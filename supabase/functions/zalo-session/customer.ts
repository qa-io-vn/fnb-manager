import {
	BRAND_KEY_PATTERN,
	type BrandApp,
	CUSTOMER_SESSION_KIND,
	type CustomerJoinReason,
	type CustomerSignInResult,
	customerAppMetadata,
	customerLoginEmail,
	exchangePhoneToken,
	type GraphOutcome,
	NOTICE_VERSION_PATTERN,
	PHONE_TOKEN_USED,
	parseCustomerJoin,
	parseCustomerSignIn,
	type SupabaseBackend,
	UpstreamError,
	type ZaloFetch,
	type ZaloSettings,
	type ZaloUser,
} from "@fnb/zalo";
import { HttpError, json, type RequestContext } from "../_shared/http.ts";

export const CUSTOMER_REQUEST_FIELDS: readonly string[] = [
	"kind",
	"access_token",
	"brand",
	"join",
];
export const PHONE_TOKEN_MAX_LENGTH = 4096;
export const SHOWN_AT_MAX_LENGTH = 40;
export const STORE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const CUSTOMER_JOIN_CHANNEL = "mini_app";

export const JOIN_REFUSALS: Readonly<
	Record<CustomerJoinReason, { readonly status: number; readonly code: string }>
> = {
	consent_required: { status: 400, code: "loyalty_consent_required" },
	policy_outdated: { status: 409, code: "policy_outdated" },
	unknown_store: { status: 404, code: "unknown_store" },
	phone_in_use: { status: 409, code: "phone_in_use" },
	no_programme: { status: 409, code: "no_programme" },
};

export interface CustomerJoinInput {
	readonly phoneToken: string;
	readonly marketingConsent: boolean;
	readonly policyVersion: string;
	readonly screenVersion: string;
	readonly store: string | null;
	readonly shownAt: string;
}

export interface CustomerRequest {
	readonly accessToken: string;
	readonly brand: string;
	readonly join: CustomerJoinInput | null;
}

function joinInput(value: unknown): CustomerJoinInput | null {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new HttpError(400, "invalid_join");
	}
	const join = value as Readonly<Record<string, unknown>>;
	if (join.loyalty_consent !== true) {
		throw new HttpError(400, "loyalty_consent_required");
	}
	const phoneToken = join.phone_token;
	if (
		typeof phoneToken !== "string" ||
		phoneToken.trim() === "" ||
		phoneToken.length > PHONE_TOKEN_MAX_LENGTH
	) {
		throw new HttpError(400, "invalid_phone_token");
	}
	const { marketing_consent, policy_version, screen_version, store, shown_at } =
		join;
	if (
		typeof marketing_consent !== "boolean" ||
		typeof policy_version !== "string" ||
		!NOTICE_VERSION_PATTERN.test(policy_version) ||
		typeof screen_version !== "string" ||
		!NOTICE_VERSION_PATTERN.test(screen_version) ||
		(store !== null &&
			store !== undefined &&
			(typeof store !== "string" || !STORE_CODE_PATTERN.test(store))) ||
		typeof shown_at !== "string" ||
		shown_at.length > SHOWN_AT_MAX_LENGTH ||
		Number.isNaN(Date.parse(shown_at))
	) {
		throw new HttpError(400, "invalid_join");
	}
	return {
		phoneToken,
		marketingConsent: marketing_consent,
		policyVersion: policy_version,
		screenVersion: screen_version,
		store: typeof store === "string" ? store : null,
		shownAt: new Date(Date.parse(shown_at)).toISOString(),
	};
}

export function customerRequest(
	body: Readonly<Record<string, unknown>>,
): CustomerRequest {
	if (
		body.kind !== CUSTOMER_SESSION_KIND ||
		!Object.keys(body).every((field) => CUSTOMER_REQUEST_FIELDS.includes(field))
	) {
		throw new HttpError(400, "invalid_kind");
	}
	const accessToken = body.access_token;
	if (
		typeof accessToken !== "string" ||
		accessToken.trim() === "" ||
		accessToken.length > PHONE_TOKEN_MAX_LENGTH
	) {
		throw new HttpError(400, "invalid_access_token");
	}
	const brand = body.brand;
	if (typeof brand !== "string" || !BRAND_KEY_PATTERN.test(brand)) {
		throw new HttpError(400, "invalid_brand");
	}
	return { accessToken, brand, join: joinInput(body.join) };
}

async function discardLogin(
	backend: SupabaseBackend,
	userId: string,
	context: RequestContext,
): Promise<void> {
	try {
		await backend.deleteLogin(userId);
	} catch {
		context.log("an unused customer login could not be removed");
	}
}

async function customerSignIn(
	backend: SupabaseBackend,
	app: BrandApp,
	me: ZaloUser,
	context: RequestContext,
	newLoginId: () => string,
): Promise<{
	readonly signIn: Extract<CustomerSignInResult, { status: "customer" }>;
	readonly created: boolean;
}> {
	const args = {
		p_zalo_app_id: app.zaloAppId,
		p_zalo_user_id: me.id,
		p_display_name: me.name,
	};
	const first = parseCustomerSignIn(
		await backend.rpc("zalo_customer_sign_in", {
			...args,
			p_new_user_id: null,
		}),
	);
	if (first.status === "customer") {
		return { signIn: first, created: false };
	}
	const email = customerLoginEmail(newLoginId());
	context.protect(email);
	const created = await backend.createLogin(
		email,
		customerAppMetadata(app.tenantId, null),
	);
	context.protect(created);
	let second: CustomerSignInResult;
	try {
		second = parseCustomerSignIn(
			await backend.rpc("zalo_customer_sign_in", {
				...args,
				p_new_user_id: created,
			}),
		);
	} catch (error) {
		await discardLogin(backend, created, context);
		throw error;
	}
	if (second.status !== "customer") {
		await discardLogin(backend, created, context);
		throw new UpstreamError("supabase", "invalid_answer");
	}
	if (second.userId !== created) {
		await discardLogin(backend, created, context);
	}
	return { signIn: second, created: second.userId === created };
}

async function decodePhone(
	settings: ZaloSettings,
	fetch: ZaloFetch | undefined,
	accessToken: string,
	phoneToken: string,
	appSecret: string,
	context: RequestContext,
): Promise<string> {
	let result: GraphOutcome<string>;
	try {
		result = await exchangePhoneToken(
			{ baseUrl: settings.graphBaseUrl, fetch },
			accessToken,
			phoneToken,
			appSecret,
		);
	} catch (error) {
		if (error instanceof UpstreamError && error.service === "zalo") {
			context.log(
				"the Zalo graph did not answer the phone exchange; the token may be spent",
			);
			throw new HttpError(502, "zalo_unavailable");
		}
		throw error;
	}
	if (!result.ok) {
		context.log(
			`the Zalo graph refused the phone token (error ${result.error})`,
		);
		throw result.error === PHONE_TOKEN_USED
			? new HttpError(409, "phone_token_used")
			: new HttpError(422, "phone_token_refused");
	}
	context.protect(result.value);
	return result.value;
}

export interface CustomerSessionInput {
	readonly request: CustomerRequest;
	readonly settings: ZaloSettings;
	readonly backend: SupabaseBackend;
	readonly app: BrandApp;
	readonly me: ZaloUser;
	readonly appSecret: string;
	readonly fetch: ZaloFetch | undefined;
	readonly newLoginId: () => string;
}

export async function customerSession(
	input: CustomerSessionInput,
	context: RequestContext,
): Promise<Response> {
	const { request, backend, app, me } = input;
	const { signIn, created } = await customerSignIn(
		backend,
		app,
		me,
		context,
		input.newLoginId,
	);
	let customerId = signIn.customerId;
	let joined: {
		readonly membership_id: string;
		readonly welcome_stamps: number;
		readonly already_member: boolean;
	} | null = null;
	if (request.join !== null) {
		const join = request.join;
		context.protect(join.phoneToken);
		const phone = await decodePhone(
			input.settings,
			input.fetch,
			request.accessToken,
			join.phoneToken,
			input.appSecret,
			context,
		);
		const result = parseCustomerJoin(
			await backend.rpc("customer_join", {
				p_user_id: signIn.userId,
				p_zalo_app_id: app.zaloAppId,
				p_zalo_user_id: me.id,
				p_display_name: me.name,
				p_phone: phone,
				p_loyalty_consent: true,
				p_marketing_consent: join.marketingConsent,
				p_policy_version: join.policyVersion,
				p_screen_version: join.screenVersion,
				p_shown_at: join.shownAt,
				p_store_code: join.store,
				p_channel: CUSTOMER_JOIN_CHANNEL,
			}),
		);
		if (result.status === "refused") {
			context.log(`join refused: ${result.reason}`);
			const refusal = JOIN_REFUSALS[result.reason];
			throw new HttpError(refusal.status, refusal.code);
		}
		customerId = result.customerId;
		joined = {
			membership_id: result.membershipId,
			welcome_stamps: result.welcomeStamps,
			already_member: result.alreadyMember,
		};
		context.log(
			`customer joined${result.alreadyMember ? " again" : ""}, marketing ${join.marketingConsent ? "given" : "not given"}, ${result.welcomeStamps} welcome stamps`,
		);
	}
	await backend.setAppMetadata(
		signIn.userId,
		customerAppMetadata(signIn.tenantId, customerId),
	);
	const email = await backend.userEmail(signIn.userId);
	if (email === undefined || email === null) {
		context.log("the customer login has no e-mail to mint a session for");
		throw new HttpError(500, "session_unavailable");
	}
	context.protect(email);
	const session = await backend.mintSession(email);
	context.protect(session.accessToken);
	context.protect(session.refreshToken);
	context.log(
		`customer session minted: ${customerId === null ? "visitor" : "member"}${created ? ", login created" : ""}`,
	);
	return json(
		{
			status: CUSTOMER_SESSION_KIND,
			access_token: session.accessToken,
			refresh_token: session.refreshToken,
			expires_at: session.expiresAt,
			customer: {
				tenant_id: signIn.tenantId,
				customer_id: customerId,
				display_name: signIn.displayName,
			},
			...(joined === null ? {} : { joined }),
		},
		200,
	);
}
