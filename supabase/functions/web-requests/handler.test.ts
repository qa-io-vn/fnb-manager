import type { FunctionEnvironment } from "../_shared/http.ts";
import {
	clientAddress,
	clientKey,
	handleWebRequests,
	MAX_BODY_BYTES,
	originBrands,
	parseForm,
	type RequestBackend,
} from "./handler.ts";

// web-requests: the website's public forms against a fake database, never the real one. Use cases (a booking, a
// workshop, a hold, an application; a replay), equivalence partitions and boundary values of every field (guests 0, 1,
// 20, 21 and 1.5; a name of 60 and 61 characters; a note of 500 and 501; real and impossible dates; 23:59 and 24:00;
// phone forms), a decision table of the abuse defences (honeypot x fill time: 2,999 and 3,000 ms), the database's
// refusals mapped to answers (422, 429 with Retry-After), CORS (only the configured origins, preflight and answer),
// the body limit, the content type, the method, configuration errors, and the security properties: the client key is
// opaque and stable, no answer echoes what was sent, and no log line carries a name, a phone or an address.

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

const BRAND = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const OTHER_BRAND = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";
const SITE = "https://www.example.com";
const OTHER_SITE = "https://other.example.com";
const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/web-requests";
const KEY = "synthetic-web-request-key-0001";
const NAME = "Nguyễn Văn Khách";
const PHONE = "0901 234 567";
const ENVIRONMENT: FunctionEnvironment = {
	WEB_REQUEST_ORIGINS: `${SITE}=${BRAND}, ${OTHER_SITE}=${OTHER_BRAND}, http://evil.example.com=${BRAND}, https://bad.example.com=not-a-uuid`,
	WEB_REQUEST_KEY: KEY,
};

interface Call {
	readonly name: string;
	readonly args: Readonly<Record<string, unknown>>;
}

interface Harness {
	readonly calls: Call[];
	readonly lines: string[];
	answer: unknown;
	failWith: Error | null;
	send(
		body: unknown,
		options?: {
			readonly origin?: string | null;
			readonly method?: string;
			readonly contentType?: string;
			readonly environment?: FunctionEnvironment;
			readonly headers?: Record<string, string>;
			readonly raw?: string;
		},
	): Promise<Response>;
}

function harness(): Harness {
	const state: Harness = {
		calls: [],
		lines: [],
		answer: {
			state: "submitted",
			refusal: null,
			replayed: false,
			request: { id: "x" },
		},
		failWith: null,
		async send(body, options = {}) {
			const backend: RequestBackend = {
				rpc(name, args) {
					state.calls.push({ name, args });
					if (state.failWith !== null) {
						return Promise.reject(state.failWith);
					}
					return Promise.resolve(state.answer);
				},
			};
			const headers = new Headers({
				"content-type": options.contentType ?? "application/json",
				"user-agent": "Synthetic Browser/1.0",
				"x-forwarded-for": "203.0.113.7, 10.0.0.1",
				...(options.headers ?? {}),
			});
			const origin = options.origin === undefined ? SITE : options.origin;
			if (origin !== null) {
				headers.set("origin", origin);
			}
			const method = options.method ?? "POST";
			const request = new Request(FUNCTION_URL, {
				method,
				headers,
				...(method === "GET" || method === "OPTIONS"
					? {}
					: { body: options.raw ?? JSON.stringify(body) }),
			});
			return await handleWebRequests(
				request,
				options.environment ?? ENVIRONMENT,
				{
					backend,
					log: (line) => state.lines.push(line),
					requestId: () => "req-1",
				},
			);
		},
	};
	return state;
}

function booking(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		kind: "booking",
		store: "sa-1",
		request_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
		name: NAME,
		phone: PHONE,
		date: "2026-12-05",
		time: "19:30",
		guests: 4,
		note: "Gần cửa sổ",
		website: "",
		elapsed_ms: 12000,
		...overrides,
	};
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}

function noEcho(text: string, label: string): void {
	for (const secret of [
		NAME,
		PHONE,
		"0901234567",
		"Gần cửa sổ",
		"203.0.113.7",
		"Synthetic Browser",
	]) {
		assert(!text.includes(secret), `${label}: echoes ${secret}`);
	}
}

Deno.test("a booking from the website reaches web_submit_request with the brand, an opaque key and the database's shape", async () => {
	const h = harness();
	const response = await h.send(booking());
	assertEquals(response.status, 200, "status");
	const text = await response.text();
	assertEquals(
		JSON.parse(text),
		{ state: "submitted", replayed: false },
		"answer",
	);
	noEcho(text, "answer");
	assertEquals(
		response.headers.get("access-control-allow-origin"),
		SITE,
		"CORS origin",
	);
	assertEquals(h.calls.length, 1, "one call");
	const [call] = h.calls;
	assert(call !== undefined, "a call");
	assertEquals(call.name, "web_submit_request", "rpc");
	assertEquals(call.args.p_brand, BRAND, "brand from the origin");
	assertEquals(
		call.args.p_request,
		{
			request_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
			store: "sa-1",
			kind: "booking",
			name: NAME,
			phone: "0901234567",
			party_size: 4,
			at: "2026-12-05T19:30:00+07:00",
			note: "Gần cửa sổ",
		},
		"the request in the database's shape",
	);
	const key = call.args.p_client_key as string;
	assert(
		/^[A-Za-z0-9_-]{43}$/.test(key),
		"the client key is 43 base64url characters",
	);
	assert(
		!key.includes("203") && !key.includes("Synthetic"),
		"the key is not the address or the agent",
	);
	for (const line of h.lines) noEcho(line, "log");
});

Deno.test("the other origin names its own brand; a workshop, a hold and an application go through the same contract", async () => {
	const h = harness();
	const workshop = await h.send(
		booking({
			kind: "workshop",
			guests: undefined,
			subject: "Pha phin cơ bản",
		}),
		{ origin: OTHER_SITE },
	);
	assertEquals(workshop.status, 200, "workshop");
	assertEquals(h.calls[0]?.args.p_brand, OTHER_BRAND, "other brand");
	assert(
		!(
			"party_size" in
			((h.calls[0]?.args.p_request ?? {}) as Record<string, unknown>)
		),
		"no party size for a workshop",
	);
	const hold = await h.send(
		booking({ kind: "hold", guests: undefined, subject: "Cốc sứ" }),
	);
	assertEquals(hold.status, 200, "hold");
	const application = await h.send(
		booking({
			kind: "application",
			guests: undefined,
			date: undefined,
			time: undefined,
			subject: "Pha chế",
		}),
	);
	assertEquals(application.status, 200, "application");
	const sent = h.calls[2]?.args.p_request as Record<string, unknown>;
	assert(!("at" in sent), "an application without a date has no time");
	assertEquals(sent.subject, "Pha chế", "the position");
});

Deno.test("a replay of the same request answers replayed true", async () => {
	const h = harness();
	h.answer = {
		state: "submitted",
		refusal: null,
		replayed: true,
		request: { id: "x" },
	};
	const response = await h.send(booking());
	assertEquals(
		await bodyOf(response),
		{ state: "submitted", replayed: true },
		"replayed",
	);
});

Deno.test("fields: equivalence partitions and boundaries, each failure naming only the field", async () => {
	const cases: [string, Record<string, unknown>, number, string | null][] = [
		["guests 1", { guests: 1 }, 200, null],
		["guests 20", { guests: 20 }, 200, null],
		["guests 0", { guests: 0 }, 400, "guests"],
		["guests 21", { guests: 21 }, 400, "guests"],
		["guests 1.5", { guests: 1.5 }, 400, "guests"],
		["guests as text", { guests: "4" }, 400, "guests"],
		["guests missing", { guests: undefined }, 400, "guests"],
		[
			"guests on a hold",
			{ kind: "hold", subject: "Cốc", guests: 2 },
			400,
			"guests",
		],
		["name of 60", { name: "a".repeat(60) }, 200, null],
		["name of 61", { name: "a".repeat(61) }, 400, "name"],
		["name blank", { name: "   " }, 400, "name"],
		["name with a newline", { name: "Khách\nhàng" }, 400, "name"],
		[
			"name with a tab",
			{ name: `Khách${String.fromCharCode(9)}hàng` },
			400,
			"name",
		],
		["name as a number", { name: 12 }, 400, "name"],
		["note of 500", { note: "n".repeat(500) }, 200, null],
		["note of 501", { note: "n".repeat(501) }, 400, "note"],
		["note empty", { note: "" }, 200, null],
		["phone +84", { phone: "+84 901 234 567" }, 200, null],
		["phone 84", { phone: "84901234567" }, 200, null],
		["phone with dots", { phone: "090.123.4567" }, 200, null],
		["phone landline", { phone: "028 3823 4567" }, 200, null],
		["phone too short", { phone: "090123456" }, 400, "phone"],
		["phone too long", { phone: "090123456789" }, 400, "phone"],
		["phone with letters", { phone: "09012345ab" }, 400, "phone"],
		["phone foreign", { phone: "+1 202 555 0100" }, 400, "phone"],
		["phone starting 01", { phone: "0123456789" }, 400, "phone"],
		["date impossible", { date: "2026-02-30" }, 400, "date"],
		["date shape", { date: "05/12/2026" }, 400, "date"],
		["date leap day", { date: "2028-02-29" }, 200, null],
		["time 23:59", { time: "23:59" }, 200, null],
		["time 24:00", { time: "24:00" }, 400, "time"],
		["time 7:30", { time: "7:30" }, 400, "time"],
		["time with seconds", { time: "19:30:00" }, 400, "time"],
		["kind unknown", { kind: "party" }, 400, "kind"],
		["store bad", { store: "sa 1" }, 400, "store"],
		["store too long", { store: "s".repeat(41) }, 400, "store"],
		["request id bad", { request_id: "not-a-uuid" }, 400, "request_id"],
		[
			"subject required for a workshop",
			{ kind: "workshop", guests: undefined },
			400,
			"subject",
		],
		[
			"subject of 101",
			{ kind: "workshop", guests: undefined, subject: "s".repeat(101) },
			400,
			"subject",
		],
		["elapsed missing", { elapsed_ms: undefined }, 400, "elapsed_ms"],
		["elapsed negative", { elapsed_ms: -1 }, 400, "elapsed_ms"],
		["elapsed a day and more", { elapsed_ms: 86_400_001 }, 400, "elapsed_ms"],
		["honeypot not text", { website: 1 }, 400, "website"],
	];
	for (const [label, overrides, status, failed] of cases) {
		const h = harness();
		const response = await h.send(booking(overrides));
		const text = await response.text();
		assertEquals(response.status, status, label);
		if (failed !== null) {
			assertEquals(
				JSON.parse(text),
				{ error: "invalid_field", field: failed, request_id: "req-1" },
				label,
			);
			assertEquals(h.calls.length, 0, `${label}: nothing reaches the database`);
		}
		noEcho(text, label);
	}
});

Deno.test("only the known fields: an unknown one, __proto__ included, is refused", async () => {
	for (const extra of [
		{ email: "x@example.com" },
		JSON.parse('{"__proto__": {"admin": true}}'),
	]) {
		const h = harness();
		const response = await h.send({ ...booking(), ...extra });
		assertEquals(response.status, 400, "status");
		assertEquals((await bodyOf(response)).error, "invalid_request", "code");
		assertEquals(h.calls.length, 0, "nothing reaches the database");
	}
});

Deno.test("abuse defences: a filled honeypot or a form sent under three seconds answers like a success and stores nothing", async () => {
	const table: [string, Record<string, unknown>, boolean][] = [
		["honeypot filled", { website: "http://spam.example.com" }, false],
		["honeypot spaces only", { website: "   " }, true],
		["honeypot null", { website: null }, true],
		["2,999 ms", { elapsed_ms: 2999 }, false],
		["3,000 ms", { elapsed_ms: 3000 }, true],
		["both", { website: "x", elapsed_ms: 10 }, false],
	];
	for (const [label, overrides, stored] of table) {
		const h = harness();
		const response = await h.send(booking(overrides));
		assertEquals(response.status, 200, label);
		assertEquals(
			await bodyOf(response),
			{ state: "submitted", replayed: false },
			label,
		);
		assertEquals(h.calls.length, stored ? 1 : 0, `${label}: stored`);
	}
});

Deno.test("the database's refusals: 422 with the code, 429 with Retry-After for the rate limit", async () => {
	for (const refusal of [
		"store_unknown",
		"kind_not_offered",
		"too_many_open_requests",
		"time_invalid",
		"time_outside_hours",
		"request_conflict",
		"phone_invalid",
	]) {
		const h = harness();
		h.answer = { state: "refused", refusal, replayed: false, request: null };
		const response = await h.send(booking());
		assertEquals(response.status, 422, refusal);
		assertEquals(
			await bodyOf(response),
			{ state: "refused", refusal },
			refusal,
		);
	}
	const h = harness();
	h.answer = {
		state: "refused",
		refusal: "rate_limited",
		retry_at: new Date(Date.now() + 120_000).toISOString(),
		request: null,
	};
	const limited = await h.send(booking());
	assertEquals(limited.status, 429, "rate limited");
	assertEquals(
		await bodyOf(limited),
		{ state: "refused", refusal: "rate_limited" },
		"rate limited body",
	);
	const after = Number(limited.headers.get("retry-after"));
	assert(
		after >= 110 && after <= 121,
		`Retry-After near 120 seconds, got ${after}`,
	);
	const odd = harness();
	odd.answer = { state: "refused", refusal: "something_new" };
	assertEquals(
		(await odd.send(booking())).status,
		502,
		"an unknown answer is a 502, never passed on",
	);
});

Deno.test("CORS: only the configured https origins; preflight and answers carry no CORS header for any other", async () => {
	const h = harness();
	const preflight = await h.send(null, { method: "OPTIONS" });
	assertEquals(preflight.status, 204, "preflight");
	assertEquals(
		preflight.headers.get("access-control-allow-origin"),
		SITE,
		"allowed origin",
	);
	assert(
		(preflight.headers.get("access-control-allow-methods") ?? "").includes(
			"POST",
		),
		"POST allowed",
	);
	for (const origin of [
		"https://evil.example.com",
		"http://evil.example.com",
		"https://bad.example.com",
		"null",
	]) {
		const pre = await h.send(null, { method: "OPTIONS", origin });
		assertEquals(
			pre.headers.get("access-control-allow-origin"),
			null,
			`preflight from ${origin}`,
		);
		const post = await h.send(booking(), { origin });
		assertEquals(post.status, 403, `post from ${origin}`);
		assertEquals(
			post.headers.get("access-control-allow-origin"),
			null,
			`answer to ${origin}`,
		);
		assertEquals(
			(await bodyOf(post)).error,
			"origin_not_allowed",
			`code for ${origin}`,
		);
	}
	const none = await h.send(booking(), { origin: null });
	assertEquals(none.status, 403, "no origin");
	assertEquals(h.calls.length, 0, "nothing reached the database");
	assertEquals(
		[...originBrands(ENVIRONMENT).keys()],
		[SITE, OTHER_SITE],
		"an http origin and an entry without a brand id are ignored",
	);
	assertEquals(
		originBrands({ WEB_REQUEST_ORIGINS: `http://127.0.0.1:5173=${BRAND}` })
			.size,
		0,
		"loopback only on the local stack",
	);
	assertEquals(
		originBrands({
			WEB_REQUEST_ORIGINS: `http://127.0.0.1:5173=${BRAND}`,
			ZALO_LOCAL_DEV: "1",
		}).size,
		1,
		"loopback on the local stack",
	);
});

Deno.test("transport: method, content type, body size and JSON", async () => {
	const h = harness();
	assertEquals((await h.send(null, { method: "GET" })).status, 405, "GET");
	assertEquals(
		(await h.send(booking(), { contentType: "text/plain" })).status,
		415,
		"text/plain",
	);
	assertEquals(
		(
			await h.send(booking(), {
				contentType: "application/x-www-form-urlencoded",
			})
		).status,
		415,
		"a form post",
	);
	assertEquals(
		(
			await h.send(booking(), {
				contentType: "application/json; charset=utf-8",
			})
		).status,
		200,
		"JSON with a charset",
	);
	const big = await h.send(null, {
		raw: JSON.stringify(booking({ note: "n".repeat(MAX_BODY_BYTES) })),
	});
	assertEquals(big.status, 413, "a body over 4 KiB");
	assertEquals(
		(await h.send(null, { raw: "{not json" })).status,
		400,
		"broken JSON",
	);
	assertEquals((await h.send(null, { raw: "[1,2]" })).status, 400, "an array");
	assertEquals(h.calls.length, 1, "only the good one reached the database");
});

Deno.test("configuration and backend failures answer without detail", async () => {
	const h = harness();
	const noKey = await h.send(booking(), {
		environment: { WEB_REQUEST_ORIGINS: ENVIRONMENT.WEB_REQUEST_ORIGINS },
	});
	assertEquals(noKey.status, 500, "no key");
	assertEquals((await bodyOf(noKey)).error, "not_configured", "not configured");
	const noOrigins = await h.send(booking(), {
		environment: { WEB_REQUEST_KEY: KEY },
	});
	assertEquals(
		noOrigins.status,
		403,
		"no origins configured: nothing is allowed",
	);
	h.failWith = new TypeError("network down");
	const down = await h.send(booking());
	assertEquals(down.status, 503, "backend down");
	assertEquals(
		(await bodyOf(down)).error,
		"backend_unavailable",
		"backend code",
	);
	const noBackend = await handleWebRequests(
		new Request(FUNCTION_URL, {
			method: "POST",
			headers: { origin: SITE, "content-type": "application/json" },
			body: JSON.stringify(booking()),
		}),
		ENVIRONMENT,
		{ log: () => {} },
	);
	assertEquals(noBackend.status, 500, "no Supabase URL or key");
	for (const line of h.lines) noEcho(line, "log");
	assert(
		h.lines.every((line) => !line.includes(KEY)),
		"the key never reaches a log",
	);
});

Deno.test("the client key: stable for one address and agent, different for another, keyed by the secret", async () => {
	const request = (address: string, agent: string) =>
		new Request(FUNCTION_URL, {
			method: "POST",
			headers: { "x-forwarded-for": address, "user-agent": agent },
		});
	const a = await clientKey(request("203.0.113.7", "A"), KEY);
	assertEquals(a, await clientKey(request("203.0.113.7", "A"), KEY), "stable");
	assert(
		a !== (await clientKey(request("203.0.113.8", "A"), KEY)),
		"another address",
	);
	assert(
		a !== (await clientKey(request("203.0.113.7", "B"), KEY)),
		"another agent",
	);
	assert(
		a !== (await clientKey(request("203.0.113.7", "A"), "another-secret-0000")),
		"another secret",
	);
	assertEquals(
		clientAddress(request("203.0.113.7, 10.0.0.1", "A")),
		"203.0.113.7",
		"the first forwarded address",
	);
	assertEquals(
		clientAddress(new Request(FUNCTION_URL)),
		"unknown",
		"no address",
	);
});

Deno.test("parseForm trims and lower-cases what it keeps, and refuses a time for an application without a date", () => {
	const parsed = parseForm(
		booking({
			name: "  Khách  ",
			request_id: "AAAAAAAA-AAAA-4AAA-8AAA-000000000001",
		}),
	);
	assertEquals(parsed.request.name, "Khách", "trimmed");
	assertEquals(
		parsed.request.request_id,
		"aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
		"lower case",
	);
	assertEquals(parsed.bot, false, "a person");
	let failed = "";
	try {
		parseForm(
			booking({
				kind: "application",
				guests: undefined,
				subject: "Phục vụ",
				date: undefined,
			}),
		);
	} catch (error) {
		failed = (error as { field?: string }).field ?? "";
	}
	assertEquals(failed, "date", "a time without a date");
});
