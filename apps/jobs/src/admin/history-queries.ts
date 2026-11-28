import type { Sql } from "postgres";

export interface DateWindow {
	fromDate: string;
	toDate: string;
}

export async function uncoveredStoreDays(
	sql: Sql,
	accountId: string,
	storeIds: readonly string[],
	window: DateWindow,
): Promise<number> {
	const [row] = await sql<{ uncovered: number }[]>`
		select count(*)::integer as uncovered
		from public.stores s
		cross join generate_series(${window.fromDate}::timestamp, ${window.toDate}::timestamp, interval '1 day') as d(day)
		where s.id = any(${[...storeIds]}::uuid[])
			and not exists (
				select 1
				from public.sync_runs r
				where r.pos_account_id = ${accountId}
					and r.status = 'succeeded'
					and r.kind in ('backfill', 'nightly', 'incremental')
					and r.range_start <= d.day::date
					and r.range_end >= d.day::date
					and (
						s.id = any(r.store_ids)
						or (r.store_ids is null and (r.store_id is null or r.store_id = s.id))
					)
					and r.started_at >= (
						(d.day::date + 1)::timestamp
						+ make_interval(mins => s.business_day_start_minutes)
					) at time zone s.timezone
			)
	`;
	return row?.uncovered ?? 0;
}

export async function storedSales(
	sql: Sql,
	storeIds: readonly string[],
	window: DateWindow,
): Promise<number> {
	const [row] = await sql<{ sales: number }[]>`
		select count(*)::integer as sales
		from public.invoices
		where store_id = any(${[...storeIds]}::uuid[])
			and business_date between ${window.fromDate}::date and ${window.toDate}::date
			and status in ('completed', 'edited')
	`;
	return row?.sales ?? 0;
}

export async function masterDataLoaded(
	sql: Sql,
	accountId: string,
): Promise<boolean> {
	const [row] = await sql<{ loaded: boolean }[]>`
		select exists (
			select 1
			from public.sync_runs
			where pos_account_id = ${accountId}
				and kind = 'master_data'
				and status = 'succeeded'
		) as loaded
	`;
	return row?.loaded ?? false;
}

export async function databaseBytes(sql: Sql): Promise<number> {
	const [row] = await sql<{ bytes: string }[]>`
		select pg_database_size(current_database())::text as bytes
	`;
	return Number(row?.bytes ?? 0);
}
