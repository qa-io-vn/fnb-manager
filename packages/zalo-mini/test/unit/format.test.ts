import { describe, expect, it } from "vitest";
import {
	EN_DASH,
	formatCount,
	formatDate,
	formatTime,
	formatTimeRange,
	formatVnd,
	formatVndDelta,
	looksLikePrice,
	MINUS_SIGN,
} from "../../src/format/index";

// Test design (ISTQB) for the formatters of design spec 5.2:
// - equivalence partitions of an amount by its number of digit groups (none, one, two, three), and of the refused
//   values (negative, not whole, not finite, not a number);
// - boundary values at every power of ten where a dot appears or the digits grow (0, 1, 999, 1.000, 9.999, 10.000,
//   99.999, 100.000, 999.999, 1.000.000) and at the largest whole number a double can hold;
// - times at 00:00, 23:59 and the closing 24:00, and one step beyond; dates at month ends and 29 February.

describe("formatVnd", () => {
	it.each([
		[0, "0đ"],
		[1, "1đ"],
		[9, "9đ"],
		[10, "10đ"],
		[99, "99đ"],
		[100, "100đ"],
		[999, "999đ"],
		[1000, "1.000đ"],
		[1001, "1.001đ"],
		[9999, "9.999đ"],
		[10000, "10.000đ"],
		[35000, "35.000đ"],
		[99999, "99.999đ"],
		[100000, "100.000đ"],
		[999999, "999.999đ"],
		[1000000, "1.000.000đ"],
		[1234567, "1.234.567đ"],
		[100000000, "100.000.000đ"],
		[Number.MAX_SAFE_INTEGER, "9.007.199.254.740.991đ"],
	])("writes %i as %s", (amount, written) => {
		expect(formatVnd(amount)).toBe(written);
	});

	it("writes the đ attached, never a space, ₫ or VND, and a dot, never a comma or a space, between the groups", () => {
		for (const amount of [0, 999, 1000, 35000, 1234567]) {
			const written = formatVnd(amount);
			expect(written).toMatch(/^\d{1,3}(?:\.\d{3})*đ$/);
			expect(written).not.toMatch(/[₫,\s]|vnd/i);
		}
	});

	it("treats a negative zero as zero", () => {
		expect(formatVnd(-0)).toBe("0đ");
	});

	it("refuses what is not a whole number of 0 or more, and never writes a plausible price from it", () => {
		for (const bad of [
			-1,
			-35000,
			0.5,
			35000.5,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
			Number.MAX_SAFE_INTEGER + 2,
			1e21,
		]) {
			expect(() => formatVnd(bad), String(bad)).toThrow(RangeError);
		}
		for (const notANumber of [
			"35000",
			"35.000đ",
			"<b>1</b>",
			null,
			undefined,
			{},
		]) {
			expect(() => formatVnd(notANumber as never), String(notANumber)).toThrow(
				RangeError,
			);
		}
	});
});

describe("formatVndDelta", () => {
	it("writes the sign: + for more, the minus sign U+2212 for less, nothing for no change", () => {
		expect(formatVndDelta(5000)).toBe("+5.000đ");
		expect(formatVndDelta(-5000)).toBe(`${MINUS_SIGN}5.000đ`);
		expect(formatVndDelta(0)).toBe("0đ");
		expect(formatVndDelta(1)).toBe("+1đ");
		expect(formatVndDelta(-1)).toBe(`${MINUS_SIGN}1đ`);
		expect(formatVndDelta(-1000000)).toBe(`${MINUS_SIGN}1.000.000đ`);
		expect(formatVndDelta(-0)).toBe("0đ");
	});

	it("uses the true minus sign, not a hyphen or an en dash", () => {
		expect(MINUS_SIGN.codePointAt(0)).toBe(0x2212);
		const written = formatVndDelta(-5000);
		expect(written.startsWith("-")).toBe(false);
		expect(written.startsWith(EN_DASH)).toBe(false);
	});

	it("refuses a change that is not a whole number", () => {
		for (const bad of [0.5, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(() => formatVndDelta(bad), String(bad)).toThrow(RangeError);
		}
	});
});

describe("formatCount", () => {
	it.each([
		[0, "0"],
		[7, "7"],
		[999, "999"],
		[1000, "1.000"],
		[1200, "1.200"],
		[1000000, "1.000.000"],
	])("writes %i as %s", (count, written) => {
		expect(formatCount(count)).toBe(written);
	});

	it("refuses a negative or fractional count", () => {
		for (const bad of [-1, 1.5, Number.NaN]) {
			expect(() => formatCount(bad), String(bad)).toThrow(RangeError);
		}
	});
});

describe("formatTime and formatTimeRange", () => {
	it.each(["00:00", "07:00", "12:30", "23:59", "24:00"])(
		"accepts %s",
		(time) => {
			expect(formatTime(time)).toBe(time);
		},
	);

	it.each([
		"24:01",
		"25:00",
		"07:60",
		"7:00",
		"07:0",
		"07-00",
		"07:00:00",
		" 07:00",
		"07:00 ",
		"0700",
		"",
		"AB:CD",
		"7am",
	])("refuses %j", (time) => {
		expect(() => formatTime(time)).toThrow(RangeError);
	});

	it("writes a range with an en dash (U+2013), in 24-hour time", () => {
		const range = formatTimeRange("07:00", "23:00");
		expect(range).toBe("07:00–23:00");
		expect(range.codePointAt(5)).toBe(0x2013);
		expect(range).not.toMatch(/[AP]M/i);
	});

	it("writes a night span and a day that closes at 24:00 as they are", () => {
		expect(formatTimeRange("18:00", "02:00")).toBe("18:00–02:00");
		expect(formatTimeRange("07:00", "24:00")).toBe("07:00–24:00");
		expect(formatTimeRange("00:00", "23:59")).toBe("00:00–23:59");
	});

	it("refuses a range with a bad end, naming the value", () => {
		expect(() => formatTimeRange("07:00", "25:00")).toThrow(/"25:00"/);
		expect(() => formatTimeRange("7:00", "23:00")).toThrow(/"7:00"/);
	});
});

describe("formatDate", () => {
	it.each([
		["2026-11-26", "26/11/2026"],
		["2026-01-01", "01/01/2026"],
		["2026-12-31", "31/12/2026"],
		["2028-02-29", "29/02/2028"],
		["2026-02-28", "28/02/2026"],
		["2026-04-30", "30/04/2026"],
		["2000-02-29", "29/02/2000"],
		["0099-03-05", "05/03/0099"],
	])("writes %s as %s", (iso, written) => {
		expect(formatDate(iso)).toBe(written);
	});

	it.each([
		"2026-02-29",
		"2100-02-29",
		"2026-04-31",
		"2026-13-01",
		"2026-00-10",
		"2026-11-00",
		"2026-11-32",
		"26-11-2026",
		"2026-1-5",
		"2026/11/26",
		"2026-11-26T00:00:00Z",
		"",
		"today",
	])("refuses %j", (iso) => {
		expect(() => formatDate(iso)).toThrow(RangeError);
	});
});

describe("looksLikePrice", () => {
	it.each([
		"35.000đ",
		"35.000 đ",
		"35.000₫",
		"35.000 ₫",
		"35.000 đồng",
		"35,000 VND",
		"35000vnđ",
		"VND 35000",
		"₫35.000",
		"1.234.567đ",
		"35k",
		"35K",
		"Cà phê sữa 35.000đ",
		"+5.000đ",
		"−5.000đ",
	])("sees a price in %j", (text) => {
		expect(looksLikePrice(text)).toBe(true);
	});

	it.each([
		"ly thứ 10 được tặng",
		"còn 6 ly nữa",
		"10 điểm",
		"3 đơn mới",
		"5km",
		"Bàn 12",
		"0912 345 678",
		"07:00–23:00",
		"26/11/2026",
		"đồng phục",
		"Đã thêm. Giỏ có 2 món.",
		"",
	])("sees no price in %j", (text) => {
		expect(looksLikePrice(text)).toBe(false);
	});

	it("sees every price the formatters write", () => {
		for (const amount of [0, 1, 999, 1000, 35000, 1234567]) {
			expect(looksLikePrice(formatVnd(amount)), String(amount)).toBe(true);
			expect(looksLikePrice(formatVndDelta(amount)), String(amount)).toBe(true);
			expect(looksLikePrice(formatVndDelta(-amount)), String(amount)).toBe(
				true,
			);
		}
	});

	it("does not take a count, a time or a date for a price", () => {
		for (const count of [0, 7, 1000, 1200]) {
			expect(looksLikePrice(formatCount(count))).toBe(false);
		}
		expect(looksLikePrice(formatTimeRange("07:00", "23:00"))).toBe(false);
		expect(looksLikePrice(formatDate("2026-11-26"))).toBe(false);
	});
});
