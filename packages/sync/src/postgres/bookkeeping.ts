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

export async function openRun(sql: ISql, run: RunStart): Promise<string> {
	const rows = await sql<{ id: string }[]>`
		insert into public.sync_runs (tenant_id, pos_account_id, kind, range_start, range_end, started_at, status, triggered_by)
		values (${run.tenant_id}, ${run.pos_account_id}, ${run.kind}::public.sync_kind, ${run.range_start}::date,
			${run.range_end}::date, ${run.started_at}::timestamptz, 'running', ${run.triggered_by})
		returning id
	`;
	const [row] = rows;
	if (!row) {
		throw new Error("sync run insert returned no row");
	}
	return row.id;
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
