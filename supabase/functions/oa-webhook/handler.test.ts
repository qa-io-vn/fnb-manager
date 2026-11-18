import {
	type FunctionEnvironment,
	REQUEST_ID_HEADER,
	serveFunction,
} from "../_shared/http.ts";
import {
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

const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/oa-webhook";
const APP_ID = "synthetic-app-1";
const OA_ID = "synthetic-oa-1";
const USER_ID = "synthetic-user-1";
const MESSAGE_TEXT = "Xin chào quán";
const SECRET_NAME = "ZALO_OA_SECRET_BRAND_1";
const SECRET = "synthetic-oa-secret-key";
const TIMESTAMP = "1794970800000";
const NOW = new Date("2026-11-18T03:00:01.000Z");

const ENVIRONMENT: FunctionEnvironment = {
	[SECRET_NAME]: SECRET,
	SUPABASE_DB_URL:
		"postgresql://postgres.synthetic:synthetic-db-password@example.com:5432/postgres",
};

interface Gate {
	readonly promise: Promise<void>;
	open(): void;
}

function gate(): Gate {
	let open = () => {};
	const promise = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { promise, open };
}

class FakeStore implements OaWebhookStore {
	readonly targetRows = new Map<string, OaTarget[]>();
	readonly stored = new Map<string, ReceivedEvent>();
	readonly received: ReceivedEvent[] = [];
	readonly applied: string[] = [];
	readonly alerts: number[] = [];
	refused = 0;
	unverified = 0;
	lookups = 0;
	receiveGate: Promise<void> | null = null;
	applyGate: Promise<void> | null = null;
	applyFails = false;

	configure(mode: WebhookMode, count = 1): void {
		const rows: OaTarget[] = [];
		for (let index = 0; index < count; index += 1) {
			rows.push({
				oaId: `00000000-0000-4000-8000-00000000000${index + 1}`,
				tenantId: "11111111-1111-4111-8111-111111111111",
				secretName: SECRET_NAME,
				webhookMode: mode,
			});
		}
		this.targetRows.set(`${APP_ID}/${OA_ID}`, rows);
	}

	async targets(appId: string, oaId: string): Promise<readonly OaTarget[]> {
		this.lookups += 1;
		return this.targetRows.get(`${appId}/${oaId}`) ?? [];
	}

	async receive(event: ReceivedEvent): Promise<Reception> {
		if (this.receiveGate) {
			await this.receiveGate;
		}
		this.received.push(event);
		const target = [...this.targetRows.values()]
			.flat()
			.find((row) => row.oaId === event.oaId);
		const verified = event.signature === "raw" || event.signature === "compact";
		if (!verified && target?.webhookMode === "enforce") {
			this.refused += 1;
			this.unverified += 1;
			return {
				outcome: "refused",
				eventRow: null,
				unverified: this.unverified,
			};
		}
		if (this.stored.has(event.eventId)) {
			return { outcome: "duplicate", eventRow: null, unverified: null };
		}
		this.stored.set(event.eventId, event);
		if (!verified) {
			this.unverified += 1;
		}
		return {
			outcome: "recorded",
			eventRow: `row-${this.stored.size}`,
			unverified: verified ? null : this.unverified,
		};
	}

	async apply(eventRow: string): Promise<string> {
		if (this.applyGate) {
			await this.applyGate;
		}
		if (this.applyFails) {
			throw new Error("the follow-up lost its connection");
		}
		this.applied.push(eventRow);
		return "interaction";
	}

	async raiseAlert(_oaId: string, unverified: number): Promise<string> {
		this.alerts.push(unverified);
		return "not_crossed";
	}
}

interface Harness {
	readonly store: FakeStore;
	readonly lines: string[];
	readonly pending: Promise<unknown>[];
	send(request: Request, environment?: FunctionEnvironment): Promise<Response>;
	settle(): Promise<void>;
}

function harness(mode: WebhookMode = "observe", deadlineMs = 200): Harness {
	const store = new FakeStore();
	store.configure(mode);
	const lines: string[] = [];
	const pending: Promise<unknown>[] = [];
	const handler = createOaWebhookHandler({
		store: () => store,
		clock: () => NOW,
		waitUntil: (promise) => {
			pending.push(promise);
		},
		ackDeadlineMs: deadlineMs,
	});
	return {
		store,
		lines,
		pending,
		send: (request, environment = ENVIRONMENT) =>
			serveFunction(request, environment, handler, {
				name: FUNCTION_NAME,
				origins: [],
				log: (line) => lines.push(line),
				requestId: () => "synthetic-request",
			}),
		settle: async () => {
			await Promise.all(pending);
		},
	};
}

function messageBody(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		app_id: APP_ID,
		user_id_by_app: "synthetic-app-user-1",
		event_name: "user_send_text",
		timestamp: TIMESTAMP,
		sender: { id: USER_ID },
		recipient: { id: OA_ID },
		message: { text: MESSAGE_TEXT, msg_id: "synthetic-msg-1" },
		...overrides,
	});
}

async function signed(body: string, secret = SECRET): Promise<Request> {
	const mac = await oaSignature(APP_ID, body, TIMESTAMP, secret);
	return new Request(FUNCTION_URL, {
		method: "POST",
		body,
		headers: { [SIGNATURE_HEADER]: `mac=${mac}` },
	});
}

function unsigned(body: string, header?: string): Request {
	return new Request(FUNCTION_URL, {
		method: "POST",
		body,
		headers: header === undefined ? {} : { [SIGNATURE_HEADER]: header },
	});
}

Deno.test("a signed event in observe mode is answered 200, stored as raw and followed up", async () => {
	const test = harness();
	const response = await test.send(await signed(messageBody()));
	assertEquals(response.status, 200, "status");
	assertEquals(await response.json(), { ok: true }, "body");
	assertEquals(
		response.headers.get(REQUEST_ID_HEADER),
		"synthetic-request",
		"request id",
	);
	assertEquals(
		response.headers.get("access-control-allow-origin"),
		null,
		"no CORS",
	);
	await test.settle();
	assertEquals(
		test.store.received.map((event) => [
			event.signature,
			event.eventName,
			event.oaUserId,
			event.occurredAt?.toISOString(),
			event.receivedAt.toISOString(),
		]),
		[
			[
				"raw",
				"user_send_text",
				USER_ID,
				"2026-11-18T03:00:00.000Z",
				NOW.toISOString(),
			],
		],
		"reception",
	);
	assertEquals(test.store.applied, ["row-1"], "follow-up");
	assertEquals(test.store.alerts, [], "no alert for a verified event");
});

Deno.test("Zalo delivering the same event twice stores and follows it up once", async () => {
	const test = harness();
	const body = messageBody();
	const first = await test.send(await signed(body));
	const second = await test.send(await signed(body));
	await test.settle();
	assertEquals([first.status, second.status], [200, 200], "both answered 200");
	assertEquals(test.store.stored.size, 1, "one event stored");
	assertEquals(test.store.applied, ["row-1"], "one follow-up");
	assert(
		test.lines.some((line) => line.includes("user_send_text: duplicate")),
		"the duplicate is logged",
	);
});

Deno.test("a body re-serialised compact by Zalo is recorded as compact", async () => {
	const test = harness();
	const compact = messageBody();
	const pretty = JSON.stringify(JSON.parse(compact), null, 2);
	const mac = await oaSignature(APP_ID, compact, TIMESTAMP, SECRET);
	const response = await test.send(unsigned(pretty, `mac=${mac}`));
	await test.settle();
	assertEquals(response.status, 200, "status");
	assertEquals(test.store.received[0]?.signature, "compact", "serialisation");
});

Deno.test("observe mode stores and counts a wrong or missing signature and still answers 200", async () => {
	const test = harness();
	const wrong = await test.send(await signed(messageBody(), "another-secret"));
	const missing = await test.send(
		unsigned(
			messageBody({ message: { text: "khác", msg_id: "synthetic-msg-2" } }),
		),
	);
	await test.settle();
	assertEquals([wrong.status, missing.status], [200, 200], "answered 200");
	assertEquals(
		test.store.received.map((event) => event.signature),
		["mismatch", "missing"],
		"outcomes",
	);
	assertEquals(test.store.stored.size, 2, "both stored");
	assertEquals(
		test.store.alerts,
		[1, 2],
		"each unverified call reaches the alert rule",
	);
});

Deno.test("enforce mode answers 401 to a wrong or missing signature and stores nothing", async () => {
	const test = harness("enforce");
	const wrong = await test.send(await signed(messageBody(), "another-secret"));
	const missing = await test.send(unsigned(messageBody()));
	const malformed = await test.send(unsigned(messageBody(), "mac=nothex"));
	await test.settle();
	for (const response of [wrong, missing, malformed]) {
		assertEquals(response.status, 401, "status");
		assertEquals(
			await response.json(),
			{ error: "invalid_signature", request_id: "synthetic-request" },
			"body",
		);
	}
	assertEquals(test.store.stored.size, 0, "nothing stored");
	assertEquals(test.store.refused, 3, "refusals counted");
	assertEquals(test.store.applied, [], "no follow-up");
	assertEquals(test.store.alerts, [1, 2, 3], "refusals reach the alert rule");
});

Deno.test("enforce mode stores a correctly signed event", async () => {
	const test = harness("enforce");
	const response = await test.send(await signed(messageBody()));
	await test.settle();
	assertEquals(response.status, 200, "status");
	assertEquals(test.store.stored.size, 1, "stored");
	assertEquals(test.store.applied, ["row-1"], "followed up");
});

Deno.test("a missing OA secret answers 500 not_configured without naming it and stores nothing", async () => {
	const test = harness();
	const environment: FunctionEnvironment = {
		...ENVIRONMENT,
		[SECRET_NAME]: undefined,
	};
	const response = await test.send(await signed(messageBody()), environment);
	await test.settle();
	assertEquals(response.status, 500, "status");
	const text = await response.text();
	assertEquals(
		JSON.parse(text),
		{ error: "not_configured", request_id: "synthetic-request" },
		"body",
	);
	assert(!text.includes(SECRET_NAME), "the answer does not name the secret");
	assertEquals(test.store.received.length, 0, "nothing received");
	assertEquals(test.pending.length, 0, "no follow-up scheduled");
	assert(
		test.lines.some((line) =>
			line.includes(`the function secret ${SECRET_NAME} is not set`),
		),
		"the log names the missing secret",
	);
});

Deno.test("an event of an unknown or ambiguous OA is answered 200 and stored nowhere", async () => {
	const unknown = harness();
	unknown.store.targetRows.clear();
	const first = await unknown.send(await signed(messageBody()));
	await unknown.settle();
	assertEquals(first.status, 200, "unknown OA status");
	assertEquals(unknown.store.received.length, 0, "unknown OA stored nothing");
	assert(
		unknown.lines.some((line) => line.includes("no configured OA matches")),
		"unknown OA logged",
	);
	const ambiguous = harness();
	ambiguous.store.configure("observe", 2);
	const second = await ambiguous.send(await signed(messageBody()));
	await ambiguous.settle();
	assertEquals(second.status, 200, "ambiguous OA status");
	assertEquals(
		ambiguous.store.received.length,
		0,
		"ambiguous OA stored nothing",
	);
	assert(
		ambiguous.lines.some((line) => line.includes("match 2 configured OAs")),
		"ambiguous OA logged",
	);
});

Deno.test("a body without an app, OA or event name is answered 200 without a lookup", async () => {
	const test = harness();
	const response = await test.send(
		unsigned(JSON.stringify({ hello: "world" })),
	);
	assertEquals(response.status, 200, "status");
	assertEquals(test.store.lookups, 0, "no lookup");
});

Deno.test("a body that is not a JSON object, too large, or not a POST is refused", async () => {
	const test = harness();
	const invalid = await test.send(unsigned("{not json"));
	const array = await test.send(unsigned("[]"));
	const large = await test.send(unsigned(`"${"x".repeat(MAX_EVENT_BYTES)}"`));
	const get = await test.send(new Request(FUNCTION_URL, { method: "GET" }));
	const preflight = await test.send(
		new Request(FUNCTION_URL, {
			method: "OPTIONS",
			headers: { origin: "https://h5.zdn.vn" },
		}),
	);
	assertEquals(
		[invalid.status, array.status, large.status, get.status, preflight.status],
		[400, 400, 413, 405, 204],
		"statuses",
	);
	assertEquals(
		preflight.headers.get("access-control-allow-origin"),
		null,
		"the webhook allows no browser origin",
	);
	assertEquals(test.store.lookups, 0, "no lookup");
});

Deno.test("the answer is sent before a slow follow-up finishes", async () => {
	const test = harness();
	const slow = gate();
	test.store.applyGate = slow.promise;
	const response = await test.send(await signed(messageBody()));
	assertEquals(response.status, 200, "answered");
	assertEquals(test.store.stored.size, 1, "stored before the answer");
	assertEquals(test.store.applied, [], "the follow-up is still running");
	assertEquals(test.pending.length, 1, "the follow-up runs under waitUntil");
	slow.open();
	await test.settle();
	assertEquals(
		test.store.applied,
		["row-1"],
		"the follow-up finished afterwards",
	);
});

Deno.test("a database slower than the deadline still gets a 200 and the event is stored afterwards", async () => {
	const test = harness("observe", 20);
	const slow = gate();
	test.store.receiveGate = slow.promise;
	const started = performance.now();
	const response = await test.send(await signed(messageBody()));
	const elapsed = performance.now() - started;
	assertEquals(response.status, 200, "answered");
	assert(elapsed < 1_000, `answered at the deadline, took ${elapsed} ms`);
	assertEquals(test.store.stored.size, 0, "not stored yet");
	slow.open();
	await test.settle();
	assertEquals(test.store.stored.size, 1, "stored after the answer");
	assertEquals(test.store.applied, ["row-1"], "followed up after the answer");
	assert(
		test.lines.some((line) =>
			line.includes("answered before the event was stored"),
		),
		"the late store is logged",
	);
});

Deno.test("a failing follow-up is logged and never changes the answer", async () => {
	const test = harness();
	test.store.applyFails = true;
	const response = await test.send(await signed(messageBody()));
	await test.settle();
	assertEquals(response.status, 200, "answered");
	assert(
		test.lines.some((line) =>
			line.includes("user_send_text: follow-up failed"),
		),
		"logged",
	);
});

Deno.test("no log line carries the message text, the user id, the OA id or a secret", async () => {
	const test = harness();
	await test.send(await signed(messageBody()));
	await test.send(await signed(messageBody(), "another-secret"));
	await test.send(unsigned("{not json"));
	await test.settle();
	assert(test.lines.length > 0, "something was logged");
	for (const line of test.lines) {
		for (const secret of [
			MESSAGE_TEXT,
			USER_ID,
			OA_ID,
			APP_ID,
			SECRET,
			"synthetic-db-password",
		]) {
			assert(!line.includes(secret), `a log line carries ${secret}: ${line}`);
		}
	}
});
