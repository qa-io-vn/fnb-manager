import { describe, expect, it } from "vitest";
import {
	BREVO_LIMITS,
	createAdapterRegistry,
	createBrevoAdapter,
	type Destination,
	type RenderedMessage,
	type SendContext,
	USER_AGENT,
} from "../../../src/index.js";
import { type FakeAnswer, fakeFetch } from "../../support/fake-fetch.js";

const KEY = "synthetic-email-key";
const ADDRESS = "owner@example.com";
const SENDER = "alerts@example.com";
const BASE = "https://api.brevo.com";
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
	provider: "brevo",
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
	expect(text).not.toContain("brevo.com");
}

async function sendWith(
	answer: FakeAnswer,
	destination: Destination = DESTINATION,
) {
	const fake = fakeFetch();
	fake.answer(answer);
	const outcome = await createBrevoAdapter().send(
		MESSAGE,
		destination,
		context(fake.fetch),
	);
	expectNoLeak(outcome);
	return { outcome, fake };
}

describe("Brevo adapter", () => {
	it("posts the documented transactional e-mail body with the api-key and user agent", async () => {
		const { outcome, fake } = await sendWith({
			status: 201,
			body: { messageId: "<brevo-1@example.com>" },
		});
		expect(outcome).toEqual({
			kind: "sent",
			providerMessageId: "<brevo-1@example.com>",
		});
		const [request] = fake.requests;
		expect(request?.url).toBe(`${BASE}/v3/smtp/email`);
		expect(request?.method).toBe("POST");
		expect(request?.headers["api-key"]).toBe(KEY);
		expect(request?.headers["user-agent"]).toBe("fnb-manager-notify/1");
		expect(request?.headers["content-type"]).toContain("application/json");
		expect(request?.headers.authorization).toBeUndefined();
		expect(request?.body).toEqual({
			sender: { email: SENDER, name: "FNB Manager" },
			to: [{ email: ADDRESS }],
			subject: MESSAGE.subject,
			textContent: MESSAGE.text,
			htmlContent: MESSAGE.html,
		});
	});

	it("always sends escaped HTML, even when the message carries none", async () => {
		const fake = fakeFetch();
		fake.answer({ status: 201, body: { messageId: "m" } });
		await createBrevoAdapter().send(
			{ ...MESSAGE, html: null },
			DESTINATION,
			context(fake.fetch),
		);
		const body = fake.requests[0]?.body as { htmlContent: string };
		expect(body.htmlContent).toContain('lang="vi"');
		expect(body.htmlContent).toContain(
			"<p>Tin thử &lt;b&gt;&amp;&lt;/b&gt;</p>",
		);
		expect(body.htmlContent).not.toContain("<b>&</b>");
	});

	it("refuses to send without a sender and names the channel", async () => {
		const fake = fakeFetch();
		const outcome = await createBrevoAdapter().send(
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
			{ status: 400, body: { code: "not_enough_credits", message: "x" } },
			{ kind: "failed", code: "no_credit", scope: "channel" },
		],
		[
			{ status: 400, body: { code: "unauthorized", message: "x" } },
			{ kind: "failed", code: "unauthorized", scope: "channel" },
		],
		[
			{ status: 400, body: { code: "permission_denied", message: "x" } },
			{ kind: "failed", code: "permission_denied", scope: "channel" },
		],
		[
			{ status: 400, body: { code: "account_under_validation" } },
			{ kind: "failed", code: "account_under_validation", scope: "channel" },
		],
		[
			{ status: 400, body: { code: "invalid_parameter", message: "x" } },
			{ kind: "failed", code: "bad_request", scope: "message" },
		],
		[
			{ status: 400, body: { code: "missing_parameter" } },
			{ kind: "failed", code: "bad_request", scope: "message" },
		],
		[
			{ status: 422, body: {} },
			{ kind: "failed", code: "bad_request", scope: "message" },
		],
		[
			{ status: 401, body: {} },
			{ kind: "failed", code: "unauthorized", scope: "channel" },
		],
		[
			{ status: 403, raw: "forbidden" },
			{ kind: "failed", code: "unauthorized", scope: "channel" },
		],
		[
			{ status: 429, body: {} },
			{ kind: "retry", code: "rate_limited", retryAfterSeconds: 60 },
		],
		[
			{ status: 429, body: {}, headers: { "retry-after": "17" } },
			{ kind: "retry", code: "rate_limited", retryAfterSeconds: 17 },
		],
		[
			{ status: 500, body: {} },
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

	it("turns a timeout into uncertain and a refused connection into a retry", async () => {
		expect((await sendWith({ reject: "timeout" })).outcome).toEqual({
			kind: "uncertain",
			code: "timeout",
		});
		expect((await sendWith({ reject: "connection_lost" })).outcome).toEqual({
			kind: "uncertain",
			code: "connection_lost",
		});
		expect((await sendWith({ reject: "network" })).outcome).toEqual({
			kind: "retry",
			code: "network",
			retryAfterSeconds: null,
		});
	});

	it("declares the e-mail limits and is registered as available", () => {
		expect(BREVO_LIMITS).toMatchObject({
			maxSubjectChars: 120,
			supportsHtml: true,
			idempotent: false,
		});
		const adapter = createAdapterRegistry().brevo;
		expect(adapter.available).toBe(true);
		expect(adapter.kind).toBe("email");
	});
});
