import { describe, expect, it } from "vitest";
import {
	createAdapterRegistry,
	createResendAdapter,
	type Destination,
	RESEND_LIMITS,
	type RenderedMessage,
	type SendContext,
	USER_AGENT,
} from "../../../src/index.js";
import { type FakeAnswer, fakeFetch } from "../../support/fake-fetch.js";

const KEY = "synthetic-resend-key";
const ADDRESS = "owner@example.com";
const SENDER = "alerts@example.com";
const BASE = "https://api.resend.com";
const AT = new Date("2026-11-09T02:00:00.000Z");

const MESSAGE: RenderedMessage = {
	messageId: "11111111-1111-4111-8111-111111111111",
	kind: "test",
	subject: "Tin thử từ FNB Manager",
	text: "Tin thử <b>&</b>\nDòng hai",
	html: "<p>Tin thử &lt;b&gt;&amp;&lt;/b&gt;</p><p>Dòng hai</p>",
	webhookBody: null,
};

const DESTINATION: Destination = {
	channelId: "22222222-2222-4222-8222-222222222222",
	kind: "email",
	provider: "resend",
	address: ADDRESS,
	config: { from_email: SENDER, from_name: "FNB Manager" },
};

function context(fetchLike: SendContext["fetch"]): SendContext {
	return {
		secret: KEY,
		fetch: fetchLike,
		baseUrl: BASE,
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
	expect(text).not.toContain(KEY);
	expect(text).not.toContain(ADDRESS);
	expect(text).not.toContain(SENDER);
	expect(text).not.toContain(BASE);
	expect(text).not.toContain("resend.com");
}

async function sendWith(
	answer: FakeAnswer,
	destination: Destination = DESTINATION,
) {
	const fake = fakeFetch();
	fake.answer(answer);
	const outcome = await createResendAdapter().send(
		MESSAGE,
		destination,
		context(fake.fetch),
	);
	expectNoLeak(outcome);
	return { outcome, fake };
}

describe("Resend adapter", () => {
	it("posts the documented body with the bearer key, a user agent and the message id as idempotency key", async () => {
		const { outcome, fake } = await sendWith({
			status: 200,
			body: { id: "44444444-4444-4444-8444-444444444444" },
		});
		expect(outcome).toEqual({
			kind: "sent",
			providerMessageId: "44444444-4444-4444-8444-444444444444",
		});
		const [request] = fake.requests;
		expect(request?.url).toBe(`${BASE}/emails`);
		expect(request?.method).toBe("POST");
		expect(request?.headers.authorization).toBe(`Bearer ${KEY}`);
		expect(request?.headers["user-agent"]).toBe("fnb-manager-notify/1");
		expect(request?.headers["idempotency-key"]).toBe(MESSAGE.messageId);
		expect(request?.headers["content-type"]).toContain("application/json");
		expect(request?.headers["api-key"]).toBeUndefined();
		expect(request?.body).toEqual({
			from: `FNB Manager <${SENDER}>`,
			to: [ADDRESS],
			subject: MESSAGE.subject,
			text: MESSAGE.text,
			html: MESSAGE.html,
		});
	});

	it("sends the same key and the same bytes on every attempt", async () => {
		const fake = fakeFetch();
		fake.answer({ status: 500, body: {} }, { status: 200, body: { id: "x" } });
		const adapter = createResendAdapter();
		await adapter.send(MESSAGE, DESTINATION, context(fake.fetch));
		await adapter.send(MESSAGE, DESTINATION, context(fake.fetch));
		expect(fake.requests).toHaveLength(2);
		expect(fake.requests[0]?.headers["idempotency-key"]).toBe(
			fake.requests[1]?.headers["idempotency-key"],
		);
		expect(fake.requests[0]?.body).toEqual(fake.requests[1]?.body);
	});

	it("always sends escaped HTML and strips markup characters from the sender name", async () => {
		const fake = fakeFetch();
		fake.answer({ status: 200, body: { id: "m" } });
		await createResendAdapter().send(
			{ ...MESSAGE, html: null },
			{
				...DESTINATION,
				config: { from_email: SENDER, from_name: 'Quán <"x">' },
			},
			context(fake.fetch),
		);
		const body = fake.requests[0]?.body as { html: string; from: string };
		expect(body.html).toContain('lang="vi"');
		expect(body.html).not.toContain("<b>&</b>");
		expect(body.from).toBe(`Quán x <${SENDER}>`);
	});

	it("refuses to send without a sender and names the channel", async () => {
		const fake = fakeFetch();
		const outcome = await createResendAdapter().send(
			MESSAGE,
			{ ...DESTINATION, config: {} },
			context(fake.fetch),
		);
		expect(outcome).toEqual({
			kind: "failed",
			code: "sender_missing",
			scope: "channel",
		});
		expect(fake.requests).toHaveLength(0);
	});

	it.each([
		[
			{ status: 400, body: { statusCode: 400, name: "validation_error" } },
			{ kind: "failed", code: "bad_request", scope: "message" },
		],
		[
			{
				status: 422,
				body: { statusCode: 422, name: "missing_required_field" },
			},
			{ kind: "failed", code: "bad_request", scope: "message" },
		],
		[
			{ status: 401, body: { statusCode: 401, name: "missing_api_key" } },
			{ kind: "failed", code: "unauthorized", scope: "channel" },
		],
		[
			{ status: 403, body: { statusCode: 403, name: "invalid_api_key" } },
			{ kind: "failed", code: "unauthorized", scope: "channel" },
		],
		[
			{
				status: 409,
				body: { statusCode: 409, name: "invalid_idempotent_request" },
			},
			{ kind: "failed", code: "invalid_idempotent_request", scope: "message" },
		],
		[
			{
				status: 409,
				body: { statusCode: 409, name: "concurrent_idempotent_requests" },
			},
			{
				kind: "retry",
				code: "concurrent_idempotent_requests",
				retryAfterSeconds: 30,
			},
		],
		[
			{ status: 409, raw: "conflict" },
			{ kind: "failed", code: "http_409", scope: "message" },
		],
		[
			{ status: 429, body: { name: "rate_limit_exceeded" } },
			{ kind: "retry", code: "rate_limited", retryAfterSeconds: 60 },
		],
		[
			{ status: 429, body: {}, headers: { "retry-after": "2" } },
			{ kind: "retry", code: "rate_limited", retryAfterSeconds: 2 },
		],
		[
			{ status: 500, body: { name: "internal_server_error" } },
			{ kind: "retry", code: "http_500", retryAfterSeconds: null },
		],
		[
			{ status: 503, raw: "<html>down</html>" },
			{ kind: "retry", code: "http_503", retryAfterSeconds: null },
		],
		[
			{ status: 404, body: {} },
			{ kind: "failed", code: "http_404", scope: "message" },
		],
	] as const)("classifies %j", async (answer, expected) => {
		const { outcome } = await sendWith(answer);
		expect(outcome).toEqual(expected);
	});

	it("retries a timeout and a lost connection, because the key makes a retry safe", async () => {
		expect((await sendWith({ reject: "timeout" })).outcome).toEqual({
			kind: "retry",
			code: "timeout",
			retryAfterSeconds: null,
		});
		expect((await sendWith({ reject: "connection_lost" })).outcome).toEqual({
			kind: "retry",
			code: "connection_lost",
			retryAfterSeconds: null,
		});
		expect((await sendWith({ reject: "network" })).outcome).toEqual({
			kind: "retry",
			code: "network",
			retryAfterSeconds: null,
		});
	});

	it("declares itself idempotent and is registered as available", () => {
		expect(RESEND_LIMITS).toMatchObject({
			maxSubjectChars: 120,
			supportsHtml: true,
			idempotent: true,
		});
		const adapter = createAdapterRegistry().resend;
		expect(adapter.available).toBe(true);
		expect(adapter.kind).toBe("email");
	});
});
