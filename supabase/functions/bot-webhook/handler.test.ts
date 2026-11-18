import { sha256Hex } from "@fnb/notify";
import { type FunctionEnvironment, serveFunction } from "../_shared/http.ts";
import {
	type BotReply,
	type BotTarget,
	type BotWebhookStore,
	createBotWebhookHandler,
	FUNCTION_NAME,
	inboundUpdates,
	isStop,
	SECRET_TOKEN_HEADER,
	STOP_CONFIRMATION,
	STOP_TEMPLATE,
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

const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/bot-webhook";
const SECRET_NAME = "NOTIFY_ZALO_BOT_TOKEN";
const BOT_TOKEN = "synthetic-bot-token";
const SECRET_TOKEN = "synthetic-webhook-secret-token-0001";
const CHAT_ID = "synthetic-chat-0001";
const OTHER_CHAT = "synthetic-chat-0002";
const CHANNEL_ID = "88888888-8888-4888-8888-000000000001";
const LINK_CODE = "FNB-ABCD2345";
const NOW = new Date("2026-11-18T03:00:00.000Z");

const ENVIRONMENT: FunctionEnvironment = {
	[SECRET_NAME]: BOT_TOKEN,
	NOTIFY_ZALO_BOT_BASE_URL: "http://127.0.0.1:8787",
	SUPABASE_DB_URL:
		"postgresql://postgres.synthetic:synthetic-db-password@example.com:5432/postgres",
};

interface Call {
	readonly method: string;
	readonly args: readonly unknown[];
}

class FakeStore implements BotWebhookStore {
	readonly calls: Call[] = [];
	readonly hashes = new Set<string>();
	readonly linkedChats = new Set<string>([CHAT_ID]);
	readonly codes = new Set<string>([LINK_CODE]);
	readonly acceptances = new Set<string>([CHAT_ID]);
	readonly replies: { channels: readonly string[]; reply: BotReply }[] = [];
	readonly linked: string[] = [];
	linkGate: Promise<void> | null = null;

	async target(secretTokenSha256: string): Promise<BotTarget | null> {
		this.calls.push({ method: "target", args: [] });
		return this.hashes.has(secretTokenSha256)
			? { secretName: SECRET_NAME, kind: "zalo_bot" }
			: null;
	}

	async completeLink(
		target: BotTarget,
		code: string,
		chatId: string,
		hint: string,
	): Promise<string | null> {
		this.calls.push({
			method: "completeLink",
			args: [target.secretName, code, chatId, hint],
		});
		if (this.linkGate) {
			await this.linkGate;
		}
		if (!this.codes.delete(code)) {
			return null;
		}
		this.linked.push(chatId);
		return CHANNEL_ID;
	}

	async acceptLink(target: BotTarget, chatId: string): Promise<string | null> {
		this.calls.push({
			method: "acceptLink",
			args: [target.secretName, chatId],
		});
		return this.acceptances.delete(chatId) ? CHANNEL_ID : null;
	}

	async stopChat(
		target: BotTarget,
		chatId: string,
	): Promise<readonly string[]> {
		this.calls.push({ method: "stopChat", args: [target.secretName, chatId] });
		return this.linkedChats.delete(chatId) ? [CHANNEL_ID] : [];
	}

	async recordReply(
		channels: readonly string[],
		reply: BotReply,
	): Promise<number> {
		this.replies.push({ channels, reply });
		return channels.length;
	}

	methods(): string[] {
		return this.calls.map((call) => call.method);
	}
}

interface Sent {
	readonly url: string;
	readonly body: unknown;
}

interface Harness {
	readonly store: FakeStore;
	readonly lines: string[];
	readonly sent: Sent[];
	readonly pending: Promise<unknown>[];
	post(
		body: unknown,
		token?: string | null,
		environment?: FunctionEnvironment,
	): Promise<Response>;
	settle(): Promise<void>;
}

async function harness(answer: () => Response = okAnswer): Promise<Harness> {
	const store = new FakeStore();
	store.hashes.add(await sha256Hex(SECRET_TOKEN));
	const lines: string[] = [];
	const sent: Sent[] = [];
	const pending: Promise<unknown>[] = [];
	const handler = createBotWebhookHandler({
		store: () => store,
		clock: () => NOW,
		waitUntil: (promise) => {
			pending.push(promise);
		},
		fetch: async (url, init) => {
			sent.push({ url, body: JSON.parse(String(init.body)) });
			return answer();
		},
	});
	return {
		store,
		lines,
		sent,
		pending,
		post: (body, token = SECRET_TOKEN, environment = ENVIRONMENT) =>
			serveFunction(
				new Request(FUNCTION_URL, {
					method: "POST",
					body: typeof body === "string" ? body : JSON.stringify(body),
					headers: token === null ? {} : { [SECRET_TOKEN_HEADER]: token },
				}),
				environment,
				handler,
				{
					name: FUNCTION_NAME,
					origins: [],
					log: (line) => lines.push(line),
					requestId: () => "synthetic-request",
				},
			),
		settle: async () => {
			await Promise.all(pending);
		},
	};
}

function okAnswer(): Response {
	return new Response(
		JSON.stringify({ ok: true, result: { message_id: "synthetic-reply-1" } }),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

function update(text: string, chatId = CHAT_ID, chatType = "PRIVATE") {
	return {
		ok: true,
		result: {
			event_name: "message.text.received",
			message: {
				from: { id: chatId, display_name: "Synthetic member", is_bot: false },
				chat: { id: chatId, chat_type: chatType },
				text,
				message_id: "synthetic-message-1",
				date: NOW.getTime(),
			},
		},
	};
}

Deno.test("a call without the secret token header gets 401 before any lookup", async () => {
	const test = await harness();
	const missing = await test.post(update(LINK_CODE), null);
	const short = await test.post(update(LINK_CODE), "short");
	for (const response of [missing, short]) {
		assertEquals(response.status, 401, "status");
		assertEquals(
			await response.json(),
			{ error: "invalid_secret_token", request_id: "synthetic-request" },
			"body",
		);
	}
	assertEquals(test.store.calls.length, 0, "no lookup");
});

Deno.test("a wrong secret token gets 401 and the update is never read", async () => {
	const test = await harness();
	const response = await test.post(
		update(LINK_CODE),
		"synthetic-wrong-secret-token-0001",
	);
	await test.settle();
	assertEquals(response.status, 401, "status");
	assertEquals(test.store.methods(), ["target"], "only the lookup");
	assertEquals(test.pending.length, 0, "nothing scheduled");
});

Deno.test("a link code from a private chat completes the link through the phase 12 function", async () => {
	const test = await harness();
	let open = () => {};
	test.store.linkGate = new Promise<void>((resolve) => {
		open = resolve;
	});
	const response = await test.post(
		update(`  mã của tôi: ${LINK_CODE.toLowerCase()} `),
	);
	assertEquals(response.status, 200, "status");
	assertEquals(await response.json(), { ok: true }, "body");
	assertEquals(
		test.store.linked,
		[],
		"answered while the link is still running",
	);
	assertEquals(test.pending.length, 1, "the link runs under waitUntil");
	open();
	await test.settle();
	assertEquals(test.store.linked, [CHAT_ID], "linked after the answer");
	assertEquals(
		test.store.calls[1],
		{
			method: "completeLink",
			args: [SECRET_NAME, LINK_CODE, CHAT_ID, "…0001"],
		},
		"complete call",
	);
	assert(
		test.lines.some((line) =>
			line.includes("linked 1, accepted 0, stopped 0, dropped 0"),
		),
		"counted",
	);
});

Deno.test("ĐỒNG Ý with or without diacritics accepts the waiting link", async () => {
	for (const text of ["ĐỒNG Ý", "đồng ý!", "Dong y", "  DONG Y. "]) {
		const test = await harness();
		await test.post(update(text));
		await test.settle();
		assertEquals(test.store.methods(), ["target", "acceptLink"], text);
	}
});

Deno.test("DỪNG with or without diacritics withdraws the consent and confirms once", async () => {
	for (const text of ["DỪNG", "dừng", "DUNG", "Dung!", " DừNG "]) {
		const test = await harness();
		const response = await test.post(update(text));
		assertEquals(response.status, 200, `${text}: status`);
		await test.settle();
		assertEquals(
			test.store.methods(),
			["target", "stopChat"],
			`${text}: calls`,
		);
		assertEquals(test.sent.length, 1, `${text}: one confirmation`);
		assertEquals(
			test.sent[0],
			{
				url: `http://127.0.0.1:8787/bot${BOT_TOKEN}/sendMessage`,
				body: { chat_id: CHAT_ID, text: STOP_CONFIRMATION },
			},
			`${text}: confirmation request`,
		);
		assertEquals(
			test.store.replies,
			[
				{
					channels: [CHANNEL_ID],
					reply: {
						template: STOP_TEMPLATE,
						status: "sent",
						errorCode: null,
						providerMessageId: "synthetic-reply-1",
					},
				},
			],
			`${text}: logged`,
		);
	}
});

Deno.test("a second DỪNG from the same chat finds nothing linked and sends nothing", async () => {
	const test = await harness();
	await test.post(update("DỪNG"));
	await test.post(update("DỪNG"));
	await test.settle();
	assertEquals(test.sent.length, 1, "confirmed once");
	assertEquals(test.store.replies.length, 1, "logged once");
});

Deno.test("words that only look like DỪNG are not a stop", () => {
	for (const text of ["Đúng", "dùng", "DỪNG LẠI", "dung dịch", ""]) {
		assert(!isStop(text), `${text} is not a stop`);
	}
	for (const text of ["DỪNG", "dừng", "DUNG", "dung", "Dừng."]) {
		assert(isStop(text), `${text} is a stop`);
	}
});

Deno.test("an unrelated chat, a group chat or other text is dropped without a write", async () => {
	const test = await harness();
	await test.post(update("DỪNG", OTHER_CHAT));
	await test.post(update(LINK_CODE, CHAT_ID, "GROUP"));
	await test.post(update("xin chào"));
	await test.settle();
	assertEquals(
		test.store.methods(),
		["target", "stopChat", "target", "target"],
		"only the stop lookup ran",
	);
	assertEquals(test.sent.length, 0, "no reply");
	assertEquals(test.store.replies.length, 0, "nothing logged");
});

Deno.test("an update arrives either wrapped in result or bare", () => {
	const wrapped = inboundUpdates(update("DỪNG"));
	const bare = inboundUpdates(update("DỪNG").result);
	assertEquals(wrapped, bare, "same updates");
	assertEquals(wrapped.length, 1, "one update");
	assertEquals(inboundUpdates({ ok: true, result: [] }), [], "empty list");
});

Deno.test("a stop without the bot token is recorded as failed and nothing is sent", async () => {
	const test = await harness();
	await test.post(update("DỪNG"), SECRET_TOKEN, {
		...ENVIRONMENT,
		[SECRET_NAME]: undefined,
	});
	await test.settle();
	assertEquals(test.sent.length, 0, "nothing sent");
	assertEquals(
		test.store.replies[0]?.reply,
		{
			template: STOP_TEMPLATE,
			status: "failed",
			errorCode: "not_configured",
			providerMessageId: null,
		},
		"logged as failed",
	);
	assert(
		test.lines.some((line) =>
			line.includes(`the function secret ${SECRET_NAME} is not set`),
		),
		"the missing secret is logged by name",
	);
});

Deno.test("a refused or failed confirmation is logged with its code", async () => {
	const test = await harness(
		() =>
			new Response(JSON.stringify({ ok: false, error_code: 500 }), {
				status: 500,
			}),
	);
	await test.post(update("DỪNG"));
	await test.settle();
	assertEquals(
		test.store.replies[0]?.reply,
		{
			template: STOP_TEMPLATE,
			status: "failed",
			errorCode: "http_500",
			providerMessageId: null,
		},
		"failed reply",
	);
});

Deno.test("no log line carries the chat id, the text, the bot token or the secret token", async () => {
	const test = await harness();
	await test.post(update(LINK_CODE));
	await test.post(update("DỪNG"));
	await test.post(update("DỪNG"), "synthetic-wrong-secret-token-0001");
	await test.settle();
	assert(test.lines.length > 0, "something was logged");
	for (const line of test.lines) {
		for (const secret of [
			CHAT_ID,
			LINK_CODE,
			"DỪNG",
			BOT_TOKEN,
			SECRET_TOKEN,
			"synthetic-db-password",
		]) {
			assert(!line.includes(secret), `a log line carries ${secret}: ${line}`);
		}
	}
});
