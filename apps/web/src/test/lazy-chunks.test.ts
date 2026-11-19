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
	"src/pages/settings/settings-route.tsx",
	"src/pages/settings/bao-cao-page.tsx",
	"src/settings/supabase-settings-source.ts",
	"src/settings/demo-settings-source.ts",
	"src/pages/exports/exports-page.tsx",
	"src/datapack/browser-pack.ts",
	"src/pages/plans/paste-page.tsx",
	"src/pages/operations/checklist-compliance-page.tsx",
	"src/operations/supabase-operations-source.ts",
	"src/pages/loyalty/members-page.tsx",
	"src/loyalty/supabase-loyalty-source.ts",
	"src/loyalty/demo-loyalty-source.ts",
	"src/settings/rewards/supabase-rewards-source.ts",
	"src/settings/rewards/demo-rewards-source.ts",
	"../../node_modules/.pnpm/fflate@0.8.3/node_modules/fflate/esm/browser.js",
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
		expect(isLazySource("src/pages/settings/settings-route.tsx")).toBe(true);
		expect(isLazySource("src/settings/supabase-settings-source.ts")).toBe(true);
		expect(isLazySource("src/settings/access.ts")).toBe(false);
		expect(isLazySource("src/pages/settings/bao-cao-page.tsx")).toBe(true);
		expect(isLazySource("src/settings/thresholds/thresholds-form.tsx")).toBe(
			false,
		);
	});

	it("keeps the export page and the archive library out of the initial JS", () => {
		expect(isLazySource("src/pages/exports/exports-page.tsx")).toBe(true);
		expect(isLazySource("src/exports/run.ts")).toBe(false);
		expect(
			isLazySource(
				"../../node_modules/.pnpm/fflate@0.8.3/node_modules/fflate/esm/browser.js",
			),
		).toBe(true);
		expect(isLazySource("node_modules/fflate/esm/browser.js")).toBe(true);
		expect(isEagerSource("src/pages/exports/exports-page.tsx")).toBe(false);
	});

	it("loads the pack builder and its prompt only when a pack is built", () => {
		expect(isLazySource("src/datapack/browser-pack.ts")).toBe(true);
		expect(isLazySource("src/datapack/pack-cache.ts")).toBe(false);
		expect(isLazySource("src/pages/exports/pack-tab.tsx")).toBe(false);
		expect(isEagerSource("src/datapack/browser-pack.ts")).toBe(false);
	});

	it("loads the plan paste box and its lint only when the page is opened", () => {
		expect(isLazySource("src/pages/plans/paste-page.tsx")).toBe(true);
		expect(isLazySource("src/plans/paste-check.ts")).toBe(false);
		expect(isLazySource("src/pages/plans/plans-page.tsx")).toBe(false);
		expect(isEagerSource("src/pages/plans/paste-page.tsx")).toBe(false);
	});
});

describe("the operations pages' chunks", () => {
	it("keeps the four operations pages and the live operations source out of the initial JS", () => {
		for (const page of [
			"checklist-compliance-page",
			"cash-counts-page",
			"incident-log-page",
			"announcements-page",
		]) {
			expect(isLazySource(`src/pages/operations/${page}.tsx`)).toBe(true);
		}
		expect(isLazySource("src/pages/operations/operations-layout.tsx")).toBe(
			false,
		);
		expect(isLazySource("src/operations/supabase-operations-source.ts")).toBe(
			true,
		);
		expect(isLazySource("src/pages/settings/checklist-page.tsx")).toBe(true);
	});
});

describe("the loyalty pages' chunks", () => {
	it("keeps the customer pages, the loyalty sources and the loyalty settings page out of the initial JS", () => {
		for (const page of [
			"members-page",
			"member-page",
			"queue-page",
			"anomalies-page",
		]) {
			expect(isLazySource(`src/pages/loyalty/${page}.tsx`)).toBe(true);
		}
		expect(isLazySource("src/pages/loyalty/customers-layout.tsx")).toBe(false);
		expect(isLazySource("src/loyalty/supabase-loyalty-source.ts")).toBe(true);
		expect(isLazySource("src/loyalty/demo-loyalty-source.ts")).toBe(true);
		expect(isLazySource("src/loyalty/models.ts")).toBe(false);
		expect(
			isLazySource("src/pages/settings/khach-hang-than-thiet-page.tsx"),
		).toBe(true);
	});
});
