import {
	moveRangeToLimit,
	rangeOfPreset,
	revenueTheme,
	shiftsTheme,
	stepRange,
} from "@fnb/reports";
import { describe, expect, it } from "vitest";
import { parseThemeSearch, themeHref } from "./theme-route";

const AS_OF = "2026-11-03";
const STORES = ["S1", "S2"];

function parse(search: string, preferred: "7d" | "91d" | null = null) {
	return parseThemeSearch(
		revenueTheme,
		new URLSearchParams(search),
		AS_OF,
		STORES,
		preferred,
	);
}

describe("the thematic report's address", () => {
	it("keeps a preset as it is and opens the theme's default without one", () => {
		const preset = parse("range=91d");
		expect(preset.resolved.range).toEqual(rangeOfPreset("91d", AS_OF));
		expect(preset.canonical).toBe("range=91d");
		expect(preset.normalised).toBe(false);
		const bare = parse("");
		expect(bare.resolved.range.preset).toBe(revenueTheme.defaultPreset);
		expect(bare.canonical).toBe("range=28d");
		expect(bare.normalised).toBe(true);
	});

	it("opens the device's last preset when the address names no range", () => {
		expect(parse("", "7d").canonical).toBe("range=7d");
		expect(parse("range=91d", "7d").canonical).toBe("range=91d");
	});

	it("writes two dates that make a preset as that preset, and keeps other dates", () => {
		const asPreset = parse("from=2026-10-07&to=2026-11-03");
		expect(asPreset.canonical).toBe("range=28d");
		expect(asPreset.normalised).toBe(true);
		const custom = parse("from=2026-10-08&to=2026-11-01");
		expect(custom.canonical).toBe("from=2026-10-08&to=2026-11-01");
		expect(custom.normalised).toBe(false);
		expect(custom.resolved.range.days).toBe(25);
	});

	it("shortens a range longer than the theme allows and moves an end past the as-of day back", () => {
		const long = parse("from=2025-01-01&to=2026-11-03");
		expect(long.resolved.rangeClamped).toBe(true);
		expect(long.resolved.range.days).toBe(revenueTheme.maxRangeDays);
		expect(long.resolved.range.to).toBe(AS_OF);
		const future = parse("from=2026-10-20&to=2026-11-20");
		expect(future.resolved.todayClamped).toBe(true);
		expect(future.resolved.range.to).toBe(AS_OF);
		expect(future.canonical).toBe("from=2026-10-20&to=2026-11-03");
	});

	it("opens the default for a range it cannot read and says so", () => {
		for (const search of [
			"range=12d",
			"from=2026-11-05&to=2026-11-01",
			"from=2026-10-01",
			"from=2022-12-01&to=2023-01-10",
		]) {
			const parsed = parse(search);
			expect(parsed.resolved.invalid, search).toBe(true);
			expect(parsed.canonical, search).toBe("range=28d");
		}
	});

	it("keeps a subset of the stores and drops a selection of every store or none", () => {
		expect(parse("range=28d&store=S2").canonical).toBe("range=28d&store=S2");
		expect(parse("range=28d&store=S2").storeIds).toEqual(["S2"]);
		expect(parse("range=28d&store=S1,S2").canonical).toBe("range=28d");
		expect(parse("range=28d&store=S9").canonical).toBe("range=28d");
		expect(parse("range=28d&store=S9").normalised).toBe(true);
	});

	it("builds a theme link with the range and the stores", () => {
		expect(themeHref("gio-ngay", rangeOfPreset("7d", AS_OF), ["S1"])).toBe(
			"/chu-de/gio-ngay?range=7d&store=S1",
		);
		expect(
			themeHref(
				"thanh-toan",
				parse("from=2026-10-08&to=2026-11-01").resolved.range,
				null,
			),
		).toBe("/chu-de/thanh-toan?from=2026-10-08&to=2026-11-01");
	});

	it("shortens every range of Ca & két tiền to its 92 days, from a preset, dates or another theme's range, and steps by 92 days", () => {
		const parseShifts = (search: string) =>
			parseThemeSearch(shiftsTheme, new URLSearchParams(search), AS_OF, STORES);
		expect(shiftsTheme.maxRangeDays).toBe(92);
		expect(parseShifts("").canonical).toBe("range=28d");
		expect(parseShifts("range=91d").resolved.rangeClamped).toBe(false);
		for (const search of [
			"range=364d",
			"range=this_year",
			"from=2026-01-01&to=2026-11-03",
		]) {
			const parsed = parseShifts(search);
			expect(parsed.resolved.rangeClamped, search).toBe(true);
			expect(parsed.resolved.range.days, search).toBe(92);
			expect(parsed.resolved.range.to, search).toBe(AS_OF);
			expect(parsed.canonical, search).toBe("from=2026-08-04&to=2026-11-03");
		}
		const clamped = parseShifts("range=364d").resolved.range;
		const earlier = stepRange(clamped, -1);
		expect(earlier.days).toBe(92);
		expect(earlier.to).toBe("2026-08-03");
		const year = rangeOfPreset("364d", AS_OF);
		expect(
			themeHref(
				"ca-ket-tien",
				moveRangeToLimit(year, shiftsTheme.maxRangeDays),
				null,
			),
		).toBe("/chu-de/ca-ket-tien?from=2026-08-04&to=2026-11-03");
	});
});
