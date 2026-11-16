import type {
	BeginSendResult,
	ClaimedMessage,
	ClaimRequest,
	DigestBuilder,
	FinishRequest,
	NotifyRepository,
} from "@fnb/notify";
import {
	CLAIM_QUEUE_LIMIT,
	type ClaimedNotifyTicket,
	type CycleResources,
	type DatabaseSettings,
	functionRedactor,
	handleRequest,
	type NotifyFunctionDependencies,
	notifySecretVariables,
	remainingWallSeconds,
	tenantScope,
} from "./handler.ts";

const TICKET = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const BOT_TOKEN = "synthetic-bot-token";
const CHAT_ID = "synthetic-chat-1";
const LOCAL_DATABASE =
	"postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const BASE_ENVIRONMENT = {
	SUPABASE_DB_URL: LOCAL_DATABASE,
	NOTIFY_ZALO_BOT_TOKEN: BOT_TOKEN,
};

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

function post(body: unknown, method = "POST"): Request {
	return new Request("http://127.0.0.1/functions/v1/notify", {
		method,
		headers: { "content-type": "application/json" },
		...(method === "GET" ? {} : { body: JSON.stringify(body) }),
	});
}

function claimedMessage(index: number): ClaimedMessage {
	return {
		messageId: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
		claimedAt: "2026-11-09T00:00:00.000Z",
		tenantId: TENANT,
		kind: "test",
		templateRef: "test.v1",
		params: {},
		title: null,
		body: "Tin thử",
		severity: "info",
		attempts: 1,
		businessDate: null,
		channelId: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
		channelKind: "zalo_bot",
		provider: "zalo_bot",
		secretName: "NOTIFY_ZALO_BOT_TOKEN",
		address: CHAT_ID,
		config: {},
		channelLabel: "Zalo Bot",
		readerTimezone: "Asia/Ho_Chi_Minh",
		tenantName: "Synthetic tenant",
		currencyCode: "VND",
		storeName: null,
		accountName: null,
		ruleKey: null,
	};
}

interface MemoryState {
	readonly claims: ClaimRequest[];
	readonly finished: FinishRequest[];
	readonly dispatches: number[];
	continuations: number;
	closed: number;
}

function memoryRepository(
	messages: ClaimedMessage[],
	state: MemoryState,
): NotifyRepository {
	const queue = [...messages];
	return {
		tick: () => Promise.resolve({}),
		claimNext(request) {
			state.claims.push(request);
			return Promise.resolve(queue.shift() ?? null);
		},
		beginSend(_messageId, _claimedAt, title, body): Promise<BeginSendResult> {
			return Promise.resolve({ ok: true, title, body });
		},
		finishSend(request) {
			state.finished.push(request);
			return Promise.resolve(request.outcome);
		},
		recordDispatch(_at, _runtime, _secretNames, counts) {
			state.dispatches.push(counts.sent ?? 0);
			return Promise.resolve();
		},
		pendingLinkBots: () => Promise.resolve([]),
		takePollLease: () => Promise.resolve(false),
		releasePollLease: () => Promise.resolve(),
		pollCursor: () => Promise.resolve(null),
		savePollState: () => Promise.resolve(),
		completeChannelLink: () => Promise.resolve(null),
		acceptChannelLink: () => Promise.resolve(null),
	};
}

const noDigests: DigestBuilder = {
	buildDue: () => Promise.resolve({ built: 0, failed: 0, messages: 0 }),
};

function zaloAnswer(): Promise<Response> {
	return Promise.resolve(
		new Response(
			JSON.stringify({ ok: true, result: { message_id: "m-1", date: 1 } }),
			{ status: 200, headers: { "content-type": "application/json" } },
		),
	);
}

interface Harness {
	readonly dependencies: NotifyFunctionDependencies;
	readonly state: MemoryState;
	readonly lines: string[];
	readonly requests: string[];
	readonly waited: Promise<unknown>[];
}

function harness(
	options: {
		messages?: ClaimedMessage[];
		claim?: (ticket: string) => Promise<ClaimedNotifyTicket | null>;
		edgeRuntime?: boolean;
	} = {},
): Harness {
	const state: MemoryState = {
		claims: [],
		finished: [],
		dispatches: [],
		continuations: 0,
		closed: 0,
	};
	const lines: string[] = [];
	const requests: string[] = [];
	const waited: Promise<unknown>[] = [];
	const repository = memoryRepository(options.messages ?? [], state);
	const dependencies: NotifyFunctionDependencies = {
		claimTicket: (_settings: DatabaseSettings, ticket: string) =>
			options.claim
				? options.claim(ticket)
				: Promise.resolve(ticket === TICKET ? { reason: "manual" } : null),
		openCycle: (): CycleResources => ({
			repository,
			digests: noDigests,
			continueLater: () => {
				state.continuations += 1;
				return Promise.resolve(true);
			},
			close: () => {
				state.closed += 1;
				return Promise.resolve();
			},
		}),
		fetch: (input) => {
			requests.push(input);
			return zaloAnswer();
		},
		clock: () => new Date("2026-11-09T00:00:00.000Z"),
		monotonic: () => performance.now(),
		log: (line) => lines.push(line),
		edgeRuntime: () =>
			options.edgeRuntime
				? { waitUntil: (promise: Promise<unknown>) => waited.push(promise) }
				: undefined,
		worker: () => "edge:test",
	};
	return { dependencies, state, lines, requests, waited };
}

Deno.test("another method is refused with 405", async () => {
	const { dependencies } = harness();
	const response = await handleRequest(
		post(null, "GET"),
		BASE_ENVIRONMENT,
		performance.now(),
		dependencies,
	);
	assertEquals(response.status, 405, "status");
});

Deno.test("a body without a ticket is refused with 400", async () => {
	const { dependencies } = harness();
	for (const body of [{}, { ticket: "not-a-uuid" }, [TICKET], "text"]) {
		const response = await handleRequest(
			post(body),
			BASE_ENVIRONMENT,
			performance.now(),
			dependencies,
		);
		assertEquals(response.status, 400, `status for ${JSON.stringify(body)}`);
	}
});

Deno.test("an unknown, used or expired ticket gets 401 and opens no cycle", async () => {
	const { dependencies, state } = harness();
	const response = await handleRequest(
		post({ ticket: "55555555-5555-4555-8555-555555555555" }),
		BASE_ENVIRONMENT,
		performance.now(),
		dependencies,
	);
	assertEquals(response.status, 401, "status");
	assertEquals(state.claims.length, 0, "claims");
	assertEquals(state.closed, 0, "cycle connections opened");
});

Deno.test("a database URL that could fall back to plaintext gets 500 before any claim", async () => {
	let claims = 0;
	const { dependencies } = harness({
		claim: () => {
			claims += 1;
			return Promise.resolve({ reason: "manual" });
		},
	});
	const response = await handleRequest(
		post({ ticket: TICKET }),
		{
			...BASE_ENVIRONMENT,
			SUPABASE_DB_URL:
				"postgresql://postgres:synthetic-password@example.com:5432/postgres?sslmode=prefer",
		},
		performance.now(),
		dependencies,
	);
	assertEquals(response.status, 500, "status");
	assertEquals(claims, 0, "claims");
});

Deno.test("a base-URL override without a tenant filter gets 500 before any claim", async () => {
	let claims = 0;
	const { dependencies, lines } = harness({
		claim: () => {
			claims += 1;
			return Promise.resolve({ reason: "manual" });
		},
	});
	for (const environment of [
		{ ...BASE_ENVIRONMENT, NOTIFY_ZALO_BOT_BASE_URL: "http://127.0.0.1:8787" },
		{ ...BASE_ENVIRONMENT, NOTIFY_INTEGRATION: "1" },
		{
			...BASE_ENVIRONMENT,
			NOTIFY_INTEGRATION: "1",
			NOTIFY_TENANT_ID: "not-a-uuid",
		},
	]) {
		const response = await handleRequest(
			post({ ticket: TICKET }),
			environment,
			performance.now(),
			dependencies,
		);
		assertEquals(response.status, 500, "status");
	}
	assertEquals(claims, 0, "claims");
	assert(
		lines.every((line) => line.includes("NOTIFY_TENANT_ID")),
		"the log names the missing filter",
	);
});

Deno.test("the tenant filter scopes the cycle under an override and is null in production", () => {
	assertEquals(tenantScope({}), { ok: true, tenantId: null }, "production");
	assertEquals(
		tenantScope({
			NOTIFY_ZALO_BOT_BASE_URL: "http://127.0.0.1:8787",
			NOTIFY_TENANT_ID: TENANT,
		}),
		{ ok: true, tenantId: TENANT },
		"override with a filter",
	);
	assertEquals(
		tenantScope({ NOTIFY_BREVO_BASE_URL: "http://127.0.0.1:8787" }),
		{ ok: false },
		"override without a filter",
	);
});

Deno.test("claims beyond the queue limit get 429 without touching the database", async () => {
	const releases: ((value: ClaimedNotifyTicket | null) => void)[] = [];
	let started = 0;
	let allStarted: () => void = () => undefined;
	const ready = new Promise<void>((resolve) => {
		allStarted = resolve;
	});
	const { dependencies } = harness({
		claim: () => {
			started += 1;
			if (started === CLAIM_QUEUE_LIMIT) {
				allStarted();
			}
			return new Promise((resolve) => releases.push(resolve));
		},
	});
	const waiting = Array.from({ length: CLAIM_QUEUE_LIMIT }, () =>
		handleRequest(
			post({ ticket: TICKET }),
			BASE_ENVIRONMENT,
			performance.now(),
			dependencies,
		),
	);
	await ready;
	const refused = await handleRequest(
		post({ ticket: TICKET }),
		BASE_ENVIRONMENT,
		performance.now(),
		dependencies,
	);
	assertEquals(refused.status, 429, "status");
	assertEquals(started, CLAIM_QUEUE_LIMIT, "claims reaching the database");
	for (const release of releases) {
		release(null);
	}
	const answers = await Promise.all(waiting);
	assert(
		answers.every((answer) => answer.status === 401),
		"the queued claims finish",
	);
});

Deno.test("a claimed ticket is answered 202 and the cycle continues under waitUntil", async () => {
	const run = harness({ messages: [claimedMessage(1)], edgeRuntime: true });
	const response = await handleRequest(
		post({ ticket: TICKET }),
		BASE_ENVIRONMENT,
		performance.now(),
		run.dependencies,
	);
	assertEquals(response.status, 202, "status");
	assertEquals(await response.json(), { accepted: true }, "body");
	assertEquals(run.waited.length, 1, "waitUntil calls");
	await Promise.all(run.waited);
	assertEquals(run.state.finished.length, 1, "messages finished");
	assertEquals(run.state.closed, 1, "cycle connections closed");
});

Deno.test("wait true runs the cycle first and answers with counts only and the format check", async () => {
	const run = harness({ messages: [claimedMessage(1)] });
	const response = await handleRequest(
		post({ ticket: TICKET, wait: true }),
		BASE_ENVIRONMENT,
		performance.now(),
		run.dependencies,
	);
	assertEquals(response.status, 200, "status");
	const body = (await response.json()) as Record<string, unknown>;
	assertEquals(body.format_check, true, "format_check");
	assertEquals(body.reason, "manual", "reason");
	assertEquals(body.stopped_by, null, "stopped_by");
	assertEquals(body.continuation, false, "continuation");
	const counts = body.counts as Record<string, unknown>;
	assertEquals(counts.sent, 1, "sent");
	assertEquals(counts.claimed, 1, "claimed");
	assert(
		Object.values(counts).every((value) => typeof value === "number"),
		"counts are numbers",
	);
	assertEquals(run.requests.length, 1, "provider requests");
	assertEquals(run.state.claims[0]?.tenantId ?? "none", "none", "tenant");
	assertEquals(run.state.dispatches, [1], "recorded dispatch");
	const visible = JSON.stringify(body) + run.lines.join("\n");
	for (const secret of [BOT_TOKEN, CHAT_ID, "Tin thử", "bot-api"]) {
		assert(!visible.includes(secret), `${secret} must not appear`);
	}
	assert(
		run.lines.some((line) => line.includes("messages sent 1")),
		"a count-only log line",
	);
});

Deno.test("the tenant filter reaches the claims", async () => {
	const run = harness({ messages: [] });
	const response = await handleRequest(
		post({ ticket: TICKET, wait: true }),
		{
			...BASE_ENVIRONMENT,
			NOTIFY_ZALO_BOT_BASE_URL: "http://127.0.0.1:8787",
			NOTIFY_TENANT_ID: TENANT,
		},
		performance.now(),
		run.dependencies,
	);
	assertEquals(response.status, 200, "status");
	assertEquals(run.state.claims[0]?.tenantId, TENANT, "tenant");
});

Deno.test("work left at the budget's send limit posts one continuation", async () => {
	const run = harness({
		messages: Array.from({ length: 31 }, (_, index) => claimedMessage(index)),
	});
	const response = await handleRequest(
		post({ ticket: TICKET, wait: true }),
		BASE_ENVIRONMENT,
		performance.now(),
		run.dependencies,
	);
	const body = (await response.json()) as Record<string, unknown>;
	assertEquals((body.counts as Record<string, unknown>).sent, 30, "sent");
	assertEquals(body.stopped_by, "sends", "stopped_by");
	assertEquals(body.continuation, true, "continuation");
	assertEquals(run.state.continuations, 1, "continuations");
	assert(
		run.lines.some((line) => line.includes("continuation posted")),
		"the log says so",
	);
});

Deno.test("work started late in the request's wall time keeps to the 90 s budget", () => {
	assertEquals(remainingWallSeconds(0, 30_000), 60, "30 s used");
	assertEquals(remainingWallSeconds(0, 120_000), 0, "past the limit");
});

Deno.test("a failing cycle answers 500 with no detail and closes its connections", async () => {
	const run = harness();
	const failing: NotifyFunctionDependencies = {
		...run.dependencies,
		openCycle: () => ({
			repository: {
				...memoryRepository([], run.state),
				pendingLinkBots: () =>
					Promise.reject(
						Object.assign(new Error(`relation for ${BOT_TOKEN}`), {
							code: "42P01",
						}),
					),
			},
			digests: noDigests,
			continueLater: () => Promise.resolve(false),
			close: () => {
				run.state.closed += 1;
				return Promise.resolve();
			},
		}),
	};
	const response = await handleRequest(
		post({ ticket: TICKET, wait: true }),
		BASE_ENVIRONMENT,
		performance.now(),
		failing,
	);
	assertEquals(response.status, 500, "status");
	assertEquals(run.state.closed, 1, "closed");
	assert(
		run.lines.some((line) => line.includes("cycle stopped (42P01)")),
		"the SQLSTATE is logged",
	);
	assert(!run.lines.join("\n").includes(BOT_TOKEN), "no token in the log");
});

Deno.test("every NOTIFY_ credential and the database password are redacted", () => {
	const environment = {
		SUPABASE_DB_URL:
			"postgresql://postgres.synthetic:synthetic-db-password@example.com:5432/postgres",
		NOTIFY_ZALO_BOT_TOKEN: BOT_TOKEN,
		NOTIFY_EMAIL_API_KEY: "synthetic-email-key",
		NOTIFY_WEBHOOK_SECRET_2: "synthetic-webhook-secret",
		NOTIFY_ZALO_BOT_BASE_URL: "http://127.0.0.1:8787",
		NOTIFY_INTEGRATION: "1",
	};
	assertEquals(
		notifySecretVariables(environment),
		[
			"NOTIFY_EMAIL_API_KEY",
			"NOTIFY_WEBHOOK_SECRET_2",
			"NOTIFY_ZALO_BOT_TOKEN",
		],
		"secret variables",
	);
	const redact = functionRedactor(environment);
	const line = redact(
		`token ${BOT_TOKEN} key synthetic-email-key hmac synthetic-webhook-secret password synthetic-db-password`,
	);
	for (const secret of [
		BOT_TOKEN,
		"synthetic-email-key",
		"synthetic-webhook-secret",
		"synthetic-db-password",
	]) {
		assert(!line.includes(secret), `${secret} must be redacted`);
	}
});
