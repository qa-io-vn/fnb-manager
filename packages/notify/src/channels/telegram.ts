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

export const TELEGRAM_LIMITS: ProviderLimits = {
	maxTextUnits: 4000,
	maxSubjectChars: null,
	supportsHtml: false,
	idempotent: false,
	minSpacingMs: 1100,
};

export const TELEGRAM_MAX_POLL_SECONDS = 10;
export const TELEGRAM_DEEP_LINK_BASE = "https://t.me";
const BOT_NAME_MAX_CHARACTERS = 80;
const POLL_TIMEOUT_MARGIN_MS = 10_000;
const CHAT_NOT_FOUND = /chat not found/i;
const BOT_USERNAME = /^[A-Za-z0-9_]{5,64}$/;

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

function statusOf(
	response: TimedResponse,
	envelope: Record<string, unknown> | null,
): number {
	const code = envelope?.error_code;
	if (
		response.status >= 200 &&
		response.status < 300 &&
		typeof code === "number" &&
		Number.isInteger(code)
	) {
		return code;
	}
	return response.status;
}

function retryAfterOf(
	response: TimedResponse,
	envelope: Record<string, unknown> | null,
	now: () => Date,
): number | null {
	const parameters = envelope?.parameters;
	if (isRecord(parameters)) {
		const value = parameters.retry_after;
		if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
			return Math.ceil(value);
		}
	}
	return retryAfterSeconds(response.headers, now);
}

function descriptionOf(envelope: Record<string, unknown> | null): string {
	const description = envelope?.description;
	return typeof description === "string" ? description : "";
}

function messageIdOf(envelope: Record<string, unknown>): string | null {
	const result = envelope.result;
	if (!isRecord(result)) {
		return null;
	}
	const id = result.message_id;
	return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

export function classifyTelegramSend(
	response: TimedResponse,
	now: () => Date,
): SendOutcome {
	const envelope = envelopeOf(response);
	const success = response.status >= 200 && response.status < 300;
	if (success && envelope?.ok === true) {
		return { kind: "sent", providerMessageId: messageIdOf(envelope) };
	}
	const status = statusOf(response, envelope);
	if (status === 401) {
		return { kind: "failed", code: "token_invalid", scope: "channel" };
	}
	if (status === 403) {
		return { kind: "failed", code: "blocked_by_user", scope: "destination" };
	}
	if (status === 400) {
		return CHAT_NOT_FOUND.test(descriptionOf(envelope))
			? { kind: "failed", code: "not_found", scope: "destination" }
			: { kind: "failed", code: "bad_request", scope: "message" };
	}
	if (status === 429) {
		return {
			kind: "retry",
			code: "rate_limited",
			retryAfterSeconds: retryAfterOf(response, envelope, now),
		};
	}
	if (status >= 500) {
		return { kind: "retry", code: httpCode(status), retryAfterSeconds: null };
	}
	if (success) {
		return { kind: "failed", code: "provider_error", scope: "message" };
	}
	return { kind: "failed", code: httpCode(status), scope: "message" };
}

function chatTypeOf(value: unknown): "private" | "group" | null {
	if (value === "private") {
		return "private";
	}
	return value === "group" || value === "supergroup" ? "group" : null;
}

function inboundFrom(update: Record<string, unknown>): InboundText | null {
	const updateId = update.update_id;
	const message = update.message;
	if (
		typeof updateId !== "number" ||
		!isRecord(message) ||
		!isRecord(message.chat)
	) {
		return null;
	}
	const chatType = chatTypeOf(message.chat.type);
	const chatId = message.chat.id;
	const text = message.text;
	if (
		chatType === null ||
		(typeof chatId !== "number" && typeof chatId !== "string") ||
		typeof text !== "string" ||
		text.trim() === ""
	) {
		return null;
	}
	return { updateId, chatId: String(chatId), chatType, text };
}

export function telegramUpdatesFrom(
	result: unknown,
	cursor: number | null,
): PollResult {
	const updates = Array.isArray(result) ? result.filter(isRecord) : [];
	let highest = cursor;
	const inbound: InboundText[] = [];
	for (const update of updates) {
		const id = update.update_id;
		if (typeof id === "number" && Number.isSafeInteger(id)) {
			highest = highest === null ? id : Math.max(highest, id);
		}
		const text = inboundFrom(update);
		if (text !== null) {
			inbound.push(text);
		}
	}
	return { updates: inbound, cursor: highest };
}

export function telegramPollWaitSeconds(waitSeconds: number): number {
	if (!Number.isFinite(waitSeconds)) {
		return 1;
	}
	return Math.min(
		TELEGRAM_MAX_POLL_SECONDS,
		Math.max(0, Math.floor(waitSeconds)),
	);
}

export function telegramDeepLink(botUsername: string, code: string): string {
	return `${TELEGRAM_DEEP_LINK_BASE}/${encodeURIComponent(botUsername)}?start=${encodeURIComponent(code)}`;
}

export function createTelegramAdapter(): ChannelAdapter {
	return {
		provider: "telegram",
		kind: "telegram",
		available: true,
		limits: TELEGRAM_LIMITS,
		async send(
			message: RenderedMessage,
			destination: Destination,
			context: SendContext,
		): Promise<SendOutcome> {
			const response = await post(context, "sendMessage", {
				chat_id: destination.address,
				text: message.text,
				link_preview_options: { is_disabled: true },
			});
			if (response.kind === "failure") {
				return failureOutcome(response.code, TELEGRAM_LIMITS.idempotent);
			}
			return classifyTelegramSend(response, context.now);
		},
		async checkCredentials(context: SendContext): Promise<CredentialCheck> {
			const response = await post(context, "getMe", {});
			if (response.kind === "failure") {
				return { ok: false, code: response.code, botName: null };
			}
			const envelope = envelopeOf(response);
			if (response.status === 200 && envelope?.ok === true) {
				const result = envelope.result;
				const username =
					isRecord(result) &&
					typeof result.username === "string" &&
					BOT_USERNAME.test(result.username)
						? result.username.slice(0, BOT_NAME_MAX_CHARACTERS)
						: null;
				return { ok: true, code: null, botName: username };
			}
			const status = statusOf(response, envelope);
			return {
				ok: false,
				code: status === 401 ? "token_invalid" : httpCode(status),
				botName: null,
			};
		},
		async pollUpdates(
			context: SendContext,
			cursor: number | null,
			waitSeconds: number,
		): Promise<PollResult> {
			const wait = telegramPollWaitSeconds(waitSeconds);
			const response = await post(
				context,
				"getUpdates",
				{
					...(cursor === null ? {} : { offset: cursor + 1 }),
					timeout: wait,
					allowed_updates: ["message"],
				},
				wait * 1000 + POLL_TIMEOUT_MARGIN_MS,
			);
			if (response.kind === "failure") {
				throw new PollError(response.code);
			}
			const envelope = envelopeOf(response);
			const status = statusOf(response, envelope);
			if (status === 409) {
				throw new PollError("poll_conflict");
			}
			if (status === 401) {
				throw new PollError("token_invalid");
			}
			if (
				response.status < 200 ||
				response.status >= 300 ||
				envelope?.ok !== true
			) {
				throw new PollError(httpCode(status));
			}
			return telegramUpdatesFrom(envelope.result, cursor);
		},
	};
}
