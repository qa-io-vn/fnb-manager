import type { Sql } from "postgres";
import {
	closedStoreDays,
	type StatusWindow,
	type StoreClock,
	type StoreDayRange,
} from "./status-window.js";

export interface AccountStatusRow {
	id: string;
	tenant_slug: string;
	account_key: string;
	display_name: string;
	connector: string;
	status: string;
	last_run_kind: string | null;
	last_run_status: string | null;
	last_run_started_at: Date | null;
	last_run_finished_at: Date | null;
	last_success_at: Date | null;
	flagged_runs: number;
	failed_runs: number;
}

interface StoreRow extends StoreClock {
	pos_account_id: string;
	store_id: string;
	external_id: string;
	name: string;
	active: boolean;
	latest_verified_day: string | null;
	latest_invoice_day: string | null;
}

export interface StoreStatusRow extends StoreRow {
	unmatched_days: number;
	checked_days: number;
}

interface WindowedStore {
	store_id: string;
	days: StoreDayRange;
}

interface StoreDayCounts {
	store_id: string;
	unmatched_days: number;
	checked_days: number;
}

export async function accountStatuses(
	sql: Sql,
	tenantSlug: string | undefined,
	window: StatusWindow,
): Promise<AccountStatusRow[]> {
	return sql<AccountStatusRow[]>`
		select a.id, t.slug as tenant_slug, a.account_key, a.display_name, a.connector, a.status::text as status,
			last_run.kind as last_run_kind, last_run.status as last_run_status,
			last_run.started_at as last_run_started_at, last_run.finished_at as last_run_finished_at,
			success.finished_at as last_success_at,
			coalesce(recent.flagged, 0)::int as flagged_runs,
			coalesce(recent.failed, 0)::int as failed_runs
		from public.pos_accounts a
		join public.tenants t on t.id = a.tenant_id
		left join lateral (
			select r.kind::text as kind, r.status::text as status, r.started_at, r.finished_at
			from public.sync_runs r
			where r.pos_account_id = a.id
			order by r.started_at desc
			limit 1
		) last_run on true
		left join lateral (
			select max(r.finished_at) as finished_at
			from public.sync_runs r
			where r.pos_account_id = a.id and r.status = 'succeeded' and r.kind <> 'master_data'
		) success on true
		left join lateral (
			select
				count(*) filter (
					where coalesce((r.rows_upserted -> 'summary' ->> 'flags_warn')::int, 0) > 0
						or coalesce((r.rows_upserted -> 'summary' ->> 'checks_unmatched')::int, 0) > 0
				) as flagged,
				count(*) filter (where r.status = 'failed') as failed
			from public.sync_runs r
			where r.pos_account_id = a.id
				and r.started_at > ${window.since}::timestamptz
		) recent on true
		where (${tenantSlug ?? null}::text is null or t.slug = ${tenantSlug ?? null}::text)
		order by t.slug, a.account_key
	`;
}

async function storeDayCounts(
	sql: Sql,
	stores: readonly WindowedStore[],
): Promise<Map<string, StoreDayCounts>> {
	const rows = await sql<StoreDayCounts[]>`
		select w.store_id::text as store_id,
			(count(c.id) filter (where not c.is_matched))::int as unmatched_days,
			count(c.id)::int as checked_days
		from unnest(
			${stores.map((store) => store.store_id)}::uuid[],
			${stores.map((store) => store.days.fromDate)}::date[],
			${stores.map((store) => store.days.toDate)}::date[]
		) as w (store_id, from_date, to_date)
		left join public.sync_checks c
			on c.store_id = w.store_id and c.business_date between w.from_date and w.to_date
		group by w.store_id
	`;
	return new Map(rows.map((row) => [row.store_id, row]));
}

export async function storeStatuses(
	sql: Sql,
	accountIds: readonly string[],
	window: StatusWindow,
): Promise<StoreStatusRow[]> {
	if (accountIds.length === 0) {
		return [];
	}
	const stores = await sql<StoreRow[]>`
		select s.pos_account_id, s.id as store_id, s.external_id, s.name, s.active,
			s.timezone, s.business_day_start_minutes,
			(select max(c.business_date)::text from public.sync_checks c where c.store_id = s.id and c.is_matched) as latest_verified_day,
			(select max(i.business_date)::text from public.invoices i where i.store_id = s.id) as latest_invoice_day
		from public.stores s
		where s.pos_account_id = any(${[...accountIds]}::uuid[])
		order by s.pos_account_id, s.external_id
	`;
	if (stores.length === 0) {
		return [];
	}
	const counts = await storeDayCounts(
		sql,
		stores.map((store) => ({
			store_id: store.store_id,
			days: closedStoreDays(window, store),
		})),
	);
	return stores.map((store) => ({
		...store,
		unmatched_days: counts.get(store.store_id)?.unmatched_days ?? 0,
		checked_days: counts.get(store.store_id)?.checked_days ?? 0,
	}));
}

export interface OpenSyncAlert {
	store_id: string;
	kind: "sync_stale" | "dispatch_failed";
	minutes: number | null;
	occurrences: number;
	http_status: number | null;
	opened_at: Date;
}

export async function openSyncAlerts(
	sql: Sql,
	storeIds?: readonly string[],
): Promise<OpenSyncAlert[] | null> {
	const [probe] = await sql<{ present: boolean }[]>`
		select to_regclass('app.sync_alerts') is not null as present
	`;
	if (!probe?.present) {
		return null;
	}
	return sql<OpenSyncAlert[]>`
		select a.store_id::text as store_id, a.kind, a.minutes, a.occurrences, a.http_status, a.opened_at
		from app.sync_alerts a
		where a.resolved_at is null
			and (${storeIds === undefined}::boolean or a.store_id = any(${[...(storeIds ?? [])]}::uuid[]))
		order by a.store_id, a.kind
	`;
}

export interface OpeningHoursCoverage {
	active: number;
	never_entered: number;
	without_span: number;
}

export async function openingHoursCoverage(
	sql: Sql,
): Promise<OpeningHoursCoverage | null> {
	const [probe] = await sql<{ present: boolean }[]>`
		select to_regprocedure('app.opening_hours_known(jsonb)') is not null as present
	`;
	if (!probe?.present) {
		return null;
	}
	const [row] = await sql<OpeningHoursCoverage[]>`
		select count(*)::int as active,
			(count(*) filter (where s.opening_hours is null))::int as never_entered,
			(count(*) filter (where s.opening_hours is not null and not app.opening_hours_known(s.opening_hours)))::int as without_span
		from public.stores s
		where s.active
	`;
	return row ?? { active: 0, never_entered: 0, without_span: 0 };
}
