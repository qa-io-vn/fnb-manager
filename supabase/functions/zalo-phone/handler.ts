import {
	asRefusal,
	BRAND_KEY_PATTERN,
	bearerToken,
	exchangePhoneToken,
	functionBackend,
	functionSettings,
	type GraphOutcome,
	PHONE_TOKEN_USED,
	requireBrandApp,
	type SupabaseBackend,
	UpstreamError,
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

export const FUNCTION_NAME = "zalo-phone";
export const TOKEN_MAX_LENGTH = 4096;

export type PhoneMode = "number" | "probe";

export interface ZaloPhoneDependencies {
	readonly fetch?: ZaloFetch;
	readonly backend?: SupabaseBackend;
	readonly log?: (line: string) => void;
	readonly requestId?: () => string;
}

interface PhoneRequest {
	readonly brand: string;
	readonly accessToken: string;
	readonly mode: PhoneMode;
	readonly phoneToken: string | null;
	readonly consentErrorCode: number | null;
}

function token(value: unknown, code: string): string {
	if (
		typeof value !== "string" ||
		value.trim() === "" ||
		value.length > TOKEN_MAX_LENGTH
	) {
		throw new HttpError(400, code);
	}
	return value;
}

function phoneRequest(body: Readonly<Record<string, unknown>>): PhoneRequest {
	const brand = body.brand;
	if (typeof brand !== "string" || !BRAND_KEY_PATTERN.test(brand)) {
		throw new HttpError(400, "invalid_brand");
	}
	const accessToken = token(body.access_token, "invalid_access_token");
	const mode = body.mode ?? "number";
	if (mode !== "number" && mode !== "probe") {
		throw new HttpError(400, "invalid_mode");
	}
	const rawPhoneToken = body.phone_token;
	const phoneToken =
		mode === "probe" && (rawPhoneToken === undefined || rawPhoneToken === null)
			? null
			: token(rawPhoneToken, "invalid_phone_token");
	const consentError = body.consent_error_code;
	if (
		consentError !== undefined &&
		consentError !== null &&
		(typeof consentError !== "number" ||
			!Number.isSafeInteger(consentError) ||
			mode !== "probe")
	) {
		throw new HttpError(400, "invalid_consent_error_code");
	}
	return {
		brand,
		accessToken,
		mode,
		phoneToken,
		consentErrorCode: typeof consentError === "number" ? consentError : null,
	};
}

type ExchangeResult =
	| GraphOutcome<string>
	| { readonly ok: false; readonly unavailable: true };

async function exchangeOnce(
	exchange: () => Promise<GraphOutcome<string>>,
): Promise<ExchangeResult> {
	try {
		return await exchange();
	} catch (error) {
		if (error instanceof UpstreamError && error.service === "zalo") {
			return { ok: false, unavailable: true };
		}
		throw error;
	}
}

async function zaloPhone(
	request: Request,
	context: RequestContext,
	dependencies: ZaloPhoneDependencies,
): Promise<Response> {
	requireMethod(request, "POST");
	try {
		const settings = functionSettings(context.environment);
		const session = bearerToken(request.headers.get("authorization"));
		if (session === null) {
			throw new HttpError(401, "session_required");
		}
		context.protect(session);
		const { body } = await readJsonObject(request);
		const input = phoneRequest(body);
		context.protect(input.accessToken);
		if (input.phoneToken !== null) {
			context.protect(input.phoneToken);
		}
		const backend =
			dependencies.backend ??
			functionBackend(context.environment, dependencies.fetch);
		const caller = await backend.sessionUser(session);
		if (caller === null) {
			throw new HttpError(401, "session_required");
		}
		const app = await requireBrandApp(backend, settings, input.brand);
		const appSecret = context.secret(app.secretName);
		if (input.mode === "probe" && input.phoneToken === null) {
			context.log(
				`probe: consent no, exchange skipped, error ${input.consentErrorCode ?? "none"}`,
			);
			return json(
				{
					probe: {
						consent: false,
						exchange: "skipped",
						error_code: input.consentErrorCode,
					},
				},
				200,
			);
		}
		const phoneToken = input.phoneToken ?? "";
		const result = await exchangeOnce(() =>
			exchangePhoneToken(
				{ baseUrl: settings.graphBaseUrl, fetch: dependencies.fetch },
				input.accessToken,
				phoneToken,
				appSecret,
			),
		);
		if (result.ok) {
			context.protect(result.value);
		}
		if (input.mode === "probe") {
			const exchange = result.ok
				? "ok"
				: "unavailable" in result
					? "unavailable"
					: "refused";
			const errorCode =
				result.ok || "unavailable" in result ? null : result.error;
			context.log(
				`probe: consent yes, exchange ${exchange}, error ${errorCode ?? "none"}`,
			);
			return json(
				{ probe: { consent: true, exchange, error_code: errorCode } },
				200,
			);
		}
		if (result.ok) {
			context.log("phone number decoded");
			return json({ phone_number: result.value }, 200);
		}
		if ("unavailable" in result) {
			context.log(
				"the Zalo graph did not answer the phone exchange; the token may be spent",
			);
			throw new HttpError(502, "zalo_unavailable");
		}
		context.log(
			`the Zalo graph refused the phone token (error ${result.error})`,
		);
		throw result.error === PHONE_TOKEN_USED
			? new HttpError(409, "phone_token_used")
			: new HttpError(422, "phone_token_refused");
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

export function handleZaloPhone(
	request: Request,
	environment: FunctionEnvironment,
	dependencies: ZaloPhoneDependencies = {},
): Promise<Response> {
	return serveFunction(
		request,
		environment,
		(incoming, context) => zaloPhone(incoming, context, dependencies),
		{
			name: FUNCTION_NAME,
			...(dependencies.log === undefined ? {} : { log: dependencies.log }),
			...(dependencies.requestId === undefined
				? {}
				: { requestId: dependencies.requestId }),
		},
	);
}
