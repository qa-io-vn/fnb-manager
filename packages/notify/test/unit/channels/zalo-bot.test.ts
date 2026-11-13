import { describe, expect, it } from "vitest";
import {
	createZaloBotAdapter,
	type Destination,
	PollError,
	type RenderedMessage,
	type SendContext,
	USER_AGENT,
} from "../../../src/index.js";
import { type FakeAnswer, fakeFetch } from "../../support/fake-fetch.js";

const TOKEN = "synthetic-bot-token";
const CHAT = "synthetic-chat-1";
const BASE = "https://bot-api.zaloplatforms.com";
const AT = new Date("2026-11-09T02:00:00.000Z");

const MESSAGE: RenderedMessage = {
	messageId: "11111111-1111-4111-8111-111111111111",
	kind: "test",
	subject: null,
	text: "Tin thử *đậm* <b>&</b>",
	html: null,
	webhookBody: null,
};

const DESTINATION: Destination = {
	channelId: "22222222-2222-4222-8222-222222222222",
	kind: "zalo_bot",
	provider: "zalo_bot",
	address: CHAT,
	config: {},
};

function context(
	fetchLike: SendContext["fetch"],
	timeoutMs = 10_000,
): SendContext {
	return {
		secret: TOKEN,
		fetch: fetchLike,
		baseUrl: BASE,
		timeoutMs,
		userAgent: USER_AGENT,
		now: () => AT,
	};
}

function expectNoLeak(value: unknown): void {
	const text =
		value instanceof Error
			? `${value.name} ${value.message} ${value.stack ?? ""}`
			: JSON.stringify(value);
	expect(text).not.toContain(TOKEN);
	expect(text).not.toContain(CHAT);
	expect(text).not.toContain(BASE);
	expect(text).not.toContain("zaloplatforms");
}

async function sendWith(answer: FakeAnswer) {
	const fake = fakeFetch();
	fake.answer(answer);
	const outcome = await createZaloBotAdapter().send(
		MESSAGE,
		DESTINATION,
		context(fake.fetch),
	);
	expectNoLeak(outcome);
	return { outcome, fake };
}

describe("Zalo Bot adapter", () => {
	it("posts plain text to sendMessage with the user agent and no markup mode", async () => {
		const { outcome, fake } = await sendWith({
			status: 200,
			body: { ok: true, result: { message_id: "zalo-77", date: 1 } },
		});
		expect(outcome).toEqual({ kind: "sent", providerMessageId: "zalo-77" });
		expect(fake.requests).toHaveLength(1);
		const [request] = fake.requests;
		expect(request?.url).toBe(`${BASE}/bot${TOKEN}/sendMessage`);
		expect(request?.method).toBe("POST");
		expect(request?.headers["user-agent"]).toBe("fnb-manager-notify/1");
		expect(request?.headers["content-type"]).toContain("application/json");
		expect(request?.body).toEqual({ chat_id: CHAT, text: MESSAGE.text });
	});

	it.each([
		[
			{ status: 401, body: { ok: false, error_code: 401 } },
			{ kind: "failed", code: "token_invalid", scope: "channel" },
		],
		[
			{
				status: 200,
				body: { ok: false, error_code: 401, description: "Unauthorized" },
			},
			{ kind: "failed", code: "token_invalid", scope: "channel" },
		],
		[
			{ status: 400, body: { ok: false, error_code: 401 } },
			{ kind: "failed", code: "token_invalid", scope: "channel" },
		],
		[
			{ status: 403, body: { ok: false, error_code: 401 } },
			{ kind: "failed", code: "token_invalid", scope: "channel" },
		],
		[
			{ status: 500, body: { ok: false, error_code: "401" } },
			{ kind: "failed", code: "token_invalid", scope: "channel" },
		],
		[
			{ status: 401, raw: "not json" },
			{ kind: "failed", code: "token_invalid", scope: "channel" },
		],
		[
			{ status: 400, body: { ok: false, error_code: 400 } },
			{ kind: "failed", code: "bad_request", scope: "message" },
		],
		[
			{ status: 404, body: { ok: false, error_code: 404 } },
			{ kind: "failed", code: "not_found", scope: "destination" },
		],
		[
			{ status: 429, body: { ok: false, error_code: 429 } },
			{ kind: "retry", code: "quota_exceeded", retryAfterSeconds: 60 },
		],
		[
			{ status: 429, body: {}, headers: { "retry-after": "120" } },
			{ kind: "retry", code: "quota_exceeded", retryAfterSeconds: 120 },
		],
		[
			{ status: 429, body: {}, headers: { "retry-after": "5" } },
			{ kind: "retry", code: "quota_exceeded", retryAfterSeconds: 60 },
		],
		[
			{ status: 403, body: { ok: false, error_code: 403 } },
			{ kind: "retry", code: "http_403", retryAfterSeconds: null },
		],
		[
			{ status: 408, body: { ok: false, error_code: 408 } },
			{ kind: "retry", code: "http_408", retryAfterSeconds: null },
		],
		[
			{ status: 500, body: {} },
			{ kind: "retry", code: "http_500", retryAfterSeconds: null },
		],
		[
			{ status: 503, body: {} },
			{ kind: "retry", code: "http_503", retryAfterSeconds: null },
		],
		[
			{ status: 409, body: {} },
			{ kind: "failed", code: "http_409", scope: "message" },
		],
		[
			{ status: 200, raw: "not json" },
			{ kind: "uncertain", code: "bad_response" },
		],
		[
			{ reject: "network" },
			{ kind: "retry", code: "network", retryAfterSeconds: null },
		],
		[
			{ reject: "connection_lost" },
			{ kind: "uncertain", code: "connection_lost" },
		],
		[
			{ reject: "unclassified" },
			{ kind: "uncertain", code: "connection_lost" },
		],
		[{ reject: "timeout" }, { kind: "uncertain", code: "timeout" }],
	] as const)("classifies %j", async (answer, expected) => {
		const { outcome } = await sendWith(answer as FakeAnswer);
		expect(outcome).toEqual(expected);
	});

	it("turns its own 10 s style timeout into uncertain, because the message may have arrived", async () => {
		const fake = fakeFetch();
		fake.answer({ waitForAbort: true });
		const outcome = await createZaloBotAdapter().send(
			MESSAGE,
			DESTINATION,
			context(fake.fetch, 30),
		);
		expect(outcome).toEqual({ kind: "uncertain", code: "timeout" });
		expectNoLeak(outcome);
	});

	it("checks the token with getMe and keeps only the bot name", async () => {
		const fake = fakeFetch();
		fake.answer(
			{
				status: 200,
				body: {
					ok: true,
					result: {
						id: "b-1",
						account_name: "Bot synthetic",
						account_type: "BASIC",
					},
				},
			},
			{ status: 401, body: { ok: false, error_code: 401 } },
			{ reject: "network" },
			{ status: 400, body: { ok: false, error_code: 401 } },
			{ status: 403, body: { ok: false, error_code: 403 } },
		);
		const adapter = createZaloBotAdapter();
		const ok = await adapter.checkCredentials?.(context(fake.fetch));
		expect(ok).toEqual({ ok: true, code: null, botName: "Bot synthetic" });
		expect(fake.requests[0]?.url).toBe(`${BASE}/bot${TOKEN}/getMe`);
		expect(fake.requests[0]?.headers["user-agent"]).toBe(USER_AGENT);
		const refused = await adapter.checkCredentials?.(context(fake.fetch));
		expect(refused).toEqual({
			ok: false,
			code: "token_invalid",
			botName: null,
		});
		const offline = await adapter.checkCredentials?.(context(fake.fetch));
		expect(offline).toEqual({ ok: false, code: "network", botName: null });
		const expiredInBody = await adapter.checkCredentials?.(context(fake.fetch));
		expect(expiredInBody).toEqual({
			ok: false,
			code: "token_invalid",
			botName: null,
		});
		const otherwise = await adapter.checkCredentials?.(context(fake.fetch));
		expect(otherwise).toEqual({ ok: false, code: "http_403", botName: null });
		for (const value of [ok, refused, offline, expiredInBody, otherwise]) {
			expectNoLeak(value);
		}
	});

	it("polls getUpdates with a string timeout and keeps private text events only", async () => {
		const event = (
			chatId: string,
			text: string,
			chatType = "PRIVATE",
			eventName = "message.text.received",
		) => ({
			event_name: eventName,
			message: {
				message_id: "x",
				date: 1,
				from: { id: chatId, display_name: "Name not read" },
				chat: { id: chatId, chat_type: chatType },
				text,
			},
		});
		const fake = fakeFetch();
		fake.answer(
			{ status: 200, body: { ok: true, result: event(CHAT, "FNB-7K3QX9MD") } },
			{
				status: 200,
				body: {
					ok: true,
					result: [
						event(CHAT, "ĐỒNG Ý"),
						event("synthetic-group-1", "FNB-7K3QX9MD", "GROUP"),
						event(CHAT, "sticker", "PRIVATE", "message.sticker.received"),
					],
				},
			},
			{ status: 200, body: { ok: true, result: null } },
		);
		const adapter = createZaloBotAdapter();
		const first = await adapter.pollUpdates?.(context(fake.fetch), null, 30);
		expect(first).toEqual({
			updates: [
				{
					updateId: null,
					chatId: CHAT,
					chatType: "private",
					text: "FNB-7K3QX9MD",
				},
			],
			cursor: null,
		});
		expect(fake.requests[0]?.url).toBe(`${BASE}/bot${TOKEN}/getUpdates`);
		expect(fake.requests[0]?.body).toEqual({ timeout: "10" });
		const second = await adapter.pollUpdates?.(context(fake.fetch), null, 2);
		expect(second?.updates.map((update) => update.text)).toEqual(["ĐỒNG Ý"]);
		expect(fake.requests[1]?.body).toEqual({ timeout: "2" });
		const empty = await adapter.pollUpdates?.(context(fake.fetch), null, 2);
		expect(empty?.updates).toEqual([]);
		expect(JSON.stringify([first, second])).not.toContain("Name not read");
	});

	it("ends a poll round with a short code and never the token or URL", async () => {
		const fake = fakeFetch();
		fake.answer(
			{ status: 401, body: { ok: false, error_code: 401 } },
			{ reject: "network" },
			{ status: 408, body: { ok: false, error_code: 408 } },
			{ status: 403, body: { ok: false, error_code: 401 } },
			{ status: 408, body: { ok: false, error_code: 401 } },
		);
		const adapter = createZaloBotAdapter();
		const refused = await adapter
			.pollUpdates?.(context(fake.fetch), null, 1)
			.catch((error: unknown) => error);
		expect(refused).toBeInstanceOf(PollError);
		expect((refused as PollError).code).toBe("token_invalid");
		expectNoLeak(refused);
		const offline = await adapter
			.pollUpdates?.(context(fake.fetch), null, 1)
			.catch((error: unknown) => error);
		expect((offline as PollError).code).toBe("network");
		expectNoLeak(offline);
		const idle = await adapter.pollUpdates?.(context(fake.fetch), null, 1);
		expect(idle).toEqual({ updates: [], cursor: null });
		const expiredBehind403 = await adapter
			.pollUpdates?.(context(fake.fetch), null, 1)
			.catch((error: unknown) => error);
		const expiredBehind408 = await adapter
			.pollUpdates?.(context(fake.fetch), null, 1)
			.catch((error: unknown) => error);
		for (const expired of [expiredBehind403, expiredBehind408]) {
			expect(expired).toBeInstanceOf(PollError);
			expect((expired as PollError).code).toBe("token_invalid");
			expectNoLeak(expired);
		}
	});

	it("declares the documented limits", () => {
		const adapter = createZaloBotAdapter();
		expect(adapter.available).toBe(true);
		expect(adapter.limits).toEqual({
			maxTextUnits: 1900,
			maxSubjectChars: null,
			supportsHtml: false,
			idempotent: false,
			minSpacingMs: 1100,
		});
	});
});
