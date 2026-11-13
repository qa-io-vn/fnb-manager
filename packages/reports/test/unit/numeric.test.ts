import { describe, expect, it } from "vitest";
import {
	cumulativeShares,
	difference,
	ratio,
	relativeChange,
	roundHalfAwayFromZero,
	shares,
	sumMoney,
	sumQuantity,
	topN,
} from "../../src/index.js";

describe("roundHalfAwayFromZero", () => {
	it.each([
		[1.005, 2, 1.01],
		[2.675, 2, 2.68],
		[-2.675, 2, -2.68],
		[0.125, 2, 0.13],
		[1234.5, 0, 1235],
		[-1234.5, 0, -1235],
		[0.1 + 0.2, 2, 0.3],
		[12_345_678, -6, 12_000_000],
		[12_500_000, -6, 13_000_000],
		[0.0000004, 6, 0],
		[1e-7, 2, 0],
	])("rounds %d to %i digits as %d", (value, digits, expected) => {
		expect(roundHalfAwayFromZero(value, digits)).toBe(expected);
	});

	it("rejects non-finite values", () => {
		expect(() => roundHalfAwayFromZero(Number.NaN, 2)).toThrow(RangeError);
	});
});

describe("ratio, change and difference", () => {
	it("returns null on a zero or missing denominator", () => {
		expect(ratio(5, 0, 2)).toBeNull();
		expect(ratio(null, 3, 2)).toBeNull();
		expect(ratio(1, 3, 6)).toBe(0.333333);
		expect(ratio(2, 3, 4)).toBe(0.6667);
	});

	it("measures the relative change against the reference", () => {
		expect(relativeChange(110, 100)).toBeCloseTo(0.1, 12);
		expect(relativeChange(90, 100)).toBeCloseTo(-0.1, 12);
		expect(relativeChange(5, 0)).toBeNull();
		expect(relativeChange(null, 5)).toBeNull();
	});

	it("keeps differences free of binary noise", () => {
		expect(difference(1_234_567.89, 1_234_500.12)).toBe(67.77);
		expect(difference(0.123456, 0.12)).toBe(0.003456);
		expect(difference(null, 1)).toBeNull();
	});
});

describe("sums, shares and ranking", () => {
	it("adds money in minor units and quantities in thousandths", () => {
		expect(sumMoney([0.1, 0.2, 0.3])).toBe(0.6);
		expect(sumMoney([1_000_000.01, 2_000_000.02, null])).toBe(3_000_000.03);
		expect(sumQuantity([0.001, 0.002, 1])).toBe(1.003);
	});

	it("computes cumulative shares at six digits", () => {
		expect(cumulativeShares([50, 30, 20])).toEqual([0.5, 0.8, 1]);
		expect(cumulativeShares([0, 0])).toEqual([null, null]);
		expect(shares([1, 2])).toEqual([0.333333, 0.666667]);
	});

	it("keeps the first of equal rows when ranking", () => {
		const rows = [
			{ id: "a", value: 2 },
			{ id: "b", value: 3 },
			{ id: "c", value: 3 },
		];
		expect(
			topN(rows, 2, (left, right) => right.value - left.value).map(
				(row) => row.id,
			),
		).toEqual(["b", "c"]);
	});
});
