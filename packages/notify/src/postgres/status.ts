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

export const CHECK_TICK_MINUTES = 30;
export const CHECK_OVERDUE_MINUTES = 30;
export const CHECK_EXPIRED_TICKET_HOURS = 2;
export const CHECK_NO_SECRET_DAYS = 7;
export const CHECK_STALE_LEASE_MINUTES = 30;
export const CHECK_DIGEST_OVERDUE_HOURS = 2;
export const CHECK_FAILURES_IN_A_ROW = 3;

export interface FailingDestination {
	readonly tenantId: string;
	readonly number: number;
	readonly kind: string;
	readonly failures: number;
}

export interface NotifyHealth {
	readonly at: Date;
	readonly scheduleEnabled: boolean;
	readonly lastTickAt: Date | null;
	readonly lastTicketExpiredAt: Date | null;
	readonly overdueMessages: number;
	readonly missingSecrets: readonly StatusCount[];
	readonly staleLeases: number;
	readonly overdueDigests: number | null;
	readonly failingDestinations: readonly FailingDestination[];
}

export type HealthCondition =
	| "no_recent_tick"
	| "messages_overdue"
	| "ticket_expired"
	| "no_dispatcher_secret"
	| "lease_not_recovered"
	| "digest_overdue"
	| "destination_failing";

export interface HealthProblem {
	readonly condition: HealthCondition;
	readonly count: number;
	readonly detail: string;
}

async function functionExists(sql: Sql, signature: string): Promise<boolean> {
	const [row] = await sql<{ present: boolean }[]>`
		select to_regprocedure(${signature}) is not null as present
	`;
	return row?.present === true;
}

export async function notifyHealth(
	sql: Sql,
	at: Date,
	tenantId: string | null,
): Promise<NotifyHealth> {
	const schedule = await notifySchedule(sql);
	const [counts] = await sql<{ overdue: string; leases: string }[]>`
		select
			(
				select count(*)
				from public.outbound_messages o
				where o.kind is not null
					and o.status in ('queued', 'held')
					and coalesce(o.not_before, o.created_at) < ${at}::timestamptz - make_interval(mins => ${CHECK_OVERDUE_MINUTES}::integer)
					and (${tenantId}::uuid is null or o.tenant_id = ${tenantId}::uuid)
			)::text as overdue,
			(
				select count(*)
				from public.outbound_messages o
				where o.kind is not null
					and o.status = 'sending'
					and o.lease_until < ${at}::timestamptz - make_interval(mins => ${CHECK_STALE_LEASE_MINUTES}::integer)
					and (${tenantId}::uuid is null or o.tenant_id = ${tenantId}::uuid)
			)::text as leases
	`;
	const missing = await sql<{ key: string | null; count: string }[]>`
		select c.secret_name as key, count(*)::text as count
		from public.outbound_messages o
		left join public.notification_channels c on c.id = o.channel_id
		where o.kind is not null
			and o.status = 'cancelled'
			and o.decision = 'no_dispatcher_secret'
			and coalesce(o.expires_at, o.created_at) > ${at}::timestamptz - make_interval(days => ${CHECK_NO_SECRET_DAYS}::integer)
			and coalesce(o.expires_at, o.created_at) <= ${at}::timestamptz
			and (${tenantId}::uuid is null or o.tenant_id = ${tenantId}::uuid)
		group by c.secret_name
		order by c.secret_name nulls last
	`;
	let overdueDigests: number | null = null;
	if (
		await functionExists(sql, "app.due_digests(timestamp with time zone, uuid)")
	) {
		const [row] = await sql<{ count: string }[]>`
			select count(*)::text as count
			from app.due_digests(${at}::timestamptz, ${tenantId}::uuid) d
			where d.due_at < ${at}::timestamptz - make_interval(hours => ${CHECK_DIGEST_OVERDUE_HOURS}::integer)
		`;
		overdueDigests = Number(row?.count ?? 0);
	}
	const failing = await sql<
		{ tenant_id: string; number: string; kind: string; failures: number }[]
	>`
		select n.tenant_id, n.number, n.kind, n.failures
		from (
			select
				c.tenant_id::text as tenant_id,
				(row_number() over (partition by c.tenant_id order by c.created_at, c.id))::text as number,
				c.kind::text as kind,
				c.consecutive_failures as failures
			from public.notification_channels c
			where ${tenantId}::uuid is null or c.tenant_id = ${tenantId}::uuid
		) n
		where n.failures >= ${CHECK_FAILURES_IN_A_ROW}::integer
		order by n.tenant_id, n.number::integer
	`;
	return {
		at,
		scheduleEnabled: schedule.enabled,
		lastTickAt: schedule.lastTickAt,
		lastTicketExpiredAt: schedule.lastTicketExpiredAt,
		overdueMessages: Number(counts?.overdue ?? 0),
		missingSecrets: missing.map((row) => ({
			key: row.key ?? "the secret of a removed destination",
			count: Number(row.count),
		})),
		staleLeases: Number(counts?.leases ?? 0),
		overdueDigests,
		failingDestinations: failing.map((row) => ({
			tenantId: row.tenant_id,
			number: Number(row.number),
			kind: row.kind,
			failures: Number(row.failures),
		})),
	};
}

function minutesSince(at: Date, from: Date | null): number | null {
	return from === null
		? null
		: Math.floor((at.getTime() - from.getTime()) / 60_000);
}

export function defaultDestinationLabel(
	destination: FailingDestination,
): string {
	return `destination ${destination.number} (${destination.kind})`;
}

export function healthProblems(
	health: NotifyHealth,
	destinationLabel: (
		destination: FailingDestination,
	) => string = defaultDestinationLabel,
): HealthProblem[] {
	const problems: HealthProblem[] = [];
	const tickMinutes = minutesSince(health.at, health.lastTickAt);
	if (
		health.scheduleEnabled &&
		(tickMinutes === null || tickMinutes > CHECK_TICK_MINUTES)
	) {
		problems.push({
			condition: "no_recent_tick",
			count: 1,
			detail:
				tickMinutes === null
					? "the schedule is enabled but no notify tick has run"
					: `the schedule is enabled but the last notify tick was ${tickMinutes} min ago (limit ${CHECK_TICK_MINUTES})`,
		});
	}
	if (health.scheduleEnabled && health.overdueMessages > 0) {
		problems.push({
			condition: "messages_overdue",
			count: health.overdueMessages,
			detail: `${health.overdueMessages} queued or held message(s) due for more than ${CHECK_OVERDUE_MINUTES} min`,
		});
	}
	const expiredMinutes = minutesSince(health.at, health.lastTicketExpiredAt);
	if (
		health.scheduleEnabled &&
		expiredMinutes !== null &&
		expiredMinutes < CHECK_EXPIRED_TICKET_HOURS * 60
	) {
		problems.push({
			condition: "ticket_expired",
			count: 1,
			detail: `a posted ticket expired unclaimed ${Math.max(0, expiredMinutes)} min ago; check the function URL, the notify function and its secrets`,
		});
	}
	for (const secret of health.missingSecrets) {
		problems.push({
			condition: "no_dispatcher_secret",
			count: secret.count,
			detail: `${secret.count} message(s) cancelled in the last ${CHECK_NO_SECRET_DAYS} days because no dispatcher holds ${secret.key}`,
		});
	}
	if (health.staleLeases > 0) {
		problems.push({
			condition: "lease_not_recovered",
			count: health.staleLeases,
			detail: `${health.staleLeases} message(s) still sending ${CHECK_STALE_LEASE_MINUTES} min after their lease ran out; lease recovery is not running`,
		});
	}
	if (health.overdueDigests !== null && health.overdueDigests > 0) {
		problems.push({
			condition: "digest_overdue",
			count: health.overdueDigests,
			detail: `${health.overdueDigests} digest(s) due for more than ${CHECK_DIGEST_OVERDUE_HOURS} h and not built`,
		});
	}
	for (const destination of health.failingDestinations) {
		problems.push({
			condition: "destination_failing",
			count: destination.failures,
			detail: `${destinationLabel(destination)} failed ${destination.failures} times in a row`,
		});
	}
	return problems;
}

export interface NotificationSummary {
	readonly available: boolean;
	readonly sent: number;
	readonly held: number;
	readonly uncertain: number;
	readonly failed: number;
	readonly lastTickAt: Date | null;
}

export async function notificationsAvailable(sql: Sql): Promise<boolean> {
	const [row] = await sql<{ present: boolean }[]>`
		select to_regclass('app.notify_settings') is not null as present
	`;
	return row?.present === true;
}

export async function notificationSummary(
	sql: Sql,
	at: Date,
	days: number,
	tenantId: string | null,
): Promise<NotificationSummary> {
	if (!(await notificationsAvailable(sql))) {
		return {
			available: false,
			sent: 0,
			held: 0,
			uncertain: 0,
			failed: 0,
			lastTickAt: null,
		};
	}
	const [row] = await sql<
		{ sent: string; held: string; uncertain: string; failed: string }[]
	>`
		select
			count(*) filter (where o.status in ('sent', 'delivered'))::text as sent,
			count(*) filter (where o.status = 'held')::text as held,
			count(*) filter (where o.status = 'uncertain')::text as uncertain,
			count(*) filter (where o.status = 'failed')::text as failed
		from public.outbound_messages o
		where o.kind is not null
			and o.created_at >= ${at}::timestamptz - make_interval(days => ${days}::integer)
			and (${tenantId}::uuid is null or o.tenant_id = ${tenantId}::uuid)
	`;
	const schedule = await notifySchedule(sql);
	return {
		available: true,
		sent: Number(row?.sent ?? 0),
		held: Number(row?.held ?? 0),
		uncertain: Number(row?.uncertain ?? 0),
		failed: Number(row?.failed ?? 0),
		lastTickAt: schedule.lastTickAt,
	};
}

export interface DispatcherReport {
	readonly runtime: string;
	readonly names: readonly string[];
	readonly at: Date | null;
}

export interface DoctorNotifyFacts {
	readonly schedule: NotifySchedule;
	readonly destinations: number;
	readonly failingDestinations: number;
	readonly destinationSecrets: readonly string[];
	readonly dispatchers: readonly DispatcherReport[];
	readonly missingSecrets: readonly StatusCount[];
	readonly zaloMonthCounts: readonly StatusCount[];
}

export function dispatcherReports(value: unknown): DispatcherReport[] {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return [];
	}
	return Object.entries(value as Record<string, unknown>)
		.flatMap(([runtime, entry]) => {
			if (entry === null || typeof entry !== "object") {
				return [];
			}
			const { names, at } = entry as { names?: unknown; at?: unknown };
			const list = Array.isArray(names)
				? names.filter(
						(name): name is string =>
							typeof name === "string" && /^NOTIFY_[A-Z0-9_]{1,60}$/.test(name),
					)
				: [];
			const when = typeof at === "string" ? new Date(at) : null;
			return [
				{
					runtime,
					names: [...list].sort(),
					at: when !== null && !Number.isNaN(when.getTime()) ? when : null,
				},
			];
		})
		.sort((left, right) => left.runtime.localeCompare(right.runtime));
}

export async function doctorNotifyFacts(
	sql: Sql,
	at: Date,
): Promise<DoctorNotifyFacts> {
	const schedule = await notifySchedule(sql);
	const [destinations] = await sql<{ total: string; failing: string }[]>`
		select
			count(*) filter (where c.status in ('active', 'failing') and c.enabled)::text as total,
			count(*) filter (where c.enabled and (c.status = 'failing' or c.consecutive_failures >= ${CHECK_FAILURES_IN_A_ROW}::integer))::text as failing
		from public.notification_channels c
	`;
	const secrets = await sql<{ secret_name: string }[]>`
		select distinct c.secret_name
		from public.notification_channels c
		where c.status in ('active', 'failing') and c.enabled
		order by c.secret_name
	`;
	const [settings] = await sql<{ dispatcher_secrets: unknown }[]>`
		select dispatcher_secrets from app.notify_settings limit 1
	`;
	const zalo = await sql<{ key: string; count: string }[]>`
		select c.secret_name as key, count(o.id)::text as count
		from public.notification_channels c
		join public.tenants t on t.id = c.tenant_id
		join public.outbound_messages o on o.channel_id = c.id
		where c.kind = 'zalo_bot'
			and o.status in ('sending', 'sent', 'delivered', 'uncertain')
			and coalesce(o.sent_at, o.claimed_at) >= date_trunc('month', ${at}::timestamptz at time zone coalesce(c.timezone, t.timezone)) at time zone coalesce(c.timezone, t.timezone)
		group by c.secret_name
		order by c.secret_name
	`;
	const health = await notifyHealth(sql, at, null);
	return {
		schedule,
		destinations: Number(destinations?.total ?? 0),
		failingDestinations: Number(destinations?.failing ?? 0),
		destinationSecrets: secrets.map((row) => row.secret_name),
		dispatchers: dispatcherReports(settings?.dispatcher_secrets ?? null),
		missingSecrets: health.missingSecrets,
		zaloMonthCounts: zalo.map((row) => ({
			key: row.key,
			count: Number(row.count),
		})),
	};
}

export interface ResendableMessage {
	readonly id: string;
	readonly kind: string;
	readonly status: string;
	readonly businessDate: string | null;
	readonly createdAt: Date;
}

export async function resendableMessages(
	sql: Sql,
	tenantId: string,
	at: Date,
	days: number,
	limit = 20,
): Promise<ResendableMessage[]> {
	const rows = await sql<
		{
			id: string;
			kind: string;
			status: string;
			business_date: string | null;
			created_at: Date;
		}[]
	>`
		select o.id::text as id, o.kind, o.status, o.business_date::text as business_date, o.created_at
		from public.outbound_messages o
		where o.tenant_id = ${tenantId}::uuid
			and o.kind in ('digest', 'digest_correction', 'alert', 'alert_reminder', 'alert_resolved')
			and o.status in ('uncertain', 'failed')
			and o.created_at >= ${at}::timestamptz - make_interval(days => ${days}::integer)
		order by o.created_at desc, o.id
		limit ${limit}
	`;
	return rows.map((row) => ({
		id: row.id,
		kind: row.kind,
		status: row.status,
		businessDate: row.business_date,
		createdAt: row.created_at,
	}));
}

export interface MessageOwner {
	readonly tenantId: string;
	readonly kind: string | null;
	readonly status: string;
}

export async function messageOwner(
	sql: Sql,
	messageId: string,
): Promise<MessageOwner | null> {
	const [row] = await sql<
		{ tenant_id: string; kind: string | null; status: string }[]
	>`
		select tenant_id::text as tenant_id, kind, status
		from public.outbound_messages
		where id = ${messageId}::uuid
	`;
	return row
		? { tenantId: row.tenant_id, kind: row.kind, status: row.status }
		: null;
}
