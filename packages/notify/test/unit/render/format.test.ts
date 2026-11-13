import { describe, expect, it } from "vitest";
import {
	createNotifyFormatters,
	formatLocalInstant,
	formatSelfCheck,
	formatViCount,
	formatViDate,
	formatViPercent,
	formatViSignedPercent,
	formatViWeekday,
	formatVndMoney,
} from "../../../src/render/index.js";

const WEB_MONEY = new Intl.NumberFormat("vi-VN", {
	style: "currency",
	currency: "VND",
});
const WEB_COUNT = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const WEB_PERCENT = new Intl.NumberFormat("vi-VN", {
	style: "percent",
	minimumFractionDigits: 1,
	maximumFractionDigits: 1,
});
const WEB_SIGNED_PERCENT = new Intl.NumberFormat("vi-VN", {
	style: "percent",
	minimumFractionDigits: 1,
	maximumFractionDigits: 1,
	signDisplay: "exceptZero",
});
const WEB_WEEKDAY = new Intl.DateTimeFormat("vi-VN", {
	weekday: "long",
	timeZone: "UTC",
});

const MONEY_SAMPLE = [
	0,
	-0,
	1,
	-1,
	0.5,
	1.5,
	2.5,
	-2.5,
	-0.4,
	0.05,
	99.95,
	999.5,
	1234,
	12_345,
	39_567.5,
	1_234_000,
	12_345_000,
	-62_000,
	-12_345_678.49,
	1e12,
	1e12 + 0.5,
	987_654_321_012,
	123.45,
	0.1 + 0.2,
];

const FRACTION_SAMPLE = [
	0, -0, 0.031, -0.082, 0.0825, -0.0825, 0.1005, 0.00049, 0.0005, -0.0004,
	0.00055, -0.00005, 0.42, 0.58, 0.75, 1, -1, 1.2345, 10, 0.123456789,
	-0.999949, 0.05, 0.015, 0.025, 1e-7,
];

describe("pure formatters", () => {
	it("give the spec's strings", () => {
		expect(formatVndMoney(12_345_000)).toBe("12.345.000 ₫");
		expect(formatViSignedPercent(-0.082)).toBe("-8,2%");
		expect(formatViSignedPercent(0.031)).toBe("+3,1%");
		expect(formatViDate("2026-11-07")).toBe("07/11/2026");
		expect(formatViWeekday("2026-11-07")).toBe("Thứ Bảy");
		expect(formatViWeekday("2026-11-08")).toBe("Chủ Nhật");
	});

	it("equal Intl with the web's options for money and counts", () => {
		for (const value of MONEY_SAMPLE) {
			expect(formatVndMoney(value), String(value)).toBe(
				WEB_MONEY.format(value),
			);
			expect(formatViCount(value), String(value)).toBe(WEB_COUNT.format(value));
		}
	});

	it("equal Intl with the web's options for percentages", () => {
		for (const value of FRACTION_SAMPLE) {
			expect(formatViPercent(value), String(value)).toBe(
				WEB_PERCENT.format(value),
			);
			expect(formatViSignedPercent(value), String(value)).toBe(
				WEB_SIGNED_PERCENT.format(value),
			);
		}
	});

	it("equal Intl for every weekday and give dd/mm/yyyy from the ISO digits", () => {
		for (let day = 1; day <= 14; day += 1) {
			const iso = `2026-11-${String(day).padStart(2, "0")}`;
			expect(formatViWeekday(iso)).toBe(
				WEB_WEEKDAY.format(new Date(`${iso}T00:00:00Z`)),
			);
			expect(formatViDate(iso)).toBe(`${String(day).padStart(2, "0")}/11/2026`);
		}
		expect(() => formatViDate("07/11/2026")).toThrow(RangeError);
	});

	it("fall back to Intl for another currency and format times in the reader's zone", () => {
		const usd = createNotifyFormatters({
			currencyCode: "USD",
			timeZone: "America/New_York",
		});
		expect(usd.money(1234.5)).toBe(
			new Intl.NumberFormat("en-US", {
				style: "currency",
				currency: "USD",
			}).format(1234.5),
		);
		const vnd = createNotifyFormatters({
			currencyCode: "VND",
			timeZone: "Asia/Ho_Chi_Minh",
		});
		expect(vnd.time(new Date("2026-11-08T23:00:00.000Z"))).toBe("06:00");
		expect(
			formatLocalInstant(
				new Date("2026-11-08T23:00:00.000Z"),
				"Asia/Ho_Chi_Minh",
			),
		).toBe("2026-11-09 06:00 +07");
		expect(
			formatLocalInstant(new Date("2026-11-08T23:00:00.000Z"), "Asia/Kolkata"),
		).toBe("2026-11-09 04:30 +05:30");
		expect(
			formatLocalInstant(new Date("2026-03-29T01:30:00.000Z"), "Europe/Berlin"),
		).toBe("2026-03-29 03:30 +02");
	});

	it("pass their own self-check", () => {
		expect(formatSelfCheck()).toBe(true);
	});
});
