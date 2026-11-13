import type { ISql } from "postgres";
import type { DateRange } from "../repository.js";
import type {
	RefreshResult,
	RunFinish,
	RunStart,
	ShiftRow,
	SyncCheckRow,
	TableCounts,
} from "../rows.js";
import { CHECK_COLUMNS, SHIFT_COLUMNS } from "./columns.js";
import { lockStore } from "./locks.js";
import {
	chunkRows,
	columnTuple,
	excludedAssignments,
	toSqlRow,
} from "./values.js";

const SHIFT_UPDATE_COLUMNS = SHIFT_COLUMNS.filter(
	(column) => !["tenant_id", "store_id", "external_id"].includes(column),
);

export async function upsertShifts(
	sql: ISql,
	storeId: string,
	shifts: readonly ShiftRow[],
): Promise<TableCounts> {
	await lockStore(sql, storeId);
	let changed = 0;
	for (const chunk of chunkRows(shifts, SHIFT_COLUMNS.length)) {
		const rows = chunk.map((shift) => toSqlRow(shift, SHIFT_COLUMNS));
		const result = await sql`
			insert into public.shifts ${sql(rows, SHIFT_COLUMNS)}
			on conflict (store_id, external_id)
			do update set ${sql.unsafe(excludedAssignments(SHIFT_UPDATE_COLUMNS))}
			where ${sql.unsafe(columnTuple("public.shifts", SHIFT_UPDATE_COLUMNS))}
				is distinct from ${sql.unsafe(columnTuple("excluded", SHIFT_UPDATE_COLUMNS))}
		`;
		changed += result.count;
	}
	return { shifts: changed };
}

const CHECK_UPDATE_COLUMNS = CHECK_COLUMNS.filter(
	(column) => !["tenant_id", "store_id", "business_date"].includes(column),
);

export async function upsertChecks(
	sql: ISql,
	checks: readonly SyncCheckRow[],
): Promise<TableCounts> {
	let changed = 0;
	for (const chunk of chunkRows(checks, CHECK_COLUMNS.length)) {
		const rows = chunk.map((check) =>
			toSqlRow(check, CHECK_COLUMNS, new Set()),
		);
		const result = await sql`
			insert into public.sync_checks ${sql(rows, CHECK_COLUMNS)}
			on conflict (store_id, business_date)
			do update set ${sql.unsafe(excludedAssignments(CHECK_UPDATE_COLUMNS))}, checked_at = now()
			where ${sql.unsafe(columnTuple("public.sync_checks", CHECK_UPDATE_COLUMNS))}
				is distinct from ${sql.unsafe(columnTuple("excluded", CHECK_UPDATE_COLUMNS))}
		`;
		changed += result.count;
	}
	return { sync_checks: changed };
}

export async function loadChecks(
	sql: ISql,
	storeId: string,
	range: DateRange,
): Promise<SyncCheckRow[]> {
	return sql<SyncCheckRow[]>`
		select tenant_id, store_id, business_date::text as business_date,
			source_invoice_count, source_net_amount::text as source_net_amount,
			local_invoice_count, local_net_amount::text as local_net_amount, is_matched
		from public.sync_checks
		where store_id = ${storeId}
			and business_date between ${range.from}::date and ${range.to}::date
		order by business_date
	`;
}

export async function staleAnalyticsDates(
	sql: ISql,
	storeId: string,
	range: DateRange,
): Promise<string[]> {
	const [probe] = await sql<{ available: boolean }[]>`
		select to_regprocedure('app.stale_analytics_dates(uuid, date, date)') is not null as available
	`;
	if (!probe?.available) {
		return [];
	}
	const rows = await sql<{ business_date: string }[]>`
		select business_date::text as business_date
		from app.stale_analytics_dates(${storeId}::uuid, ${range.from}::date, ${range.to}::date)
	`;
	return rows.map((row) => row.business_date);
}

export async function openRun(sql: ISql, run: RunStart): Promise<string> {
	const rows = await sql<{ id: string }[]>`
		insert into public.sync_runs (tenant_id, pos_account_id, store_id, store_ids, kind, range_start, range_end, started_at, status, triggered_by)
		values (${run.tenant_id}, ${run.pos_account_id}, ${run.store_id ?? null}::uuid, ${run.store_ids ?? null}::uuid[], ${run.kind}::public.sync_kind,
			${run.range_start}::date, ${run.range_end}::date, ${run.started_at}::timestamptz, 'running', ${run.triggered_by})
		returning id
	`;
	const [row] = rows;
	if (!row) {
		throw new Error("sync run insert returned no row");
	}
	return row.id;
}

export async function closeAbandonedRuns(
	sql: ISql,
	storeId: string,
	startedBefore: string,
	message: string,
): Promise<number> {
	const result = await sql`
		update public.sync_runs
		set status = 'failed', finished_at = now(), error_message = ${message}
		where store_id = ${storeId}
			and kind = 'incremental'
			and status = 'running'
			and started_at < ${startedBefore}::timestamptz
	`;
	return result.count;
}

export async function closeRun(
	sql: ISql,
	runId: string,
	finish: RunFinish,
): Promise<void> {
	await sql`
		update public.sync_runs
		set status = ${finish.status}::public.sync_status,
			finished_at = ${finish.finished_at}::timestamptz,
			rows_upserted = ${sql.json(finish.rows_upserted)},
			error_message = ${finish.error_message}
		where id = ${runId}
	`;
}

export async function refreshAnalytics(
	sql: ISql,
	tenantId: string,
	range: DateRange,
): Promise<RefreshResult> {
	const [probe] = await sql<{ available: boolean }[]>`
		select to_regprocedure('app.refresh_analytics(uuid, date, date)') is not null as available
	`;
	if (!probe?.available) {
		return { available: false };
	}
	const [result] = await sql<{ rows: string | null }[]>`
		select app.refresh_analytics(${tenantId}::uuid, ${range.from}::date, ${range.to}::date)::text as rows
	`;
	return { available: true, rows: Number(result?.rows ?? 0) };
}
