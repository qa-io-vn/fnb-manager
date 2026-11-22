import { readFileSync } from "node:fs";
import { shiftIsoDate } from "@fnb/core";
import type { Sql } from "postgres";
import { describe, expect, it, vi } from "vitest";
import {
	assertNoIdentifiers,
	daysBetween,
	ENTRY_QUIET_LIMIT_DAYS,
	evaluate,
	isStale,
	type LoyaltyFieldsInput,
	looksLikeIdentifier,
	percentOf,
	quietDays,
	type RailEntry,
	renderReport,
	type StoreCounts,
} from "../../src/live/loyalty-fields.js";
import { runLoyaltyFieldsCheck } from "../../src/live/loyalty-fields-cli.js";

// G-11: the pure logic of the read-only loyalty fields check, on synthetic rows.
// Every case names its ISTQB technique. Nothing here opens a database or a
// network connection.

const AS_OF = "2026-11-20";
const STORE_A = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const STORE_B = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";
const STORE_C = "cccccccc-cccc-4ccc-8ccc-000000000003";
const PHONE_SHAPE = /0\d{9}/;
const UUID_SHAPE =
	/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function store(
	storeId: string,
	overrides: Partial<StoreCounts> = {},
): StoreCounts {
	return {
		storeId,
		rail: "pos_payment_discount",
		invoices: 10,
		voided: 0,
		withPhone: 0,
		withCustomerId: 0,
		withVoucherCode: 0,
		withMappedDiscountEntry: 0,
		withZeroPricePromoLine: 0,
		receiptMissing: 0,
		receiptDuplicateGroups: 0,
		...overrides,
	};
}

function entry(
	storeId: string,
	quietAgo: number | null,
	overrides: Partial<RailEntry> = {},
): RailEntry {
	return {
		storeId,
		railFrom: shiftIsoDate(AS_OF, -60),
		lastSeen: quietAgo === null ? null : shiftIsoDate(AS_OF, -quietAgo),
		...overrides,
	};
}

function input(
	overrides: Partial<LoyaltyFieldsInput> = {},
): LoyaltyFieldsInput {
	return {
		asOf: AS_OF,
		asOfDaysAgo: 1,
		stores: [store(STORE_A)],
		entries: [],
		...overrides,
	};
}

describe("daysBetween: calendar arithmetic (boundary value analysis, error guessing)", () => {
	it.each([
		["2026-11-20", "2026-11-20", 0],
		["2026-11-19", "2026-11-20", 1],
		["2026-11-20", "2026-11-19", -1],
		["2026-10-31", "2026-11-01", 1],
		["2026-12-31", "2027-01-01", 1],
		["2027-02-15", "2027-03-01", 14],
		["2028-02-15", "2028-03-01", 15],
		["2026-10-22", "2026-11-20", 29],
	])("%s to %s is %i days", (from, to, days) => {
		expect(daysBetween(from, to)).toBe(days);
	});

	it.each([
		"",
		"2026-1-5",
		"20261120",
		"2026-02-30",
		"2026-13-01",
		"not a date",
		"2026-11-20T00:00:00Z",
	])("refuses %j (negative cases)", (value) => {
		expect(() => daysBetween(value, AS_OF)).toThrow();
		expect(() => daysBetween(AS_OF, value)).toThrow();
	});
});

describe("percentOf: shares (equivalence partitioning)", () => {
	it.each([
		[0, 10, 0],
		[10, 10, 100],
		[3, 10, 30],
		[1, 3, 33.3],
		[2, 3, 66.7],
		[1, 8, 12.5],
		[1, 1000, 0.1],
	])("%i of %i is %f percent", (part, total, percent) => {
		expect(percentOf(part, total)).toBe(percent);
	});

	it("an empty, negative or non-finite total gives 0 and never NaN (negative cases)", () => {
		expect(percentOf(0, 0)).toBe(0);
		expect(percentOf(5, 0)).toBe(0);
		expect(percentOf(5, -3)).toBe(0);
		expect(percentOf(Number.NaN, 4)).toBe(0);
		expect(percentOf(1, Number.POSITIVE_INFINITY)).toBe(0);
	});
});

describe("the 14-day rule (boundary value analysis)", () => {
	it("the limit is 14 days", () => {
		expect(ENTRY_QUIET_LIMIT_DAYS).toBe(14);
	});

	it.each([
		[0, false],
		[1, false],
		[13, false],
		[14, true],
		[15, true],
		[29, true],
	])(
		"an entry last seen %i days before the as-of day: stale is %s",
		(ago, stale) => {
			const quiet = quietDays(entry(STORE_A, ago), AS_OF);
			expect(quiet).toBe(ago);
			expect(isStale(quiet)).toBe(stale);
		},
	);

	it("holds across a month end and a leap day (error guessing)", () => {
		const base = { railFrom: "2027-01-01" };
		expect(
			isStale(
				quietDays(
					{ storeId: STORE_A, ...base, lastSeen: "2027-02-15" },
					"2027-03-01",
				),
			),
		).toBe(true);
		expect(
			isStale(
				quietDays(
					{ storeId: STORE_A, ...base, lastSeen: "2027-02-16" },
					"2027-03-01",
				),
			),
		).toBe(false);
		const leap = { railFrom: "2028-01-01" };
		expect(
			isStale(
				quietDays(
					{ storeId: STORE_A, ...leap, lastSeen: "2028-02-16" },
					"2028-03-01",
				),
			),
		).toBe(true);
		expect(
			isStale(
				quietDays(
					{ storeId: STORE_A, ...leap, lastSeen: "2028-02-17" },
					"2028-03-01",
				),
			),
		).toBe(false);
	});

	it("a custom limit moves the boundary with it", () => {
		expect(isStale(6, 7)).toBe(false);
		expect(isStale(7, 7)).toBe(true);
	});
});

describe("when the quiet clock starts (decision table: last sighting x rail start)", () => {
	// rule 1: seen recently, rail old
	// rule 2: never seen, rail began 13 days ago (grace, the rail is new)
	// rule 3: never seen, rail began 14 days ago
	// rule 4: never seen, rail old
	// rule 5: seen 20 days ago but the rail began 5 days ago (the clock restarts)
	// rule 6: the rail begins after the as-of day (clock never negative-stale)
	it.each([
		["seen 3 days ago, old rail", 3, -60, 3, false],
		["never seen, rail 13 days old", null, -13, 13, false],
		["never seen, rail 14 days old", null, -14, 14, true],
		["never seen, old rail", null, -60, 60, true],
		["seen 20 days ago, rail 5 days old", 20, -5, 5, false],
		["rail begins after the as-of day", null, 2, -2, false],
	])("%s", (_name, seenAgo, railOffset, quiet, stale) => {
		const row = entry(STORE_A, seenAgo, {
			railFrom: shiftIsoDate(AS_OF, railOffset as number),
		});
		expect(quietDays(row, AS_OF)).toBe(quiet);
		expect(isStale(quietDays(row, AS_OF))).toBe(stale);
	});
});

describe("evaluate: labels, shares and the verdict", () => {
	it("labels stores store-1, store-2 by ascending id whatever the input order (equivalence partitioning)", () => {
		const result = evaluate(
			input({
				stores: [
					store(STORE_C, { invoices: 3 }),
					store(STORE_A, { invoices: 1 }),
					store(STORE_B, { invoices: 2 }),
				],
			}),
		);
		expect(result.stores.map((line) => [line.store, line.invoices])).toEqual([
			["store-1", 1],
			["store-2", 2],
			["store-3", 3],
		]);
	});

	it("counts and shares of the five fields come from the non-voided invoices", () => {
		const result = evaluate(
			input({
				stores: [
					store(STORE_A, {
						invoices: 8,
						voided: 2,
						withPhone: 2,
						withCustomerId: 4,
						withVoucherCode: 1,
						withMappedDiscountEntry: 3,
						withZeroPricePromoLine: 8,
					}),
				],
			}),
		);
		expect(result.stores[0]).toMatchObject({
			invoices: 8,
			voided: 2,
			with_phone: 2,
			with_phone_pct: 25,
			with_customer_id: 4,
			with_customer_id_pct: 50,
			with_voucher_code: 1,
			with_voucher_code_pct: 12.5,
			with_discount_entry: 3,
			with_discount_entry_pct: 37.5,
			with_zero_price_line: 8,
			with_zero_price_line_pct: 100,
		});
	});

	it("a store with no invoice shows zeros, not NaN or null (boundary value: 0 invoices)", () => {
		const result = evaluate(
			input({ stores: [store(STORE_A, { invoices: 0 })] }),
		);
		const text = renderReport(result).join("\n");
		expect(result.stores[0]?.with_phone_pct).toBe(0);
		expect(text).not.toContain("null");
		expect(text).not.toContain("NaN");
	});

	it("receipt numbers are unique only when no store-day group repeats (equivalence partitioning: 0, 1, many groups)", () => {
		const result = evaluate(
			input({
				stores: [
					store(STORE_A, { receiptDuplicateGroups: 0 }),
					store(STORE_B, { receiptDuplicateGroups: 1 }),
					store(STORE_C, { receiptDuplicateGroups: 7 }),
				],
			}),
		);
		expect(result.stores.map((line) => line.receipt_numbers_unique)).toEqual([
			true,
			false,
			false,
		]);
		expect(result.receiptNumbersUnique).toBe(false);
		expect(result.pass).toBe(true);
	});

	it("names the rail with a fixed label, never a database value (equivalence partitioning: three rails, none, unknown)", () => {
		const result = evaluate(
			input({
				stores: [
					store(STORE_A, { rail: "pos_payment_discount" }),
					store(STORE_B, { rail: "crm_code_pool" }),
					store(STORE_C, { rail: null }),
					store("dddddddd-dddd-4ddd-8ddd-000000000004", {
						rail: "Some Brand Rail",
					}),
				],
			}),
		);
		expect(result.stores.map((line) => line.rail)).toEqual([
			"pos_payment_discount",
			"crm_code_pool",
			"none",
			"other",
		]);
	});

	it("an entry at 13 days passes and at 14 days fails the check (boundary value analysis)", () => {
		const at13 = evaluate(input({ entries: [entry(STORE_A, 13)] }));
		expect(at13.pass).toBe(true);
		expect(at13.entries).toEqual([
			{
				store: "store-1",
				entry: "entry-1",
				quiet_days: 13,
				seen_in_window: true,
				stale: false,
			},
		]);
		const at14 = evaluate(input({ entries: [entry(STORE_A, 14)] }));
		expect(at14.pass).toBe(false);
		expect(at14.reason).toBe("stale_entry");
		expect(at14.stores[0]?.stale_entries).toBe(1);
		const at15 = evaluate(input({ entries: [entry(STORE_A, 15)] }));
		expect(at15.pass).toBe(false);
	});

	it("an entry never seen in the window reports seen_in_window false", () => {
		const result = evaluate(input({ entries: [entry(STORE_A, null)] }));
		expect(result.entries[0]).toMatchObject({
			seen_in_window: false,
			quiet_days: 60,
			stale: true,
		});
	});

	it("only a store whose rail uses discount entries can fail on one (decision table: rail x entry state)", () => {
		const stale = entry(STORE_A, 20);
		for (const rail of [
			"crm_code_pool",
			"crm_callback",
			null,
			"unknown_rail",
		]) {
			const result = evaluate(
				input({
					stores: [store(STORE_A, { rail })],
					entries: [stale],
				}),
			);
			expect(result.pass).toBe(true);
			expect(result.entries).toEqual([]);
		}
		const onRail = evaluate(
			input({
				stores: [store(STORE_A, { rail: "pos_payment_discount" })],
				entries: [stale],
			}),
		);
		expect(onRail.pass).toBe(false);
	});

	it("numbers the entries of each store from entry-1, one failing entry fails the store and the check", () => {
		const result = evaluate(
			input({
				stores: [store(STORE_A), store(STORE_B)],
				entries: [entry(STORE_A, 2), entry(STORE_A, 30), entry(STORE_B, 1)],
			}),
		);
		expect(
			result.entries.map((line) => `${line.store}/${line.entry}/${line.stale}`),
		).toEqual([
			"store-1/entry-1/false",
			"store-1/entry-2/true",
			"store-2/entry-1/false",
		]);
		expect(
			result.stores.map((line) => [line.rail_entries, line.stale_entries]),
		).toEqual([
			[2, 1],
			[1, 0],
		]);
		expect(result.pass).toBe(false);
	});

	it("no store in scope fails with its own reason (negative case)", () => {
		const result = evaluate(input({ stores: [], entries: [] }));
		expect(result.pass).toBe(false);
		expect(result.reason).toBe("no_store_in_scope");
	});

	it("refuses an entry whose store is not in the scope (negative case)", () => {
		expect(() =>
			evaluate(
				input({ stores: [store(STORE_A)], entries: [entry(STORE_B, 1)] }),
			),
		).toThrow(/outside the scope/);
	});
});

describe("renderReport: counts, booleans and labels only (security: no identifier)", () => {
	const busy = input({
		asOfDaysAgo: 2,
		stores: [
			store(STORE_A, { invoices: 1234, withPhone: 600, withCustomerId: 12 }),
			store(STORE_B, { rail: "crm_callback", receiptDuplicateGroups: 2 }),
			store(STORE_C, { rail: null }),
		],
		entries: [entry(STORE_A, 3), entry(STORE_A, 20)],
	});

	it("prints one JSON object per line, a header, a line per store and entry, and a verdict", () => {
		const lines = renderReport(evaluate(busy));
		const objects = lines.map(
			(line) => JSON.parse(line) as Record<string, unknown>,
		);
		expect(objects.every((object) => object.check === "loyalty-fields")).toBe(
			true,
		);
		expect(objects[0]).toMatchObject({
			window_business_days: 30,
			entry_quiet_limit_days: 14,
			stores: 3,
			as_of_days_ago: 2,
		});
		expect(objects.filter((object) => "with_phone" in object)).toHaveLength(3);
		expect(objects.filter((object) => "entry" in object)).toHaveLength(2);
		expect(objects.at(-1)).toEqual({
			check: "loyalty-fields",
			result: "fail",
			reason: "stale_entry",
			stores: 3,
			rail_entries_checked: 2,
			stale_entries: 1,
			receipt_numbers_unique: false,
		});
	});

	it("every string value is a fixed label and every other value a number or a boolean", () => {
		const allowed =
			/^(loyalty-fields|store-\d+|entry-\d+|pos_payment_discount|crm_code_pool|crm_callback|none|other|pass|fail|stale_entry|no_store_in_scope)$/;
		for (const line of renderReport(evaluate(busy))) {
			for (const value of Object.values(
				JSON.parse(line) as Record<string, unknown>,
			)) {
				if (typeof value === "string") {
					expect(value).toMatch(allowed);
				} else {
					expect(["number", "boolean"]).toContain(typeof value);
				}
			}
		}
	});

	it("contains no 0-and-nine-digits run and no uuid although the input holds uuids", () => {
		const text = renderReport(evaluate(busy)).join("\n");
		expect(PHONE_SHAPE.test(text)).toBe(false);
		expect(UUID_SHAPE.test(text)).toBe(false);
		expect(text).not.toContain(STORE_A);
		expect(text).not.toContain("aaaaaaaa");
		expect(text).not.toContain("@");
	});

	it("passes its own identifier screen", () => {
		expect(() =>
			assertNoIdentifiers(renderReport(evaluate(busy))),
		).not.toThrow();
	});
});

describe("the identifier screen (equivalence partitioning of identifier shapes, negative cases)", () => {
	it.each([
		["a mobile phone", "0900000123"],
		["a phone in a sentence", "store-1 called 0900000999 today"],
		["an international phone", `+${"84"}${"900000123"}`],
		["a uuid", "id aaaaaaaa-aaaa-4aaa-8aaa-000000000001 end"],
		["an upper-case uuid", "AAAAAAAA-AAAA-4AAA-8AAA-000000000001"],
		["an e-mail address", "owner@example.com"],
	])("refuses %s", (_name, text) => {
		expect(looksLikeIdentifier(text)).toBe(true);
		expect(() => assertNoIdentifiers(["{}", text])).toThrow(/identifier/);
	});

	it.each([
		"store-1",
		'{"invoices":1234,"with_phone_pct":33.3}',
		"090000012",
		'{"quiet_days":14}',
	])("lets %s through", (text) => {
		expect(looksLikeIdentifier(text)).toBe(false);
	});
});

describe("runLoyaltyFieldsCheck: refusals and error handling, offline (error guessing)", () => {
	function harness(read: LoyaltyFieldsInput | Error) {
		const written: string[] = [];
		const warned: string[] = [];
		const end = vi.fn(() => Promise.resolve());
		const client = { end } as unknown as Sql;
		const open = vi.fn(() => client);
		const readStub = vi.fn(
			(_client: Sql, _options: { tenantSlug?: string | null }) =>
				read instanceof Error ? Promise.reject(read) : Promise.resolve(read),
		);
		return {
			written,
			warned,
			end,
			open,
			readStub,
			run: (env: Record<string, string | undefined>) =>
				runLoyaltyFieldsCheck(
					env,
					(line) => written.push(line),
					(line) => warned.push(line),
					{ open, read: readStub },
				),
		};
	}

	it.each([
		["missing", undefined],
		["empty", ""],
		["blank", "   "],
	])(
		"refuses to run when DATABASE_URL is %s, opens nothing and has no default",
		async (_name, value) => {
			const h = harness(input());
			const code = await h.run({ DATABASE_URL: value });
			expect(code).toBe(2);
			expect(h.open).not.toHaveBeenCalled();
			expect(h.readStub).not.toHaveBeenCalled();
			expect(h.written).toEqual([]);
			expect(h.warned.join("\n")).toMatch(/DATABASE_URL is not set/);
		},
	);

	it("does not fall back to another variable that could hold a cloud URL", async () => {
		const h = harness(input());
		const code = await h.run({
			SUPABASE_DB_URL: "postgresql://user:pw@example.com:5432/postgres",
			POSTGRES_URL: "postgresql://user:pw@example.com:5432/postgres",
		});
		expect(code).toBe(2);
		expect(h.open).not.toHaveBeenCalled();
	});

	it.each([
		"not a url",
		"mysql://user:secretpw@127.0.0.1/db",
		"https://example.org/secretpath",
	])("refuses %j without echoing it", async (value) => {
		const h = harness(input());
		const code = await h.run({ DATABASE_URL: value });
		expect(code).toBe(2);
		expect(h.open).not.toHaveBeenCalled();
		expect(h.warned.join("\n")).not.toContain("secret");
		expect(h.warned.join("\n")).not.toContain("example.");
	});

	it("prints the report and exits 0 on a pass, 1 on a stale entry, closing the client each time", async () => {
		const pass = harness(input({ entries: [entry(STORE_A, 13)] }));
		expect(
			await pass.run({ DATABASE_URL: "postgresql://127.0.0.1:54322/db" }),
		).toBe(0);
		expect(pass.written.length).toBeGreaterThan(2);
		expect(pass.written.at(-1)).toContain('"result":"pass"');
		expect(pass.end).toHaveBeenCalledTimes(1);

		const fail = harness(input({ entries: [entry(STORE_A, 14)] }));
		expect(
			await fail.run({ DATABASE_URL: "postgres://127.0.0.1:54322/db" }),
		).toBe(1);
		expect(fail.written.at(-1)).toContain('"result":"fail"');
		expect(fail.end).toHaveBeenCalledTimes(1);
	});

	it("passes an optional tenant slug to the reader and nothing else of the environment", async () => {
		const scoped = harness(input());
		await scoped.run({
			DATABASE_URL: "postgresql://127.0.0.1:54322/db",
			LIVE_TENANT: " some-slug ",
		});
		expect(scoped.readStub.mock.calls[0]?.[1]).toEqual({
			tenantSlug: "some-slug",
		});
		const unscoped = harness(input());
		await unscoped.run({ DATABASE_URL: "postgresql://127.0.0.1:54322/db" });
		expect(unscoped.readStub.mock.calls[0]?.[1]).toEqual({ tenantSlug: null });
	});

	it("a failing read prints its error code only, never its message, the URL or a host, and prints no report", async () => {
		const secret = "postgresql://user:secretpw@example.com:5432/postgres";
		const h = harness(
			Object.assign(new Error(`connect failed for ${secret}`), {
				code: "ECONNREFUSED",
			}),
		);
		const code = await h.run({ DATABASE_URL: secret });
		expect(code).toBe(2);
		expect(h.written).toEqual([]);
		const warned = h.warned.join("\n");
		expect(warned).toContain("ECONNREFUSED");
		expect(warned).not.toContain("secret");
		expect(warned).not.toContain("example.");
		expect(h.end).toHaveBeenCalledTimes(1);
	});

	it("an error with an odd code is shown as a generic error (negative case)", async () => {
		const h = harness(
			Object.assign(new Error("x"), { code: "has spaces and 127.0.0.1" }),
		);
		await h.run({ DATABASE_URL: "postgresql://127.0.0.1:54322/db" });
		expect(h.warned.join("\n")).toContain("(error)");
		expect(h.warned.join("\n")).not.toContain("127.0.0.1");
	});
});

describe("static guard on the check's own source (static analysis)", () => {
	const files = [
		"../../src/live/loyalty-fields.ts",
		"../../src/live/loyalty-fields-queries.ts",
		"../../src/live/loyalty-fields-cli.ts",
		"../../bin/loyalty-fields.mjs",
	].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

	it("holds no database URL, no cloud host, no env-file reader and no POS or Zalo client", () => {
		for (const source of files) {
			expect(source).not.toMatch(/postgres(?:ql)?:\/\/\S/);
			expect(source).not.toMatch(/supabase\.(co|com|net)/);
			expect(source).not.toMatch(
				/dotenv|readFileSync|loadEnvFile|--env-file|[/\\"'`]\.env/,
			);
			expect(source).not.toMatch(/@fnb\/connector|@fnb\/zalo|fetch\(/);
		}
	});

	it("reads DATABASE_URL and no other connection variable", () => {
		const cli = files[2] ?? "";
		expect(cli).toContain("env.DATABASE_URL");
		expect(cli).not.toMatch(/env\.(SUPABASE|POSTGRES|DB_)/);
	});

	it("issues select statements only", () => {
		const queries = files[1] ?? "";
		expect(queries).not.toMatch(
			/\b(insert\s+into|update\s+public|delete\s+from|truncate|drop\s+|alter\s+table)\b/i,
		);
	});
});
