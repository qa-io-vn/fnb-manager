// Security tests of the OA webhook (OWASP API Top 10: API2 broken authentication, API4 unrestricted resource
// consumption, API8 injection). Zalo signs the app id, the body, the event's timestamp and the OA secret key, so a
// signature moved to another body or timestamp must not verify, a replayed delivery must be stored once, a stale
// signed event must reach the database with its own (old) time so the customer step refuses it (pgTAP 125), and
// wrong methods, oversized, malformed or hostile bodies must be refused or ignored without a lookup, without a
// crash and without a hostile value in a log line.
import type { CustomerInput } from "@fnb/zalo/oa";
import { type FunctionEnvironment, serveFunction } from "../_shared/http.ts";
import type { CustomerStep } from "./customer.ts";
import {
	ACK_DEADLINE_MS,
	createOaWebhookHandler,
	FUNCTION_NAME,
	MAX_EVENT_BYTES,
	type OaTarget,
	type OaWebhookStore,
	type ReceivedEvent,
	type Reception,
	type WebhookMode,
} from "./handler.ts";
import { oaSignature, SIGNATURE_HEADER } from "./signature.ts";

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

const URL_OF_FUNCTION = "http://127.0.0.1:54321/functions/v1/oa-webhook";
const APP_ID = "synthetic-sec-app";
const OA_ID = "synthetic-sec-oa";
const USER_ID = "synthetic-sec-user";
const SECRET_NAME = "ZALO_OA_SECRET_BRAND_1";
const SECRET = "synthetic-sec-oa-secret";
const NOW = new Date("2026-11-19T03:00:00.000Z");
const FRESH = String(NOW.getTime() - 1_000);
const STALE = String(NOW.getTime() - 49 * 3_600_000);
const BREAKS = new RegExp(
	`[${String.fromCharCode(0x0d, 0x0a, 0x2028, 0x2029, 0x1b)}]`,
);
const ENVIRONMENT: FunctionEnvironment = {
	[SECRET_NAME]: SECRET,
	SUPABASE_DB_URL:
		"postgresql://postgres.synthetic:synthetic-db-password@example.com:5432/postgres",
};

class Store implements OaWebhookStore {
	readonly received: ReceivedEvent[] = [];
	readonly stored = new Set<string>();
	readonly steps: string[] = [];
	lookups = 0;
	mode: WebhookMode = "observe";

	async customerStep(
		eventRow: string,
		_input: CustomerInput,
	): Promise<CustomerStep> {
		this.steps.push(eventRow);
		return {
			step: "ignored",
			oaUserRow: null,
			recipient: null,
			customerId: null,
			reply: null,
		};
	}
	async accessToken(): Promise<string | null> {
		return null;
	}
	async recordReply(): Promise<void> {}
	async targets(appId: string, oaId: string): Promise<readonly OaTarget[]> {
		this.lookups += 1;
		return appId === APP_ID && oaId === OA_ID
			? [
					{
						oaId: "00000000-0000-4000-8000-000000000001",
						tenantId: "11111111-1111-4111-8111-111111111111",
						secretName: SECRET_NAME,
						webhookMode: this.mode,
					},
				]
			: [];
	}
	async receive(event: ReceivedEvent): Promise<Reception> {
		await new Promise((resolve) => setTimeout(resolve, 1));
		this.received.push(event);
		const verified = event.signature === "raw" || event.signature === "compact";
		if (!verified && this.mode === "enforce") {
			return { outcome: "refused", eventRow: null, unverified: 1 };
		}
		if (this.stored.has(event.eventId)) {
			return { outcome: "duplicate", eventRow: null, unverified: null };
		}
		this.stored.add(event.eventId);
		return {
			outcome: "recorded",
			eventRow: `row-${this.stored.size}`,
			unverified: verified ? null : 1,
		};
	}
	async apply(): Promise<string> {
		return "interaction";
	}
	async raiseAlert(): Promise<string> {
		return "not_crossed";
	}
}

function harness(mode: WebhookMode = "observe") {
	const store = new Store();
	store.mode = mode;
	const lines: string[] = [];
	const pending: Promise<unknown>[] = [];
	const handler = createOaWebhookHandler({
		store: () => store,
		clock: () => NOW,
		waitUntil: (promise) => {
			pending.push(promise);
		},
		ackDeadlineMs: 200,
	});
	const send = (request: Request) =>
		serveFunction(request, ENVIRONMENT, handler, {
			name: FUNCTION_NAME,
			origins: [],
			log: (line) => lines.push(line),
			requestId: () => "synthetic-request",
		});
	return { store, lines, send, settle: () => Promise.all(pending) };
}

function body(
	timestamp = FRESH,
	overrides: Record<string, unknown> = {},
): string {
	return JSON.stringify({
		app_id: APP_ID,
		event_name: "user_submit_info",
		timestamp,
		sender: { id: USER_ID },
		recipient: { id: OA_ID },
		info: { phone: "0900000971", name: "Khách Bảo Mật" },
		...overrides,
	});
}

async function mac(raw: string, timestamp: string): Promise<string> {
	return `mac=${await oaSignature(APP_ID, raw, timestamp, SECRET)}`;
}

function post(raw: BodyInit, header?: string): Request {
	return new Request(URL_OF_FUNCTION, {
		method: "POST",
		body: raw,
		headers: header === undefined ? {} : { [SIGNATURE_HEADER]: header },
	});
}

Deno.test("security: a signature moved to another body, timestamp, app or key does not verify; enforce refuses it with 401", async () => {
	const original = body();
	const signature = await mac(original, FRESH);
	const tampered = [
		body(FRESH, { info: { phone: "0900000972", name: "Khách Bảo Mật" } }),
		body(String(Number(FRESH) + 1)),
		body(FRESH, { sender: { id: "synthetic-other-user" } }),
	];
	const observe = harness("observe");
	for (const raw of tampered) {
		await observe.send(post(raw, signature));
	}
	await observe.send(
		post(
			original,
			`mac=${await oaSignature(APP_ID, original, FRESH, "synthetic-wrong-key")}`,
		),
	);
	await observe.settle();
	assertEquals(
		observe.store.received.map((event) => event.signature),
		["mismatch", "mismatch", "mismatch", "mismatch"],
		"every tampered event is a mismatch",
	);
	// The tampered body keeps the event id (the id covers app, OA, event, user, time and message id, not the form),
	// so the wrong-key delivery of the original is a duplicate of it: three events stored, each unverified, which the
	// database's customer step refuses (pgTAP 107). In observe mode an unsigned delivery can thus shadow a later signed
	// one with the same id; enforce mode, the switch of #210, closes that.
	assertEquals(
		[observe.store.stored.size, observe.store.steps.length],
		[3, 3],
		"observe mode stores them for the database, which acts on verified events only",
	);
	const enforce = harness("enforce");
	for (const raw of tampered) {
		const response = await enforce.send(post(raw, signature));
		assertEquals(response.status, 401, "enforce refuses a tampered event");
	}
	await enforce.settle();
	assertEquals(enforce.store.stored.size, 0, "and stores nothing");
	assertEquals(enforce.store.steps.length, 0, "and runs no customer step");
});

Deno.test("security: a malformed, oversized or doubled signature header is a mismatch or missing, never an error", async () => {
	const raw = body();
	const good = await mac(raw, FRESH);
	const test = harness("enforce");
	for (const header of [
		"",
		" ",
		"mac=",
		"mac=zz",
		`${good},${good}`,
		`${good} ${good}`,
		`mac=${"a".repeat(10_000)}`,
		`sha256=${good.slice(4)}`,
		`${good.toUpperCase().replace("MAC=", "mac=")}0`,
	]) {
		const response = await test.send(post(raw, header));
		assertEquals(response.status, 401, `header ${header.slice(0, 20)}`);
	}
	const unsigned = await test.send(post(raw));
	assertEquals(unsigned.status, 401, "no header");
	const signed = await test.send(post(raw, ` ${good} `));
	assertEquals(signed.status, 200, "surrounding spaces are trimmed");
});

Deno.test("security: a stale signed event reaches the database with its own signed time, so the customer step can refuse it", async () => {
	const test = harness("enforce");
	const raw = body(STALE);
	const response = await test.send(post(raw, await mac(raw, STALE)));
	assertEquals(
		response.status,
		200,
		"a correctly signed event is accepted at the door",
	);
	await test.settle();
	const event = test.store.received[0];
	assert(event !== undefined, "the event was received");
	assertEquals(
		[
			event.signature,
			event.occurredAt?.toISOString(),
			event.receivedAt.toISOString(),
		],
		["raw", new Date(Number(STALE)).toISOString(), NOW.toISOString()],
		"the signed time, not the receipt time",
	);
});

Deno.test("security: twenty deliveries of one event at once are stored and followed up once", async () => {
	const test = harness("observe");
	const raw = body();
	const header = await mac(raw, FRESH);
	const responses = await Promise.all(
		Array.from({ length: 20 }, () => test.send(post(raw, header))),
	);
	assertEquals(
		[...new Set(responses.map((response) => response.status))],
		[200],
		"every delivery is answered 200",
	);
	await test.settle();
	assertEquals(
		[
			test.store.received.length,
			test.store.stored.size,
			test.store.steps.length,
		],
		[20, 1, 1],
		"received 20, stored 1, one customer step",
	);
});

Deno.test("security: wrong methods are 405 and a foreign origin gets no CORS answer", async () => {
	const test = harness();
	for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD"]) {
		const response = await test.send(new Request(URL_OF_FUNCTION, { method }));
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
	const answered = await test.send(
		new Request(URL_OF_FUNCTION, {
			method: "POST",
			body: body(),
			headers: { origin: "https://h5.zdn.vn" },
		}),
	);
	assertEquals(
		answered.headers.get("access-control-allow-origin"),
		null,
		"not even a Mini App origin",
	);
	assertEquals(test.store.lookups, 1, "only the POST looked its OA up");
});

Deno.test("security: a body over 65,536 bytes is 413 by its length or while read, before any lookup", async () => {
	const test = harness();
	const padded = body(FRESH, { padding: "x".repeat(MAX_EVENT_BYTES) });
	const declared = await test.send(post(padded, await mac(padded, FRESH)));
	assertEquals(declared.status, 413, "declared");
	let sent = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			sent += 8_192;
			controller.enqueue(new Uint8Array(8_192).fill(0x20));
			if (sent > MAX_EVENT_BYTES * 4) {
				controller.close();
			}
		},
	});
	const streamed = await test.send(post(stream));
	assertEquals(streamed.status, 413, "streamed");
	assertEquals(test.store.lookups, 0, "no lookup");
});

Deno.test("security: malformed JSON, invalid UTF-8 and non-objects are 400; unroutable or hostile ids are ignored without a lookup", async () => {
	const test = harness();
	for (const raw of [
		"",
		"null",
		'"text"',
		"[]",
		"{",
		`${"[".repeat(20_000)}${"]".repeat(20_000)}`,
	]) {
		const response = await test.send(post(raw));
		assertEquals(response.status, 400, `status for ${raw.slice(0, 10)}`);
	}
	const invalid = await test.send(
		post(new Blob([new Uint8Array([0x7b, 0xc3, 0x28, 0x7d])])),
	);
	assertEquals(
		[invalid.status, (await invalid.json()).error],
		[400, "invalid_body"],
		"invalid UTF-8",
	);
	for (const overrides of [
		{ event_name: "user_submit_info\r\nforged" },
		{ event_name: "USER_SUBMIT_INFO" },
		{ event_name: "x".repeat(65) },
		{ app_id: `synthetic${String.fromCharCode(0x0a)}app` },
		{ app_id: "synthetic-sec-app'; drop table public.oa_events; --" },
		{ app_id: ["synthetic-sec-app"] },
		{ recipient: { id: { $ne: null } } },
	]) {
		const raw = body(FRESH, overrides);
		const response = await test.send(post(raw, await mac(raw, FRESH)));
		assertEquals(
			response.status,
			200,
			`answered 200 for ${JSON.stringify(overrides).slice(0, 30)}`,
		);
	}
	assertEquals(test.store.lookups, 0, "none of them was looked up");
	const polluting = `{"__proto__": {"polluted": true}, "constructor": {"prototype": {"polluted": true}}, "app_id": "${APP_ID}", "event_name": "follow", "timestamp": "${FRESH}", "follower": {"id": "${USER_ID}"}, "oa_id": "${OA_ID}"}`;
	await test.send(post(polluting, await mac(polluting, FRESH)));
	assertEquals(
		({} as Record<string, unknown>).polluted,
		undefined,
		"a __proto__ key pollutes no prototype",
	);
});

Deno.test("security: hostile values stay out of the log, and every log line is one line", async () => {
	const test = harness("observe");
	const hostile = body(FRESH, {
		sender: { id: `${USER_ID}${String.fromCharCode(0x0a)}forged` },
		info: {
			phone: "0900000973",
			name: `Khách${String.fromCharCode(0x1b)}[31m`,
		},
		message: { text: "SECRET-TEXT\r\nforged-line", msg_id: "m-1" },
	});
	await test.send(post(hostile, await mac(hostile, FRESH)));
	const ok = body();
	await test.send(post(ok, await mac(ok, FRESH)));
	await test.send(post(ok, "mac=00"));
	await test.settle();
	assert(test.lines.length >= 3, "lines were written");
	for (const line of test.lines) {
		assert(
			!BREAKS.test(line),
			`a log line holds a control character: ${JSON.stringify(line)}`,
		);
		for (const value of [
			SECRET,
			USER_ID,
			OA_ID,
			APP_ID,
			"0900000973",
			"0900000971",
			"SECRET-TEXT",
			"forged",
		]) {
			assert(!line.includes(value), `a log line leaks ${value}: ${line}`);
		}
	}
});

Deno.test("security: the answer deadline is 1,500 ms, inside Zalo's patience", () => {
	assertEquals(ACK_DEADLINE_MS, 1_500, "the documented deadline");
});
