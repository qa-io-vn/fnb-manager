import {
	type AnalyticsArgs,
	type AnalyticsFunctionName,
	type ReportCallSpec,
	type ReportSource,
	reportCall,
	reportCallIdentity,
	type ThemeArgs,
	type ThemeFunctionName,
} from "@fnb/reports";
import {
	calendarOf,
	KPI_WINDOWS,
	kpiWindowsOf,
	type PackCalendar,
} from "./calendar.js";
import { compareCodeUnits } from "./canonical.js";
import { type PackScope, packScopes } from "./coverage.js";
import { trackableMetricIds } from "./kpi-ids.js";
import type { ResolvedPackRequest } from "./request.js";

export type PackCallSpec = ReportCallSpec;

export const CALL_KEYS = {
	profiles: "profiles",
	coverage: "coverage",
	settings: "settings",
	weekly: "weekly",
	monthly: "monthly",
	weekday: "weekday",
	shifts: "shifts",
	holidays: "holidays",
} as const;

export const SCOPED_CALLS = [
	"kpi",
	"month_to_date",
	"heatmap",
	"hours",
	"items",
	"margins",
	"pairs",
	"modifiers",
	"payments",
	"promotions",
] as const;

export type ScopedCall = (typeof SCOPED_CALLS)[number];

export const BROWSER_CONCURRENCY = 4;
export const SNAPSHOT_CONCURRENCY = 1;

export function scopedKey(kind: ScopedCall, scope: PackScope): string {
	return `${kind}/${scope.label}`;
}

export function profilesCall(
	storeIds: readonly string[],
): ReportCallSpec<"store_profiles"> {
	return reportCall(CALL_KEYS.profiles, "store_profiles", {
		store_ids: [...storeIds].sort(compareCodeUnits),
	});
}

function scopedCalls(
	scope: PackScope,
	request: ResolvedPackRequest,
	calendar: PackCalendar,
): readonly PackCallSpec[] {
	const kpi = kpiWindowsOf(request.asOf);
	const ids = [...scope.storeIds];
	const { w28, p28, w84, month_to_date: monthToDate } = calendar;
	const range = (from: string, to: string) => ({
		store_ids: [...ids],
		from_date: from,
		to_date: to,
	});
	const compared = {
		...range(w28.from, w28.to),
		compare_from: p28.from,
		compare_to: p28.to,
	};
	return [
		reportCall(scopedKey("kpi", scope), "metric_windows", {
			store_ids: [...ids],
			metric_ids: [...trackableMetricIds()],
			from_dates: KPI_WINDOWS.map((window) => kpi[window].from),
			to_dates: KPI_WINDOWS.map((window) => kpi[window].to),
		}),
		reportCall(scopedKey("month_to_date", scope), "month_pace", {
			store_ids: [...ids],
			month_start: monthToDate.from,
			as_of: monthToDate.to,
		}),
		reportCall(
			scopedKey("heatmap", scope),
			"hour_weekday_heatmap",
			range(w84.from, w84.to),
		),
		reportCall(
			scopedKey("hours", scope),
			"hour_profile",
			range(w84.from, w84.to),
		),
		reportCall(scopedKey("items", scope), "item_summary", compared),
		reportCall(
			scopedKey("margins", scope),
			"item_margins",
			range(w28.from, w28.to),
		),
		reportCall(
			scopedKey("pairs", scope),
			"basket_pairs",
			range(w28.from, w28.to),
		),
		reportCall(scopedKey("modifiers", scope), "modifier_summary", compared),
		reportCall(scopedKey("payments", scope), "payment_summary", compared),
		reportCall(
			scopedKey("promotions", scope),
			"promotion_summary",
			range(w28.from, w28.to),
		),
	];
}

export function packCalls(
	request: ResolvedPackRequest,
): readonly PackCallSpec[] {
	const calendar = calendarOf(request.asOf, request.horizon);
	const ids = request.stores.map((store) => store.id);
	const includeStores = ids.length > 1;
	const series = (
		grain: "week" | "month" | "weekday",
		from: string,
		to: string,
	) => ({
		store_ids: [...ids],
		grain,
		from_date: from,
		to_date: to,
		include_stores: includeStores,
	});
	const { weeks, months, w84, w28, horizon, ly28 } = calendar;
	return [
		profilesCall(ids),
		reportCall(CALL_KEYS.coverage, "store_coverage", {
			store_ids: [...ids],
			from_date: ly28.from,
			to_date: request.asOf,
		}),
		reportCall(CALL_KEYS.settings, "report_settings_of", {
			store_ids: [...ids],
		}),
		reportCall(
			CALL_KEYS.weekly,
			"period_series",
			series("week", weeks.from, weeks.to),
		),
		reportCall(
			CALL_KEYS.monthly,
			"period_series",
			series("month", months.from, months.to),
		),
		reportCall(
			CALL_KEYS.weekday,
			"period_series",
			series("weekday", w84.from, w84.to),
		),
		reportCall(CALL_KEYS.shifts, "shift_review", {
			store_ids: [...ids],
			from_date: w28.from,
			to_date: w28.to,
		}),
		reportCall(CALL_KEYS.holidays, "holiday_calendar", {
			store_ids: [...ids],
			from_date: horizon.from,
			to_date: horizon.to,
		}),
		...packScopes(request.stores).flatMap((scope) =>
			scopedCalls(scope, request, calendar),
		),
	];
}

export function distinctCallCount(calls: readonly PackCallSpec[]): number {
	return new Set(calls.map((spec) => reportCallIdentity(spec))).size;
}

export function limitedReportSource(
	source: ReportSource,
	limit: number,
	onSettled: () => void = () => {},
): ReportSource {
	let active = 0;
	const waiting: (() => void)[] = [];
	async function acquire(): Promise<void> {
		if (active < limit) {
			active += 1;
			return;
		}
		await new Promise<void>((resolve) => waiting.push(resolve));
	}
	function release(): void {
		const next = waiting.shift();
		if (next === undefined) active -= 1;
		else next();
	}
	async function run<Result>(task: () => Promise<Result>): Promise<Result> {
		await acquire();
		try {
			return await task();
		} finally {
			release();
			onSettled();
		}
	}
	return {
		kind: source.kind,
		call<N extends AnalyticsFunctionName>(name: N, args: AnalyticsArgs<N>) {
			return run(() => source.call(name, args));
		},
		callTheme<N extends ThemeFunctionName>(name: N, args: ThemeArgs<N>) {
			return run(() => source.callTheme(name, args));
		},
	};
}
