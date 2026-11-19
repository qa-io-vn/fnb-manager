import {
	failureOutcome,
	httpCode,
	isRecord,
	parseJson,
	retryAfterSeconds,
	type TimedResponse,
	timedFetch,
} from "./timed-fetch.js";
import type { FetchLike, SendOutcome } from "./types.js";

export const ZBS_BASE_URL = "https://business.openapi.zalo.me";
export const ZBS_TEMPLATE_PATH = "/message/template";
export const ZALO_OA_BASE_URL = "https://openapi.zalo.me";
export const ZALO_OA_CONSULTATION_PATH = "/v3.0/oa/message/cs";

export const ZBS_QUOTA_RETRY_SECONDS = 3600;
export const ZBS_NIGHT_RETRY_SECONDS = 1800;
export const ZALO_RATE_RETRY_SECONDS = 60;

export type CustomerSendOutcome =
	| SendOutcome
	| { readonly kind: "reroute"; readonly code: string };

export interface CustomerSendContext {
	readonly accessToken: string;
	readonly fetch: FetchLike;
	readonly baseUrl: string;
	readonly timeoutMs: number;
	readonly userAgent: string;
	readonly now: () => Date;
}

export type ZbsRecipient =
	| { readonly kind: "phone"; readonly phone: string }
	| { readonly kind: "uid"; readonly userId: string };

export interface ZbsTemplateRequest {
	readonly trackingId: string;
	readonly templateId: string;
	readonly recipient: ZbsRecipient;
	readonly data: Readonly<Record<string, string>>;
}

export interface ConsultationRequest {
	readonly userId: string;
	readonly text: string;
}

export const ZBS_ERRORS = {
	userInactive: -114,
	balanceInsufficient: -115,
	phoneInvalid: -108,
	templateInvalid: -109,
	templateDataEmpty: -111,
	templateDataInvalid: -112,
	buttonInvalid: -113,
	contentInvalid: -116,
	accountMissing: -118,
	cannotReceive: -119,
	accessTokenInvalid: -124,
	contentTooLong: -130,
	templateNotApproved: -131,
	parameterInvalid: -132,
	nightTime: -133,
	notPermitted: -135,
	userRefused: -139,
	dailyQuota: -144,
	templateQuota: -147,
	rateLimited: -32,
} as const;

export const OA_ERRORS = {
	rateLimited: -32,
	parameterInvalid: -201,
	userNotFollowing: -213,
	accessTokenInvalid: -216,
	outsideWindow: -230,
} as const;

const ZBS_USER_UNREACHABLE: ReadonlySet<number> = new Set([
	ZBS_ERRORS.userInactive,
	ZBS_ERRORS.phoneInvalid,
	ZBS_ERRORS.accountMissing,
	ZBS_ERRORS.cannotReceive,
	ZBS_ERRORS.userRefused,
]);

const ZBS_TEMPLATE_REJECTED: ReadonlySet<number> = new Set([
	ZBS_ERRORS.templateInvalid,
	ZBS_ERRORS.templateDataEmpty,
	ZBS_ERRORS.templateDataInvalid,
	ZBS_ERRORS.buttonInvalid,
	ZBS_ERRORS.contentInvalid,
	ZBS_ERRORS.contentTooLong,
	ZBS_ERRORS.templateNotApproved,
	ZBS_ERRORS.parameterInvalid,
]);

function headers(context: CustomerSendContext): Record<string, string> {
	return {
		"content-type": "application/json; charset=utf-8",
		accept: "application/json",
		"user-agent": context.userAgent,
		access_token: context.accessToken,
	};
}

interface Envelope {
	readonly error: number | null;
	readonly data: Record<string, unknown> | null;
}

function envelopeOf(response: TimedResponse): Envelope | null {
	const parsed = parseJson(response.body);
	if (!isRecord(parsed)) {
		return null;
	}
	const error = parsed.error;
	const code =
		typeof error === "number" && Number.isInteger(error)
			? error
			: typeof error === "string" && /^-?\d+$/.test(error)
				? Number(error)
				: null;
	return { error: code, data: isRecord(parsed.data) ? parsed.data : null };
}

function idOf(
	data: Record<string, unknown> | null,
	key: string,
): string | null {
	const value = data?.[key];
	return typeof value === "string" || typeof value === "number"
		? String(value)
		: null;
}

function httpFailure(
	response: TimedResponse,
	now: () => Date,
): CustomerSendOutcome | null {
	if (response.status === 429) {
		const after = retryAfterSeconds(response.headers, now);
		return {
			kind: "retry",
			code: "rate_limited",
			retryAfterSeconds: Math.max(ZALO_RATE_RETRY_SECONDS, after ?? 0),
		};
	}
	if (response.status === 401 || response.status === 403) {
		return { kind: "failed", code: "token_invalid", scope: "channel" };
	}
	if (response.status === 408 || response.status >= 500) {
		return {
			kind: "retry",
			code: httpCode(response.status),
			retryAfterSeconds: null,
		};
	}
	if (response.status < 200 || response.status >= 300) {
		return {
			kind: "failed",
			code: httpCode(response.status),
			scope: "message",
		};
	}
	return null;
}

export function classifyZbsResponse(
	response: TimedResponse,
	now: () => Date,
): CustomerSendOutcome {
	const failure = httpFailure(response, now);
	if (failure !== null) {
		return failure;
	}
	const envelope = envelopeOf(response);
	if (envelope === null || envelope.error === null) {
		return { kind: "uncertain", code: "bad_response" };
	}
	const code = envelope.error;
	if (code === 0) {
		return { kind: "sent", providerMessageId: idOf(envelope.data, "msg_id") };
	}
	if (code === ZBS_ERRORS.accessTokenInvalid) {
		return { kind: "failed", code: "token_invalid", scope: "channel" };
	}
	if (code === ZBS_ERRORS.balanceInsufficient) {
		return { kind: "failed", code: "balance_insufficient", scope: "channel" };
	}
	if (code === ZBS_ERRORS.notPermitted) {
		return { kind: "failed", code: "not_permitted", scope: "channel" };
	}
	if (code === ZBS_ERRORS.dailyQuota || code === ZBS_ERRORS.templateQuota) {
		return {
			kind: "retry",
			code: "quota_exceeded",
			retryAfterSeconds: ZBS_QUOTA_RETRY_SECONDS,
		};
	}
	if (code === ZBS_ERRORS.nightTime) {
		return {
			kind: "retry",
			code: "outside_hours",
			retryAfterSeconds: ZBS_NIGHT_RETRY_SECONDS,
		};
	}
	if (code === ZBS_ERRORS.rateLimited) {
		return {
			kind: "retry",
			code: "rate_limited",
			retryAfterSeconds: ZALO_RATE_RETRY_SECONDS,
		};
	}
	if (ZBS_USER_UNREACHABLE.has(code)) {
		return { kind: "failed", code: "user_unreachable", scope: "message" };
	}
	if (ZBS_TEMPLATE_REJECTED.has(code)) {
		return { kind: "failed", code: "template_rejected", scope: "message" };
	}
	return {
		kind: "failed",
		code: `zbs_error_${Math.abs(code)}`,
		scope: "message",
	};
}

export function zbsPayload(
	request: ZbsTemplateRequest,
): Record<string, unknown> {
	return {
		...(request.recipient.kind === "phone"
			? { phone: request.recipient.phone }
			: { user_id: request.recipient.userId }),
		template_id: request.templateId,
		template_data: { ...request.data },
		tracking_id: request.trackingId,
	};
}

export async function sendZbsTemplate(
	request: ZbsTemplateRequest,
	context: CustomerSendContext,
): Promise<CustomerSendOutcome> {
	const response = await timedFetch(
		context.fetch,
		`${context.baseUrl}${ZBS_TEMPLATE_PATH}`,
		{
			method: "POST",
			headers: headers(context),
			body: JSON.stringify(zbsPayload(request)),
		},
		context.timeoutMs,
	);
	if (response.kind === "failure") {
		return failureOutcome(response.code, false);
	}
	return classifyZbsResponse(response, context.now);
}

export function classifyConsultationResponse(
	response: TimedResponse,
	now: () => Date,
): CustomerSendOutcome {
	const failure = httpFailure(response, now);
	if (failure !== null) {
		return failure;
	}
	const envelope = envelopeOf(response);
	if (envelope === null || envelope.error === null) {
		return { kind: "uncertain", code: "bad_response" };
	}
	const code = envelope.error;
	if (code === 0) {
		return {
			kind: "sent",
			providerMessageId: idOf(envelope.data, "message_id"),
		};
	}
	if (code === OA_ERRORS.accessTokenInvalid) {
		return { kind: "failed", code: "token_invalid", scope: "channel" };
	}
	if (code === OA_ERRORS.outsideWindow) {
		return { kind: "reroute", code: "window_closed" };
	}
	if (code === OA_ERRORS.userNotFollowing) {
		return { kind: "reroute", code: "user_unreachable" };
	}
	if (code === OA_ERRORS.rateLimited) {
		return {
			kind: "retry",
			code: "rate_limited",
			retryAfterSeconds: ZALO_RATE_RETRY_SECONDS,
		};
	}
	if (code === OA_ERRORS.parameterInvalid) {
		return { kind: "failed", code: "bad_request", scope: "message" };
	}
	return {
		kind: "failed",
		code: `zalo_oa_error_${Math.abs(code)}`,
		scope: "message",
	};
}

export async function sendConsultation(
	request: ConsultationRequest,
	context: CustomerSendContext,
): Promise<CustomerSendOutcome> {
	const response = await timedFetch(
		context.fetch,
		`${context.baseUrl}${ZALO_OA_CONSULTATION_PATH}`,
		{
			method: "POST",
			headers: headers(context),
			body: JSON.stringify({
				recipient: { user_id: request.userId },
				message: { text: request.text },
			}),
		},
		context.timeoutMs,
	);
	if (response.kind === "failure") {
		return failureOutcome(response.code, false);
	}
	return classifyConsultationResponse(response, context.now);
}
