import type { Sql } from "postgres";

export interface MessageDecisionRow {
	readonly number: number;
	readonly id: string;
	readonly kind: string;
	readonly status: string;
	readonly decision: string | null;
	readonly releaseAt: Date | null;
	readonly reason: string | null;
	readonly readerTimezone: string;
}

export async function messageDecisions(
	sql: Sql,
	at: Date,
	tenantId: string,
	limit = 200,
): Promise<MessageDecisionRow[]> {
	const rows = await sql<
		{
			number: string;
			id: string;
			kind: string;
			status: string;
			decision: string | null;
			release_at: Date | null;
			reason: string | null;
			reader_timezone: string;
		}[]
	>`
		select
			(row_number() over (order by coalesce(o.not_before, o.created_at), o.created_at, o.id))::text as number,
			o.id::text as id,
			o.kind,
			o.status,
			d.decision,
			d.release_at,
			d.reason,
			coalesce(c.timezone, t.timezone) as reader_timezone
		from public.outbound_messages o
		join public.tenants t on t.id = o.tenant_id
		left join public.notification_channels c on c.id = o.channel_id
		cross join lateral app.message_decision(o.id, ${at}::timestamptz) d
		where o.tenant_id = ${tenantId}::uuid
			and o.kind is not null
			and o.status in ('queued', 'held')
		order by coalesce(o.not_before, o.created_at), o.created_at, o.id
		limit ${limit}
	`;
	return rows.map((row) => ({
		number: Number(row.number),
		id: row.id,
		kind: row.kind,
		status: row.status,
		decision: row.decision,
		releaseAt: row.release_at,
		reason: row.reason,
		readerTimezone: row.reader_timezone,
	}));
}

export interface WaitingSummary {
	readonly queued: number;
	readonly held: number;
	readonly uncertain: number;
	readonly nextReleaseAt: Date | null;
	readonly nextReleaseTimezone: string | null;
	readonly oldestQueuedAt: Date | null;
}

export async function waitingSummary(
	sql: Sql,
	tenantId: string | null,
): Promise<WaitingSummary> {
	const [row] = await sql<
		{
			queued: string;
			held: string;
			uncertain: string;
			next_release_at: Date | null;
			next_release_timezone: string | null;
			oldest_queued_at: Date | null;
		}[]
	>`
		with scoped as (
			select o.status, o.not_before, o.created_at, coalesce(c.timezone, t.timezone) as reader_timezone
			from public.outbound_messages o
			join public.tenants t on t.id = o.tenant_id
			left join public.notification_channels c on c.id = o.channel_id
			where o.kind is not null
				and o.status in ('queued', 'held', 'uncertain')
				and (${tenantId}::uuid is null or o.tenant_id = ${tenantId}::uuid)
		),
		next_release as (
			select s.not_before, s.reader_timezone
			from scoped s
			where s.status = 'held' and s.not_before is not null
			order by s.not_before
			limit 1
		)
		select
			(select count(*) from scoped where status = 'queued')::text as queued,
			(select count(*) from scoped where status = 'held')::text as held,
			(select count(*) from scoped where status = 'uncertain')::text as uncertain,
			(select n.not_before from next_release n) as next_release_at,
			(select n.reader_timezone from next_release n) as next_release_timezone,
			(select min(coalesce(s.not_before, s.created_at)) from scoped s where s.status = 'queued') as oldest_queued_at
	`;
	return {
		queued: Number(row?.queued ?? 0),
		held: Number(row?.held ?? 0),
		uncertain: Number(row?.uncertain ?? 0),
		nextReleaseAt: row?.next_release_at ?? null,
		nextReleaseTimezone: row?.next_release_timezone ?? null,
		oldestQueuedAt: row?.oldest_queued_at ?? null,
	};
}

export interface StatusCount {
	readonly key: string;
	readonly count: number;
}

export interface DestinationActivity {
	readonly number: number;
	readonly kind: string;
	readonly status: string;
	readonly enabled: boolean;
	readonly secretName: string;
	readonly lastOkAt: Date | null;
	readonly lastErrorCode: string | null;
	readonly consecutiveFailures: number;
	readonly monthCount: number;
}

export interface TenantNotifyStatus {
	readonly messages: readonly StatusCount[];
	readonly waiting: WaitingSummary;
	readonly destinations: readonly DestinationActivity[];
	readonly botMonthCounts: readonly StatusCount[];
	readonly openEpisodes: readonly StatusCount[];
	readonly digests: readonly StatusCount[];
}

export async function tenantNotifyStatus(
	sql: Sql,
	tenantId: string,
	at: Date,
	days: number,
): Promise<TenantNotifyStatus> {
	const messages = await sql<{ key: string; count: string }[]>`
		select o.status as key, count(*)::text as count
		from public.outbound_messages o
		where o.tenant_id = ${tenantId}::uuid
			and o.kind is not null
			and o.created_at >= ${at}::timestamptz - make_interval(days => ${days}::integer)
		group by o.status
		order by o.status
	`;
	const destinations = await sql<
		{
			number: string;
			kind: string;
			status: string;
			enabled: boolean;
			secret_name: string;
			last_ok_at: Date | null;
			last_error_code: string | null;
			consecutive_failures: number;
			month_count: string;
		}[]
	>`
		select
			(row_number() over (order by c.created_at, c.id))::text as number,
			c.kind::text as kind,
			c.status,
			c.enabled,
			c.secret_name,
			c.last_ok_at,
			c.last_error_code,
			c.consecutive_failures,
			(
				select count(*)
				from public.outbound_messages o
				where o.channel_id = c.id
					and o.status in ('sending', 'sent', 'delivered', 'uncertain')
					and coalesce(o.sent_at, o.claimed_at) >= date_trunc('month', ${at}::timestamptz at time zone coalesce(c.timezone, t.timezone)) at time zone coalesce(c.timezone, t.timezone)
			)::text as month_count
		from public.notification_channels c
		join public.tenants t on t.id = c.tenant_id
		where c.tenant_id = ${tenantId}::uuid
		order by c.created_at, c.id
	`;
	const openEpisodes = await sql<{ key: string; count: string }[]>`
		select e.rule_key as key, count(*)::text as count
		from public.alert_events e
		where e.tenant_id = ${tenantId}::uuid and e.state = 'open'
		group by e.rule_key
		order by e.rule_key
	`;
	const digests = await sql<{ key: string; count: string }[]>`
		select d.state || case when d.revision > 0 then ' (corrected)' else '' end as key, count(*)::text as count
		from public.digests d
		where d.tenant_id = ${tenantId}::uuid
			and d.business_date >= (${at}::timestamptz at time zone 'UTC')::date - ${days}::integer
		group by 1
		order by 1
	`;
	const rows = destinations.map((row) => ({
		number: Number(row.number),
		kind: row.kind,
		status: row.status,
		enabled: row.enabled,
		secretName: row.secret_name,
		lastOkAt: row.last_ok_at,
		lastErrorCode: row.last_error_code,
		consecutiveFailures: Number(row.consecutive_failures),
		monthCount: Number(row.month_count),
	}));
	const bots = new Map<string, number>();
	for (const row of rows) {
		if (row.kind === "zalo_bot") {
			bots.set(
				row.secretName,
				(bots.get(row.secretName) ?? 0) + row.monthCount,
			);
		}
	}
	return {
		messages: messages.map((row) => ({
			key: row.key,
			count: Number(row.count),
		})),
		waiting: await waitingSummary(sql, tenantId),
		destinations: rows,
		botMonthCounts: [...bots.entries()]
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([key, count]) => ({ key, count })),
		openEpisodes: openEpisodes.map((row) => ({
			key: row.key,
			count: Number(row.count),
		})),
		digests: digests.map((row) => ({ key: row.key, count: Number(row.count) })),
	};
}

export interface NotifySchedule {
	readonly enabled: boolean;
	readonly lastTickAt: Date | null;
	readonly lastDispatchAt: Date | null;
	readonly lastTicketExpiredAt: Date | null;
	readonly lastDispatcherSecrets: readonly string[];
}

export async function notifySchedule(sql: Sql): Promise<NotifySchedule> {
	const [row] = await sql<
		{
			enabled: boolean;
			last_tick_at: Date | null;
			last_dispatch_at: Date | null;
			last_ticket_expired_at: Date | null;
			last_dispatcher_secrets: string[] | null;
		}[]
	>`
		select enabled, last_tick_at, last_dispatch_at, last_ticket_expired_at, last_dispatcher_secrets
		from app.notify_settings
		where singleton
	`;
	return {
		enabled: row?.enabled === true,
		lastTickAt: row?.last_tick_at ?? null,
		lastDispatchAt: row?.last_dispatch_at ?? null,
		lastTicketExpiredAt: row?.last_ticket_expired_at ?? null,
		lastDispatcherSecrets: row?.last_dispatcher_secrets ?? [],
	};
}

export interface SchedulerHealth {
	readonly healthy: boolean;
	readonly reasons: readonly string[];
	readonly lastTickMinutes: number | null;
}

const HEALTHY_TICK_MINUTES = 15;
const OVERDUE_MINUTES = 10;
const EXPIRED_TICKET_HOURS = 1;

async function overdueDigestCount(sql: Sql, at: Date): Promise<number> {
	const [exists] = await sql<{ present: boolean }[]>`
		select to_regprocedure('app.due_digests(timestamp with time zone, uuid)') is not null as present
	`;
	if (!exists?.present) {
		return 0;
	}
	const [row] = await sql<{ count: string }[]>`
		select count(*)::text as count
		from app.due_digests(${at}::timestamptz, null::uuid) d
		where d.due_at < ${at}::timestamptz - make_interval(mins => ${OVERDUE_MINUTES}::integer)
	`;
	return Number(row?.count ?? 0);
}

export async function schedulerHealth(
	sql: Sql,
	at: Date,
): Promise<SchedulerHealth> {
	const schedule = await notifySchedule(sql);
	const reasons: string[] = [];
	const lastTickMinutes =
		schedule.lastTickAt === null
			? null
			: Math.floor((at.getTime() - schedule.lastTickAt.getTime()) / 60_000);
	if (!schedule.enabled) {
		reasons.push("the Supabase schedule is disabled");
	}
	if (lastTickMinutes === null || lastTickMinutes >= HEALTHY_TICK_MINUTES) {
		reasons.push(`no notify tick in the last ${HEALTHY_TICK_MINUTES} minutes`);
	}
	const [overdue] = await sql<{ count: string }[]>`
		select count(*)::text as count
		from public.outbound_messages o
		where o.kind is not null
			and o.status in ('queued', 'held')
			and coalesce(o.not_before, o.created_at) < ${at}::timestamptz - make_interval(mins => ${OVERDUE_MINUTES}::integer)
	`;
	if (Number(overdue?.count ?? 0) > 0) {
		reasons.push(`${Number(overdue?.count ?? 0)} message(s) overdue`);
	}
	if (schedule.enabled) {
		const digests = await overdueDigestCount(sql, at);
		if (digests > 0) {
			reasons.push(`${digests} digest(s) overdue`);
		}
	}
	if (
		schedule.lastTicketExpiredAt !== null &&
		at.getTime() - schedule.lastTicketExpiredAt.getTime() <
			EXPIRED_TICKET_HOURS * 3_600_000
	) {
		reasons.push("a posted ticket expired unclaimed in the last hour");
	}
	return { healthy: reasons.length === 0, reasons, lastTickMinutes };
}
