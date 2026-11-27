import {
	asRefusal,
	BRAND_KEY_PATTERN,
	type BrandApp,
	CODE_CHALLENGE_PATTERN,
	CODE_VERIFIER_PATTERN,
	deviceLineOf,
	exchangeWebLoginCode,
	fetchZaloUser,
	functionBackend,
	functionSettings,
	graphFetchFor,
	isLoopbackBaseUrl,
	NOTICE_VERSION_PATTERN,
	noticeAnswer,
	openIdentityTicket,
	PAIRING_CODE_PATTERN,
	parseBrandApps,
	parseSignIn,
	relayKeyText,
	SEALED_TEXT_PATTERN,
	type SignInResult,
	type SupabaseBackend,
	sealIdentityTicket,
	sealingKey,
	sealLoginState,
	staffLoginEmail,
	UpstreamError,
	verifyLoginState,
	WEB_LOGIN_CODE_PATTERN,
	WEB_LOGIN_STATE_TTL_MS,
	WEB_LOGIN_TICKET_TTL_MS,
	WebLoginError,
	webLoginAuthorizeUrl,
	ZALO_OAUTH_ORIGIN,
	type ZaloFetch,
	ZaloRefusal,
	type ZaloSettings,
} from "@fnb/zalo";
import {
	type FunctionEnvironment,
	HttpError,
	json,
	type RequestContext,
	readJsonObject,
	requireMethod,
	serveFunction,
} from "../_shared/http.ts";

/**
 * counter-session (ADR-064, ADR-066): the counter web app signs people in with Zalo's web login (OAuth v4 with PKCE).
 * Three requests, all POST with JSON:
 *
 * - start: the browser sends its code challenge and its address; the function answers Zalo's authorise address with
 *   a state sealed under a key derived from the App secret (the challenge, the address and ten minutes).
 * - callback: the browser sends the code, the state and its PKCE verifier; the function checks the state, exchanges
 *   the code with the App secret and asks Zalo who the person is (both through the relay of ADR-057 when one is
 *   set), then maps the person to a member exactly as the staff Mini App does (zalo_session_sign_in). A member gets a
 *   session of their login; a person the roster does not know is refused, recorded for the managers (M02, acceptance
 *   criterion 5) and given a short sealed ticket, with which they may type a pairing code and accept the staff notice.
 * - pair: the ticket, a six-digit pairing code and/or the notice acceptance (zalo_session_pair, as zalo-session).
 *
 * Only owners, managers and staff get a session: a viewer or publisher bound to the brand's app is refused.
 */

export const FUNCTION_NAME = "counter-session";
export const REDIRECT_URIS_VARIABLE = "COUNTER_REDIRECT_URIS";
export const OAUTH_BASE_URL_VARIABLE = "ZALO_OAUTH_BASE_URL";
export const DEFAULT_DISPLAY_NAME = "Nhân viên";
export const COUNTER_ROLES: readonly string[] = ["owner", "manager", "staff"];
export const REDIRECT_URI_MAX_LENGTH = 200;
const LOOPBACK_REDIRECT = /^http:\/\/(127\.0\.0\.1|localhost):[0-9]{1,5}\/$/;
const HTTPS_REDIRECT = /^https:\/\/[a-z0-9.-]+(:[0-9]{1,5})?\/[A-Za-z0-9/_-]*$/;
const SHOWN_AT_MAX_LENGTH = 40;

export interface CounterSessionDependencies {
	readonly fetch?: ZaloFetch;
	readonly backend?: SupabaseBackend;
	readonly log?: (line: string) => void;
	readonly requestId?: () => string;
	readonly newLoginId?: () => string;
	readonly now?: () => number;
}

interface CounterApp extends BrandApp {
	readonly externalId: string;
}

interface Notice {
	readonly version: string;
	readonly shownAt: string;
}

function stringField(
	body: Readonly<Record<string, unknown>>,
	name: string,
	pattern: RegExp,
	code: string,
): string {
	const value = body[name];
	if (typeof value !== "string" || !pattern.test(value)) {
		throw new HttpError(400, code);
	}
	return value;
}

function onlyFields(
	body: Readonly<Record<string, unknown>>,
	allowed: readonly string[],
): void {
	if (!Object.keys(body).every((field) => allowed.includes(field))) {
		throw new HttpError(400, "invalid_request");
	}
}

/** The exact addresses the app may come back to: the configured list, and loopback addresses on the local stack. */
export function allowedRedirects(environment: FunctionEnvironment): string[] {
	return (environment[REDIRECT_URIS_VARIABLE] ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "" && HTTPS_REDIRECT.test(entry));
}

function redirectAllowed(
	redirectUri: string,
	environment: FunctionEnvironment,
	settings: ZaloSettings,
): boolean {
	if (redirectUri.length > REDIRECT_URI_MAX_LENGTH) {
		return false;
	}
	if (allowedRedirects(environment).includes(redirectUri)) {
		return true;
	}
	return settings.local && LOOPBACK_REDIRECT.test(redirectUri);
}

/** The origins CORS lets in: those of the allowed redirect addresses, and a loopback origin on the local stack. */
export function allowedOrigins(
	request: Request,
	environment: FunctionEnvironment,
): string[] {
	const origins = allowedRedirects(environment).map(
		(entry) => new URL(entry).origin,
	);
	const origin = request.headers.get("origin");
	if (
		origin !== null &&
		environment.ZALO_LOCAL_DEV === "1" &&
		isLoopbackBaseUrl(origin)
	) {
		origins.push(origin);
	}
	return origins;
}

function oauthBaseOf(
	environment: FunctionEnvironment,
	settings: ZaloSettings,
): string {
	const override = environment[OAUTH_BASE_URL_VARIABLE]?.trim() ?? "";
	if (override === "") {
		return ZALO_OAUTH_ORIGIN;
	}
	if (!(settings.local || settings.integration)) {
		throw new ZaloRefusal(
			500,
			"not_configured",
			`${OAUTH_BASE_URL_VARIABLE} is accepted only on the local stack or in the integration gate`,
		);
	}
	if (!isLoopbackBaseUrl(override)) {
		throw new ZaloRefusal(
			500,
			"not_configured",
			`${OAUTH_BASE_URL_VARIABLE} must be a loopback address`,
		);
	}
	return override;
}

function text(value: unknown): string {
	if (typeof value !== "string" || value === "") {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	return value;
}

async function counterApp(
	backend: SupabaseBackend,
	settings: ZaloSettings,
	brand: string,
): Promise<CounterApp> {
	const raw = await backend.rpc("counter_session_app", {
		p_brand_key: brand,
		p_tenant_id: settings.tenantId,
	});
	const apps = parseBrandApps(raw);
	const [app] = apps;
	if (app === undefined || !Array.isArray(raw)) {
		throw new ZaloRefusal(404, "unknown_brand", "no Zalo App for the brand");
	}
	if (apps.length > 1) {
		throw new ZaloRefusal(
			500,
			"not_configured",
			"the brand key names Zalo Apps of more than one tenant; set ZALO_TENANT_ID",
		);
	}
	if (app.status !== "active") {
		throw new ZaloRefusal(
			403,
			"app_disabled",
			"the brand's Zalo App is disabled",
		);
	}
	const row = raw[0] as Record<string, unknown>;
	return { ...app, externalId: text(row.external_id) };
}

function noticeOf(value: unknown): Notice | null {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new HttpError(400, "invalid_notice");
	}
	const { version, shown_at: shownAt } = value as Record<string, unknown>;
	if (typeof version !== "string" || !NOTICE_VERSION_PATTERN.test(version)) {
		throw new HttpError(400, "invalid_notice");
	}
	if (
		typeof shownAt !== "string" ||
		shownAt.length > SHOWN_AT_MAX_LENGTH ||
		Number.isNaN(Date.parse(shownAt))
	) {
		throw new HttpError(400, "invalid_notice");
	}
	return { version, shownAt: new Date(Date.parse(shownAt)).toISOString() };
}

async function discardLogin(
	backend: SupabaseBackend,
	userId: string,
	context: RequestContext,
): Promise<void> {
	try {
		await backend.deleteLogin(userId);
	} catch {
		context.log("an unused login could not be removed");
	}
}

/** zalo_session_pair as zalo-session calls it: a fresh login is made only when the database asks for one. */
async function pair(
	backend: SupabaseBackend,
	args: Readonly<Record<string, unknown>>,
	context: RequestContext,
	newLoginId: () => string,
): Promise<SignInResult> {
	const first = parseSignIn(await backend.rpc("zalo_session_pair", args));
	if (first.status !== "login_needed") {
		return first;
	}
	const email = staffLoginEmail(newLoginId());
	context.protect(email);
	const created = await backend.createLogin(email);
	context.protect(created);
	let second: SignInResult;
	try {
		second = parseSignIn(
			await backend.rpc("zalo_session_pair", {
				...args,
				p_new_user_id: created,
			}),
		);
	} catch (error) {
		await discardLogin(backend, created, context);
		throw error;
	}
	if (second.status === "login_needed") {
		await discardLogin(backend, created, context);
		throw new UpstreamError("supabase", "invalid_answer");
	}
	if (!(second.status === "bound" && second.userId === created)) {
		await discardLogin(backend, created, context);
	}
	return second;
}

interface Person {
	readonly zaloUserId: string;
	readonly displayName: string | null;
}

async function answer(
	signIn: SignInResult,
	person: Person,
	app: CounterApp,
	appSecret: string,
	backend: SupabaseBackend,
	request: Request,
	context: RequestContext,
	now: number,
): Promise<Response> {
	if (signIn.status === "bound") {
		if (!COUNTER_ROLES.includes(signIn.role)) {
			context.log(`refused: a ${signIn.role} has no counter session`);
			throw new HttpError(403, "role_not_allowed");
		}
		const email = await backend.userEmail(signIn.userId);
		if (email === undefined || email === null) {
			context.log("the bound login has no e-mail to mint a session for");
			throw new HttpError(500, "session_unavailable");
		}
		context.protect(email);
		const session = await backend.mintSession(email);
		context.protect(session.accessToken);
		context.protect(session.refreshToken);
		context.log(
			`session minted: ${signIn.role}, ${signIn.stores.length} stores`,
		);
		return json(
			{
				status: "bound",
				access_token: session.accessToken,
				refresh_token: session.refreshToken,
				expires_at: session.expiresAt,
				member: {
					display_name: signIn.displayName ?? DEFAULT_DISPLAY_NAME,
					role: signIn.role,
					stores: [...signIn.stores],
					store_ids:
						signIn.brandStoreIds === undefined
							? null
							: [...signIn.brandStoreIds],
					tenant_id: signIn.tenantId,
				},
			},
			200,
		);
	}
	if (signIn.status === "login_needed") {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	const ticket = await sealIdentityTicket(
		await sealingKey(appSecret, "ticket"),
		{
			zaloAppId: app.zaloAppId,
			zaloUserId: person.zaloUserId,
			displayName: person.displayName,
			expiresAt: now + WEB_LOGIN_TICKET_TTL_MS,
		},
	);
	context.protect(ticket);
	if (signIn.status === "unpaired") {
		const recorded = await backend.rpc("counter_record_blocked_signin", {
			p_zalo_app_id: app.zaloAppId,
			p_zalo_user_id: person.zaloUserId,
			p_display_name: person.displayName,
			p_device: deviceLineOf(request.headers.get("user-agent")),
		});
		context.log(
			`unpaired${signIn.reason === undefined ? "" : ` (${signIn.reason})`}; ${
				(recorded as Record<string, unknown> | null)?.recorded === true
					? "recorded for the managers"
					: "not recorded"
			}`,
		);
	} else {
		context.log(
			"notice required: the staff_ops consent is missing or outdated",
		);
	}
	return json(
		{
			status: signIn.status,
			ticket,
			ticket_expires_at: new Date(now + WEB_LOGIN_TICKET_TTL_MS).toISOString(),
			...(signIn.status === "unpaired" && signIn.reason !== undefined
				? { reason: signIn.reason }
				: {}),
			...(signIn.status === "unpaired" && signIn.retryAfter !== undefined
				? { retry_after: signIn.retryAfter }
				: {}),
			...(signIn.notice === undefined
				? {}
				: { notice: noticeAnswer(signIn.notice) }),
			...(signIn.contact === undefined ? {} : { contact: signIn.contact }),
		},
		200,
	);
}

async function start(
	body: Readonly<Record<string, unknown>>,
	context: RequestContext,
	dependencies: CounterSessionDependencies,
): Promise<Response> {
	onlyFields(body, ["action", "brand", "redirect_uri", "code_challenge"]);
	const brand = stringField(body, "brand", BRAND_KEY_PATTERN, "invalid_brand");
	const redirectUri = stringField(
		body,
		"redirect_uri",
		/^.{1,200}$/,
		"invalid_redirect",
	);
	const challenge = stringField(
		body,
		"code_challenge",
		CODE_CHALLENGE_PATTERN,
		"invalid_challenge",
	);
	const settings = functionSettings(context.environment);
	if (!redirectAllowed(redirectUri, context.environment, settings)) {
		context.log("refused: the redirect address is not allowed");
		throw new HttpError(403, "redirect_not_allowed");
	}
	const backend =
		dependencies.backend ??
		functionBackend(context.environment, dependencies.fetch);
	const app = await counterApp(backend, settings, brand);
	const appSecret = context.secret(app.secretName);
	const now = (dependencies.now ?? Date.now)();
	const state = await sealLoginState(await sealingKey(appSecret, "state"), {
		challenge,
		redirectUri,
		expiresAt: now + WEB_LOGIN_STATE_TTL_MS,
	});
	context.log("authorise address issued");
	return json(
		{
			status: "authorize",
			authorize_url: webLoginAuthorizeUrl(
				oauthBaseOf(context.environment, settings),
				{
					appId: app.externalId,
					redirectUri,
					codeChallenge: challenge,
					state,
				},
			),
			state,
		},
		200,
	);
}

async function callback(
	request: Request,
	body: Readonly<Record<string, unknown>>,
	context: RequestContext,
	dependencies: CounterSessionDependencies,
): Promise<Response> {
	onlyFields(body, [
		"action",
		"brand",
		"redirect_uri",
		"code",
		"state",
		"code_verifier",
	]);
	const brand = stringField(body, "brand", BRAND_KEY_PATTERN, "invalid_brand");
	const redirectUri = stringField(
		body,
		"redirect_uri",
		/^.{1,200}$/,
		"invalid_redirect",
	);
	const code = stringField(
		body,
		"code",
		WEB_LOGIN_CODE_PATTERN,
		"invalid_code",
	);
	const state = stringField(
		body,
		"state",
		SEALED_TEXT_PATTERN,
		"invalid_state",
	);
	const verifier = stringField(
		body,
		"code_verifier",
		CODE_VERIFIER_PATTERN,
		"invalid_verifier",
	);
	context.protect(code);
	context.protect(verifier);
	const settings = functionSettings(context.environment);
	if (!redirectAllowed(redirectUri, context.environment, settings)) {
		throw new HttpError(403, "redirect_not_allowed");
	}
	const backend =
		dependencies.backend ??
		functionBackend(context.environment, dependencies.fetch);
	const app = await counterApp(backend, settings, brand);
	const appSecret = context.secret(app.secretName);
	const now = (dependencies.now ?? Date.now)();
	try {
		await verifyLoginState(await sealingKey(appSecret, "state"), state, {
			redirectUri,
			codeVerifier: verifier,
			now,
		});
	} catch (error) {
		if (error instanceof WebLoginError) {
			context.log(`refused the state (${error.code})`);
			throw new HttpError(401, "state_refused");
		}
		throw error;
	}
	const zaloFetch = await graphFetchFor(
		relayKeyText(context.environment, (name) => context.secret(name)),
		backend,
		dependencies.fetch,
	);
	const exchanged = await exchangeWebLoginCode(
		{ baseUrl: oauthBaseOf(context.environment, settings), fetch: zaloFetch },
		{ appId: app.externalId, appSecret, code, codeVerifier: verifier },
	);
	if (!exchanged.ok) {
		context.log(
			`Zalo refused the authorisation code (error ${exchanged.error})`,
		);
		throw new HttpError(401, "zalo_code_refused");
	}
	context.protect(exchanged.accessToken);
	const me = await fetchZaloUser(
		{ baseUrl: settings.graphBaseUrl, fetch: zaloFetch },
		exchanged.accessToken,
		appSecret,
	);
	if (!me.ok) {
		context.log(`the Zalo graph refused the access token (error ${me.error})`);
		throw new HttpError(401, "zalo_token_refused");
	}
	context.protect(me.value.id);
	if (me.value.name !== null) {
		context.protect(me.value.name);
	}
	const signIn = parseSignIn(
		await backend.rpc("zalo_session_sign_in", {
			p_zalo_app_id: app.zaloAppId,
			p_zalo_user_id: me.value.id,
			p_display_name: me.value.name,
			p_binding_code: null,
		}),
	);
	return await answer(
		signIn,
		{ zaloUserId: me.value.id, displayName: me.value.name },
		app,
		appSecret,
		backend,
		request,
		context,
		now,
	);
}

async function pairStep(
	request: Request,
	body: Readonly<Record<string, unknown>>,
	context: RequestContext,
	dependencies: CounterSessionDependencies,
): Promise<Response> {
	onlyFields(body, ["action", "brand", "ticket", "pairing_code", "notice"]);
	const brand = stringField(body, "brand", BRAND_KEY_PATTERN, "invalid_brand");
	const ticketText = stringField(
		body,
		"ticket",
		SEALED_TEXT_PATTERN,
		"invalid_ticket",
	);
	const pairingCode =
		body.pairing_code === undefined || body.pairing_code === null
			? null
			: stringField(
					body,
					"pairing_code",
					PAIRING_CODE_PATTERN,
					"invalid_pairing_code",
				);
	const notice = noticeOf(body.notice);
	if (pairingCode === null && notice === null) {
		throw new HttpError(400, "invalid_request");
	}
	context.protect(ticketText);
	if (pairingCode !== null) {
		context.protect(pairingCode);
	}
	const settings = functionSettings(context.environment);
	const backend =
		dependencies.backend ??
		functionBackend(context.environment, dependencies.fetch);
	const app = await counterApp(backend, settings, brand);
	const appSecret = context.secret(app.secretName);
	const now = (dependencies.now ?? Date.now)();
	let person: Person;
	try {
		const ticket = await openIdentityTicket(
			await sealingKey(appSecret, "ticket"),
			ticketText,
			{
				zaloAppId: app.zaloAppId,
				now,
			},
		);
		person = { zaloUserId: ticket.zaloUserId, displayName: ticket.displayName };
	} catch (error) {
		if (error instanceof WebLoginError) {
			context.log(`refused the ticket (${error.code})`);
			throw new HttpError(401, "ticket_refused");
		}
		throw error;
	}
	context.protect(person.zaloUserId);
	const signIn = await pair(
		backend,
		{
			p_zalo_app_id: app.zaloAppId,
			p_zalo_user_id: person.zaloUserId,
			p_display_name: person.displayName,
			p_code: pairingCode,
			p_notice_version: notice?.version ?? null,
			p_notice_shown_at: notice?.shownAt ?? null,
			p_new_user_id: null,
		},
		context,
		dependencies.newLoginId ?? (() => crypto.randomUUID()),
	);
	return await answer(
		signIn,
		person,
		app,
		appSecret,
		backend,
		request,
		context,
		now,
	);
}

async function counterSession(
	request: Request,
	context: RequestContext,
	dependencies: CounterSessionDependencies,
): Promise<Response> {
	requireMethod(request, "POST");
	try {
		const { body } = await readJsonObject(request);
		switch (body.action) {
			case "start":
				return await start(body, context, dependencies);
			case "callback":
				return await callback(request, body, context, dependencies);
			case "pair":
				return await pairStep(request, body, context, dependencies);
			default:
				throw new HttpError(400, "invalid_action");
		}
	} catch (error) {
		const refused = asRefusal(error);
		if (refused === null) {
			throw error;
		}
		if (refused.logLine !== null) {
			context.log(refused.logLine);
		}
		throw new HttpError(refused.status, refused.code);
	}
}

export function handleCounterSession(
	request: Request,
	environment: FunctionEnvironment,
	dependencies: CounterSessionDependencies = {},
): Promise<Response> {
	return serveFunction(
		request,
		environment,
		(incoming, context) => counterSession(incoming, context, dependencies),
		{
			name: FUNCTION_NAME,
			origins: allowedOrigins(request, environment),
			...(dependencies.log === undefined ? {} : { log: dependencies.log }),
			...(dependencies.requestId === undefined
				? {}
				: { requestId: dependencies.requestId }),
		},
	);
}
