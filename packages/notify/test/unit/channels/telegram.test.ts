import { describe, expect, it } from "vitest";
import {
	createAdapterRegistry,
	createTelegramAdapter,
	type Destination,
	PollError,
	type RenderedMessage,
	type SendContext,
	TELEGRAM_LIMITS,
	telegramDeepLink,
	USER_AGENT,
} from "../../../src/index.js";
import { type FakeAnswer, fakeFetch } from "../../support/fake-fetch.js";

const TOKEN = "synthetic-telegram-token";
const CHAT = "700123456";
const BASE = "https://api.telegram.org";
const AT = new Date("2026-11-09T02:00:00.000Z");

const MESSAGE: RenderedMessage = {
	messageId: "11111111-1111-4111-8111-111111111111",
	kind: "test",
	subject: null,
	text: "Tin thử *đậm* _nghiêng_ <b>",
	html: null,
	webhookBody: null,
};

const DESTINATION: Destination = {
	channelId: "22222222-2222-4222-8222-222222222222",
	kind: "telegram",
	provider: "telegram",
	address: CHAT,
	config: {},
};

function context(fetchLike: SendContext["fetch"]): SendContext {
	return {
		secret: TOKEN,
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
	expect(text).not.toContain(TOKEN);
	expect(text).not.toContain(CHAT);
	expect(text).not.toContain(BASE);
	expect(text).not.toContain("telegram.org");
}

async function sendWith(answer: FakeAnswer) {
	const fake = fakeFetch();
	fake.answer(answer);
	const outcome = await createTelegramAdapter().send(
		MESSAGE,
		DESTINATION,
		context(fake.fetch),
	);
	expectNoLeak(outcome);
	return { outcome, fake };
}

async function pollWith(answer: FakeAnswer, cursor: number | null) {
	const fake = fakeFetch();
	fake.answer(answer);
	const adapter = createTelegramAdapter();
	if (!adapter.pollUpdates) {
		throw new Error("the Telegram adapter must poll");
	}
	try {
		return {
			result: await adapter.pollUpdates(context(fake.fetch), cursor, 3),
			error: null,
			fake,
		};
	} catch (error) {
		expectNoLeak(error);
		return { result: null, error, fake };
	}
}

describe("Telegram adapter", () => {
	it("sends plain text without markup and with link previews off", async () => {
		const { outcome, fake } = await sendWith({
			status: 200,
			body: { ok: true, result: { message_id: 42, date: 1 } },
		});
		expect(outcome).toEqual({ kind: "sent", providerMessageId: "42" });
		const [request] = fake.requests;
		expect(request?.url).toBe(`${BASE}/bot${TOKEN}/sendMessage`);
		expect(request?.method).toBe("POST");
		expect(request?.headers["user-agent"]).toBe("fnb-manager-notify/1");
		expect(request?.headers["content-type"]).toContain("application/json");
		expect(request?.body).toEqual({
			chat_id: CHAT,
			text: MESSAGE.text,
			link_preview_options: { is_disabled: true },
		});
		expect(request?.body).not.toHaveProperty("parse_mode");
	});

	it.each([
		[
			{
				status: 403,
				body: {
					ok: false,
					error_code: 403,
					description: "Forbidden: bot was blocked by the user",
				},
			},
			{ kind: "failed", code: "blocked_by_user", scope: "destination" },
		],
		[
			{
				status: 400,
				body: {
					ok: false,
					error_code: 400,
					description: "Bad Request: chat not found",
				},
			},
			{ kind: "failed", code: "not_found", scope: "destination" },
		],
		[
			{
				status: 400,
				body: {
					ok: false,
					error_code: 400,
					description: "Bad Request: message text is empty",
				},
			},
			{ kind: "failed", code: "bad_request", scope: "message" },
		],
		[
			{
				status: 401,
				body: { ok: false, error_code: 401, description: "Unauthorized" },
			},
			{ kind: "failed", code: "token_invalid", scope: "channel" },
		],
		[
			{
				status: 429,
				body: {
					ok: false,
					error_code: 429,
					description: "Too Many Requests: retry after 17",
					parameters: { retry_after: 17 },
				},
			},
			{ kind: "retry", code: "rate_limited", retryAfterSeconds: 17 },
		],
		[
			{ status: 429, body: { ok: false }, headers: { "retry-after": "9" } },
			{ kind: "retry", code: "rate_limited", retryAfterSeconds: 9 },
		],
		[
			{ status: 500, raw: "<html>down</html>" },
			{ kind: "retry", code: "http_500", retryAfterSeconds: null },
		],
		[
			{ status: 502, body: {} },
			{ kind: "retry", code: "http_502", retryAfterSeconds: null },
		],
		[
			{ status: 200, body: { ok: false } },
			{ kind: "failed", code: "provider_error", scope: "message" },
		],
		[
			{ status: 404, body: { ok: false, error_code: 404 } },
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

	it("checks the token with getMe and returns the username for the deep link", async () => {
		const fake = fakeFetch();
		fake.answer(
			{
				status: 200,
				body: {
					ok: true,
					result: { id: 1, is_bot: true, username: "synthetic_fnb_bot" },
				},
			},
			{ status: 401, body: { ok: false, error_code: 401 } },
		);
		const adapter = createTelegramAdapter();
		const ok = await adapter.checkCredentials?.(context(fake.fetch));
		expect(ok).toEqual({ ok: true, code: null, botName: "synthetic_fnb_bot" });
		expect(fake.requests[0]?.url).toBe(`${BASE}/bot${TOKEN}/getMe`);
		const refused = await adapter.checkCredentials?.(context(fake.fetch));
		expect(refused).toEqual({
			ok: false,
			code: "token_invalid",
			botName: null,
		});
		expectNoLeak(refused);
		expect(telegramDeepLink("synthetic_fnb_bot", "FNB-7K3QX9MD")).toBe(
			"https://t.me/synthetic_fnb_bot?start=FNB-7K3QX9MD",
		);
	});

	it("polls from the update after the cursor and returns the highest update id", async () => {
		const { result, fake } = await pollWith(
			{
				status: 200,
				body: {
					ok: true,
					result: [
						{
							update_id: 11,
							message: {
								chat: { id: 700000001, type: "private" },
								text: "/start FNB-7K3QX9MD",
							},
						},
						{
							update_id: 12,
							message: {
								chat: { id: -100200, type: "group" },
								text: "FNB-7K3QX9MD",
							},
						},
						{ update_id: 13, edited_message: { text: "x" } },
						{
							update_id: 14,
							message: {
								chat: { id: 1, type: "channel" },
								text: "ĐỒNG Ý",
							},
						},
					],
				},
			},
			10,
		);
		expect(fake.requests[0]?.url).toBe(`${BASE}/bot${TOKEN}/getUpdates`);
		expect(fake.requests[0]?.body).toEqual({
			offset: 11,
			timeout: 3,
			allowed_updates: ["message"],
		});
		expect(result).toEqual({
			cursor: 14,
			updates: [
				{
					updateId: 11,
					chatId: "700000001",
					chatType: "private",
					text: "/start FNB-7K3QX9MD",
				},
				{
					updateId: 12,
					chatId: "-100200",
					chatType: "group",
					text: "FNB-7K3QX9MD",
				},
			],
		});
	});

	it("asks without an offset the first time and keeps the cursor when nothing arrived", async () => {
		const { result, fake } = await pollWith(
			{ status: 200, body: { ok: true, result: [] } },
			null,
		);
		expect(fake.requests[0]?.body).not.toHaveProperty("offset");
		expect(result).toEqual({ updates: [], cursor: null });
	});

	it("ends the round on 409 (another poller) and on a refused token without leaking the URL", async () => {
		const conflict = await pollWith(
			{
				status: 409,
				body: {
					ok: false,
					error_code: 409,
					description: "Conflict: terminated by other getUpdates request",
				},
			},
			5,
		);
		expect(conflict.error).toBeInstanceOf(PollError);
		expect((conflict.error as PollError).code).toBe("poll_conflict");
		const refused = await pollWith(
			{ status: 401, body: { ok: false, error_code: 401 } },
			5,
		);
		expect((refused.error as PollError).code).toBe("token_invalid");
		const down = await pollWith({ reject: "network" }, 5);
		expect((down.error as PollError).code).toBe("network");
	});

	it("declares its limits and is registered as available", () => {
		expect(TELEGRAM_LIMITS).toMatchObject({
			maxTextUnits: 4000,
			supportsHtml: false,
			idempotent: false,
		});
		const adapter = createAdapterRegistry().telegram;
		expect(adapter.available).toBe(true);
		expect(adapter.kind).toBe("telegram");
		expect(adapter.pollUpdates).toBeTypeOf("function");
	});
});
