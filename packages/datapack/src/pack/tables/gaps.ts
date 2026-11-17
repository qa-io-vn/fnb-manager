import { metrics } from "@fnb/metrics";
import type { NoticeAction } from "@fnb/reports";
import { CALL_KEYS } from "../calls.js";
import type { PackScope } from "../coverage.js";
import { trackableMetricIds } from "../kpi-ids.js";
import { ALL_SCOPE, type PackTable } from "../schema.js";
import { scopeMargins } from "./items.js";
import { kpiValues } from "./kpi.js";
import { monthTarget } from "./month-to-date.js";
import {
	columns,
	type PackRows,
	packRow,
	packTable,
	type SettingsRow,
	scopeByLabel,
	scopeOfStoreLabel,
	type TableContext,
	type TableSpec,
} from "./support.js";

export const GAP_SEVERITIES = ["high", "medium", "low"] as const;
export type GapSeverity = (typeof GAP_SEVERITIES)[number];

export interface PackGapSpec {
	readonly severity: GapSeverity;
	readonly setting: NoticeAction | null;
}

export const PACK_GAPS = {
	opening_hours: { severity: "medium", setting: "settings_store" },
	seat_count: { severity: "low", setting: "settings_store" },
	item_roles: { severity: "medium", setting: "settings_roles" },
	item_costs: { severity: "medium", setting: "settings_costs" },
	partial_costs: { severity: "low", setting: "settings_costs" },
	fee_rates: { severity: "low", setting: "settings_fees" },
	target: { severity: "low", setting: "settings_targets" },
	young_store: { severity: "medium", setting: null },
	short_history: { severity: "low", setting: null },
	partial_scope_window: { severity: "medium", setting: null },
	unreconciled_days: { severity: "high", setting: null },
	stale_aggregates: { severity: "medium", setting: null },
	no_customer_identity: { severity: "low", setting: null },
	unmeasured_kpi: { severity: "medium", setting: null },
	staff_hours: { severity: "low", setting: null },
} as const satisfies Readonly<Record<string, PackGapSpec>>;

export type PackGapCode = keyof typeof PACK_GAPS;

export const PACK_GAP_CODES = Object.keys(PACK_GAPS) as readonly PackGapCode[];

export interface PackGap {
	readonly code: PackGapCode;
	readonly scope: string;
	readonly value: number | null;
}

export const GAPS_SPEC: TableSpec = {
	grain: "gap",
	window: null,
	columns: columns([
		["value", "count"],
		["severity", "class"],
		["setting", "class"],
	]),
};

const CUSTOMER_IDENTITY = "customer identity";

export function customerIdentityMetricCount(): number {
	return metrics.filter((metric) => metric.status.includes(CUSTOMER_IDENTITY))
		.length;
}

function storeGaps(
	context: TableContext,
	settings: readonly SettingsRow[],
): PackGap[] {
	const gaps: PackGap[] = [];
	const coverageRows = context.results.rows(
		CALL_KEYS.coverage,
		"store_coverage",
	);
	const { w28, ly28 } = context.windows;
	for (const profile of context.profiles) {
		const scope = profile.label;
		const add = (code: PackGapCode, value: number | null = null) =>
			gaps.push({ code, scope, value });
		const setting = settings.find((row) => row.store_id === profile.store_id);
		if (setting?.opening_hours_known !== true) add("opening_hours");
		if ((setting?.seat_count ?? null) === null) add("seat_count");
		if (setting?.roles_configured !== true) add("item_roles");
		if (setting?.costs_configured !== true) add("item_costs");
		if (setting?.fee_rates_configured !== true) add("fee_rates");
		const own = scopeByLabel(context, scopeOfStoreLabel(context, scope));
		if (own !== undefined && monthTarget(context, own) === null) add("target");
		const start = context.coverage.historyStart(profile.store_id);
		const days = context.coverage.historyDays(profile.store_id);
		if (start === null || start > w28.from) add("young_store", days);
		else if (start > ly28.from) add("short_history", days);
		const coverage = coverageRows.find(
			(row) => row.store_id === profile.store_id,
		);
		const unreconciled =
			(coverage?.unmatched_days ?? 0) + (coverage?.unchecked_sales_days ?? 0);
		if (unreconciled > 0) add("unreconciled_days", unreconciled);
		if ((coverage?.stale_days ?? 0) > 0) {
			add("stale_aggregates", coverage?.stale_days ?? null);
		}
	}
	return gaps;
}

function partialCosts(
	context: TableContext,
	scope: PackScope,
	settings: readonly SettingsRow[],
): number {
	const costed = scope.storeIds.some(
		(id) =>
			settings.find((row) => row.store_id === id)?.costs_configured === true,
	);
	if (!costed) return 0;
	return scopeMargins(context, scope).filter(
		(row) =>
			row.net_amount !== 0 &&
			(row.cost_coverage === null || row.cost_coverage < 1),
	).length;
}

function scopeGaps(
	context: TableContext,
	settings: readonly SettingsRow[],
): PackGap[] {
	const gaps: PackGap[] = [];
	for (const scope of context.scopes) {
		const add = (code: PackGapCode, value: number) =>
			gaps.push({ code, scope: scope.label, value });
		const uncosted = partialCosts(context, scope, settings);
		if (uncosted > 0) add("partial_costs", uncosted);
		if (scope.storeIds.length > 1) {
			const nulled = context.coverage.nulledWindows(scope).length;
			if (nulled > 0) add("partial_scope_window", nulled);
		}
		if (context.coverage.counts(scope, "w28")) {
			const value = kpiValues(context, scope);
			const unmeasured = trackableMetricIds().filter(
				(id) => value("w28", id) === null,
			).length;
			if (unmeasured > 0) add("unmeasured_kpi", unmeasured);
		}
	}
	return gaps;
}

export function packGaps(context: TableContext): readonly PackGap[] {
	const settings = context.results.rows(
		CALL_KEYS.settings,
		"report_settings_of",
	);
	const gaps = [
		...storeGaps(context, settings),
		...scopeGaps(context, settings),
	];
	const identity = customerIdentityMetricCount();
	if (identity > 0) {
		gaps.push({
			code: "no_customer_identity",
			scope: ALL_SCOPE,
			value: identity,
		});
	}
	gaps.push({ code: "staff_hours", scope: ALL_SCOPE, value: null });
	return gaps;
}

export function gapsTable(context: TableContext): PackTable {
	const rows: PackRows = {};
	for (const gap of packGaps(context)) {
		const spec: PackGapSpec = PACK_GAPS[gap.code];
		rows[`${gap.code}/${gap.scope}`] = packRow(
			GAPS_SPEC,
			[gap.value, spec.severity, spec.setting],
			context.request.currency,
		);
	}
	return packTable("gaps", context, GAPS_SPEC, rows);
}
