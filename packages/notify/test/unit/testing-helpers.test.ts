import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createBrevoAdapter,
	createResendAdapter,
	createTelegramAdapter,
	createWebhookAdapter,
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
	RESEND_FAULT_METHOD,
	SYNTHETIC_BOT_TOKEN,
	SYNTHETIC_EMAIL_KEY,
	SYNTHETIC_TELEGRAM_BOT,
	SYNTHETIC_TELEGRAM_TOKEN,
	SYNTHETIC_WEBHOOK_SECRET,
	SyntheticEnvironmentError,
	startMockProviders,
	syntheticEnvironment,
	TELEGRAM_METHOD_PREFIX,
	WEBHOOK_FAULT_METHOD,
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
			"NOTIFY_TELEGRAM_BOT_TOKEN_IT",
			"NOTIFY_WEBHOOK_SECRET_IT",
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

describe("mock providers for Telegram, Resend and the signed webhook", () => {
	let mock: MockProviders;

	beforeAll(async () => {
		mock = await startMockProviders();
		mock.registerTelegramBot(SYNTHETIC_TELEGRAM_TOKEN, SYNTHETIC_TELEGRAM_BOT);
		mock.registerEmailKey(SYNTHETIC_EMAIL_KEY);
		mock.registerWebhookSecret(SYNTHETIC_WEBHOOK_SECRET);
	});

	afterAll(async () => {
		await mock.close();
	});

	function contextFor(
		provider: "telegram" | "resend" | "hmac_webhook",
		secret: string,
		timeoutMs = 2000,
	): SendContext {
		return {
			secret,
			fetch: (input, init) => fetch(input, init),
			baseUrl: providerBaseUrl(provider, mock.environment()),
			timeoutMs,
			userAgent: USER_AGENT,
			now: () => new Date(),
		};
	}

	it("serves Telegram sends, getMe, offsets and a scripted 409", async () => {
		mock.reset();
		const adapter = createTelegramAdapter();
		const context = contextFor("telegram", SYNTHETIC_TELEGRAM_TOKEN);
		expect(await adapter.checkCredentials?.(context)).toEqual({
			ok: true,
			code: null,
			botName: SYNTHETIC_TELEGRAM_BOT,
		});
		const sent = await adapter.send(
			MESSAGE,
			{
				channelId: "22222222-2222-4222-8222-222222222222",
				kind: "telegram",
				provider: "telegram",
				address: "700000001",
				config: {},
			},
			context,
		);
		expect(sent.kind).toBe("sent");
		expect(mock.telegramMessages()).toMatchObject([
			{ chatId: "700000001", text: "Tin thử", previewsDisabled: true },
		]);
		const first = mock.queueTelegramUpdate(SYNTHETIC_TELEGRAM_TOKEN, {
			chatId: "700000001",
			text: "/start FNB-7K3QX9MD",
		});
		const round = await adapter.pollUpdates?.(context, null, 0);
		expect(round?.cursor).toBe(first);
		expect(round?.updates).toHaveLength(1);
		const again = await adapter.pollUpdates?.(
			context,
			round?.cursor ?? null,
			0,
		);
		expect(again?.updates).toEqual([]);
		expect(mock.telegramOffsets(SYNTHETIC_TELEGRAM_TOKEN)).toEqual([
			null,
			first + 1,
		]);
		mock.failNext(`${TELEGRAM_METHOD_PREFIX}getUpdates`, {
			kind: "status",
			status: 409,
			description: "Conflict: terminated by other getUpdates request",
		});
		await expect(adapter.pollUpdates?.(context, first, 0)).rejects.toThrow(
			"poll_conflict",
		);
		mock.failNext(`${TELEGRAM_METHOD_PREFIX}sendMessage`, {
			kind: "status",
			status: 403,
			description: "Forbidden: bot was blocked by the user",
		});
		expect(
			await adapter.send(
				MESSAGE,
				{
					channelId: "22222222-2222-4222-8222-222222222222",
					kind: "telegram",
					provider: "telegram",
					address: "700000001",
					config: {},
				},
				context,
			),
		).toEqual({
			kind: "failed",
			code: "blocked_by_user",
			scope: "destination",
		});
	});

	it("keeps Resend's idempotency: the same key and bytes once, a changed payload refused, a key in flight retried", async () => {
		mock.reset();
		const adapter = createResendAdapter();
		const context = contextFor("resend", SYNTHETIC_EMAIL_KEY);
		const destination = {
			channelId: "22222222-2222-4222-8222-222222222222",
			kind: "email" as const,
			provider: "resend" as const,
			address: "owner@example.com",
			config: { from_email: "sender@example.com" },
		};
		const message = { ...MESSAGE, subject: "Tin thử từ FNB Manager" };
		const first = await adapter.send(message, destination, context);
		const second = await adapter.send(message, destination, context);
		expect(first.kind).toBe("sent");
		expect(second).toEqual(first);
		expect(mock.emails()).toHaveLength(1);
		expect(mock.emails()[0]).toMatchObject({
			provider: "resend",
			idempotencyKey: MESSAGE.messageId,
			to: "owner@example.com",
			from: "sender@example.com",
		});
		expect(
			await adapter.send({ ...message, text: "khác" }, destination, context),
		).toEqual({
			kind: "failed",
			code: "invalid_idempotent_request",
			scope: "message",
		});
		mock.failNext(RESEND_FAULT_METHOD, { kind: "hang", milliseconds: 400 });
		const other = {
			...message,
			messageId: "33333333-3333-4333-8333-333333333333",
		};
		const hanging = adapter.send(
			other,
			destination,
			contextFor("resend", SYNTHETIC_EMAIL_KEY, 2000),
		);
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(await adapter.send(other, destination, context)).toEqual({
			kind: "retry",
			code: "concurrent_idempotent_requests",
			retryAfterSeconds: 30,
		});
		expect((await hanging).kind).toBe("retry");
		mock.failNext(RESEND_FAULT_METHOD, { kind: "accept_then_drop" });
		const dropped = {
			...message,
			messageId: "44444444-4444-4444-8444-444444444444",
		};
		expect((await adapter.send(dropped, destination, context)).kind).toBe(
			"retry",
		);
		expect((await adapter.send(dropped, destination, context)).kind).toBe(
			"sent",
		);
		expect(
			mock
				.emails()
				.filter((email) => email.idempotencyKey === dropped.messageId),
		).toHaveLength(1);
	});

	it("receives signed webhooks, drops a duplicate key and rejects a bad signature or a stale timestamp", async () => {
		mock.reset();
		const adapter = createWebhookAdapter();
		const destination = {
			channelId: "22222222-2222-4222-8222-222222222222",
			kind: "webhook" as const,
			provider: "hmac_webhook" as const,
			address: "https://hooks.example.com/fnb/alerts",
			config: { url: "https://hooks.example.com/fnb/alerts" },
		};
		const message = {
			...MESSAGE,
			kind: "alert" as const,
			webhookBody: '{"version":1,"type":"alert.opened","facts":{}}',
		};
		const context = contextFor("hmac_webhook", SYNTHETIC_WEBHOOK_SECRET);
		expect(await adapter.send(message, destination, context)).toEqual({
			kind: "sent",
			providerMessageId: null,
		});
		expect(await adapter.send(message, destination, context)).toEqual({
			kind: "sent",
			providerMessageId: null,
		});
		expect(mock.webhookDeliveries()).toMatchObject([
			{
				path: "/fnb/alerts",
				event: "alert.opened",
				verified: true,
				body: { version: 1, type: "alert.opened" },
			},
		]);
		expect(mock.webhookDuplicates()).toBe(1);
		const forged = await adapter.send(
			{ ...message, messageId: "55555555-5555-4555-8555-555555555555" },
			destination,
			{ ...context, secret: "synthetic-wrong-secret" },
		);
		expect(forged).toEqual({
			kind: "failed",
			code: "http_401",
			scope: "message",
		});
		const stale = await adapter.send(
			{ ...message, messageId: "66666666-6666-4666-8666-666666666666" },
			destination,
			{ ...context, now: () => new Date(Date.now() - 301_000) },
		);
		expect(stale).toEqual({
			kind: "failed",
			code: "http_400",
			scope: "message",
		});
		expect(mock.webhookRejections()).toBe(2);
		mock.failNext(WEBHOOK_FAULT_METHOD, { kind: "status", status: 503 });
		expect(
			(
				await adapter.send(
					{ ...message, messageId: "77777777-7777-4777-8777-777777777777" },
					destination,
					context,
				)
			).kind,
		).toBe("retry");
	});
});
