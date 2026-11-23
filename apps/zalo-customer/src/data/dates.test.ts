// ADR-047 in the Mini App's own date helpers (the demo world decides with them):
// a credit is valid through the local date of its issue plus the programme's
// months and ends at the local midnight closing that day. Boundary value
// analysis on month ends, 29 February and the hours of a sale.
import { describe, expect, it } from "vitest";
import { addMonths, creditEnd, localMidnight, shownDate } from "./dates";

const at = (local: string) => Date.parse(`${local}:00+07:00`);

describe("addMonths (as PostgreSQL adds months to a date)", () => {
	it.each([
		{ from: "2026-08-31", months: 6, to: "2027-02-28" },
		{ from: "2027-08-31", months: 6, to: "2028-02-29" },
		{ from: "2028-02-29", months: 12, to: "2029-02-28" },
		{ from: "2026-01-31", months: 1, to: "2026-02-28" },
		{ from: "2026-12-15", months: 1, to: "2027-01-15" },
		{ from: "2026-11-19", months: 12, to: "2027-11-19" },
	])("$from + $months months is $to", ({ from, months, to }) => {
		expect(addMonths(from, months)).toBe(to);
	});
});

describe("creditEnd: valid through the anniversary day, ending at the midnight that closes it", () => {
	it.each([
		{
			issued: "2026-11-19T02:00",
			months: 12,
			through: "2027-11-19",
			ends: "2027-11-20T00:00",
		},
		{
			issued: "2026-11-19T23:30",
			months: 12,
			through: "2027-11-19",
			ends: "2027-11-20T00:00",
		},
		{
			issued: "2026-11-20T00:30",
			months: 12,
			through: "2027-11-20",
			ends: "2027-11-21T00:00",
		},
		{
			issued: "2026-08-31T12:00",
			months: 6,
			through: "2027-02-28",
			ends: "2027-03-01T00:00",
		},
	])(
		"a credit of $issued is valid through $through",
		({ issued, months, through, ends }) => {
			const end = creditEnd(at(issued), months);
			expect(end).toEqual({ validThrough: through, expiresAt: at(ends) });
			expect(shownDate(end.validThrough)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
		},
	);

	it("the local midnight of a date in the shop's time zone", () => {
		expect(localMidnight("2027-11-20")).toBe(
			Date.parse("2027-11-19T17:00:00Z"),
		);
		expect(localMidnight("2027-11-20", "UTC")).toBe(
			Date.parse("2027-11-20T00:00:00Z"),
		);
		expect(localMidnight("2027-01-10", "America/New_York")).toBe(
			Date.parse("2027-01-10T05:00:00Z"),
		);
	});
});
