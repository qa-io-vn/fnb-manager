// Test design (ISTQB): boundary value analysis and equivalence partitioning for what staff type on Ghi hóa đơn (the
// bill number 0 / 1 / 40 / 41 characters, the total 0 / 1 / 100,000,000 / 100,000,001 and its accepted spellings, the
// member code 5 / 6 / 7 digits or a scanned payload), a decision table for "may this bill be reversed now"
// (reversible flag x window), and boundaries for the counter QR refresh delay (5 s floor, 10 min ceiling).
import { describe, expect, it } from "vitest";
import type { RecentBill } from "./bills-contract";
import {
	billInput,
	canReverse,
	codeDigits,
	EMPTY_DRAFT,
	MAX_COUNTER_REFRESH_MS,
	MIN_COUNTER_REFRESH_MS,
	readBillNo,
	readBillTotal,
	readMemberCode,
	refreshDelay,
	withinWindow,
} from "./bills-model";

const STORE = "00000000-0000-4000-8000-0000000005a1";
const NOW = new Date("2026-11-21T05:00:00Z");

describe("the bill number", () => {
	it("takes 1 to 40 characters without spaces, trimmed", () => {
		expect(readBillNo(" HD-0031 ")).toEqual({ ok: true, billNo: "HD-0031" });
		expect(readBillNo("1")).toEqual({ ok: true, billNo: "1" });
		expect(readBillNo("A".repeat(40))).toEqual({
			ok: true,
			billNo: "A".repeat(40),
		});
	});

	it("refuses empty, 41 characters, inner spaces and control characters", () => {
		expect(readBillNo("   ")).toEqual({ ok: false, problem: "empty" });
		expect(readBillNo("A".repeat(41))).toEqual({
			ok: false,
			problem: "format",
		});
		expect(readBillNo("HD 0031")).toEqual({ ok: false, problem: "format" });
		expect(readBillNo("HD\u00070031")).toEqual({
			ok: false,
			problem: "format",
		});
	});
});

describe("the bill total", () => {
	it("reads plain and grouped đồng amounts", () => {
		for (const [text, total] of [
			["185000", 185_000],
			["185.000", 185_000],
			["185,000", 185_000],
			["185 000", 185_000],
			["1.250.000", 1_250_000],
			["185.000 ₫", 185_000],
			["1", 1],
			["100.000.000", 100_000_000],
		] as const)
			expect(readBillTotal(text)).toEqual({ ok: true, total });
	});

	it("refuses 0, more than 100,000,000, decimals and stray text", () => {
		expect(readBillTotal("")).toEqual({ ok: false, problem: "empty" });
		expect(readBillTotal("0")).toEqual({ ok: false, problem: "zero" });
		expect(readBillTotal("100000001")).toEqual({
			ok: false,
			problem: "large",
		});
		expect(readBillTotal("99999999999999999999")).toEqual({
			ok: false,
			problem: "large",
		});
		for (const text of ["185.5", "18.50", "-5000", "12a", "1.2.3", "1e6"])
			expect(readBillTotal(text)).toEqual({ ok: false, problem: "format" });
	});
});

describe("the member code", () => {
	it("keeps six digits from what is typed", () => {
		expect(codeDigits("24 68-10x9")).toBe("246810");
	});

	it("takes exactly six digits, and a scanned payload in place of the digits", () => {
		expect(readMemberCode({ code: "246810", payload: null })).toEqual({
			ok: true,
			code: "246810",
		});
		expect(
			readMemberCode({ code: "246810", payload: "fnb-member:1:Q1:246810" }),
		).toEqual({ ok: true, code: "fnb-member:1:Q1:246810" });
		expect(readMemberCode({ code: "", payload: null })).toEqual({
			ok: false,
			problem: "empty",
		});
		for (const code of ["24681", "2468101"])
			expect(readMemberCode({ code, payload: null })).toEqual({
				ok: false,
				problem: "format",
			});
	});
});

describe("billInput", () => {
	it("gives the input when every field reads, and every problem otherwise", () => {
		expect(
			billInput(STORE, {
				code: "246810",
				payload: null,
				billNo: "HD-1",
				total: "185.000",
			}),
		).toEqual({
			ok: true,
			input: { storeId: STORE, code: "246810", billNo: "HD-1", total: 185_000 },
		});
		expect(billInput(STORE, EMPTY_DRAFT)).toEqual({
			ok: false,
			problems: [
				{ field: "code", problem: "empty" },
				{ field: "billNo", problem: "empty" },
				{ field: "total", problem: "empty" },
			],
		});
	});
});

function bill(reversible: boolean, reverseUntil: string | null): RecentBill {
	return {
		id: "b",
		createdAt: NOW.toISOString(),
		billNo: "HD-1",
		total: 1,
		source: "staff_scan",
		state: "confirmed",
		queueReason: null,
		reversalReason: null,
		evidenceLevel: 2,
		byMe: false,
		recordedByName: null,
		phoneMasked: "•••• ••• 234",
		stamps: 0,
		points: 0,
		reverseUntil,
		reversible,
		shadowState: null,
	};
}

describe("canReverse: reversible flag x window", () => {
	const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
	it.each([
		[true, at(1), true],
		[true, at(0), true],
		[true, at(-1), false],
		[true, null, true],
		[false, at(60_000), false],
		[false, null, false],
	] as const)("reversible %s until %s: %s", (reversible, until, expected) => {
		expect(canReverse(bill(reversible, until), NOW)).toBe(expected);
	});

	it("keeps a void open up to its last instant only", () => {
		expect(withinWindow(at(0), NOW)).toBe(true);
		expect(withinWindow(at(-1), NOW)).toBe(false);
		expect(withinWindow(null, NOW)).toBe(false);
	});
});

describe("refreshDelay", () => {
	it("waits until the refresh time, between 5 s and 10 min", () => {
		const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
		expect(refreshDelay(at(45_000), NOW)).toBe(45_000);
		expect(refreshDelay(at(5_000), NOW)).toBe(5_000);
		expect(refreshDelay(at(4_999), NOW)).toBe(MIN_COUNTER_REFRESH_MS);
		expect(refreshDelay(at(-60_000), NOW)).toBe(MIN_COUNTER_REFRESH_MS);
		expect(refreshDelay(at(MAX_COUNTER_REFRESH_MS + 1), NOW)).toBe(
			MAX_COUNTER_REFRESH_MS,
		);
		expect(refreshDelay("not a time", NOW)).toBe(MIN_COUNTER_REFRESH_MS);
	});
});
