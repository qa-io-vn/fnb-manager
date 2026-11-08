import type { CanonicalDailyTotal } from "@fnb/core";
import type { LocalDayTotal, SyncCheckRow, TableCounts } from "../rows.js";
import { buildChecks } from "./checks.js";
import { pullControlTotals } from "./pull.js";
import type { StoreScope } from "./store-window-context.js";

export type RecordWrite = (
	planned: TableCounts,
	apply: () => Promise<TableCounts>,
) => Promise<void>;

export async function writeChecks(
	scope: StoreScope,
	dates: readonly string[],
	controlTotals: readonly CanonicalDailyTotal[],
	local: readonly LocalDayTotal[],
	record: RecordWrite,
): Promise<SyncCheckRow[]> {
	const { store, context } = scope;
	const rows = buildChecks(dates, controlTotals, local, {
		tenantId: store.tenant_id,
		storeId: store.id,
		tolerance: context.tolerance,
	});
	if (rows.length > 0) {
		await record({ sync_checks: rows.length }, () =>
			context.repository.upsertChecks(rows),
		);
	}
	return rows;
}

export async function recheckDates(
	scope: StoreScope,
	dates: readonly string[],
	record: RecordWrite,
): Promise<SyncCheckRow[]> {
	const rows: SyncCheckRow[] = [];
	for (const date of dates) {
		const range = { from: date, to: date };
		const totals = await pullControlTotals(scope, {
			fromDate: date,
			toDate: date,
		});
		const local = await scope.context.repository.localDayTotals(
			scope.store.id,
			range,
		);
		rows.push(...(await writeChecks(scope, [date], totals, local, record)));
	}
	return rows;
}
