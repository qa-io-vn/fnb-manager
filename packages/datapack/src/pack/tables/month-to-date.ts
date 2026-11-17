import { scopedKey } from "../calls.js";
import type { PackScope } from "../coverage.js";
import type { PackTable } from "../schema.js";
import {
	columns,
	type PackRows,
	packRow,
	packTable,
	ratioOf,
	scopeByLabel,
	type TableContext,
	type TableSpec,
} from "./support.js";

export const MONTH_TO_DATE_SPEC: TableSpec = {
	grain: "store-period",
	window: "month_to_date",
	columns: columns([
		["net", "money"],
		["invoices", "count"],
		["elapsed_days", "days"],
		["remaining_days", "days"],
		["target", "money"],
		["target_share", "fraction"],
		["forecast_profile", "money"],
		["forecast_naive", "money"],
	]),
};

function ownTarget(context: TableContext, scope: PackScope): number | null {
	const [row] = context.results.rows(
		scopedKey("month_to_date", scope),
		"month_pace",
	);
	return row?.target_net_amount ?? null;
}

export function monthTarget(
	context: TableContext,
	scope: PackScope,
): number | null {
	if (scope.storeIds.length > 1) {
		const missing = context.request.stores.some((store) => {
			const own = scopeByLabel(context, store.label);
			return own === undefined || ownTarget(context, own) === null;
		});
		if (missing) return null;
	}
	return ownTarget(context, scope);
}

export function monthToDateTable(context: TableContext): PackTable {
	const rows: PackRows = {};
	for (const scope of context.scopes) {
		const [row] = context.results.rows(
			scopedKey("month_to_date", scope),
			"month_pace",
		);
		if (row === undefined) continue;
		const target = monthTarget(context, scope);
		rows[scope.label] = packRow(
			MONTH_TO_DATE_SPEC,
			[
				row.month_to_date_net_amount,
				row.month_to_date_invoices,
				row.elapsed_days,
				row.remaining_days,
				target,
				ratioOf(row.month_to_date_net_amount, target),
				row.forecast_weekday_profile_net_amount,
				row.forecast_seasonal_naive_net_amount,
			],
			context.request.currency,
		);
	}
	return packTable("month_to_date", context, MONTH_TO_DATE_SPEC, rows);
}
