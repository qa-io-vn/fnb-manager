import { describe, expect, it } from "vitest";
import { hoursTheme } from "../../../../src/themes/hours/definition.js";
import {
	hoursCalls,
	hoursFollowUpCalls,
	hoursPrimaryCalls,
} from "../../../../src/themes/hours/support.js";
import { STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";

describe("the Giờ & ngày calls", () => {
	it("asks for coverage, the heat cells, both hour profiles, both productivity blocks and the settings", () => {
		const stores = [STORE_A, STORE_B];
		const range = { from_date: "2026-10-10", to_date: "2026-11-06" };
		const previous = { from_date: "2026-09-12", to_date: "2026-10-09" };
		expect(hoursPrimaryCalls(themeContext("28d", stores))).toEqual([
			{
				key: hoursCalls.coverage,
				name: "store_coverage",
				args: { store_ids: stores, ...range },
			},
			{
				key: hoursCalls.heat,
				name: "hour_weekday_heatmap",
				args: { store_ids: stores, ...range },
			},
			{
				key: hoursCalls.hours,
				name: "hour_profile",
				args: { store_ids: stores, ...range },
			},
			{
				key: hoursCalls.hoursPrevious,
				name: "hour_profile",
				args: { store_ids: stores, ...previous },
			},
			{
				key: hoursCalls.productivity,
				name: "opening_productivity",
				args: { store_ids: stores, ...range },
			},
			{
				key: hoursCalls.productivityPrevious,
				name: "opening_productivity",
				args: { store_ids: stores, ...previous },
			},
			{
				key: hoursCalls.settings,
				name: "report_settings_of",
				args: { store_ids: stores },
			},
		]);
	});

	it("plans no follow-up calls", () => {
		expect(hoursFollowUpCalls()).toEqual([]);
	});
});

describe("the Giờ & ngày definition", () => {
	it("defaults to 28 days, allows 400 and orders its five cards", () => {
		expect(hoursTheme.kind).toBe("hours");
		expect(hoursTheme.slug).toBe("gio-ngay");
		expect(hoursTheme.defaultPreset).toBe("28d");
		expect(hoursTheme.maxRangeDays).toBe(400);
		expect(hoursTheme.cards.map((card) => card.id)).toEqual([
			"heatmap",
			"peak_dead",
			"weekday",
			"productivity",
			"shift_windows",
		]);
	});
});
