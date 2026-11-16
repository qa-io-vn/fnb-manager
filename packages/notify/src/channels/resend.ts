import { emailHtml } from "../render/html.js";
import { SENDER_EMAIL_KEY, SENDER_NAME_KEY } from "./brevo.js";
import {
	failureOutcome,
	httpCode,
	isRecord,
	jsonHeaders,
	parseJson,
	retryAfterSeconds,
	type TimedResponse,
	timedFetch,
} from "./timed-fetch.js";
import type {
	ChannelAdapter,
	Destination,
	ProviderLimits,
	RenderedMessage,
	SendContext,
	SendOutcome,
} from "./types.js";

export const RESEND_LIMITS: ProviderLimits = {
	maxTextUnits: 8000,
	maxSubjectChars: 120,
	supportsHtml: true,
	idempotent: true,
	minSpacingMs: 0,
};

export const RESEND_SEND_PATH = "/emails";
export const RESEND_RATE_LIMIT_RETRY_SECONDS = 60;
export const RESEND_CONCURRENT_RETRY_SECONDS = 30;
const DEFAULT_SENDER_NAME = "FNB Manager";
const INVALID_IDEMPOTENT = "invalid_idempotent_request";
const CONCURRENT_IDEMPOTENT = "concurrent_idempotent_requests";
const SENDER_NAME_UNSAFE = /[<>"\r\n]/g;

function errorNameOf(response: TimedResponse): string | null {
	const parsed = parseJson(response.body);
	if (!isRecord(parsed)) {
		return null;
	}
	for (const key of ["name", "code", "type"]) {
		const value = parsed[key];
		if (typeof value === "string" && /^[a-z0-9_]{1,60}$/.test(value)) {
			return value;
		}
	}
	return null;
}

function messageIdOf(response: TimedResponse): string | null {
	const parsed = parseJson(response.body);
	if (!isRecord(parsed)) {
		return null;
	}
	const id = parsed.id;
	return typeof id === "string" && id.length > 0 ? id.slice(0, 200) : null;
}

export function classifyResendSend(
	response: TimedResponse,
	now: () => Date,
): SendOutcome {
	const { status } = response;
	if (status >= 200 && status < 300) {
		return { kind: "sent", providerMessageId: messageIdOf(response) };
	}
	if (status === 409) {
		const name = errorNameOf(response);
		if (name === CONCURRENT_IDEMPOTENT) {
			return {
				kind: "retry",
				code: CONCURRENT_IDEMPOTENT,
				retryAfterSeconds: RESEND_CONCURRENT_RETRY_SECONDS,
			};
		}
		return {
			kind: "failed",
			code: name === INVALID_IDEMPOTENT ? INVALID_IDEMPOTENT : httpCode(409),
			scope: "message",
		};
	}
	if (status === 400 || status === 422) {
		return { kind: "failed", code: "bad_request", scope: "message" };
	}
	if (status === 401 || status === 403) {
		return { kind: "failed", code: "unauthorized", scope: "channel" };
	}
	if (status === 429) {
		const after = retryAfterSeconds(response.headers, now);
		return {
			kind: "retry",
			code: "rate_limited",
			retryAfterSeconds: after ?? RESEND_RATE_LIMIT_RETRY_SECONDS,
		};
	}
	if (status >= 500) {
		return { kind: "retry", code: httpCode(status), retryAfterSeconds: null };
	}
	return { kind: "failed", code: httpCode(status), scope: "message" };
}

export interface ResendPayload {
	readonly from: string;
	readonly to: readonly string[];
	readonly subject: string;
	readonly text: string;
	readonly html: string;
}

export function resendPayload(
	message: RenderedMessage,
	destination: Destination,
): ResendPayload | null {
	const senderEmail = destination.config[SENDER_EMAIL_KEY]?.trim() ?? "";
	if (senderEmail === "") {
		return null;
	}
	const senderName = (
		destination.config[SENDER_NAME_KEY]?.trim() || DEFAULT_SENDER_NAME
	).replace(SENDER_NAME_UNSAFE, "");
	return {
		from: `${senderName} <${senderEmail}>`,
		to: [destination.address],
		subject: message.subject ?? DEFAULT_SENDER_NAME,
		text: message.text,
		html: message.html ?? emailHtml(message.kind, message.text),
	};
}

export function createResendAdapter(): ChannelAdapter {
	return {
		provider: "resend",
		kind: "email",
		available: true,
		limits: RESEND_LIMITS,
		async send(
			message: RenderedMessage,
			destination: Destination,
			context: SendContext,
		): Promise<SendOutcome> {
			const payload = resendPayload(message, destination);
			if (payload === null) {
				return { kind: "failed", code: "sender_missing", scope: "channel" };
			}
			const response = await timedFetch(
				context.fetch,
				`${context.baseUrl}${RESEND_SEND_PATH}`,
				{
					method: "POST",
					headers: {
						...jsonHeaders(context.userAgent),
						authorization: `Bearer ${context.secret}`,
						"idempotency-key": message.messageId,
					},
					body: JSON.stringify(payload),
				},
				context.timeoutMs,
			);
			if (response.kind === "failure") {
				return failureOutcome(response.code, RESEND_LIMITS.idempotent);
			}
			return classifyResendSend(response, context.now);
		},
	};
}
