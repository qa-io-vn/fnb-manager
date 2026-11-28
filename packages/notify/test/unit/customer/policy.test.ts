// The weekly cap of promotional Zalo messages (GA-065, ADR-073) as the TypeScript statement of
// app.customer_cap_release. Techniques: boundary values of the rolling window (7 days less 1 ms, exactly 7 days, a
// message sent at the very instant) and of the cap (no cap, 1, 2); equivalence partitions of the messages counted (in
// the window, before it, after the instant asked); a decision table of the floor (class × channel × allowed × cap); and
// the SQL's text, so a change on one side fails here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	CUSTOMER_HOLD_REASONS,
	effectiveWeeklyCap,
	PROMOTION_WEEKLY_CAP,
	WEEK_MS,
	type WeeklyCapRow,
	weeklyCapRelease,
	weeklyFloorHolds,
} from "../../../src/index.js";

const S1 = new Date("2026-11-20T03:00:00Z");
const S2 = new Date("2026-11-22T03:00:00Z");
const plus = (date: Date, ms: number) => new Date(date.getTime() + ms);

describe("the rolling week", () => {
	it("holds a third promotion until the first is exactly 7 days old", () => {
		expect(weeklyCapRelease([S1, S2], plus(S1, WEEK_MS - 1), 2)).toEqual(
			plus(S1, WEEK_MS),
		);
	});

	it("lets it go at exactly 7 days and after", () => {
		expect(weeklyCapRelease([S1, S2], plus(S1, WEEK_MS), 2)).toBeNull();
		expect(weeklyCapRelease([S1, S2], plus(S1, WEEK_MS + 1), 2)).toBeNull();
	});

	it("counts a message sent at the very instant asked, and none sent after it", () => {
		expect(weeklyCapRelease([S1, S2], S2, 2)).toEqual(plus(S1, WEEK_MS));
		expect(weeklyCapRelease([S1, S2], plus(S2, -1), 2)).toBeNull();
	});

	it("releases at the message that keeps the count at the cap, whatever the order given", () => {
		expect(weeklyCapRelease([S2, S1], plus(S2, 1), 1)).toEqual(
			plus(S2, WEEK_MS),
		);
		expect(
			weeklyCapRelease([S2, S1, plus(S2, 1000)], plus(S2, 2000), 2),
		).toEqual(plus(S2, WEEK_MS));
	});

	it("holds nothing without a cap or below it", () => {
		expect(weeklyCapRelease([S1, S2], plus(S2, 1), null)).toBeNull();
		expect(weeklyCapRelease([], S1, 2)).toBeNull();
		expect(weeklyCapRelease([S1], plus(S1, 1), 2)).toBeNull();
	});

	it("refuses a cap below 1 or not whole", () => {
		expect(() => weeklyCapRelease([S1], S1, 0)).toThrow(RangeError);
		expect(() => weeklyCapRelease([S1], S1, 1.5)).toThrow(RangeError);
	});

	it("names weekly_cap among the hold reasons and promises 2", () => {
		expect(CUSTOMER_HOLD_REASONS).toContain("weekly_cap");
		expect(PROMOTION_WEEKLY_CAP).toBe(2);
		expect(WEEK_MS).toBe(604_800_000);
	});
});

describe("the floor of a policy row", () => {
	const row = (overrides: Partial<WeeklyCapRow>): WeeklyCapRow => ({
		channelKind: "zalo_zbs",
		messageClass: "advertising",
		allowed: true,
		maxPerWeek: 2,
		...overrides,
	});

	it.each([
		[row({ maxPerWeek: 1 }), true],
		[row({ maxPerWeek: 2 }), true],
		[row({ maxPerWeek: 3 }), false],
		[row({ maxPerWeek: null }), true],
		[row({ channelKind: "zalo_oa", maxPerWeek: 3 }), false],
		[row({ allowed: false, maxPerWeek: 50 }), true],
		[row({ channelKind: "email", maxPerWeek: 50 }), true],
		[row({ messageClass: "transactional", maxPerWeek: null }), true],
	])("decides %o as %s", (given, holds) => {
		expect(weeklyFloorHolds(given)).toBe(holds);
	});

	it("gives a Zalo promotion row without a number the promised 2, and nothing else one", () => {
		expect(effectiveWeeklyCap(row({ maxPerWeek: null }))).toBe(2);
		expect(
			effectiveWeeklyCap(row({ channelKind: "zalo_oa", maxPerWeek: null })),
		).toBe(2);
		expect(
			effectiveWeeklyCap(row({ channelKind: "email", maxPerWeek: null })),
		).toBeNull();
		expect(
			effectiveWeeklyCap(
				row({ messageClass: "transactional", maxPerWeek: null }),
			),
		).toBeNull();
	});
});

describe("the SQL it states", () => {
	const migration = readFileSync(
		new URL(
			"../../../../../supabase/migrations/20261129000000_weekly_promotion_cap.sql",
			import.meta.url,
		),
		"utf8",
	).replace(/\r\n/g, "\n");

	it("counts a rolling 7 days, strictly after the start, and releases 7 days after the keeping message", () => {
		expect(migration).toContain("period_start := p_at - interval '7 days';");
		expect(migration).toContain(
			"and coalesce(o.sent_at, o.claimed_at) > period_start;",
		);
		expect(migration).toContain(
			"select coalesce(o.sent_at, o.claimed_at) + interval '7 days' into release_instant",
		);
		expect(migration).toContain("offset counted - p_policy.max_per_week");
		expect(migration).toContain("'weekly_cap'::text");
	});

	it("binds Zalo promotion rows to 1 or 2 and fills in 2", () => {
		expect(migration).toContain(
			"or coalesce(max_per_week between 1 and 2, false)",
		);
		expect(migration).toContain("new.max_per_week := 2;");
		expect(migration).toContain("channel_kind not in ('zalo_oa', 'zalo_zbs')");
	});
});
