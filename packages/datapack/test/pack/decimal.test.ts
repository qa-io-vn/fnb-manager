import { roundHalfAwayFromZero } from "@fnb/reports";
import { describe, expect, it } from "vitest";
import { decimalPlaces, formatDecimal } from "../../src/pack/decimal.js";
import { DataPackError } from "../../src/pack/errors.js";
import {
	CURRENCY_MINOR_UNITS,
	currencyMinorUnits,
	NUMERIC_UNITS,
	PACK_UNITS,
	roundToUnit,
	UNIT_DIGITS,
	UNIT_KINDS,
	unitDigits,
} from "../../src/pack/units.js";

const PLAIN_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;

function sampleValues(): number[] {
	const values: number[] = [];
	let state = 20261117;
	for (let index = 0; index < 2000; index += 1) {
		state = (state * 1103515245 + 12345) % 2147483648;
		const mantissa = state / 2147483648 - 0.5;
		const exponent = (index % 61) - 30;
		values.push(mantissa * 10 ** exponent);
	}
	return values;
}

describe("formatDecimal", () => {
	it("writes values rounded to scales 0 to 6, positive and negative", () => {
		const cases: [number, number, string][] = [
			[12500000, 0, "12500000"],
			[-12500000.4, 0, "-12500000"],
			[2.5, 0, "3"],
			[-2.5, 0, "-3"],
			[12.45, 1, "12.5"],
			[-12.45, 1, "-12.5"],
			[52314.274, 2, "52314.27"],
			[1.005, 2, "1.01"],
			[-1.005, 2, "-1.01"],
			[0.07, 2, "0.07"],
			[312.1255, 3, "312.126"],
			[1.0005, 3, "1.001"],
			[0.12345, 4, "0.1235"],
			[0.00005, 4, "0.0001"],
			[-0.00005, 4, "-0.0001"],
			[0.000049999, 4, "0"],
			[1.234565, 5, "1.23457"],
			[0.000015, 5, "0.00002"],
			[0.0000005, 6, "0.000001"],
			[-0.0000005, 6, "-0.000001"],
			[0.000000499, 6, "0"],
			[123.4567891, 6, "123.456789"],
		];
		for (const [value, scale, text] of cases) {
			expect(formatDecimal(roundHalfAwayFromZero(value, scale))).toBe(text);
		}
	});

	it("trims trailing zeros and keeps the zeros of integers", () => {
		expect(formatDecimal(1.5)).toBe("1.5");
		expect(formatDecimal(1.1)).toBe("1.1");
		expect(formatDecimal(100)).toBe("100");
		expect(formatDecimal(1000.25)).toBe("1000.25");
		expect(formatDecimal(0.1)).toBe("0.1");
		expect(formatDecimal(-0.5)).toBe("-0.5");
	});

	it("writes zero and negative zero as 0", () => {
		expect(formatDecimal(0)).toBe("0");
		expect(formatDecimal(-0)).toBe("0");
		expect(formatDecimal(roundHalfAwayFromZero(-0.0001, 2))).toBe("0");
	});

	it("writes large đồng amounts in full", () => {
		expect(formatDecimal(1e14)).toBe("100000000000000");
		expect(formatDecimal(-1e14)).toBe("-100000000000000");
		expect(formatDecimal(999999999999.99)).toBe("999999999999.99");
		expect(formatDecimal(123456789012)).toBe("123456789012");
		expect(formatDecimal(1e15)).toBe("1000000000000000");
		expect(formatDecimal(1e21)).toBe(`1${"0".repeat(21)}`);
		expect(formatDecimal(1.5e300)).toBe(`15${"0".repeat(299)}`);
	});

	it("keeps 15 significant digits and breaks toPrecision ties away from zero", () => {
		expect(formatDecimal(1e14 + 0.5)).toBe("100000000000001");
		expect(formatDecimal(-(1e14 + 0.5))).toBe("-100000000000001");
		expect(formatDecimal(1000000000000005)).toBe("1000000000000010");
		expect(formatDecimal(1000000000000015)).toBe("1000000000000020");
		expect(formatDecimal(2 ** 53)).toBe("9007199254740990");
		expect(formatDecimal(123456789012345680)).toBe("123456789012346000");
		expect(formatDecimal(52314.271428571425)).toBe("52314.2714285714");
	});

	it("removes binary float drift", () => {
		expect(formatDecimal(0.1 + 0.2)).toBe("0.3");
		expect(formatDecimal(1.1 * 3)).toBe("3.3");
		expect(formatDecimal(0.7 - 0.4)).toBe("0.3");
		expect(formatDecimal(1.0000000000000002)).toBe("1");
	});

	it("writes tiny shares without an exponent", () => {
		expect(formatDecimal(1e-7)).toBe("0.0000001");
		expect(formatDecimal(-1.234e-10)).toBe("-0.0000000001234");
		expect(formatDecimal(0.0001)).toBe("0.0001");
		const smallest = formatDecimal(Number.MIN_VALUE);
		expect(smallest.startsWith(`0.${"0".repeat(323)}`)).toBe(true);
		expect(smallest.endsWith("494065645841247")).toBe(true);
	});

	it("never writes an exponent and reads back to the same text", () => {
		for (const value of sampleValues()) {
			const text = formatDecimal(value);
			expect(text).toMatch(PLAIN_DECIMAL);
			expect(formatDecimal(Number(text))).toBe(text);
			if (value !== 0) {
				expect(Math.abs(Number(text) - value) / Math.abs(value)).toBeLessThan(
					1e-14,
				);
			}
		}
	});

	it("refuses values that are not finite numbers", () => {
		for (const value of [
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
		]) {
			expect(() => formatDecimal(value)).toThrow(DataPackError);
			expect(() => formatDecimal(value)).toThrow(/^pack_invalid: /);
		}
		expect(() => formatDecimal("1" as unknown as number)).toThrow(
			DataPackError,
		);
	});

	it("counts the decimals of the written text", () => {
		expect(decimalPlaces(12500000)).toBe(0);
		expect(decimalPlaces(1.5)).toBe(1);
		expect(decimalPlaces(0.1 + 0.2)).toBe(1);
		expect(decimalPlaces(0.0001)).toBe(4);
		expect(decimalPlaces(1e-7)).toBe(7);
	});
});

describe("the digits of each unit", () => {
	it("declares a cell kind for every unit and digits for every numeric unit", () => {
		expect(Object.keys(UNIT_KINDS).sort()).toEqual([...PACK_UNITS].sort());
		expect(Object.keys(UNIT_DIGITS).sort()).toEqual([...NUMERIC_UNITS].sort());
		for (const unit of PACK_UNITS) {
			expect(UNIT_KINDS[unit] === "number").toBe(
				(NUMERIC_UNITS as readonly string[]).includes(unit),
			);
		}
	});

	it("rounds money by the currency's minor units, quantities to 3, fractions and changes to 4, hours to 1, ratios to 2", () => {
		expect(unitDigits("money", "VND")).toBe(0);
		expect(unitDigits("money", "USD")).toBe(2);
		expect(unitDigits("money", "KWD")).toBe(3);
		expect(unitDigits("quantity", "VND")).toBe(3);
		expect(unitDigits("fraction", "VND")).toBe(4);
		expect(unitDigits("rel_change", "VND")).toBe(4);
		expect(unitDigits("pp_change", "VND")).toBe(4);
		expect(unitDigits("hours", "VND")).toBe(1);
		expect(unitDigits("ratio", "VND")).toBe(2);
		expect(unitDigits("count", "VND")).toBe(0);
		expect(unitDigits("metric", "VND")).toBeNull();
		expect(unitDigits("metric_change", "VND")).toBeNull();
	});

	it("rounds half away from zero and leaves KPI values unrounded", () => {
		expect(roundToUnit(52314.5, "money", "VND")).toBe(52315);
		expect(roundToUnit(-52314.5, "money", "VND")).toBe(-52315);
		expect(roundToUnit(12.345, "money", "USD")).toBe(12.35);
		expect(roundToUnit(0.12345, "fraction", "VND")).toBe(0.1235);
		expect(roundToUnit(7.25, "hours", "VND")).toBe(7.3);
		expect(roundToUnit(1.005, "ratio", "VND")).toBe(1.01);
		expect(roundToUnit(155.2505, "quantity", "VND")).toBe(155.251);
		expect(roundToUnit(52314.2714285714, "metric", "VND")).toBe(
			52314.2714285714,
		);
	});

	it("uses ISO 4217 minor units and two for a currency it does not list", () => {
		expect(currencyMinorUnits("VND")).toBe(0);
		expect(currencyMinorUnits("JPY")).toBe(0);
		expect(currencyMinorUnits("EUR")).toBe(2);
		expect(currencyMinorUnits("XYZ")).toBe(2);
		expect(currencyMinorUnits("constructor")).toBe(2);
		expect(
			Object.values(CURRENCY_MINOR_UNITS).every((d) => d === 0 || d === 3),
		).toBe(true);
	});
});
