import { describe, expect, it } from "vitest";
import {
	isEagerSource,
	isLazySource,
	lazySources,
	unmatchedLazySources,
} from "../../scripts/lazy-chunks.mjs";

const manifestKeys = [
	"index.html",
	"src/components/report-card/echarts-view.tsx",
	"src/demo/demo-row-source.ts",
	"src/demo/demo-analytics-source.ts",
	"src/pages/reports/day/day-page.tsx",
	"src/pages/reports/week/week-page.tsx",
	"src/pages/reports/month/month-page.tsx",
	"src/pages/reports/year/year-page.tsx",
	"src/pages/themes/doanh-thu/doanh-thu-page.tsx",
	"src/pages/themes/gio-ngay/gio-ngay-page.tsx",
	"src/data/supabase-analytics-source.ts",
];

describe("the size check's lazy chunks", () => {
	it("needs every pattern to match at least one manifest key, however many it matches", () => {
		expect(unmatchedLazySources(manifestKeys)).toEqual([]);
		expect(
			manifestKeys.filter((key) => isLazySource(key)).length,
		).toBeGreaterThan(lazySources.length);
	});

	it("reports the pattern whose chunk went missing", () => {
		const withoutReports = manifestKeys.filter(
			(key) => !key.startsWith("src/pages/reports/"),
		);
		expect(unmatchedLazySources(withoutReports).map(String)).toEqual([
			String(lazySources[3]),
		]);
	});

	it("counts the live analytics source as lazy, since only report pages load it", () => {
		expect(isLazySource("src/data/supabase-analytics-source.ts")).toBe(true);
		expect(isEagerSource("src/data/supabase-analytics-source.ts")).toBe(false);
		expect(isEagerSource("src/demo/demo-analytics-source.ts")).toBe(false);
		expect(isLazySource("src/pages/reports/day/day-page.tsx")).toBe(true);
		expect(isLazySource("src/pages/reports/day/cards.tsx")).toBe(false);
		expect(isLazySource("src/pages/themes/gio-ngay/gio-ngay-page.tsx")).toBe(
			true,
		);
		expect(isLazySource("src/themes/theme-page.tsx")).toBe(false);
	});
});
