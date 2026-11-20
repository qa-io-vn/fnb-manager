import { describe, expect, it } from "vitest";
import {
	createAdapterRegistry,
	createWebhookAdapter,
	type Destination,
	type RenderedMessage,
	type SendContext,
	USER_AGENT,
	WEBHOOK_LIMITS,
	webhookEvent,
	webhookPayload,
	webhookSignature,
} from "../../../src/index.js";
import { type FakeAnswer, fakeFetch } from "../../support/fake-fetch.js";

const SECRET = "synthetic-webhook-secret";
const URL_PATH = "/fnb/alerts";
const URL = `https://hooks.example.com${URL_PATH}`;
const AT = new Date("2026-11-09T02:00:00.000Z");
const TIMESTAMP = 1794189600;

const BODY =
	'{"version":1,"type":"alert.opened","rule":"sync_stale","severity":"critical","occurred_at":"2026-11-08T14:10:00Z","store":"Cửa hàng 1","facts":{"minutes_without_sync":95,"threshold_minutes":90}}';

const MESSAGE: RenderedMessage = {
	messageId: "11111111-1111-4111-8111-111111111111",
	kind: "alert",
	subject: null,
	text: BODY,
	html: null,
	webhookBody: BODY,
};

const DESTINATION: Destination = {
	channelId: "22222222-2222-4222-8222-222222222222",
	kind: "webhook",
	provider: "hmac_webhook",
	address: URL,
	config: { url: URL },
};

function context(fetchLike: SendContext["fetch"], baseUrl = ""): SendContext {
	return {
		secret: SECRET,
		fetch: fetchLike,
		baseUrl,
		timeoutMs: 10_000,
		userAgent: USER_AGENT,
		now: () => AT,
	};
}

function expectNoLeak(value: unknown): void {
	const text =
		value instanceof Error
			? `${value.name} ${value.message} ${value.stack ?? ""}`
			: JSON.stringify(value);
	expect(text).not.toContain(SECRET);
	expect(text).not.toContain("hooks.example.com");
	expect(text).not.toContain(URL_PATH);
	expect(text).not.toContain("v1=");
}

async function sendWith(
	answer: FakeAnswer,
	message: RenderedMessage = MESSAGE,
	destination: Destination = DESTINATION,
) {
	const fake = fakeFetch();
	fake.answer(answer);
	const outcome = await createWebhookAdapter().send(
		message,
		destination,
		context(fake.fetch),
	);
	expectNoLeak(outcome);
	return { outcome, fake };
}

describe("signed webhook adapter", () => {
	it("signs <timestamp>.<raw body> with HMAC-SHA256 exactly as the fixed vectors say", async () => {
		expect(await webhookSignature(SECRET, 1700000000, "{}")).toBe(
			"v1=77c75cec50c6d78d2aa5c1b1c2c418d24709e600b282bcca2c08dffd296c3c89",
		);
		expect(await webhookSignature(SECRET, TIMESTAMP, BODY)).toBe(
			"v1=459332c3aac617ee5671f7938bf98446218b18dc9fc2a4247f00082bc9d54dd9",
		);
	});

	it("posts the stored body with the documented headers", async () => {
		const { outcome, fake } = await sendWith({ status: 202, raw: "" });
		expect(outcome).toEqual({ kind: "sent", providerMessageId: null });
		const [request] = fake.requests;
		expect(request?.url).toBe(URL);
		expect(request?.method).toBe("POST");
		expect(request?.headers).toEqual({
			"content-type": "application/json; charset=utf-8",
			"user-agent": "fnb-manager-notify/1",
			"x-fnb-event": "alert.opened",
			"x-fnb-message-id": MESSAGE.messageId,
			"idempotency-key": MESSAGE.messageId,
			"x-fnb-timestamp": String(TIMESTAMP),
			"x-fnb-signature":
				"v1=459332c3aac617ee5671f7938bf98446218b18dc9fc2a4247f00082bc9d54dd9",
		});
		expect(JSON.stringify(request?.body)).toBe(BODY);
	});

	it("names the event by message kind and refuses digests and link messages", async () => {
		expect(webhookEvent("alert")).toBe("alert.opened");
		expect(webhookEvent("alert_reminder")).toBe("alert.reminder");
		expect(webhookEvent("alert_resolved")).toBe("alert.resolved");
		expect(webhookEvent("test")).toBe("test");
		for (const kind of [
			"digest",
			"digest_correction",
			"link_code",
			"link_notice",
			"link_confirmation",
		] as const) {
			const { outcome, fake } = await sendWith(
				{ status: 200 },
				{
					...MESSAGE,
					kind,
				},
			);
			expect(outcome).toEqual({
				kind: "failed",
				code: "kind_not_allowed",
				scope: "message",
			});
			expect(fake.requests).toHaveLength(0);
		}
	});

	it("reaches a loopback test server only through the override, keeping the path", async () => {
		const fake = fakeFetch();
		fake.answer({ status: 200 });
		await createWebhookAdapter().send(
			MESSAGE,
			DESTINATION,
			context(fake.fetch, "http://127.0.0.1:8787"),
		);
		expect(fake.requests[0]?.url).toBe(`http://127.0.0.1:8787${URL_PATH}`);
	});

	it("refuses a destination whose URL is not https and a body over 16 kB", async () => {
		const plain = await sendWith({ status: 200 }, MESSAGE, {
			...DESTINATION,
			address: "http://hooks.example.com/x",
			config: { url: "http://hooks.example.com/x" },
		});
		expect(plain.outcome).toEqual({
			kind: "failed",
			code: "bad_url",
			scope: "destination",
		});
		expect(plain.fake.requests).toHaveLength(0);
		const large = await sendWith(
			{ status: 200 },
			{
				...MESSAGE,
				webhookBody: JSON.stringify({ padding: "x".repeat(17_000) }),
			},
		);
		expect(large.outcome).toEqual({
			kind: "failed",
			code: "too_large",
			scope: "message",
		});
		const missing = await sendWith(
			{ status: 200 },
			{
				...MESSAGE,
				webhookBody: null,
			},
		);
		expect(missing.outcome).toMatchObject({ code: "body_missing" });
	});

	it.each([
		[{ status: 200 }, { kind: "sent", providerMessageId: null }],
		[{ status: 410 }, { kind: "failed", code: "gone", scope: "destination" }],
		[{ status: 400 }, { kind: "failed", code: "http_400", scope: "message" }],
		[{ status: 401 }, { kind: "failed", code: "http_401", scope: "message" }],
		[
			{ status: 429, headers: { "retry-after": "12" } },
			{ kind: "retry", code: "rate_limited", retryAfterSeconds: 12 },
		],
		[
			{ status: 500 },
			{ kind: "retry", code: "http_500", retryAfterSeconds: null },
		],
		[
			{ status: 503, raw: "down" },
			{ kind: "retry", code: "http_503", retryAfterSeconds: null },
		],
	] as const)("classifies %j", async (answer, expected) => {
		const { outcome } = await sendWith(answer);
		expect(outcome).toEqual(expected);
	});

	it("retries a timeout, a lost connection and a refused connection", async () => {
		for (const reject of ["timeout", "connection_lost", "network"] as const) {
			expect((await sendWith({ reject })).outcome).toEqual({
				kind: "retry",
				code: reject,
				retryAfterSeconds: null,
			});
		}
	});

	it("builds a count-only body from the alert's parameters", () => {
		const body = JSON.parse(
			webhookPayload({
				kind: "alert",
				ruleKey: "sync_stale",
				severity: "critical",
				params: {
					rule_key: "sync_stale",
					severity: "critical",
					store_id: "33333333-3333-4333-8333-333333333333",
					account_id: "44444444-4444-4444-8444-444444444444",
					business_date: "2026-11-08",
					occurrences: 3,
					opened_at: 1794147000,
					minutes_without_sync: 95,
					threshold_minutes: 90,
					note: "free text never leaves",
				},
				storeName: "Cửa hàng 1",
				at: AT,
			}),
		);
		expect(body).toEqual({
			version: 1,
			type: "alert.opened",
			rule: "sync_stale",
			severity: "critical",
			occurred_at: "2026-11-08T14:10:00Z",
			store: "Cửa hàng 1",
			facts: {
				minutes_without_sync: 95,
				occurrences: 3,
				threshold_minutes: 90,
			},
		});
		const resolved = JSON.parse(
			webhookPayload({
				kind: "alert_resolved",
				ruleKey: null,
				severity: null,
				params: {
					rule_key: "sync_stale",
					severity: "warning",
					opened_at: 1794147000,
					resolved_at: 1794150000,
				},
				storeName: null,
				at: AT,
			}),
		);
		expect(resolved).toMatchObject({
			type: "alert.resolved",
			rule: "sync_stale",
			severity: "warning",
			occurred_at: "2026-11-08T15:00:00Z",
			store: null,
		});
		const test = JSON.parse(
			webhookPayload({
				kind: "test",
				ruleKey: null,
				severity: null,
				params: {},
				storeName: null,
				at: AT,
			}),
		);
		expect(test).toEqual({
			version: 1,
			type: "test",
			rule: null,
			severity: "info",
			occurred_at: "2026-11-09T02:00:00Z",
			store: null,
			facts: {},
		});
	});

	it("is idempotent, fits the stored body column, and is registered as available", () => {
		expect(WEBHOOK_LIMITS).toMatchObject({
			idempotent: true,
			maxTextUnits: 8000,
			supportsHtml: false,
		});
		const adapter = createAdapterRegistry().hmac_webhook;
		expect(adapter.available).toBe(true);
		expect(adapter.kind).toBe("webhook");
	});
});
