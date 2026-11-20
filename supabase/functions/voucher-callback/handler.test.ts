import { type FunctionEnvironment, serveFunction } from "../_shared/http.ts";
import { decisionOf } from "./database.ts";
import {
	type CallbackDecision,
	type CallbackQuestion,
	createVoucherCallbackHandler,
	DESCRIPTIONS,
	FUNCTION_NAME,
	MAX_PROXY_HOPS,
	PROXY_HOPS_VARIABLE,
	pathSegment,
	proxyHops,
	sha256Hex,
	sourceAddress,
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

const SEGMENT = "Synthetic_path-segment_0123456789abcdefghij";
const OTHER_SEGMENT = "Synthetic_path-segment_0123456789abcdefghiX";
const BASE_URL = "http://127.0.0.1:54321/functions/v1/voucher-callback";
const CODE = "SYNC2345";
const SALE = "synthetic-sale-0001";
const PHONE = "0900000951";
const NOW = new Date("2026-11-19T03:00:00.000Z");
const ENVIRONMENT: FunctionEnvironment = {
	SUPABASE_DB_URL:
		"postgresql://postgres.synthetic:synthetic-db-password@example.com:5432/postgres",
};

function assumedPayload(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		Pos_Parent: "SYNTHETIC-BRAND",
		Pos_Id: 9501,
		Coupon_Code: CODE,
		Membership_Id: PHONE,
		Sale_Tran_Id: SALE,
		Created_At: "2026-11-19 10:00:00",
		Code: 1,
		Date_Start: "2026-11-01",
		Date_End: "2026-12-31",
		Voucher_Order_Line: [
			{
				Item_Type_Id: "TYPE-1",
				Item_Id: "ITEM-A",
				Description: "Synthetic drink",
				Quantity: 2,
				Amount: 60000,
				Pr_Key: 1,
				Price_Sale: 30000,
				Discount: 0,
				Detail_State: 0,
				Package_Id: null,
			},
			{
				Item_Type_Id: "TYPE-2",
				Item_Id: "ITEM-X",
				Description: "Synthetic cake",
				Quantity: 1,
				Amount: 40000,
				Pr_Key: 2,
				Price_Sale: 40000,
				Discount: 5000,
				Detail_State: 0,
				Package_Id: null,
			},
		],
		...overrides,
	};
}

class FakeStore implements VoucherCallbackStore {
	readonly questions: CallbackQuestion[] = [];
	readonly answers = new Map<string, CallbackDecision>();
	readonly used = new Set<string>();
	decide: ((question: CallbackQuestion) => Promise<CallbackDecision>) | null =
		null;
	pathSha256 = "";

	answer(question: CallbackQuestion): Promise<CallbackDecision> {
		this.questions.push(question);
		if (this.decide) {
			return this.decide(question);
		}
		if (question.pathSha256 !== this.pathSha256) {
			return Promise.resolve({
				outcome: "unknown_path",
				discountAmount: 0,
				rewardName: null,
			});
		}
		const key = `${question.storeRef}|${question.saleRef}|${question.code}`;
		const first = this.answers.get(key);
		if (first) {
			return Promise.resolve({ ...first, outcome: "replayed" });
		}
		if (this.used.has(question.code)) {
			return Promise.resolve({
				outcome: "used",
				discountAmount: 0,
				rewardName: null,
			});
		}
		const decision: CallbackDecision = {
			outcome: "accepted",
			discountAmount: 6000,
			rewardName: "Giảm 10%",
		};
		this.answers.set(key, decision);
		this.used.add(question.code);
		return Promise.resolve(decision);
	}
}

interface Harness {
	readonly store: FakeStore;
	readonly lines: string[];
	post(
		body: unknown,
		options?: {
			segment?: string | null;
			url?: string;
			method?: string;
			forwardedFor?: string;
			connectionAddress?: string | null;
			environment?: FunctionEnvironment;
		},
	): Promise<Response>;
}

async function harness(budgetMs = 200): Promise<Harness> {
	const store = new FakeStore();
	store.pathSha256 = await sha256Hex(SEGMENT);
	const lines: string[] = [];
	return {
		store,
		lines,
		post: (body, options = {}) => {
			const connection =
				options.connectionAddress === undefined
					? "198.51.100.20"
					: options.connectionAddress;
			const handler = createVoucherCallbackHandler({
				store: () => store,
				clock: () => NOW,
				connectionAddress: () => connection,
				budgetMs,
			});
			const segment = options.segment === undefined ? SEGMENT : options.segment;
			const url =
				options.url ?? (segment === null ? BASE_URL : `${BASE_URL}/${segment}`);
			const method = options.method ?? "POST";
			return serveFunction(
				new Request(url, {
					method,
					...(method === "GET"
						? {}
						: { body: typeof body === "string" ? body : JSON.stringify(body) }),
					headers: {
						"x-forwarded-for": options.forwardedFor ?? "203.0.113.5, 10.0.0.1",
					},
				}),
				options.environment ?? ENVIRONMENT,
				handler,
				{
					name: FUNCTION_NAME,
					origins: [],
					log: (line) => lines.push(line),
					requestId: () => "synthetic-request",
				},
			);
		},
	};
}

Deno.test("a valid code gets the discount and the reward's name", async () => {
	const { store, post } = await harness();
	const response = await post(assumedPayload());
	assertEquals(response.status, 200, "status");
	const body = await response.json();
	assertEquals(
		[body.Discount_Amount, body.Discount_Description],
		[6000, "Giảm 10%"],
		"answer",
	);
	assertEquals(
		body.Code,
		1,
		"the result code is echoed until its meaning is known",
	);
	assertEquals(body.Sale_Tran_Id, SALE, "the payload is echoed");
	const question = store.questions[0];
	assert(question !== undefined, "the store was asked");
	assertEquals(
		Object.keys(question).sort(),
		[
			"code",
			"lines",
			"memberPhone",
			"pathSha256",
			"programmeRef",
			"receivedAt",
			"saleRef",
			"sourceIp",
			"storeRef",
		],
		"the question carries canonical names only",
	);
	assertEquals(
		[
			question.storeRef,
			question.code,
			question.saleRef,
			question.memberPhone,
			question.programmeRef,
			question.sourceIp,
		],
		["9501", CODE, SALE, PHONE, null, "198.51.100.20"],
		"canonical values",
	);
	assertEquals(
		question.lines,
		[
			{ item: "ITEM-A", quantity: 2, amount: 60000 },
			{ item: "ITEM-X", quantity: 1, amount: 35000 },
		],
		"net lines",
	);
	assertEquals(
		question.pathSha256,
		await sha256Hex(SEGMENT),
		"only the hash of the path reaches the store",
	);
});

Deno.test("a replay of the same sale gets the first answer", async () => {
	const { post } = await harness();
	await post(assumedPayload());
	const response = await post(assumedPayload({ Voucher_Order_Line: [] }));
	const body = await response.json();
	assertEquals(
		[response.status, body.Discount_Amount],
		[200, 6000],
		"replayed answer",
	);
});

Deno.test("a used code under another sale gets 0 with the description", async () => {
	const { post } = await harness();
	await post(assumedPayload());
	const response = await post(
		assumedPayload({ Sale_Tran_Id: "synthetic-sale-0002" }),
	);
	const body = await response.json();
	assertEquals(
		[response.status, body.Discount_Amount, body.Discount_Description],
		[200, 0, "Mã đã được sử dụng"],
		"used",
	);
});

Deno.test("a wrong or missing path segment gets 404 before the store is asked", async () => {
	const { store, post } = await harness();
	for (const options of [
		{ segment: null },
		{ segment: "short" },
		{ url: `${BASE_URL}/${SEGMENT}/extra` },
		{ url: `http://127.0.0.1:54321/functions/v1/other/${SEGMENT}` },
	]) {
		const response = await post(assumedPayload(), options);
		assertEquals(
			response.status,
			404,
			`status for ${JSON.stringify(options).slice(0, 40)}`,
		);
	}
	assertEquals(store.questions.length, 0, "no store call");
	const response = await post(assumedPayload(), { segment: OTHER_SEGMENT });
	assertEquals(response.status, 404, "a well-formed segment of no tenant");
	assertEquals((await response.json()).error, "not_found", "error code");
});

Deno.test("another method on the secret path gets 405 without a store call", async () => {
	const { store, post } = await harness();
	const response = await post(null, { method: "GET" });
	assertEquals(response.status, 405, "status");
	assertEquals(store.questions.length, 0, "no store call");
});

Deno.test("a malformed body gets 400 and the store is never asked", async () => {
	const { store, post } = await harness();
	for (const body of [
		"{not json",
		"[]",
		assumedPayload({ Coupon_Code: undefined }),
		assumedPayload({ Coupon_Code: "TWO WORDS" }),
		assumedPayload({ Sale_Tran_Id: "" }),
		assumedPayload({ Voucher_Order_Line: "ITEM-A" }),
		assumedPayload({
			Voucher_Order_Line: [{ Item_Id: "ITEM-A", Quantity: "two", Amount: 1 }],
		}),
	]) {
		const response = await post(body);
		assertEquals(
			response.status,
			400,
			`status for ${JSON.stringify(body).slice(0, 60)}`,
		);
		const answer = await response.json();
		assertEquals(
			[answer.Discount_Amount, answer.Discount_Description],
			[0, DESCRIPTIONS.malformed],
			"zero answer",
		);
	}
	assertEquals(store.questions.length, 0, "no store call");
});

Deno.test("an amount above the line total is refused without a store call", async () => {
	const { store, post } = await harness();
	for (const line of [
		{ Item_Id: "ITEM-A", Quantity: 1, Price_Sale: 30000, Amount: 90000 },
		{
			Item_Id: "ITEM-A",
			Quantity: 1,
			Price_Sale: 30000,
			Amount: 30000,
			Discount: 40000,
		},
		{ Item_Id: "ITEM-A", Quantity: 0, Price_Sale: 30000, Amount: 0 },
		{ Item_Id: "ITEM-A", Quantity: -1, Price_Sale: 30000, Amount: 30000 },
		{ Item_Id: "ITEM-A", Quantity: 1, Price_Sale: 2_000_000_000, Amount: 1 },
	]) {
		const response = await post(assumedPayload({ Voucher_Order_Line: [line] }));
		assertEquals(response.status, 422, `status for ${JSON.stringify(line)}`);
		const answer = await response.json();
		assertEquals(answer.Discount_Amount, 0, "zero answer");
	}
	assertEquals(store.questions.length, 0, "no store call");
});

Deno.test("a refused address gets 403 with a zero answer", async () => {
	const { store, post } = await harness();
	store.decide = () =>
		Promise.resolve({
			outcome: "refused_address",
			discountAmount: 0,
			rewardName: null,
		});
	const response = await post(assumedPayload(), {
		forwardedFor: "192.0.2.10",
		connectionAddress: "198.51.100.7",
	});
	assertEquals(response.status, 403, "status");
	assertEquals((await response.json()).Discount_Amount, 0, "zero");
	assertEquals(
		store.questions[0]?.sourceIp,
		"198.51.100.7",
		"the connection's address is the source, not the forwarded header",
	);
});

Deno.test("an answer slower than the budget becomes a busy zero answer", async () => {
	const { store, post, lines } = await harness(20);
	store.decide = () => new Promise(() => undefined);
	const started = Date.now();
	const response = await post(assumedPayload());
	assert(Date.now() - started < 1000, "answered within the budget");
	const body = await response.json();
	assertEquals(
		[response.status, body.Discount_Amount, body.Discount_Description],
		[200, 0, DESCRIPTIONS.busy],
		"busy",
	);
	assert(
		lines.some((line) => line.includes("answered busy")),
		"logged as busy",
	);
});

Deno.test("each refusal of the database has its description", async () => {
	const { store, post } = await harness();
	for (const outcome of [
		"disabled",
		"unknown_code",
		"wrong_store",
		"expired",
		"released",
		"wrong_member",
		"below_minimum",
		"not_applicable",
		"unknown_store",
		"wrong_programme",
	] as const) {
		store.decide = () =>
			Promise.resolve({ outcome, discountAmount: 0, rewardName: null });
		const response = await post(assumedPayload());
		const body = await response.json();
		assertEquals(
			[response.status, body.Discount_Amount, body.Discount_Description],
			[200, 0, DESCRIPTIONS[outcome]],
			outcome,
		);
	}
});

Deno.test("no log line carries the path, the code, the sale or the member", async () => {
	const { store, post, lines } = await harness(20);
	await post(assumedPayload());
	await post(assumedPayload({ Sale_Tran_Id: "synthetic-sale-0002" }));
	await post(
		assumedPayload({
			Voucher_Order_Line: [
				{ Item_Id: "ITEM-A", Quantity: 1, Price_Sale: 1, Amount: 9 },
			],
		}),
	);
	await post("{not json");
	store.decide = () => new Promise(() => undefined);
	await post(assumedPayload());
	assert(lines.length >= 5, "lines were written");
	for (const line of lines) {
		for (const secret of [SEGMENT, CODE, SALE, PHONE, "synthetic-sale-0002"]) {
			assert(!line.includes(secret), `a log line leaks a value: ${line}`);
		}
	}
});

Deno.test("the path segment, the source address and the stored answer are read strictly", async () => {
	assertEquals(pathSegment(`${BASE_URL}/${SEGMENT}`), SEGMENT, "segment");
	assertEquals(
		pathSegment(`http://127.0.0.1/voucher-callback/${SEGMENT}?x=1`),
		SEGMENT,
		"query ignored",
	);
	assertEquals(
		pathSegment(`${BASE_URL}/${SEGMENT}/`),
		SEGMENT,
		"trailing slash",
	);
	assertEquals(pathSegment(BASE_URL), null, "missing");
	const request = (value: string) =>
		new Request(BASE_URL, { headers: { "x-forwarded-for": value } });
	const oneHop = { [PROXY_HOPS_VARIABLE]: "1" };
	assertEquals(
		sourceAddress(request("2001:db8::1"), oneHop, null),
		"2001:db8::1",
		"IPv6",
	);
	assertEquals(
		sourceAddress(request("not-an-address"), oneHop, null),
		null,
		"garbage",
	);
	assertEquals(
		sourceAddress(new Request(BASE_URL), oneHop, null),
		null,
		"absent",
	);
	assertEquals(
		sourceAddress(new Request(BASE_URL), {}, "2001:db8::2"),
		"2001:db8::2",
		"connection IPv6",
	);
	assertEquals(
		sourceAddress(new Request(BASE_URL), {}, "localhost"),
		null,
		"a connection name that is no address",
	);
	assertEquals(MAX_PROXY_HOPS, 5, "at most five trusted proxies");
	assertEquals(proxyHops({}), 0, "unset trusts the connection");
	assertEquals(
		decisionOf({
			answer: {
				outcome: "accepted",
				discount_amount: "6000",
				reward_name: "Giảm 10%",
			},
		}),
		{ outcome: "accepted", discountAmount: 6000, rewardName: "Giảm 10%" },
		"numeric text",
	);
	let threw = false;
	try {
		decisionOf({ answer: { outcome: "something_else" } });
	} catch {
		threw = true;
	}
	assert(threw, "an unknown outcome is an error");
});
