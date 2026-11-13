import { describe, expect, it } from "vitest";
import {
	float8ToNumeric,
	formatFloat8,
	PgDecimal,
	percentileContMedian,
	roundedMedian,
	stddevSample,
} from "../../src/index.js";

const n = (text: string) => PgDecimal.parse(text);

describe("PgDecimal division follows select_div_scale", () => {
	it.each([
		["5000000.00", "100", "50000.000000000000"],
		["1", "3", "0.33333333333333333333"],
		["2", "3", "0.66666666666666666667"],
		["10", "4", "2.5000000000000000"],
		["123456789.12", "7", "17636684.160000000000"],
		["0", "7", "0.00000000000000000000"],
		["1", "10000", "0.000100000000000000000000"],
		["-7", "2", "-3.5000000000000000"],
		["9999", "9999", "1.00000000000000000000"],
	])("%s / %s = %s", (left, right, expected) => {
		expect(n(left).div(n(right)).toString()).toBe(expected);
	});

	it("rounds the quotient half away from zero", () => {
		expect(n("2").div(n("3")).round(2).toString()).toBe("0.67");
		expect(n("-2").div(n("3")).round(2).toString()).toBe("-0.67");
		expect(n("1").div(n("8")).round(2).toString()).toBe("0.13");
	});

	it("refuses division by zero", () => {
		expect(() => n("1").div(n("0.00"))).toThrow(RangeError);
		expect(n("1").divOrNull(n("0"))).toBeNull();
	});
});

describe("PgDecimal arithmetic", () => {
	it("keeps the display scale of each operation", () => {
		expect(n("1.50").add(n("2.125")).toString()).toBe("3.625");
		expect(n("1.50").mul(n("2.125")).toString()).toBe("3.18750");
		expect(n("12.5").round(3).toString()).toBe("12.500");
		expect(n("12345678").round(-6).toString()).toBe("12000000");
		expect(n("-0.005").round(2).toString()).toBe("-0.01");
		expect(PgDecimal.avg([n("1.00"), n("2.00"), n("2.00")])?.toString()).toBe(
			"1.6666666666666667",
		);
	});

	it("parses exponent forms like numeric_in", () => {
		expect(n("1.25e3").toString()).toBe("1250");
		expect(n("1.5e-3").toString()).toBe("0.0015");
		expect(() => n("abc")).toThrow(RangeError);
	});

	it("takes the sample standard deviation like numeric stddev_samp", () => {
		const values = ["-20000.00", "0.00", "5000.00", "10000.00"].map(n);
		expect(stddevSample(values)?.round(2).toString()).toBe("13149.78");
		expect(stddevSample([n("5.00")])).toBeNull();
		expect(stddevSample([n("5.00"), n("5.00")])?.toString()).toBe("0");
	});
});

describe("percentile_cont and float8 conversion", () => {
	it("interpolates the median in float8", () => {
		expect(percentileContMedian([3, 1, 2])).toBe(2);
		expect(percentileContMedian([4, 1, 2, 3])).toBe(2.5);
		expect(percentileContMedian([])).toBeNull();
	});

	it("casts float8 to numeric with 15 significant digits", () => {
		expect(formatFloat8(0.1 + 0.2)).toBe("0.3");
		expect(formatFloat8(1 / 3)).toBe("0.333333333333333");
		expect(formatFloat8(1.5e20)).toBe("1.5e+20");
		expect(float8ToNumeric(2.675).round(2).toString()).toBe("2.68");
	});

	it("rounds the median of numeric values to two digits", () => {
		expect(roundedMedian([n("100.00"), n("200.01")], 2)).toBe(150.01);
		expect(roundedMedian([null, n("7.00")], 2)).toBe(7);
		expect(roundedMedian([], 2)).toBeNull();
	});
});
