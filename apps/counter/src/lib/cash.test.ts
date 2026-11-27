import { describe, expect, it } from "vitest";
import {
	changeDue,
	countTotal,
	DENOMINATIONS,
	differenceOf,
	MAX_AMOUNT,
	MAX_NOTES,
	parseAmount,
	parseNoteCount,
	quickAmounts,
	setCount,
} from "./cash";

// counter:unit/cash (Q02-U1, U2; Q01-U1): equivalence partitions and boundary values of a drawer count, the change for a
// customer and the difference with the server's expected cash.

describe("a drawer count by denomination", () => {
	it("is 0 with nothing counted and adds every note", () => {
		expect(countTotal({})).toBe(0);
		expect(countTotal({ 500000: 1 })).toBe(500_000);
		// the drawn count of the design: 3.283.000đ
		expect(
			countTotal({
				500000: 4,
				200000: 2,
				100000: 5,
				50000: 5,
				20000: 4,
				10000: 4,
				5000: 2,
				2000: 1,
				1000: 1,
			}),
		).toBe(3_283_000);
		expect(
			countTotal({
				500000: 4,
				200000: 2,
				100000: 5,
				50000: 6,
				20000: 4,
				10000: 4,
				5000: 2,
				2000: 1,
				1000: 1,
			}),
		).toBe(3_333_000);
	});

	it("refuses a negative, fractional or too large count (boundaries 0, MAX_NOTES, MAX_NOTES + 1)", () => {
		expect(() => countTotal({ 1000: -1 })).toThrow(RangeError);
		expect(() => countTotal({ 1000: 1.5 })).toThrow(RangeError);
		expect(countTotal({ 1000: MAX_NOTES })).toBe(MAX_NOTES * 1_000);
		expect(() => countTotal({ 1000: MAX_NOTES + 1 })).toThrow(RangeError);
	});

	it("reads a typed count: empty is 0, digits only, four at most", () => {
		expect(parseNoteCount("")).toBe(0);
		expect(parseNoteCount(" 7 ")).toBe(7);
		expect(parseNoteCount("9999")).toBe(9_999);
		expect(parseNoteCount("10000")).toBeNull();
		expect(parseNoteCount("-1")).toBeNull();
		expect(parseNoteCount("1.5")).toBeNull();
		expect(parseNoteCount("a")).toBeNull();
	});

	it("clamps a stepper to 0 and MAX_NOTES", () => {
		expect(setCount({}, 1_000, -1)[1_000]).toBe(0);
		expect(setCount({}, 1_000, MAX_NOTES + 5)[1_000]).toBe(MAX_NOTES);
		expect(DENOMINATIONS[0]).toBe(500_000);
	});
});

describe("the change for a customer", () => {
	it.each([
		[167_000, 166_999, null],
		[167_000, 167_000, 0],
		[167_000, 200_000, 33_000],
		[0, 0, 0],
		[167_000, -1, null],
		[167_000, 1.5, null],
		[167_000, MAX_AMOUNT + 1, null],
		[MAX_AMOUNT, MAX_AMOUNT, 0],
	])("total %i, given %s: change %s", (total, tendered, change) => {
		expect(changeDue(total, tendered)).toBe(change);
	});

	it("offers exact, round and large notes, no smaller than the total", () => {
		expect(quickAmounts(167_000)).toEqual([167_000, 170_000, 200_000, 500_000]);
		expect(quickAmounts(200_000)).toEqual([200_000, 500_000]);
		expect(quickAmounts(29_000)).toEqual([
			29_000, 30_000, 50_000, 100_000, 200_000,
		]);
		expect(quickAmounts(0)).toEqual([]);
	});

	it("reads a typed amount with dots, commas, spaces or đ", () => {
		expect(parseAmount("200.000đ")).toBe(200_000);
		expect(parseAmount("1,000,000")).toBe(1_000_000);
		expect(parseAmount("")).toBe(0);
		expect(parseAmount("12a")).toBeNull();
		expect(parseAmount(String(MAX_AMOUNT + 1))).toBeNull();
	});
});

describe("the difference with the expected cash", () => {
	it.each([
		[0, { kind: "matched" }],
		[-1_000, { kind: "short", amount: 1_000 }],
		[1_000, { kind: "over", amount: 1_000 }],
		[-50_000, { kind: "short", amount: 50_000 }],
		[-1, { kind: "short", amount: 1 }],
	])("%i", (difference, expected) => {
		expect(differenceOf(difference)).toEqual(expected);
	});
});
