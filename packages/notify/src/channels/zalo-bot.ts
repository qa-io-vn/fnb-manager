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
import {
	type ChannelAdapter,
	type CredentialCheck,
	type Destination,
	type InboundText,
	PollError,
	type PollResult,
	type ProviderLimits,
	type RenderedMessage,
	type SendContext,
	type SendOutcome,
} from "./types.js";

export const ZALO_BOT_LIMITS: ProviderLimits = {
	maxTextUnits: 1900,
	maxSubjectChars: null,
	supportsHtml: false,
	idempotent: false,
	minSpacingMs: 1100,
};

export const ZALO_QUOTA_RETRY_SECONDS = 60;
export const ZALO_MAX_POLL_SECONDS = 10;
const BOT_NAME_MAX_CHARACTERS = 80;
const POLL_TIMEOUT_MARGIN_MS = 10_000;
const TOKEN_REJECTED_CODE = 401;

function methodUrl(context: SendContext, method: string): string {
	return `${context.baseUrl}/bot${context.secret}/${method}`;
}

function post(
	context: SendContext,
	method: string,
	payload: Record<string, unknown>,
	timeoutMs = context.timeoutMs,
) {
	return timedFetch(
		context.fetch,
		methodUrl(context, method),
		{
			method: "POST",
			headers: jsonHeaders(context.userAgent),
			body: JSON.stringify(payload),
		},
		timeoutMs,
	);
}

function envelopeOf(response: TimedResponse): Record<string, unknown> | null {
	const parsed = parseJson(response.body);
	return isRecord(parsed) ? parsed : null;
}

function errorCodeOf(
	response: TimedResponse,
	envelope: Record<string, unknown> | null,
): number | null {
	const success = response.status >= 200 && response.status < 300;
	if (!success) {
		return response.status;
	}
	const code = envelope?.error_code;
	return typeof code === "number" && Number.isInteger(code) ? code : null;
}

function tokenRejected(
	response: TimedResponse,
	envelope: Record<string, unknown> | null,
): boolean {
	const bodyCode = envelope?.error_code;
	return (
		response.status === TOKEN_REJECTED_CODE ||
		bodyCode === TOKEN_REJECTED_CODE ||
		bodyCode === String(TOKEN_REJECTED_CODE)
	);
}

function messageIdOf(envelope: Record<string, unknown>): string | null {
	const result = envelope.result;
	if (!isRecord(result)) {
		return null;
	}
	const id = result.message_id;
	return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

export function classifyZaloSend(
	response: TimedResponse,
	now: () => Date,
): SendOutcome {
	const envelope = envelopeOf(response);
	const success = response.status >= 200 && response.status < 300;
	if (success && envelope?.ok === true) {
		return { kind: "sent", providerMessageId: messageIdOf(envelope) };
	}
	if (tokenRejected(response, envelope)) {
		return { kind: "failed", code: "token_invalid", scope: "channel" };
	}
	const code = errorCodeOf(response, envelope);
	if (code === null) {
		return success && envelope?.ok === false
			? { kind: "failed", code: "provider_error", scope: "message" }
			: { kind: "uncertain", code: "bad_response" };
	}
	if (code === 400) {
		return { kind: "failed", code: "bad_request", scope: "message" };
	}
	if (code === 404) {
		return { kind: "failed", code: "not_found", scope: "destination" };
	}
	if (code === 429) {
		const after = retryAfterSeconds(response.headers, now);
		return {
			kind: "retry",
			code: "quota_exceeded",
			retryAfterSeconds: Math.max(ZALO_QUOTA_RETRY_SECONDS, after ?? 0),
		};
	}
	if (code === 403 || code === 408 || code >= 500) {
		return { kind: "retry", code: httpCode(code), retryAfterSeconds: null };
	}
	return { kind: "failed", code: httpCode(code), scope: "message" };
}

function inboundFrom(event: unknown): InboundText | null {
	if (!isRecord(event) || event.event_name !== "message.text.received") {
		return null;
	}
	const message = event.message;
	if (!isRecord(message) || !isRecord(message.chat)) {
		return null;
	}
	const chatType = message.chat.chat_type;
	const chatId = message.chat.id;
	const text = message.text;
	if (
		typeof chatType !== "string" ||
		chatType.toUpperCase() !== "PRIVATE" ||
		(typeof chatId !== "string" && typeof chatId !== "number") ||
		typeof text !== "string" ||
		text.trim() === ""
	) {
		return null;
	}
	return {
		updateId: null,
		chatId: String(chatId),
		chatType: "private",
		text,
	};
}

export function zaloUpdatesFrom(result: unknown): InboundText[] {
	const events = Array.isArray(result)
		? result
		: result === null || result === undefined
			? []
			: [result];
	return events.flatMap((event) => {
		const inbound = inboundFrom(event);
		return inbound ? [inbound] : [];
	});
}

export function pollWaitSeconds(waitSeconds: number): number {
	if (!Number.isFinite(waitSeconds)) {
		return 1;
	}
	return Math.min(ZALO_MAX_POLL_SECONDS, Math.max(1, Math.floor(waitSeconds)));
}

export function createZaloBotAdapter(): ChannelAdapter {
	return {
		provider: "zalo_bot",
		kind: "zalo_bot",
		available: true,
		limits: ZALO_BOT_LIMITS,
		async send(
			message: RenderedMessage,
			destination: Destination,
			context: SendContext,
		): Promise<SendOutcome> {
			const response = await post(context, "sendMessage", {
				chat_id: destination.address,
				text: message.text,
			});
			if (response.kind === "failure") {
				return failureOutcome(response.code, ZALO_BOT_LIMITS.idempotent);
			}
			return classifyZaloSend(response, context.now);
		},
		async checkCredentials(context: SendContext): Promise<CredentialCheck> {
			const response = await post(context, "getMe", {});
			if (response.kind === "failure") {
				return { ok: false, code: response.code, botName: null };
			}
			const envelope = envelopeOf(response);
			if (response.status === 200 && envelope?.ok === true) {
				const result = envelope.result;
				const name =
					isRecord(result) && typeof result.account_name === "string"
						? result.account_name.slice(0, BOT_NAME_MAX_CHARACTERS)
						: null;
				return { ok: true, code: null, botName: name };
			}
			if (tokenRejected(response, envelope)) {
				return { ok: false, code: "token_invalid", botName: null };
			}
			const code = errorCodeOf(response, envelope);
			return {
				ok: false,
				code: httpCode(code ?? response.status),
				botName: null,
			};
		},
		async pollUpdates(
			context: SendContext,
			cursor: number | null,
			waitSeconds: number,
		): Promise<PollResult> {
			const wait = pollWaitSeconds(waitSeconds);
			const response = await post(
				context,
				"getUpdates",
				{ timeout: String(wait) },
				wait * 1000 + POLL_TIMEOUT_MARGIN_MS,
			);
			if (response.kind === "failure") {
				throw new PollError(response.code);
			}
			const envelope = envelopeOf(response);
			if (tokenRejected(response, envelope)) {
				throw new PollError("token_invalid");
			}
			const code = errorCodeOf(response, envelope);
			if (code === 408) {
				return { updates: [], cursor };
			}
			if (code !== null || envelope?.ok !== true) {
				throw new PollError(httpCode(code ?? response.status));
			}
			return { updates: zaloUpdatesFrom(envelope.result), cursor };
		},
	};
}
