import type { IsoDate, ReportStore } from "@fnb/reports";
import type { Sql } from "postgres";
import type {
	DigestStoreFacts,
	DigestTrigger,
	DueDigest,
} from "../digest/build.js";
import type { DigestModel, DigestOpenAlert } from "../digest/model.js";
import {
	DAY_RULE_KEYS,
	type EffectiveRule,
	type EffectiveRuleSet,
} from "../rules/day.js";
import { textArray } from "./statements.js";

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function numberOrNull(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function textOrNull(value: unknown): string | null {
	if (value instanceof Date) {
		return value.toISOString();
	}
	return typeof value === "string" && value !== "" ? value : null;
}

export function storeFactsFrom(value: unknown): DigestStoreFacts[] {
	const entries = Array.isArray(value)
		? value
		: Object.entries(record(value)).map(([storeId, facts]) => ({
				store_id: storeId,
				...record(facts),
			}));
	return entries.flatMap((entry) => {
		const facts = record(entry);
		const storeId = textOrNull(facts.store_id);
		if (storeId === null) {
			return [];
		}
		return [
			{
				storeId,
				openingMinutes: numberOrNull(facts.opening_minutes),
				closeAt: textOrNull(facts.close_at) ?? "",
				lastShiftClosedAt: textOrNull(facts.last_shift_closed_at),
				openShifts: numberOrNull(facts.open_shifts) ?? 0,
				settledAt: textOrNull(facts.settled_at),
				dayEnded: facts.day_ended === true,
			},
		];
	});
}

function triggerOf(value: string): DigestTrigger {
	return value === "settled" || value === "deadline" ? value : "manual";
}

interface DueRow {
	tenant_id: string;
	business_date: string;
	scope_key: string;
	store_ids: string[];
	all_stores: boolean;
	trigger: string;
	due_at: string | null;
	run_as: string;
	channel_ids: string[];
	store_facts: unknown;
}

export async function dueDigests(
	sql: Sql,
	at: Date,
	tenantId: string | null,
): Promise<DueDigest[]> {
	const rows = await sql<DueRow[]>`
		select
			d.tenant_id::text as tenant_id,
			d.business_date::text as business_date,
			d.scope_key,
			d.store_ids::text[] as store_ids,
			d.all_stores,
			d.trigger,
			d.due_at::text as due_at,
			d.run_as::text as run_as,
			d.channel_ids::text[] as channel_ids,
			d.store_facts
		from app.due_digests(${at}::timestamptz, ${tenantId}::uuid) d
		order by d.tenant_id, d.due_at, d.scope_key
	`;
	return rows.map((row) => ({
		tenantId: row.tenant_id,
		businessDate: row.business_date,
		scopeKey: row.scope_key,
		storeIds: [...row.store_ids].sort(),
		allStores: row.all_stores,
		trigger: triggerOf(row.trigger),
		runAs: row.run_as,
		channelIds: [...row.channel_ids],
		storeFacts: storeFactsFrom(row.store_facts),
		dueAt: row.due_at,
	}));
}

export async function scopeStores(
	sql: Sql,
	storeIds: readonly string[],
): Promise<ReportStore[]> {
	const rows = await sql<
		{
			id: string;
			name: string;
			timezone: string;
			business_day_start_minutes: number;
		}[]
	>`
		select id::text as id, name, timezone, business_day_start_minutes
		from public.stores
		where id in (select jsonb_array_elements_text(${textArray(storeIds)}::text::jsonb)::uuid)
		order by name, id
	`;
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		timeZone: row.timezone,
		businessDayStartMinutes: Number(row.business_day_start_minutes),
	}));
}

export async function loadRuleSet(
	sql: Sql,
	tenantId: string,
	storeIds: readonly string[],
): Promise<EffectiveRuleSet> {
	const rows = await sql<
		{
			store_id: string | null;
			rule_key: string;
			enabled: boolean | null;
			params: unknown;
		}[]
	>`
		with scope as (
			select null::uuid as store_id
			union all
			select jsonb_array_elements_text(${textArray(storeIds)}::text::jsonb)::uuid
		),
		rules as (
			select jsonb_array_elements_text(${textArray(DAY_RULE_KEYS)}::text::jsonb) as rule_key
		)
		select s.store_id::text as store_id, r.rule_key, e.enabled, e.params
		from scope s
		cross join rules r
		cross join lateral app.effective_alert_rule(${tenantId}::uuid, s.store_id, r.rule_key) e
	`;
	const tenant: Record<string, EffectiveRule> = {};
	const stores: Record<string, Record<string, EffectiveRule>> = {};
	for (const row of rows) {
		const rule: EffectiveRule = {
			enabled: row.enabled === true,
			params: record(row.params),
		};
		if (row.store_id === null) {
			tenant[row.rule_key] = rule;
		} else {
			const entry = stores[row.store_id] ?? {};
			entry[row.rule_key] = rule;
			stores[row.store_id] = entry;
		}
	}
	return { tenant, stores };
}

export async function openDigestAlerts(
	sql: Sql,
	tenantId: string,
	storeIds: readonly string[],
): Promise<DigestOpenAlert[]> {
	const rows = await sql<
		{
			rule_key: string;
			store_id: string | null;
			account_id: string | null;
			account_name: string | null;
			run_kind: string | null;
			opened_at: Date;
		}[]
	>`
		with scope as (
			select jsonb_array_elements_text(${textArray(storeIds)}::text::jsonb)::uuid as store_id
		)
		select
			e.rule_key,
			e.store_id::text as store_id,
			e.pos_account_id::text as account_id,
			a.display_name as account_name,
			case when e.rule_key = 'sync_failed' and e.store_id is null then nullif(split_part(e.dedupe_key, ':', 4), '') end as run_kind,
			e.opened_at
		from public.alert_events e
		left join public.pos_accounts a on a.id = e.pos_account_id
		where e.tenant_id = ${tenantId}::uuid
			and e.state = 'open'
			and e.rule_key in ('auth_failed', 'sync_stale', 'sync_failed')
			and (
				e.store_id in (select store_id from scope)
				or (
					e.store_id is null
					and e.pos_account_id in (
						select st.pos_account_id from public.stores st where st.id in (select store_id from scope)
					)
				)
			)
		order by e.opened_at, e.id
		limit 10
	`;
	return rows.map((row) => ({
		ruleKey: row.rule_key,
		storeId: row.store_id,
		accountId: row.account_id,
		accountName: row.account_name,
		runKind: row.run_kind,
		openedAt: new Date(row.opened_at).toISOString(),
	}));
}

export async function appBaseUrl(sql: Sql): Promise<string | null> {
	const [row] = await sql<{ app_base_url: string | null }[]>`
		select app_base_url from app.notify_settings limit 1
	`;
	return row?.app_base_url ?? null;
}

export interface DigestChannel {
	readonly id: string;
	readonly kind: string;
	readonly provider: string;
	readonly readerTimezone: string;
	readonly currencyCode: string;
}

export async function digestChannels(
	sql: Sql,
	channelIds: readonly string[],
): Promise<DigestChannel[]> {
	const rows = await sql<
		{
			id: string;
			kind: string;
			provider: string;
			reader_timezone: string;
			currency_code: string;
		}[]
	>`
		select c.id::text as id, c.kind::text as kind, c.provider,
			coalesce(c.timezone, t.timezone) as reader_timezone, t.currency_code
		from public.notification_channels c
		join public.tenants t on t.id = c.tenant_id
		where c.id in (select jsonb_array_elements_text(${textArray(channelIds)}::text::jsonb)::uuid)
		order by c.created_at, c.id
	`;
	return rows.map((row) => ({
		id: row.id,
		kind: row.kind,
		provider: row.provider,
		readerTimezone: row.reader_timezone,
		currencyCode: row.currency_code,
	}));
}

export async function tenantClock(
	sql: Sql,
	tenantId: string,
): Promise<{ timezone: string; currencyCode: string }> {
	const [row] = await sql<{ timezone: string; currency_code: string }[]>`
		select timezone, currency_code from public.tenants where id = ${tenantId}::uuid
	`;
	return {
		timezone: row?.timezone ?? "Asia/Ho_Chi_Minh",
		currencyCode: row?.currency_code ?? "VND",
	};
}

export interface DigestMessageInput {
	readonly channelId: string;
	readonly title: string | null;
	readonly body: string;
}

export interface StoredDigest {
	readonly digestId: string | null;
	readonly messageIds: readonly string[];
}

export function digestLockKey(
	due: Pick<DueDigest, "tenantId" | "scopeKey" | "businessDate">,
): string {
	return `fnb-notify:digest:${due.tenantId}:${due.scopeKey}:${due.businessDate}`;
}

export async function completeDigestAndEnqueue(
	sql: Sql,
	input: {
		readonly due: DueDigest;
		readonly model: DigestModel;
		readonly fingerprint: string;
		readonly at: Date;
		readonly messages: readonly DigestMessageInput[];
	},
): Promise<StoredDigest> {
	const { due, model, at } = input;
	return sql.begin(async (transaction) => {
		await transaction`select pg_advisory_xact_lock(hashtextextended(${digestLockKey(due)}, 0))`;
		const [row] = await transaction<{ id: string | null }[]>`
			select app.complete_digest(
				${due.tenantId}::uuid,
				${due.businessDate}::date,
				${due.scopeKey}::text,
				array(select jsonb_array_elements_text(${textArray(due.storeIds)}::text::jsonb)::uuid),
				${due.allStores}::boolean,
				${due.trigger}::text,
				${model.dataState}::text,
				${JSON.stringify(model)}::text::jsonb,
				${model.version}::smallint,
				${input.fingerprint}::text,
				${due.runAs}::uuid,
				${at}::timestamptz
			)::text as id
		`;
		const digestId = row?.id ?? null;
		if (digestId === null) {
			return { digestId: null, messageIds: [] };
		}
		const messageIds: string[] = [];
		for (const message of input.messages) {
			const [queued] = await transaction<{ id: string | null }[]>`
				select app.enqueue_digest_message(
					${digestId}::uuid,
					${message.channelId}::uuid,
					0::smallint,
					'digest'::text,
					${message.title}::text,
					${message.body}::text,
					${at}::timestamptz
				)::text as id
			`;
			if (queued?.id) {
				messageIds.push(queued.id);
			}
		}
		return { digestId, messageIds };
	}) as Promise<StoredDigest>;
}

export async function failDigest(
	sql: Sql,
	due: DueDigest,
	errorCode: string,
	at: Date,
): Promise<void> {
	await sql`
		select app.fail_digest(
			${due.tenantId}::uuid,
			${due.businessDate}::date,
			${due.scopeKey}::text,
			array(select jsonb_array_elements_text(${textArray(due.storeIds)}::text::jsonb)::uuid),
			${errorCode}::text,
			${at}::timestamptz
		)
	`;
}

export async function scopeKeyOf(
	sql: Sql,
	storeIds: readonly string[],
): Promise<string> {
	const [row] = await sql<{ key: string }[]>`
		select md5(coalesce(string_agg(s::text, ',' order by s::text), '')) as key
		from jsonb_array_elements_text(${textArray(storeIds)}::text::jsonb) s
	`;
	return row?.key ?? "";
}

export async function manualStoreFacts(
	sql: Sql,
	storeIds: readonly string[],
	businessDate: IsoDate,
	at: Date,
	graceMinutes: number,
): Promise<DigestStoreFacts[]> {
	const rows = await sql<
		{
			store_id: string;
			opening_minutes: number | null;
			close_at: Date | null;
			last_shift_closed_at: Date | null;
			open_shifts: number | null;
			settled_at: Date | null;
			day_ended: boolean;
		}[]
	>`
		select
			st.id::text as store_id,
			case when app.opening_hours_known(st.opening_hours) then app.opening_minutes(st.opening_hours, ${businessDate}::date) end as opening_minutes,
			app.store_day_close_at(st.id, ${businessDate}::date) as close_at,
			sh.last_closed_at as last_shift_closed_at,
			sh.open_shifts,
			app.store_day_settled_at(st.id, ${businessDate}::date, make_interval(mins => ${graceMinutes}::integer)) as settled_at,
			${at}::timestamptz >= ((${businessDate}::date + 1) + make_interval(mins => st.business_day_start_minutes)) at time zone st.timezone as day_ended
		from public.stores st
		cross join lateral app.store_day_shift_state(st.id, ${businessDate}::date) sh
		where st.id in (select jsonb_array_elements_text(${textArray(storeIds)}::text::jsonb)::uuid)
		order by st.id
	`;
	return rows.map((row) => {
		const settledAt =
			row.settled_at !== null &&
			new Date(row.settled_at).getTime() <= at.getTime()
				? new Date(row.settled_at).toISOString()
				: null;
		return {
			storeId: row.store_id,
			openingMinutes:
				row.opening_minutes === null ? null : Number(row.opening_minutes),
			closeAt:
				row.close_at === null ? "" : new Date(row.close_at).toISOString(),
			lastShiftClosedAt:
				row.last_shift_closed_at === null
					? null
					: new Date(row.last_shift_closed_at).toISOString(),
			openShifts: Number(row.open_shifts ?? 0),
			settledAt,
			dayEnded: row.day_ended === true,
		};
	});
}

export interface DigestScope {
	readonly storeIds: readonly string[];
	readonly allStores: boolean;
	readonly runAs: string;
	readonly channelIds: readonly string[];
}

export async function tenantDigestScopes(
	sql: Sql,
	tenantId: string,
): Promise<DigestScope[]> {
	const rows = await sql<
		{
			store_ids: string[];
			all_stores: boolean;
			run_as: string;
			channel_ids: string[];
		}[]
	>`
		with rule as (
			select r.enabled, r.roles
			from app.effective_alert_rule(${tenantId}::uuid, null, 'daily_digest') r
		),
		candidates as (
			select
				c.id as channel_id,
				m.user_id,
				array(
					select st.id
					from public.stores st
					where st.tenant_id = c.tenant_id
						and st.active
						and (m.store_ids is null or st.id = any (m.store_ids))
						and (c.store_ids is null or st.id = any (c.store_ids))
					order by st.id
				) as scope,
				c.store_ids is null as unnarrowed
			from public.notification_channels c
			join public.tenant_members m on m.tenant_id = c.tenant_id and m.user_id = c.user_id
			cross join rule
			where c.tenant_id = ${tenantId}::uuid
				and c.status in ('active', 'failing')
				and c.enabled
				and c.kind <> 'webhook'
				and not ('daily_digest' = any (c.muted_rules))
				and rule.enabled
				and m.role = any (rule.roles)
		)
		select
			scope::text[] as store_ids,
			bool_and(unnarrowed) as all_stores,
			min(user_id::text) as run_as,
			array_agg(channel_id::text order by channel_id) as channel_ids
		from candidates
		where cardinality(scope) > 0
		group by scope
		order by min(user_id::text), scope::text
	`;
	return rows.map((row) => ({
		storeIds: [...row.store_ids].sort(),
		allStores: row.all_stores,
		runAs: row.run_as,
		channelIds: [...row.channel_ids],
	}));
}

export interface OwnerMember {
	readonly userId: string;
}

export async function unlimitedOwner(
	sql: Sql,
	tenantId: string,
): Promise<OwnerMember | null> {
	const [row] = await sql<{ user_id: string }[]>`
		select m.user_id::text as user_id
		from public.tenant_members m
		where m.tenant_id = ${tenantId}::uuid
			and m.role = 'owner'
			and m.store_ids is null
		order by m.created_at, m.user_id
		limit 1
	`;
	return row ? { userId: row.user_id } : null;
}

export async function activeStoreIds(
	sql: Sql,
	tenantId: string,
): Promise<string[]> {
	const rows = await sql<{ id: string }[]>`
		select id::text as id from public.stores
		where tenant_id = ${tenantId}::uuid and active
		order by name, id
	`;
	return rows.map((row) => row.id);
}

export async function existingDigest(
	sql: Sql,
	tenantId: string,
	businessDate: IsoDate,
	scopeKey: string,
): Promise<{
	id: string;
	state: string;
	revision: number;
	model: unknown;
} | null> {
	const [row] = await sql<
		{ id: string; state: string; revision: number; model: unknown }[]
	>`
		select id::text as id, state, revision::integer as revision, model
		from public.digests
		where tenant_id = ${tenantId}::uuid
			and business_date = ${businessDate}::date
			and scope_key = ${scopeKey}
	`;
	return row ?? null;
}
