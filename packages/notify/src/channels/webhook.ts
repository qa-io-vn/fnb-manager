import {
	failureOutcome,
	httpCode,
	retryAfterSeconds,
	timedFetch,
} from "./timed-fetch.js";
import type {
	ChannelAdapter,
	Destination,
	MessageKind,
	ProviderLimits,
	RenderedMessage,
	SendContext,
	SendOutcome,
} from "./types.js";

export const WEBHOOK_STORED_BODY_LIMIT = 8000;
export const WEBHOOK_MAX_BODY_BYTES = 16_384;
export const WEBHOOK_URL_MAX_CHARACTERS = 2000;
export const WEBHOOK_PAYLOAD_VERSION = 1;

export const WEBHOOK_LIMITS: ProviderLimits = {
	maxTextUnits: WEBHOOK_STORED_BODY_LIMIT,
	maxSubjectChars: null,
	supportsHtml: false,
	idempotent: true,
	minSpacingMs: 0,
};

export type WebhookEvent =
	| "alert.opened"
	| "alert.reminder"
	| "alert.resolved"
	| "test";

const EVENTS: Readonly<Partial<Record<MessageKind, WebhookEvent>>> = {
	alert: "alert.opened",
	alert_reminder: "alert.reminder",
	alert_resolved: "alert.resolved",
	test: "test",
};

const IDENTITY_PARAMS: ReadonlySet<string> = new Set([
	"rule_key",
	"severity",
	"store_id",
	"account_id",
	"business_date",
	"opened_at",
	"resolved_at",
]);

const SEVERITIES: ReadonlySet<string> = new Set([
	"info",
	"warning",
	"critical",
]);
const STORE_NAME_MAX_CHARACTERS = 120;
const DATABASE_URL_RULE = /^https:\/\/[^\s/@?#]+(\/[^\s?#]*)?$/;
const SECRET_LOOKING_SEGMENT = /^[A-Za-z0-9_-]{20,}$/;

export function webhookEvent(kind: MessageKind): WebhookEvent | null {
	return EVENTS[kind] ?? null;
}

export interface WebhookPayloadFacts {
	readonly kind: MessageKind;
	readonly ruleKey: string | null;
	readonly severity: string | null;
	readonly params: Readonly<Record<string, unknown>>;
	readonly storeName: string | null;
	readonly at: Date;
}

function isoSeconds(date: Date): string {
	return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function epochParam(value: unknown): Date | null {
	const seconds =
		typeof value === "number"
			? value
			: typeof value === "string" && /^\d{1,12}$/.test(value)
				? Number(value)
				: Number.NaN;
	return Number.isFinite(seconds) && seconds > 0
		? new Date(seconds * 1000)
		: null;
}

function countFacts(
	params: Readonly<Record<string, unknown>>,
): Record<string, number | boolean> {
	return Object.fromEntries(
		Object.keys(params)
			.filter(
				(key) => !IDENTITY_PARAMS.has(key) && /^[a-z0-9_]{1,60}$/.test(key),
			)
			.sort()
			.flatMap((key): [string, number | boolean][] => {
				const value = params[key];
				if (typeof value === "number" && Number.isFinite(value)) {
					return [[key, value]];
				}
				return typeof value === "boolean" ? [[key, value]] : [];
			}),
	);
}

function textParam(
	params: Readonly<Record<string, unknown>>,
	key: string,
): string | null {
	const value = params[key];
	return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function webhookPayload(facts: WebhookPayloadFacts): string {
	const event = webhookEvent(facts.kind) ?? "test";
	const occurred =
		(facts.kind === "alert_resolved"
			? epochParam(facts.params.resolved_at)
			: epochParam(facts.params.opened_at)) ?? facts.at;
	const severity = facts.severity ?? textParam(facts.params, "severity");
	const body = {
		version: WEBHOOK_PAYLOAD_VERSION,
		type: event,
		rule:
			event === "test"
				? null
				: (facts.ruleKey ?? textParam(facts.params, "rule_key")),
		severity:
			severity !== null && SEVERITIES.has(severity)
				? severity
				: event === "test"
					? "info"
					: null,
		occurred_at: isoSeconds(occurred),
		store:
			facts.storeName === null
				? null
				: facts.storeName.normalize("NFC").slice(0, STORE_NAME_MAX_CHARACTERS),
		facts: event === "test" ? {} : countFacts(facts.params),
	};
	const text = JSON.stringify(body);
	if (text.length <= WEBHOOK_STORED_BODY_LIMIT) {
		return text;
	}
	return JSON.stringify({ ...body, store: null, facts: {} });
}

function hex(bytes: ArrayBuffer): string {
	return [...new Uint8Array(bytes)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export async function webhookSignature(
	secret: string,
	timestamp: number,
	body: string,
): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(`${timestamp}.${body}`),
	);
	return `v1=${hex(signature)}`;
}

function hasLettersAndDigits(segment: string): boolean {
	return /[A-Za-z]/.test(segment) && /[0-9]/.test(segment);
}

export function webhookUrlProblem(url: string): string | null {
	if (url.length > WEBHOOK_URL_MAX_CHARACTERS) {
		return "the URL is too long";
	}
	if (!url.startsWith("https://")) {
		return "the URL must start with https://";
	}
	const authority = url.slice("https://".length).split("/")[0] ?? "";
	if (authority.includes("@")) {
		return "the URL must not carry a user name or password";
	}
	if (url.includes("?")) {
		return "the URL must not carry a query string";
	}
	if (url.includes("#")) {
		return "the URL must not carry a fragment";
	}
	if (!DATABASE_URL_RULE.test(url)) {
		return "the URL must look like https://host/path without spaces";
	}
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return "the URL is not valid";
	}
	if (parsed.hostname === "") {
		return "the URL needs a host";
	}
	const secretLooking = parsed.pathname
		.split("/")
		.some(
			(segment) =>
				SECRET_LOOKING_SEGMENT.test(segment) && hasLettersAndDigits(segment),
		);
	if (secretLooking) {
		return "the URL path looks like it holds a secret; the signing secret is the webhook's only credential";
	}
	return null;
}

export function webhookAddressHint(url: string): string {
	try {
		return new URL(url).hostname.slice(0, 40);
	} catch {
		return "webhook";
	}
}

function targetUrl(destination: Destination, baseUrl: string): string | null {
	const configured = destination.config.url ?? destination.address;
	if (typeof configured !== "string" || !DATABASE_URL_RULE.test(configured)) {
		return null;
	}
	if (baseUrl === "") {
		return configured;
	}
	try {
		return `${baseUrl}${new URL(configured).pathname}`;
	} catch {
		return null;
	}
}

export function classifyWebhookSend(
	status: number,
	headers: Headers,
	now: () => Date,
): SendOutcome {
	if (status >= 200 && status < 300) {
		return { kind: "sent", providerMessageId: null };
	}
	if (status === 410) {
		return { kind: "failed", code: "gone", scope: "destination" };
	}
	if (status === 429) {
		return {
			kind: "retry",
			code: "rate_limited",
			retryAfterSeconds: retryAfterSeconds(headers, now),
		};
	}
	if (status >= 400 && status < 500) {
		return { kind: "failed", code: httpCode(status), scope: "message" };
	}
	return { kind: "retry", code: httpCode(status), retryAfterSeconds: null };
}

export function createWebhookAdapter(): ChannelAdapter {
	return {
		provider: "hmac_webhook",
		kind: "webhook",
		available: true,
		limits: WEBHOOK_LIMITS,
		async send(
			message: RenderedMessage,
			destination: Destination,
			context: SendContext,
		): Promise<SendOutcome> {
			const event = webhookEvent(message.kind);
			if (event === null) {
				return { kind: "failed", code: "kind_not_allowed", scope: "message" };
			}
			const body = message.webhookBody;
			if (body === null || body === "") {
				return { kind: "failed", code: "body_missing", scope: "message" };
			}
			if (new TextEncoder().encode(body).length > WEBHOOK_MAX_BODY_BYTES) {
				return { kind: "failed", code: "too_large", scope: "message" };
			}
			const url = targetUrl(destination, context.baseUrl);
			if (url === null) {
				return { kind: "failed", code: "bad_url", scope: "destination" };
			}
			const timestamp = Math.floor(context.now().getTime() / 1000);
			const response = await timedFetch(
				context.fetch,
				url,
				{
					method: "POST",
					headers: {
						"content-type": "application/json; charset=utf-8",
						"user-agent": context.userAgent,
						"x-fnb-event": event,
						"x-fnb-message-id": message.messageId,
						"idempotency-key": message.messageId,
						"x-fnb-timestamp": String(timestamp),
						"x-fnb-signature": await webhookSignature(
							context.secret,
							timestamp,
							body,
						),
					},
					body,
				},
				context.timeoutMs,
			);
			if (response.kind === "failure") {
				return failureOutcome(response.code, WEBHOOK_LIMITS.idempotent);
			}
			return classifyWebhookSend(
				response.status,
				response.headers,
				context.now,
			);
		},
	};
}
