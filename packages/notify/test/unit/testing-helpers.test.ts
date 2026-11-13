import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createBrevoAdapter,
	createZaloBotAdapter,
	providerBaseUrl,
	type RenderedMessage,
	type SendContext,
	USER_AGENT,
} from "../../src/index.js";
import {
	assertSyntheticEnvironment,
	BREVO_FAULT_METHOD,
	type MockProviders,
	SYNTHETIC_BOT_TOKEN,
	SYNTHETIC_EMAIL_KEY,
	SyntheticEnvironmentError,
	startMockProviders,
	syntheticEnvironment,
} from "../../src/testing/index.js";

const MESSAGE: RenderedMessage = {
	messageId: "11111111-1111-4111-8111-111111111111",
	kind: "test",
	subject: null,
	text: "Tin thử",
	html: null,
	webhookBody: null,
};

describe("synthetic environment", () => {
	it("holds only the listed keys and refuses anything inherited", () => {
		const environment = syntheticEnvironment({
			databaseUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
			mockEnvironment: { NOTIFY_ZALO_BOT_BASE_URL: "http://127.0.0.1:8787" },
		});
		expect(Object.keys(environment).sort()).toEqual([
			"DATABASE_URL",
			"NOTIFY_EMAIL_API_KEY_IT",
			"NOTIFY_EMAIL_FROM",
			"NOTIFY_INTEGRATION",
			"NOTIFY_ZALO_BOT_BASE_URL",
			"NOTIFY_ZALO_BOT_TOKEN_IT",
		]);
		expect(() =>
			assertSyntheticEnvironment({
				...environment,
				NOTIFY_ZALO_BOT_TOKEN: "real",
			}),
		).toThrow(SyntheticEnvironmentError);
		expect(() =>
			assertSyntheticEnvironment({ ...environment, SUPABASE_DB_URL: "x" }),
		).toThrow(SyntheticEnvironmentError);
		expect(() =>
			assertSyntheticEnvironment({ ...environment, HOME: "/" }),
		).toThrow(SyntheticEnvironmentError);
	});
});

describe("mock providers", () => {
	let mock: MockProviders;

	beforeAll(async () => {
		mock = await startMockProviders();
		mock.registerZaloBot(SYNTHETIC_BOT_TOKEN, "Bot synthetic");
	});

	afterAll(async () => {
		await mock.close();
	});

	function context(timeoutMs = 2000): SendContext {
		return {
			secret: SYNTHETIC_BOT_TOKEN,
			fetch: (input, init) => fetch(input, init),
			baseUrl: providerBaseUrl("zalo_bot", mock.environment()),
			timeoutMs,
			userAgent: USER_AGENT,
			now: () => new Date(),
		};
	}

	const destination = {
		channelId: "22222222-2222-4222-8222-222222222222",
		kind: "zalo_bot" as const,
		provider: "zalo_bot" as const,
		address: "synthetic-chat-1",
		config: {},
	};

	it("serves the Zalo Bot calls on a loopback address", async () => {
		mock.reset();
		expect(mock.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		const adapter = createZaloBotAdapter();
		expect(await adapter.checkCredentials?.(context())).toEqual({
			ok: true,
			code: null,
			botName: "Bot synthetic",
		});
		const sent = await adapter.send(MESSAGE, destination, context());
		expect(sent.kind).toBe("sent");
		expect(mock.zaloMessages()).toHaveLength(1);
		expect(mock.zaloMessages()[0]).toMatchObject({
			chatId: "synthetic-chat-1",
			text: "Tin thử",
			accepted: true,
		});
		mock.queueZaloUpdate(SYNTHETIC_BOT_TOKEN, {
			chatId: "synthetic-chat-1",
			text: "FNB-7K3QX9MD",
		});
		const updates = await adapter.pollUpdates?.(context(), null, 1);
		expect(updates?.updates).toEqual([
			{
				updateId: null,
				chatId: "synthetic-chat-1",
				chatType: "private",
				text: "FNB-7K3QX9MD",
			},
		]);
		expect((await adapter.pollUpdates?.(context(), null, 1))?.updates).toEqual(
			[],
		);
		const stranger = await adapter.send(MESSAGE, destination, {
			...context(),
			secret: "synthetic-unknown-token",
		});
		expect(stranger).toEqual({
			kind: "failed",
			code: "token_invalid",
			scope: "channel",
		});
	});

	it("serves Brevo's send endpoint with the api-key check and scriptable account faults", async () => {
		mock.reset();
		mock.registerEmailKey(SYNTHETIC_EMAIL_KEY);
		const adapter = createBrevoAdapter();
		const email = {
			channelId: "22222222-2222-4222-8222-222222222222",
			kind: "email" as const,
			provider: "brevo" as const,
			address: "owner@example.com",
			config: { from_email: "sender@example.com" },
		};
		const emailContext = {
			...context(),
			secret: SYNTHETIC_EMAIL_KEY,
			baseUrl: providerBaseUrl("brevo", mock.environment()),
		};
		const message = { ...MESSAGE, subject: "Tin thử từ FNB Manager" };
		const sent = await adapter.send(message, email, emailContext);
		expect(sent.kind).toBe("sent");
		expect(mock.emails()).toHaveLength(1);
		expect(mock.emails()[0]).toMatchObject({
			to: "owner@example.com",
			from: "sender@example.com",
			subject: "Tin thử từ FNB Manager",
			text: "Tin thử",
		});
		mock.failNext(BREVO_FAULT_METHOD, {
			kind: "status",
			status: 400,
			code: "not_enough_credits",
		});
		expect(await adapter.send(message, email, emailContext)).toEqual({
			kind: "failed",
			code: "no_credit",
			scope: "channel",
		});
		expect(
			await adapter.send(message, email, {
				...emailContext,
				secret: "synthetic-unknown-key",
			}),
		).toEqual({ kind: "failed", code: "unauthorized", scope: "channel" });
		expect(mock.emails()).toHaveLength(1);
	});

	it("scripts faults: a status with retry-after, a hang past the timeout, and an accepted send whose answer is lost", async () => {
		mock.reset();
		const adapter = createZaloBotAdapter();
		mock.failNext("sendMessage", {
			kind: "status",
			status: 429,
			retryAfter: 90,
		});
		expect(await adapter.send(MESSAGE, destination, context())).toEqual({
			kind: "retry",
			code: "quota_exceeded",
			retryAfterSeconds: 90,
		});
		mock.failNext("sendMessage", { kind: "hang", milliseconds: 1000 });
		expect(await adapter.send(MESSAGE, destination, context(100))).toEqual({
			kind: "uncertain",
			code: "timeout",
		});
		mock.failNext("sendMessage", { kind: "accept_then_drop" });
		expect(await adapter.send(MESSAGE, destination, context())).toEqual({
			kind: "uncertain",
			code: "connection_lost",
		});
		expect(mock.zaloMessages()).toHaveLength(1);
		expect(mock.requestCount("sendMessage")).toBe(3);
	});

	it("retries only a send whose connection was refused, which cannot have reached the provider", async () => {
		const closed = await startMockProviders();
		const environment = closed.environment();
		await closed.close();
		const outcome = await createZaloBotAdapter().send(MESSAGE, destination, {
			...context(),
			baseUrl: providerBaseUrl("zalo_bot", environment),
		});
		expect(outcome).toEqual({
			kind: "retry",
			code: "network",
			retryAfterSeconds: null,
		});
	});
});
