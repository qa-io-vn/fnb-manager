// Security tests of the Zalo Bot webhook (OWASP API Top 10: API2 broken authentication, API4 unrestricted resource
// consumption, API8 injection). The secret token is the only credential: a missing, malformed or wrong token must be
// refused with 401 before the body is read, and a malformed one before any lookup. A replayed update must change
// nothing a second time (single-use link codes, one acceptance, one stop), at most 20 updates are handled per call,
// and wrong methods, oversized, malformed or hostile bodies must be refused or dropped without a hostile value in a
// log line.
import { sha256Hex } from "@fnb/notify";
import { type FunctionEnvironment, serveFunction } from "../_shared/http.ts";
import {
	type BotReply,
	type BotTarget,
	type BotWebhookStore,
	createBotWebhookHandler,
	FUNCTION_NAME,
	MAX_UPDATE_BYTES,
	MAX_UPDATES_PER_CALL,
	SECRET_TOKEN_HEADER,
} from "./handler.ts";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

function assertEquals(actual: unknown, expected: unknown, label: string): void {
	const left = JSON.stringify(actual);
	const right = JSON.stringify(expected);
	assert(left === right, `${label}: expected ${right}, got ${left}`);
}

const URL_OF_FUNCTION = "http://127.0.0.1:54321/functions/v1/bot-webhook";
const SECRET_NAME = "NOTIFY_ZALO_BOT_TOKEN";
const BOT_TOKEN = "synthetic-sec-bot-token";
const SECRET_TOKEN = "synthetic-sec-webhook-token-0001";
const CHAT_ID = "synthetic-sec-chat-1";
const LINK_CODE = "FNB-SECU2345";
const CHANNEL_ID = "88888888-8888-4888-8888-000000000009";
const NOW = new Date("2026-11-19T03:00:00.000Z");
const BREAKS = new RegExp(
	`[${String.fromCharCode(0x0d, 0x0a, 0x2028, 0x2029, 0x1b)}]`,
);
const ENVIRONMENT: FunctionEnvironment = {
	[SECRET_NAME]: BOT_TOKEN,
	NOTIFY_ZALO_BOT_BASE_URL: "http://127.0.0.1:8787",
	SUPABASE_DB_URL:
		"postgresql://postgres.synthetic:synthetic-db-password@example.com:5432/postgres",
};

class Store implements BotWebhookStore {
	readonly hashes = new Set<string>();
	readonly codes = new Set<string>([LINK_CODE]);
	readonly waiting = new Set<string>([CHAT_ID]);
	readonly linkedChats = new Set<string>([CHAT_ID]);
	readonly writes: string[] = [];
	lookups = 0;

	async target(hash: string): Promise<BotTarget | null> {
		this.lookups += 1;
		return this.hashes.has(hash)
			? { secretName: SECRET_NAME, kind: "zalo_bot" }
			: null;
	}
	async completeLink(
		_target: BotTarget,
		code: string,
		chatId: string,
	): Promise<string | null> {
		if (!this.codes.delete(code)) {
			return null;
		}
		this.writes.push(`link:${chatId}`);
		return CHANNEL_ID;
	}
	async acceptLink(_target: BotTarget, chatId: string): Promise<string | null> {
		if (!this.waiting.delete(chatId)) {
			return null;
		}
		this.writes.push(`accept:${chatId}`);
		return CHANNEL_ID;
	}
	async stopChat(
		_target: BotTarget,
		chatId: string,
	): Promise<readonly string[]> {
		if (!this.linkedChats.delete(chatId)) {
			return [];
		}
		this.writes.push(`stop:${chatId}`);
		return [CHANNEL_ID];
	}
	async recordReply(
		channels: readonly string[],
		_reply: BotReply,
	): Promise<number> {
		return channels.length;
	}
}

async function harness() {
	const store = new Store();
	store.hashes.add(await sha256Hex(SECRET_TOKEN));
	const lines: string[] = [];
	const pending: Promise<unknown>[] = [];
	const sent: string[] = [];
	const handler = createBotWebhookHandler({
		store: () => store,
		clock: () => NOW,
		waitUntil: (promise) => {
			pending.push(promise);
		},
		fetch: async (url) => {
			sent.push(url);
			return new Response(
				JSON.stringify({ ok: true, result: { message_id: "synthetic-reply" } }),
				{ status: 200 },
			);
		},
	});
	const send = (request: Request) =>
		serveFunction(request, ENVIRONMENT, handler, {
			name: FUNCTION_NAME,
			origins: [],
			log: (line) => lines.push(line),
			requestId: () => "synthetic-request",
		});
	return { store, lines, sent, send, settle: () => Promise.all(pending) };
}

function update(
	text: string,
	chatId = CHAT_ID,
	messageId = "synthetic-sec-message-1",
) {
	return {
		ok: true,
		result: {
			event_name: "message.text.received",
			message: {
				from: { id: chatId, display_name: "Synthetic member", is_bot: false },
				chat: { id: chatId, chat_type: "PRIVATE" },
				text,
				message_id: messageId,
				date: NOW.getTime(),
			},
		},
	};
}

function post(body: BodyInit, token: string | null = SECRET_TOKEN): Request {
	return new Request(URL_OF_FUNCTION, {
		method: "POST",
		body,
		headers: token === null ? {} : { [SECRET_TOKEN_HEADER]: token },
	});
}

Deno.test("security: a missing or malformed secret token is 401 before any lookup or body read", async () => {
	const test = await harness();
	for (const token of [
		null,
		"",
		"short-7",
		"x".repeat(257),
		"token with spaces",
		"tökén-ünïcode-0001",
		"token;drop-table",
		`${SECRET_TOKEN}%00`,
	]) {
		let pulled = false;
		const body = new ReadableStream<Uint8Array>(
			{
				pull(controller) {
					pulled = true;
					controller.enqueue(
						new TextEncoder().encode(JSON.stringify(update(LINK_CODE))),
					);
					controller.close();
				},
			},
			{ highWaterMark: 0 },
		);
		const response = await test.send(post(body, token));
		assertEquals(
			[response.status, (await response.json()).error],
			[401, "invalid_secret_token"],
			`token ${String(token).slice(0, 12)}`,
		);
		assert(!pulled, "the body was not read");
	}
	assertEquals(test.store.lookups, 0, "no lookup");
	assertEquals(test.store.writes, [], "no write");
});

Deno.test("security: a well-formed but wrong token, or one differing in case or by a character, is 401 after one lookup and no body read", async () => {
	const test = await harness();
	for (const token of [
		SECRET_TOKEN.toUpperCase(),
		`${SECRET_TOKEN.slice(0, -1)}2`,
		`${SECRET_TOKEN}0`,
		SECRET_TOKEN.slice(1),
	]) {
		let pulled = false;
		const body = new ReadableStream<Uint8Array>(
			{
				pull(controller) {
					pulled = true;
					controller.enqueue(
						new TextEncoder().encode(JSON.stringify(update(LINK_CODE))),
					);
					controller.close();
				},
			},
			{ highWaterMark: 0 },
		);
		const response = await test.send(post(body, token));
		assertEquals(response.status, 401, `token ${token.slice(-4)}`);
		assert(!pulled, "the body was not read");
	}
	assertEquals(test.store.lookups, 4, "one lookup each");
	assertEquals(test.store.writes, [], "no write");
	const right = await test.send(
		post(JSON.stringify(update("hello")), `  ${SECRET_TOKEN}  `),
	);
	assertEquals(right.status, 200, "surrounding spaces are trimmed");
});

Deno.test("security: replayed updates change nothing a second time", async () => {
	const test = await harness();
	for (const text of [
		LINK_CODE,
		LINK_CODE,
		"ĐỒNG Ý",
		"ĐỒNG Ý",
		"DỪNG",
		"DỪNG",
	]) {
		const response = await test.send(post(JSON.stringify(update(text))));
		assertEquals(response.status, 200, "answered");
	}
	await test.settle();
	assertEquals(
		test.store.writes,
		[`link:${CHAT_ID}`, `accept:${CHAT_ID}`, `stop:${CHAT_ID}`],
		"one link, one acceptance, one stop",
	);
	assertEquals(test.sent.length, 1, "one stop confirmation sent");
});

Deno.test("security: at most 20 updates are handled per call", async () => {
	const test = await harness();
	const many = {
		ok: true,
		result: Array.from(
			{ length: 50 },
			(_, index) =>
				update(`hello ${index}`, `synthetic-sec-chat-${index}`, `m-${index}`)
					.result,
		),
	};
	const response = await test.send(post(JSON.stringify(many)));
	assertEquals(response.status, 200, "answered");
	await test.settle();
	assertEquals(MAX_UPDATES_PER_CALL, 20, "the documented limit");
	assert(
		test.lines.some((line) =>
			line.startsWith("bot-webhook synthetic-request: updates 20:"),
		),
		`handled 20: ${test.lines.join(" | ")}`,
	);
});

Deno.test("security: wrong methods are 405, a foreign origin gets no CORS answer, and an oversized body is 413", async () => {
	const test = await harness();
	for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD"]) {
		const response = await test.send(
			new Request(URL_OF_FUNCTION, {
				method,
				headers: { [SECRET_TOKEN_HEADER]: SECRET_TOKEN },
			}),
		);
		assertEquals(response.status, 405, method);
		await response.body?.cancel();
	}
	const preflight = await test.send(
		new Request(URL_OF_FUNCTION, {
			method: "OPTIONS",
			headers: { origin: "https://evil.example.com" },
		}),
	);
	assertEquals(
		preflight.headers.get("access-control-allow-origin"),
		null,
		"no CORS origin",
	);
	const big = await test.send(
		post(JSON.stringify({ padding: "x".repeat(MAX_UPDATE_BYTES) })),
	);
	assertEquals(big.status, 413, "oversized");
	assertEquals(test.store.writes, [], "no write");
});

Deno.test("security: malformed or hostile bodies are 400 or dropped, and nothing hostile reaches a log line", async () => {
	const test = await harness();
	for (const raw of ["", "null", "[]", "{", '"text"']) {
		const response = await test.send(post(raw));
		assertEquals(response.status, 400, `status for ${raw.slice(0, 8)}`);
	}
	for (const text of [
		`${LINK_CODE}\r\nforged-line`,
		"'; drop table public.notification_channels; --",
		`ĐỒNG Ý${String.fromCharCode(0x1b)}[31m`,
		"x".repeat(5_000),
	]) {
		const response = await test.send(
			post(
				JSON.stringify(
					update(
						text,
						`synthetic-sec-chat-x${String.fromCharCode(0x0a)}forged`,
					),
				),
			),
		);
		assertEquals(response.status, 200, "answered");
	}
	await test.settle();
	assertEquals(
		test.store.writes,
		[],
		"a hostile chat id or text links, accepts and stops nothing",
	);
	for (const line of test.lines) {
		assert(
			!BREAKS.test(line),
			`a log line holds a control character: ${JSON.stringify(line)}`,
		);
		for (const value of [
			SECRET_TOKEN,
			BOT_TOKEN,
			LINK_CODE,
			CHAT_ID,
			"forged",
			"drop table",
		]) {
			assert(!line.includes(value), `a log line leaks ${value}: ${line}`);
		}
	}
});
