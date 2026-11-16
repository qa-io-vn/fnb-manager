import { DEFAULT_REPORT_SETTINGS, REPORT_SETTING_LIMITS } from "@fnb/reports";
import { describe, expect, it } from "vitest";
import { messages } from "../i18n";
import {
	businessDate,
	choice,
	dateBounds,
	dateWithin,
	decimalInRange,
	HOLIDAY_NAME_MAX_LENGTH,
	hasIssues,
	holidayName,
	holidayNameValueOf,
	integerInRange,
	issueOf,
	issuesByField,
	money,
	openingDate,
	openingDateBounds,
	openingHoursSchema,
	openingTime,
	PERCENT_LIMIT,
	percentage,
	reportSettingsSchema,
	SEAT_COUNT_MAX,
	STORE_CODE_MAX_LENGTH,
	seatCount,
	storeCode,
	storeCodeValueOf,
	VALIDATION_KEYS,
	VALIDATION_MESSAGE_KEYS,
	WHOLE_MONEY_MAX,
	wholeMoney,
} from "./validation";

describe("settings validation messages", () => {
	it("has every message in Vietnamese and English", () => {
		for (const key of VALIDATION_KEYS) {
			const messageKey = VALIDATION_MESSAGE_KEYS[key];
			expect(messages.vi[messageKey], messageKey).toBeTruthy();
			expect(messages.en[messageKey], messageKey).toBeTruthy();
		}
	});
});

describe("integerInRange", () => {
	const schema = integerInRange(7, 91);

	it("accepts both bounds and refuses one step outside", () => {
		expect(issueOf(schema, 7)).toBeNull();
		expect(issueOf(schema, 91)).toBeNull();
		expect(issueOf(schema, 6)).toEqual({ key: "range", min: 7, max: 91 });
		expect(issueOf(schema, 92)).toEqual({ key: "range", min: 7, max: 91 });
	});

	it("refuses a fraction and a value that is not a number", () => {
		expect(issueOf(schema, 7.5)).toEqual({ key: "integer" });
		expect(issueOf(schema, Number.NaN)).toEqual({ key: "number" });
		expect(issueOf(schema, "7")).toEqual({ key: "number" });
	});
});

describe("decimalInRange", () => {
	const schema = decimalInRange({ min: 0.1, max: 1, fractionDigits: 3 });

	it("accepts both bounds and refuses one step outside", () => {
		expect(issueOf(schema, 0.1)).toBeNull();
		expect(issueOf(schema, 1)).toBeNull();
		expect(issueOf(schema, 0.099)).toEqual({ key: "range", min: 0.1, max: 1 });
		expect(issueOf(schema, 1.001)).toEqual({ key: "range", min: 0.1, max: 1 });
	});

	it("refuses more decimals than the column keeps", () => {
		expect(issueOf(schema, 0.7005)).toEqual({ key: "decimals", digits: 3 });
		expect(issueOf(schema, 0.705)).toBeNull();
	});
});

describe("percentage", () => {
	it("takes 0 to 20 % with up to three decimals by default", () => {
		const schema = percentage();
		expect(PERCENT_LIMIT).toEqual({ min: 0, max: 20, fractionDigits: 3 });
		expect(issueOf(schema, 0)).toBeNull();
		expect(issueOf(schema, 20)).toBeNull();
		expect(issueOf(schema, 1.125)).toBeNull();
		expect(issueOf(schema, -0.001)).toEqual({ key: "range", min: 0, max: 20 });
		expect(issueOf(schema, 20.001)).toEqual({ key: "range", min: 0, max: 20 });
		expect(issueOf(schema, 1.1255)).toEqual({ key: "decimals", digits: 3 });
	});
});

describe("wholeMoney", () => {
	const schema = wholeMoney();

	it("accepts whole đồng from zero to the column ceiling", () => {
		expect(issueOf(schema, 0)).toBeNull();
		expect(issueOf(schema, 50_000)).toBeNull();
		expect(issueOf(schema, WHOLE_MONEY_MAX)).toBeNull();
		expect(issueOf(schema, -1)).toEqual({ key: "atLeast", min: 0 });
		expect(issueOf(schema, WHOLE_MONEY_MAX + 1)).toEqual({
			key: "atMost",
			max: WHOLE_MONEY_MAX,
		});
	});

	it("refuses a fraction of a đồng", () => {
		expect(issueOf(schema, 50_000.5)).toEqual({ key: "wholeMoney" });
	});

	it("takes a narrower range", () => {
		const fee = wholeMoney({ min: 1, max: 10_000 });
		expect(issueOf(fee, 1)).toBeNull();
		expect(issueOf(fee, 10_000)).toBeNull();
		expect(issueOf(fee, 0)).toEqual({ key: "atLeast", min: 1 });
		expect(issueOf(fee, 10_001)).toEqual({ key: "atMost", max: 10_000 });
	});
});

describe("money", () => {
	it("follows the currency's decimals", () => {
		expect(issueOf(money(0), 12.5)).toEqual({ key: "wholeMoney" });
		expect(issueOf(money(2), 12.5)).toBeNull();
		expect(issueOf(money(2), 12.505)).toEqual({ key: "decimals", digits: 2 });
		expect(issueOf(money(0, { max: 100 }), 101)).toEqual({
			key: "atMost",
			max: 100,
		});
		expect(issueOf(money(3), 1.005)).toEqual({ key: "decimals", digits: 2 });
	});
});

describe("businessDate", () => {
	const today = "2026-11-15";
	const schema = businessDate(today);

	it("runs from 2023-01-01 to the end of next year", () => {
		expect(dateBounds(today)).toEqual({ min: "2023-01-01", max: "2027-12-31" });
		expect(issueOf(schema, "2023-01-01")).toBeNull();
		expect(issueOf(schema, "2027-12-31")).toBeNull();
		expect(issueOf(schema, "2022-12-31")).toEqual({
			key: "dateRange",
			min: "2023-01-01",
			max: "2027-12-31",
		});
		expect(issueOf(schema, "2028-01-01")).toEqual({
			key: "dateRange",
			min: "2023-01-01",
			max: "2027-12-31",
		});
	});

	it("refuses a date that does not exist or is not ISO", () => {
		expect(issueOf(schema, "2026-02-30")).toEqual({ key: "date" });
		expect(issueOf(schema, "15/11/2026")).toEqual({ key: "date" });
		expect(issueOf(schema, 20261115)).toEqual({ key: "date" });
	});
});

describe("openingDate", () => {
	const today = "2026-11-16";

	it("runs from 2000-01-01 to the end of next year, so an older store can record its opening", () => {
		expect(openingDateBounds(today)).toEqual({
			min: "2000-01-01",
			max: "2027-12-31",
		});
		expect(issueOf(openingDate(today), "2000-01-01")).toBeNull();
		expect(issueOf(openingDate(today), "2018-05-20")).toBeNull();
		expect(issueOf(openingDate(today), "2027-12-31")).toBeNull();
		expect(issueOf(openingDate(today), "1999-12-31")).toEqual({
			key: "dateRange",
			min: "2000-01-01",
			max: "2027-12-31",
		});
		expect(issueOf(openingDate(today), "2026-02-30")).toEqual({
			key: "date",
		});
	});
});

describe("storeCode", () => {
	it("takes up to 12 characters once trimmed, counting letters with marks as one", () => {
		expect(STORE_CODE_MAX_LENGTH).toBe(12);
		expect(issueOf(storeCode, "Q1")).toBeNull();
		expect(issueOf(storeCode, "  ABCDEFGHIJKL  ")).toBeNull();
		expect(issueOf(storeCode, "ĐƯỜNGMẪUSỐ12")).toBeNull();
		expect(issueOf(storeCode, "ABCDEFGHIJKLM")).toEqual({
			key: "textLength",
			max: 12,
		});
	});

	it("saves the trimmed code, and an empty one as no code", () => {
		expect(storeCodeValueOf(" Q1 ")).toBe("Q1");
		expect(storeCodeValueOf("   ")).toBeNull();
		expect(storeCodeValueOf("")).toBeNull();
	});
});

describe("holidayName", () => {
	it("takes 1 to 80 characters once trimmed, counting letters with marks as one", () => {
		expect(HOLIDAY_NAME_MAX_LENGTH).toBe(80);
		expect(issueOf(holidayName, "Nghỉ sửa quán")).toBeNull();
		expect(issueOf(holidayName, ` ${"ạ".repeat(80)} `)).toBeNull();
		expect(issueOf(holidayName, "ạ".repeat(81))).toEqual({
			key: "textLength",
			max: 80,
		});
		expect(issueOf(holidayName, "   ")).toEqual({ key: "required" });
		expect(issueOf(holidayName, "")).toEqual({ key: "required" });
	});

	it("counts a name typed with combining marks as its composed letters", () => {
		const decomposed = "ạ".normalize("NFD");
		expect(decomposed).toHaveLength(2);
		expect(issueOf(holidayName, decomposed.repeat(80))).toBeNull();
		expect(issueOf(holidayName, decomposed.repeat(81))).toEqual({
			key: "textLength",
			max: 80,
		});
		expect(holidayNameValueOf(` ${"Nghỉ".normalize("NFD")} `)).toBe("Nghỉ");
	});
});

describe("dateWithin", () => {
	it("refuses a date outside its bounds and text that is no date", () => {
		const calendar = dateWithin({ min: "2024-01-01", max: "2030-12-31" });
		expect(issueOf(calendar, "2030-12-31")).toBeNull();
		expect(issueOf(calendar, "2023-12-31")).toEqual({
			key: "dateRange",
			min: "2024-01-01",
			max: "2030-12-31",
		});
		expect(issueOf(calendar, "2026-02-30")).toEqual({ key: "date" });
	});
});

describe("seatCount", () => {
	it("takes whole seats from 0 to 5,000", () => {
		expect(SEAT_COUNT_MAX).toBe(5_000);
		expect(issueOf(seatCount, 0)).toBeNull();
		expect(issueOf(seatCount, 5_000)).toBeNull();
		expect(issueOf(seatCount, -1)).toEqual({
			key: "range",
			min: 0,
			max: 5_000,
		});
		expect(issueOf(seatCount, 5_001)).toEqual({
			key: "range",
			min: 0,
			max: 5_000,
		});
		expect(issueOf(seatCount, 12.5)).toEqual({ key: "integer" });
	});
});

describe("openingTime", () => {
	it("takes H:MM or HH:MM from 0:00 to 23:59, or 24:00, as the database does", () => {
		for (const value of ["0:00", "7:00", "07:00", "23:59", "24:00"]) {
			expect(issueOf(openingTime, value), value).toBeNull();
		}
		for (const value of ["24:01", "25:00", "7:60", "07:5", "0700", "", "7h"]) {
			expect(issueOf(openingTime, value), value).toEqual({ key: "time" });
		}
	});
});

describe("openingHoursSchema", () => {
	it("accepts null, the empty object and split or overnight days", () => {
		expect(issueOf(openingHoursSchema, null)).toBeNull();
		expect(issueOf(openingHoursSchema, {})).toBeNull();
		expect(
			issueOf(openingHoursSchema, {
				mon: [["07:00", "22:30"]],
				sat: [
					["07:00", "12:00"],
					["16:00", "02:00"],
				],
				sun: [],
			}),
		).toBeNull();
	});

	it("refuses every shape the database check refuses", () => {
		const refused: unknown[] = [
			"07:00-22:00",
			[],
			{ monday: [["07:00", "22:00"]] },
			{ mon: null },
			{ mon: ["07:00", "22:00"] },
			{ mon: [["07:00"]] },
			{ mon: [["07:00", "22:00", "23:00"]] },
			{ mon: [["07:00", "25:00"]] },
			{ mon: [[7, 22]] },
		];
		for (const value of refused) {
			expect(
				issueOf(openingHoursSchema, value, "openingHours"),
				JSON.stringify(value),
			).not.toBeNull();
		}
	});
});

describe("choice", () => {
	it("accepts a listed value and refuses any other", () => {
		const schema = choice(["drink", "food"] as const);
		expect(issueOf(schema, "food")).toBeNull();
		expect(issueOf(schema, "topping")).toEqual({ key: "choice" });
	});
});

describe("reportSettingsSchema", () => {
	it("accepts the defaults", () => {
		expect(issueOf(reportSettingsSchema, DEFAULT_REPORT_SETTINGS)).toBeNull();
	});

	it("accepts every bound of the database checks and refuses one step outside", () => {
		for (const [field, limit] of Object.entries(REPORT_SETTING_LIMITS)) {
			const step = 10 ** -limit.fractionDigits;
			for (const value of [limit.min, limit.max]) {
				const issues = issuesByField(reportSettingsSchema, {
					...DEFAULT_REPORT_SETTINGS,
					[field]: value,
				});
				expect(hasIssues(issues), `${field} ${value}`).toBe(false);
			}
			for (const value of [limit.min - step, limit.max + step]) {
				const issues = issuesByField(reportSettingsSchema, {
					...DEFAULT_REPORT_SETTINGS,
					[field]: value,
				});
				expect(Object.keys(issues.byField), `${field} ${value}`).toEqual([
					field,
				]);
				expect(issues.form).toBeNull();
			}
		}
	});

	it("names each field with a problem and refuses unknown fields", () => {
		expect(
			issuesByField(reportSettingsSchema, {
				...DEFAULT_REPORT_SETTINGS,
				peakHours: 7,
				cashRelThreshold: 0.00505,
			}),
		).toEqual({
			byField: {
				peakHours: { key: "range", min: 1, max: 6 },
				cashRelThreshold: { key: "decimals", digits: 4 },
			},
			form: null,
		});
		const unknownField = issuesByField(reportSettingsSchema, {
			...DEFAULT_REPORT_SETTINGS,
			zThreshold: 2,
		});
		expect(unknownField.byField).toEqual({});
		expect(unknownField.form).not.toBeNull();
		expect(hasIssues(unknownField)).toBe(true);
		expect(hasIssues(issuesByField(reportSettingsSchema, "not settings"))).toBe(
			true,
		);
	});

	it("keeps the cents the money column allows", () => {
		expect(
			issueOf(reportSettingsSchema, {
				...DEFAULT_REPORT_SETTINGS,
				cashAbsThreshold: 50_000.5,
			}),
		).toBeNull();
	});
});
