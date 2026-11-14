import {
	type HourLevel,
	type HourScope,
	isoWeekday,
	type ThemeRow,
} from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { count, money, PgDecimal, roundedRatio } from "../pg-numeric.js";
import { hourlySales } from "./support.js";
import {
	requireBetween,
	requireThemeDateRange,
	requireThemeStoreIds,
	type ThemeHandlerArgs,
	type ThemeHandlerContext,
} from "./theme-support.js";

type Row = ThemeRow<"hour_profile">;

export const HOUR_PROFILE_MAX_DAYS = 400;

type HourScopeName = Exclude<HourScope, "weekday">;

const HOUR_SCOPES: readonly HourScopeName[] = ["all", "weekdays", "weekend"];

interface HourlyPoint {
	readonly date: string;
	readonly weekday: number;
	readonly hour: number;
	readonly invoices: number;
	readonly netMinor: number;
}

interface Sums {
	invoices: number;
	netMinor: number;
}

interface SpanHour {
	readonly slot: number;
	readonly hour: number;
	readonly invoices: number;
	readonly netMinor: number;
}

interface Thresholds {
	readonly peakHours: number;
	readonly deadRatio: number;
	readonly busyRatio: number;
}

function inScope(scope: HourScopeName, weekday: number): boolean {
	switch (scope) {
		case "all":
			return true;
		case "weekdays":
			return weekday <= 5;
		case "weekend":
			return weekday >= 6;
	}
}

function ratio(value: number): PgDecimal {
	return PgDecimal.parse(String(value));
}

function levelOf(
	scope: HourScopeName,
	hour: SpanHour,
	rank: number,
	span: {
		readonly count: number;
		readonly invoices: number;
		readonly netMinor: number;
	},
	thresholds: Thresholds,
): HourLevel {
	const spanCount = count(span.count);
	if (scope === "all") {
		if (hour.netMinor > 0 && rank <= thresholds.peakHours) return "peak";
		const scaled = money(hour.netMinor).mul(spanCount);
		const limit = ratio(thresholds.deadRatio).mul(money(span.netMinor));
		return scaled.compare(limit) < 0 ? "dead" : "normal";
	}
	const scaled = count(hour.invoices).mul(spanCount);
	if (
		hour.invoices > 0 &&
		scaled.compare(ratio(thresholds.busyRatio).mul(count(span.invoices))) >= 0
	) {
		return "busy";
	}
	return scaled.compare(ratio(thresholds.deadRatio).mul(count(span.invoices))) <
		0
		? "quiet"
		: "normal";
}

function sharesOf(numerator: number, denominator: number): number | null {
	return roundedRatio(money(numerator), money(denominator), 6);
}

export function hourProfile(
	store: AggregateStore,
	args: ThemeHandlerArgs<"hour_profile">,
	context: ThemeHandlerContext,
): Row[] {
	requireThemeStoreIds("hour_profile", args.store_ids);
	requireThemeDateRange(
		"hour_profile",
		args.from_date,
		args.to_date,
		HOUR_PROFILE_MAX_DAYS,
	);
	requireBetween("hour_profile", "peak_hours", args.peak_hours, 1, 6);
	requireBetween(
		"hour_profile",
		"dead_hour_ratio",
		args.dead_hour_ratio,
		0.1,
		0.9,
	);
	requireBetween(
		"hour_profile",
		"busy_hour_ratio",
		args.busy_hour_ratio,
		1.05,
		3,
	);
	if (args.store_ids.length === 0) return [];
	const visible = store.visibleStores(args.store_ids);
	const first = visible[0];
	if (first === undefined) return [];
	const settings = context.settings.reportSettings();
	const thresholds: Thresholds = {
		peakHours: args.peak_hours ?? settings.peakHours,
		deadRatio: args.dead_hour_ratio ?? settings.deadHourRatio,
		busyRatio: args.busy_hour_ratio ?? settings.busyHourRatio,
	};
	const startHour = Math.floor(first.businessDayStartMinutes / 60);
	const points: HourlyPoint[] = hourlySales(
		store,
		args.store_ids,
		args.from_date,
		args.to_date,
	).map((row) => ({
		date: row.date,
		weekday: isoWeekday(row.date),
		hour: row.hourly.hour,
		invoices: row.hourly.invoices,
		netMinor: row.hourly.netMinor,
	}));
	const used = {
		peak_hours_used: thresholds.peakHours,
		dead_hour_ratio_used: thresholds.deadRatio,
		busy_hour_ratio_used: thresholds.busyRatio,
	};
	const rows: Row[] = [];
	let allNetMinor: number | null = null;
	for (const scope of HOUR_SCOPES) {
		const scoped = points.filter((point) => inScope(scope, point.weekday));
		if (scoped.length === 0) continue;
		const days = new Set(scoped.map((point) => point.date)).size;
		const totals: Sums = { invoices: 0, netMinor: 0 };
		const bySlot = new Map<number, Sums>();
		for (const point of scoped) {
			totals.invoices += point.invoices;
			totals.netMinor += point.netMinor;
			const slot = (point.hour - startHour + 24) % 24;
			const sums = bySlot.get(slot) ?? { invoices: 0, netMinor: 0 };
			sums.invoices += point.invoices;
			sums.netMinor += point.netMinor;
			bySlot.set(slot, sums);
		}
		if (scope === "all") allNetMinor = totals.netMinor;
		const positive = [...bySlot.entries()]
			.filter(([, sums]) => sums.netMinor > 0)
			.map(([slot]) => slot);
		const span: SpanHour[] = [];
		if (positive.length > 0) {
			const firstSlot = Math.min(...positive);
			const lastSlot = Math.max(...positive);
			for (let slot = firstSlot; slot <= lastSlot; slot += 1) {
				const sums = bySlot.get(slot) ?? { invoices: 0, netMinor: 0 };
				span.push({
					slot,
					hour: (slot + startHour) % 24,
					invoices: sums.invoices,
					netMinor: sums.netMinor,
				});
			}
		}
		const spanTotals = {
			count: span.length,
			invoices: span.reduce((total, hour) => total + hour.invoices, 0),
			netMinor: span.reduce((total, hour) => total + hour.netMinor, 0),
		};
		const ranks = new Map(
			[...span]
				.sort(
					(left, right) =>
						right.netMinor - left.netMinor || left.slot - right.slot,
				)
				.map((hour, index) => [hour.slot, index + 1]),
		);
		let peakMinor = 0;
		let deadMinor = 0;
		for (const hour of span) {
			const level = levelOf(
				scope,
				hour,
				ranks.get(hour.slot) ?? 0,
				spanTotals,
				thresholds,
			);
			if (level === "peak") peakMinor += hour.netMinor;
			if (level === "dead") deadMinor += hour.netMinor;
			rows.push({
				scope,
				weekday: null,
				hour_local: hour.hour,
				hour_position: hour.slot,
				days_with_data: days,
				invoices: hour.invoices,
				net_amount: money(hour.netMinor).toNumber(),
				avg_net_amount: roundedRatio(money(hour.netMinor), count(days), 2),
				avg_invoices: roundedRatio(count(hour.invoices), count(days), 4),
				net_share: sharesOf(hour.netMinor, totals.netMinor),
				level,
				peak_share: null,
				dead_share: null,
				...used,
			});
		}
		rows.push({
			scope,
			weekday: null,
			hour_local: null,
			hour_position: null,
			days_with_data: days,
			invoices: totals.invoices,
			net_amount: money(totals.netMinor).toNumber(),
			avg_net_amount: roundedRatio(money(totals.netMinor), count(days), 2),
			avg_invoices: roundedRatio(count(totals.invoices), count(days), 4),
			net_share: sharesOf(totals.netMinor, totals.netMinor),
			level: null,
			peak_share: scope === "all" ? sharesOf(peakMinor, totals.netMinor) : null,
			dead_share: scope === "all" ? sharesOf(deadMinor, totals.netMinor) : null,
			...used,
		});
	}
	for (let weekday = 1; weekday <= 7; weekday += 1) {
		const ofDay = points.filter((point) => point.weekday === weekday);
		if (ofDay.length === 0) continue;
		const days = new Set(ofDay.map((point) => point.date)).size;
		const invoices = ofDay.reduce((total, point) => total + point.invoices, 0);
		const netMinor = ofDay.reduce((total, point) => total + point.netMinor, 0);
		rows.push({
			scope: "weekday",
			weekday,
			hour_local: null,
			hour_position: null,
			days_with_data: days,
			invoices,
			net_amount: money(netMinor).toNumber(),
			avg_net_amount: roundedRatio(money(netMinor), count(days), 2),
			avg_invoices: roundedRatio(count(invoices), count(days), 4),
			net_share: sharesOf(netMinor, allNetMinor ?? 0),
			level: null,
			peak_share: null,
			dead_share: null,
			...used,
		});
	}
	return rows;
}
