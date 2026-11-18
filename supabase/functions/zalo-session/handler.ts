import {
	asRefusal,
	BINDING_CODE_PATTERN,
	BRAND_KEY_PATTERN,
	fetchZaloUser,
	functionBackend,
	functionSettings,
	legalTextAnswer,
	NOTICE_VERSION_PATTERN,
	noticeAnswer,
	PAIRING_CODE_PATTERN,
	parseSignIn,
	parseTexts,
	requireBrandApp,
	type SignInResult,
	type SupabaseBackend,
	staffLoginEmail,
	UpstreamError,
	type ZaloFetch,
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

export const FUNCTION_NAME = "zalo-session";
export const DEFAULT_DISPLAY_NAME = "Thành viên";
export const ACCESS_TOKEN_MAX_LENGTH = 4096;
export const SHOWN_AT_MAX_LENGTH = 40;
export const TEXTS_REQUEST_FIELDS: readonly string[] = ["brand", "texts"];

export interface ZaloSessionDependencies {
	readonly fetch?: ZaloFetch;
	readonly backend?: SupabaseBackend;
	readonly log?: (line: string) => void;
	readonly requestId?: () => string;
	readonly newLoginId?: () => string;
}

interface NoticeAcceptance {
	readonly version: string;
	readonly shownAt: string;
}

interface SessionRequest {
	readonly accessToken: string;
	readonly brand: string;
	readonly bindingCode: string | null;
	readonly pairingCode: string | null;
	readonly notice: NoticeAcceptance | null;
}

function noticeAcceptance(value: unknown): NoticeAcceptance | null {
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

function sessionRequest(
	body: Readonly<Record<string, unknown>>,
): SessionRequest {
	const accessToken = body.access_token;
	if (
		typeof accessToken !== "string" ||
		accessToken.trim() === "" ||
		accessToken.length > ACCESS_TOKEN_MAX_LENGTH
	) {
		throw new HttpError(400, "invalid_access_token");
	}
	const brand = body.brand;
	if (typeof brand !== "string" || !BRAND_KEY_PATTERN.test(brand)) {
		throw new HttpError(400, "invalid_brand");
	}
	const bindingCode = body.binding_code;
	if (
		bindingCode !== undefined &&
		bindingCode !== null &&
		(typeof bindingCode !== "string" || !BINDING_CODE_PATTERN.test(bindingCode))
	) {
		throw new HttpError(400, "invalid_binding_code");
	}
	const pairingCode = body.pairing_code;
	if (
		pairingCode !== undefined &&
		pairingCode !== null &&
		(typeof pairingCode !== "string" ||
			!PAIRING_CODE_PATTERN.test(pairingCode) ||
			typeof bindingCode === "string")
	) {
		throw new HttpError(400, "invalid_pairing_code");
	}
	return {
		accessToken,
		brand,
		bindingCode: typeof bindingCode === "string" ? bindingCode : null,
		pairingCode: typeof pairingCode === "string" ? pairingCode : null,
		notice: noticeAcceptance(body.notice),
	};
}

function textsBrand(body: Readonly<Record<string, unknown>>): string {
	if (
		body.texts !== true ||
		!Object.keys(body).every((field) => TEXTS_REQUEST_FIELDS.includes(field))
	) {
		throw new HttpError(400, "invalid_texts");
	}
	const brand = body.brand;
	if (typeof brand !== "string" || !BRAND_KEY_PATTERN.test(brand)) {
		throw new HttpError(400, "invalid_brand");
	}
	return brand;
}

async function publishedTexts(
	brand: string,
	settings: ZaloSettings,
	context: RequestContext,
	dependencies: ZaloSessionDependencies,
): Promise<Response> {
	const backend =
		dependencies.backend ??
		functionBackend(context.environment, dependencies.fetch);
	const app = await requireBrandApp(backend, settings, brand);
	const answer = parseTexts(
		await backend.rpc("zalo_session_texts", { p_zalo_app_id: app.zaloAppId }),
	);
	if (answer.status === "wait") {
		context.log(
			`texts: held back for ${answer.retryAfter} s after too many requests for the app`,
		);
		return json(
			{ error: "too_many_requests", request_id: context.requestId },
			429,
			{ "retry-after": String(answer.retryAfter) },
		);
	}
	context.log(
		`texts: ${answer.documents.length} documents, contact ${answer.contact === null ? "not set" : "set"}`,
	);
	return json(
		{
			status: "texts",
			documents: answer.documents.map(legalTextAnswer),
			contact: answer.contact,
		},
		200,
	);
}

function unpairedLog(
	input: SessionRequest,
	signIn: Extract<SignInResult, { status: "unpaired" }>,
): string {
	switch (signIn.reason) {
		case "code_refused":
			return "unpaired: the pairing code was refused";
		case "wait":
			return "unpaired: the identity waits after too many wrong codes";
		case "notice_outdated":
			return "unpaired: the accepted notice is not the published one";
		default:
			return input.bindingCode !== null || input.pairingCode !== null
				? "unpaired: the binding code was refused"
				: "unpaired: the identity is not bound to a member";
	}
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

async function signInOrPair(
	backend: SupabaseBackend,
	input: SessionRequest,
	args: Readonly<Record<string, unknown>>,
	context: RequestContext,
	newLoginId: () => string,
): Promise<{ readonly signIn: SignInResult; readonly loginCreated: boolean }> {
	if (input.pairingCode === null && input.notice === null) {
		return {
			signIn: parseSignIn(
				await backend.rpc("zalo_session_sign_in", {
					...args,
					p_binding_code: input.bindingCode,
				}),
			),
			loginCreated: false,
		};
	}
	const pairArgs = {
		...args,
		p_code: input.pairingCode ?? input.bindingCode,
		p_notice_version: input.notice?.version ?? null,
		p_notice_shown_at: input.notice?.shownAt ?? null,
		p_new_user_id: null,
	};
	const first = parseSignIn(await backend.rpc("zalo_session_pair", pairArgs));
	if (first.status !== "login_needed") {
		return { signIn: first, loginCreated: false };
	}
	const email = staffLoginEmail(newLoginId());
	context.protect(email);
	const created = await backend.createLogin(email);
	context.protect(created);
	let second: SignInResult;
	try {
		second = parseSignIn(
			await backend.rpc("zalo_session_pair", {
				...pairArgs,
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
	const used = second.status === "bound" && second.userId === created;
	if (!used) {
		await discardLogin(backend, created, context);
	}
	return { signIn: second, loginCreated: used };
}

async function zaloSession(
	request: Request,
	context: RequestContext,
	dependencies: ZaloSessionDependencies,
): Promise<Response> {
	requireMethod(request, "POST");
	try {
		const settings = functionSettings(context.environment);
		const { body } = await readJsonObject(request);
		if (body.texts !== undefined) {
			return await publishedTexts(
				textsBrand(body),
				settings,
				context,
				dependencies,
			);
		}
		const input = sessionRequest(body);
		context.protect(input.accessToken);
		if (input.bindingCode !== null) {
			context.protect(input.bindingCode);
		}
		if (input.pairingCode !== null) {
			context.protect(input.pairingCode);
		}
		const backend =
			dependencies.backend ??
			functionBackend(context.environment, dependencies.fetch);
		const app = await requireBrandApp(backend, settings, input.brand);
		const appSecret = context.secret(app.secretName);
		const me = await fetchZaloUser(
			{ baseUrl: settings.graphBaseUrl, fetch: dependencies.fetch },
			input.accessToken,
			appSecret,
		);
		if (!me.ok) {
			context.log(
				`the Zalo graph refused the access token (error ${me.error})`,
			);
			throw new HttpError(401, "zalo_token_refused");
		}
		context.protect(me.value.id);
		if (me.value.name !== null) {
			context.protect(me.value.name);
		}
		const { signIn, loginCreated } = await signInOrPair(
			backend,
			input,
			{
				p_zalo_app_id: app.zaloAppId,
				p_zalo_user_id: me.value.id,
				p_display_name: me.value.name,
			},
			context,
			dependencies.newLoginId ?? (() => crypto.randomUUID()),
		);
		if (signIn.status === "unpaired") {
			context.log(unpairedLog(input, signIn));
			return json(
				{
					status: "unpaired",
					...(signIn.reason === undefined ? {} : { reason: signIn.reason }),
					...(signIn.retryAfter === undefined
						? {}
						: { retry_after: signIn.retryAfter }),
					...(signIn.notice === undefined
						? {}
						: { notice: noticeAnswer(signIn.notice) }),
					...(signIn.contact === undefined ? {} : { contact: signIn.contact }),
				},
				200,
			);
		}
		if (signIn.status === "notice_required") {
			context.log(
				"notice required: the staff_ops consent is missing or outdated",
			);
			return json(
				{
					status: "notice_required",
					...(signIn.notice === undefined
						? {}
						: { notice: noticeAnswer(signIn.notice) }),
					...(signIn.contact === undefined ? {} : { contact: signIn.contact }),
				},
				200,
			);
		}
		if (signIn.status === "login_needed") {
			throw new UpstreamError("supabase", "invalid_answer");
		}
		const email = await backend.userEmail(signIn.userId);
		if (email === undefined) {
			context.log("unpaired: the bound login no longer exists");
			return json({ status: "unpaired" }, 200);
		}
		if (email === null) {
			context.log("the bound login has no e-mail to mint a session for");
			throw new HttpError(500, "session_unavailable");
		}
		context.protect(email);
		const session = await backend.mintSession(email);
		context.protect(session.accessToken);
		context.protect(session.refreshToken);
		const step =
			input.pairingCode !== null || input.bindingCode !== null
				? ", identity bound"
				: input.notice !== null
					? ", notice accepted"
					: "";
		context.log(
			`session minted: ${signIn.role}, ${signIn.stores.length} stores${step}${loginCreated ? ", login created" : ""}`,
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
					...(signIn.brandStoreIds === undefined
						? {}
						: { store_ids: [...signIn.brandStoreIds] }),
					tenant_id: signIn.tenantId,
				},
			},
			200,
		);
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

export function handleZaloSession(
	request: Request,
	environment: FunctionEnvironment,
	dependencies: ZaloSessionDependencies = {},
): Promise<Response> {
	return serveFunction(
		request,
		environment,
		(incoming, context) => zaloSession(incoming, context, dependencies),
		{
			name: FUNCTION_NAME,
			...(dependencies.log === undefined ? {} : { log: dependencies.log }),
			...(dependencies.requestId === undefined
				? {}
				: { requestId: dependencies.requestId }),
		},
	);
}
