import { businessDayStart, wallClockIn } from "@fnb/core";
import { describe, expect, it } from "vitest";
import { businessDayStartOf, localHourOf } from "./business-dates";

const SEVEN_MINUTES = 7 * 60_000;
const TWO_DAYS = 2 * 24 * 60 * 60_000;

function instantsAround(isoInstant: string): Date[] {
	const centre = Date.parse(isoInstant);
	const instants: Date[] = [];
	for (
		let at = centre - TWO_DAYS;
		at <= centre + TWO_DAYS;
		at += SEVEN_MINUTES
	) {
		instants.push(new Date(at + 1_234));
	}
	return instants;
}

describe("localHourOf", () => {
	it.each([
		["Asia/Ho_Chi_Minh", "2026-11-04T05:30:00Z"],
		["Europe/Berlin", "2026-03-29T01:00:00Z"],
		["Europe/Berlin", "2026-10-25T01:00:00Z"],
		["America/St_Johns", "2026-03-08T05:30:00Z"],
		["America/St_Johns", "2026-11-01T04:30:00Z"],
		["Asia/Kathmandu", "2026-06-01T00:00:00Z"],
		["Australia/Lord_Howe", "2026-04-04T15:00:00Z"],
		["Australia/Lord_Howe", "2026-10-03T15:30:00Z"],
		["Pacific/Chatham", "2026-04-04T14:00:00Z"],
	])("matches the wall clock in %s around %s", (timeZone, isoInstant) => {
		for (const instant of instantsAround(isoInstant)) {
			expect(localHourOf(instant, timeZone), instant.toISOString()).toBe(
				wallClockIn(instant, timeZone).hour,
			);
		}
	});
});

describe("businessDayStartOf", () => {
	const clock = { timeZone: "Europe/Berlin", businessDayStartMinutes: 300 };

	it("equals the core rule across a daylight-saving change", () => {
		for (const date of ["2026-03-28", "2026-03-29", "2026-03-30"]) {
			expect(businessDayStartOf(date, clock).getTime()).toBe(
				businessDayStart(
					date,
					clock.timeZone,
					clock.businessDayStartMinutes,
				).getTime(),
			);
		}
	});

	it("returns a fresh date that callers may change", () => {
		const first = businessDayStartOf("2026-11-04", clock);
		first.setTime(0);
		expect(businessDayStartOf("2026-11-04", clock).getTime()).not.toBe(0);
	});
});
