import {
	asRefusal,
	BINDING_CODE_PATTERN,
	BRAND_KEY_PATTERN,
	fetchZaloUser,
	functionBackend,
	functionSettings,
	parseSignIn,
	requireBrandApp,
	type SupabaseBackend,
	type ZaloFetch,
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

export interface ZaloSessionDependencies {
	readonly fetch?: ZaloFetch;
	readonly backend?: SupabaseBackend;
	readonly log?: (line: string) => void;
	readonly requestId?: () => string;
}

interface SessionRequest {
	readonly accessToken: string;
	readonly brand: string;
	readonly bindingCode: string | null;
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
	return {
		accessToken,
		brand,
		bindingCode: typeof bindingCode === "string" ? bindingCode : null,
	};
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
		const input = sessionRequest(body);
		context.protect(input.accessToken);
		if (input.bindingCode !== null) {
			context.protect(input.bindingCode);
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
		const signIn = parseSignIn(
			await backend.rpc("zalo_session_sign_in", {
				p_zalo_app_id: app.zaloAppId,
				p_zalo_user_id: me.value.id,
				p_display_name: me.value.name,
				p_binding_code: input.bindingCode,
			}),
		);
		if (signIn.status === "unpaired") {
			context.log(
				input.bindingCode === null
					? "unpaired: the identity is not bound to a member"
					: "unpaired: the binding code was refused",
			);
			return json({ status: "unpaired" }, 200);
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
		context.log(
			`session minted: ${signIn.role}, ${signIn.stores.length} stores${input.bindingCode === null ? "" : ", identity bound"}`,
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
