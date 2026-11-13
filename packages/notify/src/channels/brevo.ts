import { emailHtml } from "../render/html.js";
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

export const BREVO_LIMITS: ProviderLimits = {
	maxTextUnits: 8000,
	maxSubjectChars: 120,
	supportsHtml: true,
	idempotent: false,
	minSpacingMs: 0,
};

export const BREVO_SEND_PATH = "/v3/smtp/email";
export const BREVO_RATE_LIMIT_RETRY_SECONDS = 60;
export const SENDER_EMAIL_KEY = "from_email";
export const SENDER_NAME_KEY = "from_name";
const DEFAULT_SENDER_NAME = "FNB Manager";

const CHANNEL_CODES: ReadonlySet<string> = new Set([
	"unauthorized",
	"permission_denied",
	"account_under_validation",
]);
const NO_CREDIT_CODE = "not_enough_credits";

function bodyCodeOf(response: TimedResponse): string | null {
	const parsed = parseJson(response.body);
	if (!isRecord(parsed)) {
		return null;
	}
	const code = parsed.code;
	return typeof code === "string" && /^[a-z0-9_]{1,40}$/.test(code)
		? code
		: null;
}

function messageIdOf(response: TimedResponse): string | null {
	const parsed = parseJson(response.body);
	if (!isRecord(parsed)) {
		return null;
	}
	const id = parsed.messageId;
	return typeof id === "string" && id.length > 0 ? id.slice(0, 200) : null;
}

export function classifyBrevoSend(
	response: TimedResponse,
	now: () => Date,
): SendOutcome {
	const { status } = response;
	if (status >= 200 && status < 300) {
		return { kind: "sent", providerMessageId: messageIdOf(response) };
	}
	const code = status >= 400 && status < 500 ? bodyCodeOf(response) : null;
	if (code === NO_CREDIT_CODE) {
		return { kind: "failed", code: "no_credit", scope: "channel" };
	}
	if (code !== null && CHANNEL_CODES.has(code)) {
		return { kind: "failed", code, scope: "channel" };
	}
	if (status === 401 || status === 403) {
		return { kind: "failed", code: "unauthorized", scope: "channel" };
	}
	if (status === 429) {
		const after = retryAfterSeconds(response.headers, now);
		return {
			kind: "retry",
			code: "rate_limited",
			retryAfterSeconds: after ?? BREVO_RATE_LIMIT_RETRY_SECONDS,
		};
	}
	if (status >= 500) {
		return { kind: "retry", code: httpCode(status), retryAfterSeconds: null };
	}
	if (status === 400 || status === 422) {
		return { kind: "failed", code: "bad_request", scope: "message" };
	}
	return { kind: "failed", code: httpCode(status), scope: "message" };
}

export interface BrevoPayload {
	readonly sender: { readonly email: string; readonly name: string };
	readonly to: readonly { readonly email: string }[];
	readonly subject: string;
	readonly textContent: string;
	readonly htmlContent: string;
}

export function brevoPayload(
	message: RenderedMessage,
	destination: Destination,
): BrevoPayload | null {
	const senderEmail = destination.config[SENDER_EMAIL_KEY]?.trim() ?? "";
	if (senderEmail === "") {
		return null;
	}
	const senderName =
		destination.config[SENDER_NAME_KEY]?.trim() || DEFAULT_SENDER_NAME;
	return {
		sender: { email: senderEmail, name: senderName },
		to: [{ email: destination.address }],
		subject: message.subject ?? DEFAULT_SENDER_NAME,
		textContent: message.text,
		htmlContent: message.html ?? emailHtml(message.kind, message.text),
	};
}

export function createBrevoAdapter(): ChannelAdapter {
	return {
		provider: "brevo",
		kind: "email",
		available: true,
		limits: BREVO_LIMITS,
		async send(
			message: RenderedMessage,
			destination: Destination,
			context: SendContext,
		): Promise<SendOutcome> {
			const payload = brevoPayload(message, destination);
			if (payload === null) {
				return { kind: "failed", code: "sender_missing", scope: "channel" };
			}
			const response = await timedFetch(
				context.fetch,
				`${context.baseUrl}${BREVO_SEND_PATH}`,
				{
					method: "POST",
					headers: {
						...jsonHeaders(context.userAgent),
						"api-key": context.secret,
					},
					body: JSON.stringify(payload),
				},
				context.timeoutMs,
			);
			if (response.kind === "failure") {
				return failureOutcome(response.code, BREVO_LIMITS.idempotent);
			}
			return classifyBrevoSend(response, context.now);
		},
	};
}
