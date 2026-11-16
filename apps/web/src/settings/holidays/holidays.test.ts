import { VIETNAM_HOLIDAYS } from "@fnb/core";
import { describe, expect, it } from "vitest";
import { messages } from "../../i18n";
import type { HolidayRow } from "../source";
import {
	defaultHolidayYear,
	globalHolidayNameKey,
	HOLIDAY_DATE_BOUNDS,
	HOLIDAY_YEARS,
	holidayKindKey,
	nationalCalendarYears,
	readHolidayDraft,
	withAddedHoliday,
	withoutHoliday,
} from "./holidays";

function row(
	holidayDate: string,
	name: string,
	custom: boolean,
	id = `${custom ? "custom" : "global"}:${holidayDate}:${name}`,
): HolidayRow {
	return {
		id,
		countryCode: "VN",
		holidayDate,
		name,
		kind: custom ? "custom" : "public",
		custom,
		audit: null,
	};
}

describe("the holiday calendar's range", () => {
	it("offers the years 2024 to 2030 and dates inside them", () => {
		expect(HOLIDAY_YEARS).toEqual([2024, 2025, 2026, 2027, 2028, 2029, 2030]);
		expect(HOLIDAY_DATE_BOUNDS).toEqual({
			min: "2024-01-01",
			max: "2030-12-31",
		});
	});

	it("opens on the current year, held inside the range", () => {
		expect(defaultHolidayYear("2026-11-16")).toBe(2026);
		expect(defaultHolidayYear("2023-06-01")).toBe(2024);
		expect(defaultHolidayYear("2031-01-01")).toBe(2030);
	});

	it("knows the national calendar is shipped for 2024 to 2028", () => {
		expect(nationalCalendarYears()).toEqual({ from: 2024, to: 2028 });
		expect(nationalCalendarYears([])).toEqual({ from: 2024, to: 2024 });
	});
});

describe("labels of the national days", () => {
	it("names every national day of the calendar in both languages", () => {
		for (const holiday of VIETNAM_HOLIDAYS) {
			const key = globalHolidayNameKey(holiday.name);
			expect(key, holiday.name).not.toBeNull();
			if (key === null) continue;
			expect(messages.vi[key]).toBeTruthy();
			expect(messages.en[key]).toBeTruthy();
		}
		expect(globalHolidayNameKey("Tet, day 1")).toBe(
			"settings.holidays.name.tetDay1",
		);
		expect(globalHolidayNameKey("toString")).toBeNull();
		expect(globalHolidayNameKey("A new name")).toBeNull();
	});

	it("labels each kind with the reports' words", () => {
		expect(holidayKindKey("public")).toBe("report.holiday.public");
		expect(holidayKindKey("tet")).toBe("report.holiday.tet");
		expect(holidayKindKey("custom")).toBe("report.holiday.custom");
		expect(holidayKindKey("other")).toBeNull();
	});
});

describe("readHolidayDraft", () => {
	const known = [row("2026-03-09", "Nghỉ sửa quán", true)];

	it("sends the date and the trimmed name", () => {
		expect(
			readHolidayDraft({ date: "2026-03-10", name: "  Nghỉ sửa quán " }, known),
		).toEqual({
			change: { holidayDate: "2026-03-10", name: "Nghỉ sửa quán" },
			dateIssue: null,
			nameIssue: null,
			exists: false,
		});
	});

	it("asks for a date inside the calendar and a name of 1 to 80 characters", () => {
		const empty = readHolidayDraft({ date: "", name: "" }, known);
		expect(empty.change).toBeNull();
		expect(empty.dateIssue).toEqual({ key: "required" });
		expect(empty.nameIssue).toEqual({ key: "required" });
		expect(
			readHolidayDraft({ date: "2031-01-01", name: "Nghỉ" }, known).dateIssue,
		).toEqual({ key: "dateRange", min: "2024-01-01", max: "2030-12-31" });
		expect(
			readHolidayDraft({ date: "2026-03-10", name: "a".repeat(81) }, known)
				.nameIssue,
		).toEqual({ key: "textLength", max: 80 });
		expect(
			readHolidayDraft({ date: "2026-03-10", name: "a".repeat(80) }, known)
				.change,
		).not.toBeNull();
	});

	it("holds back a day off the year already has under that name", () => {
		expect(
			readHolidayDraft({ date: "2026-03-09", name: "Nghỉ sửa quán " }, known),
		).toMatchObject({ change: null, exists: true });
		expect(
			readHolidayDraft({ date: "2026-03-09", name: "Nghỉ sửa quán" }, [
				row("2026-03-09", "Nghỉ sửa quán", false),
			]),
		).toMatchObject({ exists: false });
	});

	it("sends a name typed with combining marks in composed form and finds it equal to the stored one", () => {
		const typed = "Nghỉ sửa quán".normalize("NFD");
		expect(typed).not.toBe("Nghỉ sửa quán");
		expect(
			readHolidayDraft({ date: "2026-03-10", name: typed }, known).change,
		).toEqual({ holidayDate: "2026-03-10", name: "Nghỉ sửa quán" });
		expect(
			readHolidayDraft({ date: "2026-03-09", name: typed }, known),
		).toMatchObject({ change: null, exists: true });
		expect(
			readHolidayDraft({ date: "2026-03-09", name: "Nghỉ sửa quán" }, [
				row("2026-03-09", typed, true),
			]),
		).toMatchObject({ change: null, exists: true });
	});
});

describe("the cached year after a save", () => {
	const national = row("2026-04-30", "Reunification Day", false);
	const own = row("2026-04-30", "Nghỉ lễ thêm", true);

	it("puts an added day in date order after the national day of that date", () => {
		const added = row("2026-03-09", "Nghỉ sửa quán", true);
		expect(withAddedHoliday([national, own], added)).toEqual([
			added,
			national,
			own,
		]);
		expect(withAddedHoliday([national, added], added)).toEqual([
			added,
			national,
		]);
		expect(withAddedHoliday(undefined, added)).toBeUndefined();
	});

	it("drops a deleted day", () => {
		expect(withoutHoliday([national, own], own.id)).toEqual([national]);
		expect(withoutHoliday(undefined, own.id)).toBeUndefined();
	});
});
