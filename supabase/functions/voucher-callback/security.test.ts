// Security tests of the voucher callback (OWASP API Top 10: API2 broken authentication, API4 unrestricted resource
// consumption, API8 injection). The secret path is the only credential, so every malformed or foreign path must be
// refused before the body is read and before any database call; wrong methods, oversized, malformed, hostile or
// replayed bodies must never reach a discount, never cost a database call they do not need, and never leak a value
// into a log line; the answer must come within the time budget.
import { type FunctionEnvironment, serveFunction } from "../_shared/http.ts";
import {
	ANSWER_BUDGET_MS,
	type CallbackDecision,
	type CallbackQuestion,
	createVoucherCallbackHandler,
	DESCRIPTIONS,
	FUNCTION_NAME,
	MAX_CALLBACK_BYTES,
	sha256Hex,
	type VoucherCallbackStore,
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

const SEGMENT = "Synthetic_security-seg_0123456789abcdefghij";
const BASE = "http://127.0.0.1:54321/functions/v1/voucher-callback";
const CODE = "SECU2345";
const SALE = "synthetic-sale-sec-1";
const PHONE = "0900000961";
const BREAKS = new RegExp(
	`[${String.fromCharCode(0x0d, 0x0a, 0x2028, 0x2029)}]`,
);
const CONTROLS = new RegExp(
	`[${String.fromCharCode(0x0d, 0x0a, 0x2028, 0x2029, 0x1b)}]`,
);
const NOW = new Date("2026-11-19T03:00:00.000Z");
const ENVIRONMENT: FunctionEnvironment = {
	SUPABASE_DB_URL:
		"postgresql://postgres.synthetic:synthetic-db-password@example.com:5432/postgres",
};

function payload(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		Pos_Parent: "SYNTHETIC-BRAND",
		Pos_Id: 9601,
		Coupon_Code: CODE,
		Membership_Id: PHONE,
		Sale_Tran_Id: SALE,
		Created_At: "2026-11-19 10:00:00",
		Code: 1,
		Voucher_Order_Line: [
			{
				Item_Id: "ITEM-A",
				Quantity: 2,
				Amount: 60000,
				Price_Sale: 30000,
				Discount: 0,
			},
		],
		...overrides,
	};
}

class Store implements VoucherCallbackStore {
	readonly questions: CallbackQuestion[] = [];
	readonly first = new Map<string, CallbackDecision>();
	delayMs = 0;
	pathSha256 = "";

	async answer(question: CallbackQuestion): Promise<CallbackDecision> {
		this.questions.push(question);
		if (this.delayMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, this.delayMs));
		}
		if (question.pathSha256 !== this.pathSha256) {
			return { outcome: "unknown_path", discountAmount: 0, rewardName: null };
		}
		const key = `${question.storeRef}|${question.saleRef}`;
		const known = this.first.get(key);
		if (known !== undefined) {
			return { ...known, outcome: "replayed" };
		}
		if ([...this.first.values()].length > 0) {
			return { outcome: "used", discountAmount: 0, rewardName: null };
		}
		const decision: CallbackDecision = {
			outcome: "accepted",
			discountAmount: 6000,
			rewardName: "Giảm 10%",
		};
		this.first.set(key, decision);
		return decision;
	}
}

async function harness(budgetMs?: number) {
	const store = new Store();
	store.pathSha256 = await sha256Hex(SEGMENT);
	const lines: string[] = [];
	const handler = createVoucherCallbackHandler({
		store: () => store,
		clock: () => NOW,
		...(budgetMs === undefined ? {} : { budgetMs }),
	});
	const send = (request: Request) =>
		serveFunction(request, ENVIRONMENT, handler, {
			name: FUNCTION_NAME,
			origins: [],
			log: (line) => lines.push(line),
			requestId: () => "synthetic-request",
		});
	const post = (
		body: BodyInit | null,
		url = `${BASE}/${SEGMENT}`,
		headers: Record<string, string> = {},
	) => send(new Request(url, { method: "POST", body, headers }));
	return { store, lines, send, post };
}

Deno.test("security: a malformed, traversing or foreign path is 404 before the body is read or the store asked", async () => {
	const { store, post } = await harness();
	const urls = [
		`${BASE}/${SEGMENT.slice(1)}`,
		`${BASE}/${SEGMENT}x`,
		`${BASE}/${SEGMENT.replace("_", "%5F")}`,
		`${BASE}/${SEGMENT.replace("a", "а")}`,
		`${BASE}/../voucher-callback/${SEGMENT}/extra`,
		`${BASE}/${SEGMENT}/${SEGMENT}`,
		`${BASE}/%2E%2E/${SEGMENT}/x`,
		`${BASE}//${SEGMENT}/x`,
		`${BASE}`,
		`${BASE}/`,
		`http://127.0.0.1:54321/functions/v1/oa-webhook/${SEGMENT}`,
	];
	for (const url of urls) {
		let pulled = false;
		const body = new ReadableStream<Uint8Array>(
			{
				pull(controller) {
					pulled = true;
					controller.enqueue(
						new TextEncoder().encode(JSON.stringify(payload())),
					);
					controller.close();
				},
			},
			{ highWaterMark: 0 },
		);
		const response = await post(body, url);
		assertEquals(
			response.status,
			404,
			`status for ${url.slice(BASE.length) || "the bare function"}`,
		);
		assertEquals((await response.json()).error, "not_found", "error code");
		assert(!pulled, `the body was read for ${url}`);
	}
	assertEquals(store.questions.length, 0, "no store call");
});

Deno.test("security: every method but POST on the secret path is 405 without a store call, and no CORS answer", async () => {
	const { store, send } = await harness();
	for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD"]) {
		const response = await send(new Request(`${BASE}/${SEGMENT}`, { method }));
		assertEquals(response.status, 405, `${method} status`);
		await response.body?.cancel();
	}
	const preflight = await send(
		new Request(`${BASE}/${SEGMENT}`, {
			method: "OPTIONS",
			headers: {
				origin: "https://evil.example.com",
				"access-control-request-method": "POST",
			},
		}),
	);
	assertEquals(
		preflight.headers.get("access-control-allow-origin"),
		null,
		"no CORS origin",
	);
	assertEquals(store.questions.length, 0, "no store call");
});

Deno.test("security: a body over 65,536 bytes is 413, by its length or while it is read, and never decided", async () => {
	const { store, post } = await harness();
	const big = JSON.stringify(
		payload({ Pos_Parent: "x".repeat(MAX_CALLBACK_BYTES) }),
	);
	const declared = await post(big);
	assertEquals(declared.status, 413, "declared length");
	let sent = 0;
	const streamed = new ReadableStream<Uint8Array>({
		pull(controller) {
			sent += 8_192;
			controller.enqueue(new Uint8Array(8_192).fill(0x20));
			if (sent > MAX_CALLBACK_BYTES * 4) {
				controller.close();
			}
		},
	});
	const chunked = await post(streamed);
	assertEquals(chunked.status, 413, "chunked without a length");
	assert(
		sent <= MAX_CALLBACK_BYTES + 16_384,
		`stopped reading early (read ${sent})`,
	);
	const exact = await post(
		JSON.stringify(payload({ Pos_Parent: "" })).padEnd(MAX_CALLBACK_BYTES, " "),
	);
	assertEquals(exact.status, 200, "exactly the limit is read");
	assertEquals(
		store.questions.length,
		1,
		"only the body within the limit was decided",
	);
});

Deno.test("security: malformed, hostile and wrongly typed bodies are refused with a zero answer and no store call", async () => {
	const { store, post, lines } = await harness();
	const bodies: (string | Blob)[] = [
		"",
		"null",
		'"a string"',
		"[]",
		"{",
		"{}",
		`${"[".repeat(20_000)}${"]".repeat(20_000)}`,
		new Blob([new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])]),
		JSON.stringify(payload({ Coupon_Code: "" })),
		JSON.stringify(payload({ Coupon_Code: "A B" })),
		JSON.stringify(payload({ Coupon_Code: "A\nB" })),
		JSON.stringify(payload({ Coupon_Code: "x".repeat(65) })),
		JSON.stringify(payload({ Coupon_Code: ["SECU2345"] })),
		JSON.stringify(payload({ Coupon_Code: { $ne: null } })),
		JSON.stringify(payload({ Sale_Tran_Id: "x".repeat(101) })),
		JSON.stringify(payload({ Pos_Id: null })),
		JSON.stringify(payload({ Voucher_Order_Line: "lines" })),
		JSON.stringify(
			payload({
				Voucher_Order_Line: Array.from({ length: 301 }, () => ({
					Item_Id: "I",
					Quantity: 1,
					Amount: 1,
					Price_Sale: 1,
					Discount: 0,
				})),
			}),
		),
		`{"__proto__": {"Coupon_Code": "${CODE}"}, "constructor": {"prototype": {"x": 1}}}`,
	];
	for (const body of bodies) {
		const response = await post(body);
		assert(
			response.status === 400 || response.status === 422,
			`status ${response.status} for ${String(body).slice(0, 40)}`,
		);
		const answer = await response.json();
		assert(
			answer.error === "invalid_body" || answer.Discount_Amount === 0,
			`a refusal carries no discount: ${JSON.stringify(answer).slice(0, 80)}`,
		);
	}
	assertEquals(store.questions.length, 0, "no store call");
	for (const line of lines) {
		assert(!BREAKS.test(line), `a log line holds a line break: ${line}`);
	}
});

Deno.test("security: amounts out of range are 422 and never decided", async () => {
	const { store, post } = await harness();
	const line = (overrides: Record<string, unknown>) =>
		JSON.stringify(
			payload({
				Voucher_Order_Line: [
					{
						Item_Id: "ITEM-A",
						Quantity: 1,
						Amount: 30000,
						Price_Sale: 30000,
						Discount: 0,
						...overrides,
					},
				],
			}),
		);
	for (const body of [
		line({ Quantity: 0 }),
		line({ Quantity: -1 }),
		line({ Quantity: 10_001 }),
		line({ Amount: -1 }),
		line({ Amount: 30_002 }),
		line({ Discount: 30_002 }),
		line({ Price_Sale: 100_000_001, Amount: 100_000_001 }),
		line({ Quantity: 1e308, Amount: 1e308, Price_Sale: 1e308 }),
		JSON.stringify(
			payload({
				Voucher_Order_Line: Array.from({ length: 11 }, () => ({
					Item_Id: "ITEM-A",
					Quantity: 1,
					Amount: 99_999_999,
					Price_Sale: 99_999_999,
					Discount: 0,
				})),
			}),
		),
	]) {
		const response = await post(body);
		assert(
			response.status === 422 || response.status === 400,
			`status ${response.status} for ${body.slice(150, 300)}`,
		);
		assertEquals((await response.json()).Discount_Amount, 0, "zero answer");
	}
	assertEquals(store.questions.length, 0, "no store call");
});

Deno.test("security: replays of one sale get the first answer, another sale gets 0, and a burst never gives two discounts", async () => {
	const { post } = await harness();
	const answers = await Promise.all(
		Array.from({ length: 10 }, () =>
			post(JSON.stringify(payload())).then((r) => r.json()),
		),
	);
	assertEquals(
		[...new Set(answers.map((answer) => answer.Discount_Amount))],
		[6000],
		"the same sale always gets the same discount",
	);
	const other = await (
		await post(
			JSON.stringify(payload({ Sale_Tran_Id: "synthetic-sale-sec-2" })),
		)
	).json();
	assertEquals(
		[other.Discount_Amount, other.Discount_Description],
		[0, DESCRIPTIONS.used],
		"another sale",
	);
});

Deno.test("security: the time budget is 2,500 ms; a decision just inside it is given, one just outside is a busy zero", async () => {
	assertEquals(ANSWER_BUDGET_MS, 2_500, "the documented budget");
	const inside = await harness(120);
	inside.store.delayMs = 20;
	const given = await (await inside.post(JSON.stringify(payload()))).json();
	assertEquals(given.Discount_Amount, 6000, "inside the budget");
	const outside = await harness(20);
	outside.store.delayMs = 120;
	const started = Date.now();
	const busy = await (await outside.post(JSON.stringify(payload()))).json();
	assert(
		Date.now() - started < 110,
		"answered at the budget, not when the store finished",
	);
	assertEquals(
		[busy.Discount_Amount, busy.Discount_Description],
		[0, DESCRIPTIONS.busy],
		"outside the budget",
	);
	await new Promise((resolve) => setTimeout(resolve, 130));
});

Deno.test("security: hostile text in the payload never reaches a log line, and log lines stay one line", async () => {
	const { post, lines } = await harness(20);
	const hostile = "SEC\r\nFAKE-LOG-LINE";
	await post(
		JSON.stringify(
			payload({ Membership_Id: `${PHONE}\nforged`, Sale_Tran_Id: hostile }),
		),
	);
	await post(
		JSON.stringify(
			payload({ Coupon_Code: `SECU${String.fromCharCode(0x2028)}2345` }),
		),
	);
	await post(
		JSON.stringify(payload({ Pos_Id: `${String.fromCharCode(0x1b)}[31mred` })),
	);
	await post(JSON.stringify(payload()));
	assert(lines.length >= 4, "lines were written");
	for (const line of lines) {
		assert(
			!CONTROLS.test(line),
			`a log line holds a control character: ${JSON.stringify(line)}`,
		);
		for (const secret of [
			SEGMENT,
			CODE,
			SALE,
			PHONE,
			"FAKE-LOG-LINE",
			"forged",
		]) {
			assert(!line.includes(secret), `a log line leaks a value: ${line}`);
		}
	}
});
