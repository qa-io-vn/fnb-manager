import { randomUUID } from "node:crypto";
import {
	availableProviders,
	CLI_CYCLE_LIMITS,
	type CycleReport,
	createAdapterRegistry,
	createCycleBudget,
	formatLocalInstant,
	hasBaseUrlOverride,
	isFixtureTenantSlug,
	localIsoDate,
	type NotifyRepository,
	providersUseLoopback,
	runNotifyCycle,
	TEMPLATE_REFS,
	type TickSummary,
} from "@fnb/notify";
import {
	createPostgresDigestBuilder,
	createPostgresNotifyRepository,
	enqueueMessage,
	kickNotify,
	listDestinations,
	type MessageDecisionRow,
	messageDecisions,
	messageOutcomes,
	type NumberedDestination,
	notifySchedule,
	schedulerHealth,
	tenantNotifyStatus,
	waitingSummary,
} from "@fnb/notify/postgres";
import type { Sql } from "postgres";
import { requireTenant, type TenantRecord } from "../admin/tenants.js";
import {
	type CommandContext,
	flag,
	type OptionValues,
	requiredString,
	stringOption,
	UsageError,
} from "../context.js";
import { ageText } from "./formatting.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";

const INSTANT_PATTERN =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const MAX_BUDGET_SECONDS = 900;
const MAX_STATUS_DAYS = 400;
const DEFAULT_STATUS_DAYS = 14;
const ZALO_BOT_MONTHLY_QUOTA = 3000;
const TEST_MESSAGE_LIFETIME_MS = 3_600_000;

export function cliWorker(): string {
	return `cli:${process.pid}`;
}

export function instantOption(
	values: OptionValues,
	name: string,
): Date | undefined {
	const value = stringOption(values, name);
	if (value === undefined) {
		return undefined;
	}
	const parsed = new Date(value);
	if (!INSTANT_PATTERN.test(value) || Number.isNaN(parsed.getTime())) {
		throw new UsageError(
			`--${name} must be an ISO instant with an offset, for example 2026-11-09T00:31:00+07:00`,
		);
	}
	return parsed;
}

export function integerOption(
	values: OptionValues,
	name: string,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	const value = stringOption(values, name);
	if (value === undefined) {
		return fallback;
	}
	const parsed = Number(value);
	if (!/^\d+$/.test(value) || parsed < minimum || parsed > maximum) {
		throw new UsageError(
			`--${name} must be a whole number from ${minimum} to ${maximum}`,
		);
	}
	return parsed;
}

export function destinationLabel(destination: {
	readonly number: number;
	readonly kind: string;
}): string {
	return `destination ${destination.number} (${destination.kind})`;
}

export function scanNeedsTenant(
	context: CommandContext,
	simulated: boolean,
): boolean {
	return (
		simulated ||
		context.env.NOTIFY_INTEGRATION === "1" ||
		hasBaseUrlOverride(context.env)
	);
}

export function requireFixtureTenantForTestSends(
	context: CommandContext,
	slug: string | undefined,
	simulated: boolean,
): void {
	if (
		!scanNeedsTenant(context, simulated) ||
		(slug !== undefined && isFixtureTenantSlug(slug))
	) {
		return;
	}
	throw new UsageError(
		simulated
			? "--at sends only for a fixture tenant (a slug starting with notify-it-), because the simulated tick expires, recovers and sends that tenant's queue; add --dry-run to see the decisions for any tenant"
			: "a provider base-URL override or NOTIFY_INTEGRATION=1 sends only for a fixture tenant (a slug starting with notify-it-), because the mock server would record that tenant's messages as sent",
	);
}

function tenantLabel(
	context: CommandContext,
	tenant: Pick<TenantRecord, "slug">,
	index: number,
): string {
	return context.output.ci ? `tenant ${index + 1}` : tenant.slug;
}

function count(summary: TickSummary | null, key: string): number {
	const value = summary?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function releaseText(at: Date, release: Date, zone: string): string {
	const full = formatLocalInstant(release, zone);
	return localIsoDate(release, zone) === localIsoDate(at, zone)
		? full.slice(11)
		: full;
}

export function notifyRepository(
	context: CommandContext,
	sql: Sql,
	simulated: boolean,
): NotifyRepository {
	return createPostgresNotifyRepository(sql, {
		environment: context.env,
		simulatedClock: simulated,
	});
}

export async function runCliCycle(
	context: CommandContext,
	sql: Sql,
	options: {
		tenantId: string | null;
		at: Date | undefined;
		runSqlTick: boolean;
		wallSeconds: number;
		maxSends?: number;
		linkPollSeconds?: number;
		buildDigests?: boolean;
	},
): Promise<CycleReport> {
	const simulated = options.at !== undefined;
	const fixed = options.at;
	return runNotifyCycle({
		...(options.buildDigests === true
			? {
					digests: createPostgresDigestBuilder(sql, {
						environment: context.env,
						simulatedClock: simulated,
					}),
				}
			: {}),
		repository: notifyRepository(context, sql, simulated),
		adapters: createAdapterRegistry(),
		environment: context.env,
		runtime: "cli",
		worker: cliWorker(),
		tenantId: options.tenantId,
		clock: fixed === undefined ? context.now : () => fixed,
		fetch: (input, init) => fetch(input, init),
		log: (line) => context.output.error(line),
		budget: createCycleBudget({
			...CLI_CYCLE_LIMITS,
			wallSeconds: options.wallSeconds,
			...(options.maxSends === undefined ? {} : { maxSends: options.maxSends }),
			...(options.linkPollSeconds === undefined
				? {}
				: { linkPollSeconds: options.linkPollSeconds }),
		}),
		runSqlTick: options.runSqlTick,
		dryRun: false,
	});
}

async function tenantsWithWaitingMessages(sql: Sql): Promise<TenantRecord[]> {
	return sql<TenantRecord[]>`
		select t.id::text as id, t.slug, t.name, t.country_code, t.currency_code, t.timezone, t.legal_form::text as legal_form
		from public.tenants t
		where exists (
			select 1 from public.outbound_messages o
			where o.tenant_id = t.id and o.kind is not null and o.status in ('queued', 'held')
		)
		order by t.slug
	`;
}

async function tenantsWithNotifications(sql: Sql): Promise<TenantRecord[]> {
	return sql<TenantRecord[]>`
		select t.id::text as id, t.slug, t.name, t.country_code, t.currency_code, t.timezone, t.legal_form::text as legal_form
		from public.tenants t
		where exists (select 1 from public.notification_channels c where c.tenant_id = t.id)
			or exists (select 1 from public.outbound_messages o where o.tenant_id = t.id and o.kind is not null)
		order by t.slug
	`;
}

export function decisionLine(row: MessageDecisionRow, at: Date): string {
	if (row.decision === "hold" && row.releaseAt !== null) {
		return `message ${row.number}: held until ${formatLocalInstant(row.releaseAt, row.readerTimezone)}, ${row.reason ?? "held"}`;
	}
	if (row.decision === "cancel") {
		return `message ${row.number}: cancelled, ${row.reason ?? "cancelled"}`;
	}
	return `message ${row.number}: sends at the next claim at or after ${formatLocalInstant(at, row.readerTimezone)}`;
}

async function dryRunTick(
	context: CommandContext,
	sql: Sql,
	tenant: TenantRecord | null,
	at: Date,
): Promise<number> {
	const tenants = tenant ? [tenant] : await tenantsWithWaitingMessages(sql);
	let waiting = 0;
	for (const [index, scoped] of tenants.entries()) {
		const rows = await messageDecisions(sql, at, scoped.id);
		waiting += rows.length;
		if (tenants.length > 1 || !tenant) {
			context.output.line(`${tenantLabel(context, scoped, index)}:`);
		}
		for (const row of rows) {
			context.output.line(decisionLine(row, at));
		}
	}
	context.output.line(
		`tick: dry run, ${waiting} waiting message(s), nothing claimed or sent`,
	);
	return 0;
}

export function tickLine(
	report: CycleReport,
	waiting: Awaited<ReturnType<typeof waitingSummary>>,
	at: Date,
): string {
	const held =
		waiting.held > 0 &&
		waiting.nextReleaseAt !== null &&
		waiting.nextReleaseTimezone !== null
			? `held ${waiting.held} (next release ${releaseText(at, waiting.nextReleaseAt, waiting.nextReleaseTimezone)})`
			: `held ${waiting.held}`;
	const parts = [
		`imported ${count(report.tick, "imported")}`,
		`reconciled ${count(report.tick, "reconciled")}`,
		`digests built ${report.get("digests_built")}`,
		`messages sent ${report.get("sent")}`,
		held,
		`uncertain ${report.get("uncertain")}`,
		`failed ${report.get("failed")}`,
	];
	if (report.get("retried") > 0) {
		parts.push(`retrying ${report.get("retried")}`);
	}
	if (report.get("links_matched") + report.get("links_accepted") > 0) {
		parts.push(
			`links matched ${report.get("links_matched")}, accepted ${report.get("links_accepted")}`,
		);
	}
	if (report.stoppedBy !== null) {
		parts.push(`stopped by the budget (${report.stoppedBy})`);
	}
	return `tick: ${parts.join(" · ")}`;
}

async function tick(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const at = instantOption(values, "at");
	const slug = stringOption(values, "tenant");
	const dryRun = flag(values, "dry-run");
	const wallSeconds = integerOption(
		values,
		"budget-seconds",
		CLI_CYCLE_LIMITS.wallSeconds,
		1,
		MAX_BUDGET_SECONDS,
	);
	if (slug === undefined && scanNeedsTenant(context, at !== undefined)) {
		throw new UsageError(
			"--tenant is required with --at, a provider base-URL override or NOTIFY_INTEGRATION=1",
		);
	}
	if (
		at !== undefined &&
		!dryRun &&
		!providersUseLoopback(
			availableProviders(createAdapterRegistry()),
			context.env,
		)
	) {
		throw new UsageError(
			"--at sends only to a loopback mock server: point the base URL of every built provider (NOTIFY_ZALO_BOT_BASE_URL, NOTIFY_BREVO_BASE_URL) at http://127.0.0.1:<port>, or add --dry-run",
		);
	}
	if (!dryRun) {
		requireFixtureTenantForTestSends(context, slug, at !== undefined);
	}
	const { sql } = context.services.db();
	const tenant =
		slug === undefined
			? null
			: await requireTenant(sql, slug, context.output.ci);
	const now = at ?? context.now();
	if (flag(values, "skip-if-scheduler-healthy")) {
		const health = await schedulerHealth(sql, now);
		if (health.healthy) {
			context.output.line(
				`tick: skipped, the Supabase dispatcher is healthy (last tick ${health.lastTickMinutes ?? 0} min ago, nothing overdue)`,
			);
			return 0;
		}
		context.output.line(
			`tick: running here because ${health.reasons.join("; ")}`,
		);
	}
	if (dryRun) {
		return dryRunTick(context, sql, tenant, now);
	}
	const report = await runCliCycle(context, sql, {
		tenantId: tenant?.id ?? null,
		at,
		runSqlTick: true,
		wallSeconds,
		buildDigests: true,
	});
	const waiting = await waitingSummary(sql, tenant?.id ?? null);
	context.output.line(tickLine(report, waiting, now));
	context.output.summary(`- ${tickLine(report, waiting, now)}`);
	return 0;
}

function countList(entries: readonly { key: string; count: number }[]): string {
	return entries.length === 0
		? "none"
		: entries.map((entry) => `${entry.key} ${entry.count}`).join(", ");
}

async function status(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const slug = stringOption(values, "tenant");
	const days = integerOption(
		values,
		"days",
		DEFAULT_STATUS_DAYS,
		1,
		MAX_STATUS_DAYS,
	);
	const at = instantOption(values, "at") ?? context.now();
	const { sql } = context.services.db();
	const schedule = await notifySchedule(sql);
	context.output.line(
		`schedule: ${schedule.enabled ? "enabled" : "disabled"} · last tick ${ageText(schedule.lastTickAt, at)} · last dispatch ${ageText(schedule.lastDispatchAt, at)}${schedule.lastDispatcherSecrets.length > 0 ? ` · last dispatcher held ${schedule.lastDispatcherSecrets.join(", ")}` : ""}`,
	);
	const tenants =
		slug === undefined
			? await tenantsWithNotifications(sql)
			: [await requireTenant(sql, slug, context.output.ci)];
	if (tenants.length === 0) {
		context.output.line("no tenant has a destination or a notification yet");
		return 0;
	}
	for (const [index, tenant] of tenants.entries()) {
		const report = await tenantNotifyStatus(sql, tenant.id, at, days);
		const label = tenantLabel(context, tenant, index);
		context.output.line(
			`${label}: messages ${days} d: ${countList(report.messages)}`,
		);
		const waiting = report.waiting;
		context.output.line(
			`  waiting: queued ${waiting.queued}, held ${waiting.held}, uncertain ${waiting.uncertain}${waiting.nextReleaseAt && waiting.nextReleaseTimezone ? ` · next release ${formatLocalInstant(waiting.nextReleaseAt, waiting.nextReleaseTimezone)}` : ""}${waiting.oldestQueuedAt ? ` · oldest queued ${ageText(waiting.oldestQueuedAt, at)}` : ""}`,
		);
		if (report.destinations.length === 0) {
			context.output.line("  destinations: none");
		}
		for (const destination of report.destinations) {
			context.output.line(
				`  ${destinationLabel(destination)}: ${destination.enabled ? destination.status : `${destination.status}, switched off`} · last success ${ageText(destination.lastOkAt, at)} · this month ${destination.monthCount}${destination.lastErrorCode ? ` · last error ${destination.lastErrorCode}` : ""}${destination.consecutiveFailures > 0 ? ` · ${destination.consecutiveFailures} failure(s) in a row` : ""}`,
			);
		}
		for (const bot of report.botMonthCounts) {
			context.output.line(
				`  ${bot.key}: ${bot.count} of ${ZALO_BOT_MONTHLY_QUOTA} Zalo Bot messages this month`,
			);
		}
		context.output.line(`  open alerts: ${countList(report.openEpisodes)}`);
		context.output.line(`  digests ${days} d: ${countList(report.digests)}`);
	}
	return 0;
}

function outcomeText(
	outcome:
		| { status: string; decision: string | null; lastErrorCode: string | null }
		| undefined,
): string {
	if (!outcome) {
		return "not found";
	}
	switch (outcome.status) {
		case "sent":
		case "delivered":
			return "sent";
		case "queued":
		case "held":
			return "queued for the Supabase dispatcher";
		case "failed":
			return `failed (${outcome.lastErrorCode ?? "unknown"})`;
		case "cancelled":
			return `cancelled (${outcome.decision ?? "unknown"})`;
		case "uncertain":
			return `uncertain (${outcome.lastErrorCode ?? "unknown"})`;
		default:
			return outcome.status;
	}
}

async function test(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const slug = requiredString(values, "tenant");
	const chosen = stringOption(values, "destination");
	const number =
		chosen === undefined
			? undefined
			: integerOption(values, "destination", 1, 1, 10_000);
	requireFixtureTenantForTestSends(context, slug, false);
	const { sql } = context.services.db();
	const tenant = await requireTenant(sql, slug, context.output.ci);
	const destinations = await listDestinations(sql, tenant.id);
	const targets =
		number === undefined
			? destinations.filter(
					(destination) =>
						destination.status === "active" && destination.enabled,
				)
			: destinations.filter((destination) => destination.number === number);
	if (number !== undefined && targets.length === 0) {
		throw new UsageError(
			`the tenant has no destination ${number}; fnb notify status lists them`,
		);
	}
	if (targets.length === 0) {
		context.output.error(
			"no active destination to test; link one with fnb notify link",
		);
		return 1;
	}
	const at = context.now();
	const ids = new Map<string, NumberedDestination>();
	for (const destination of targets) {
		const id = await enqueueMessage(sql, {
			tenantId: tenant.id,
			channelId: destination.id,
			kind: "test",
			templateRef: TEMPLATE_REFS.test,
			dedupeKey: `test:${destination.id}:${randomUUID()}`,
			expiresAt: new Date(at.getTime() + TEST_MESSAGE_LIFETIME_MS),
			at,
		});
		ids.set(id, destination);
	}
	await kickNotify(sql, "kick");
	await runCliCycle(context, sql, {
		tenantId: tenant.id,
		at: undefined,
		runSqlTick: false,
		wallSeconds: CLI_CYCLE_LIMITS.wallSeconds,
		maxSends: ids.size + 20,
		linkPollSeconds: 0,
	});
	const outcomes = new Map(
		(await messageOutcomes(sql, [...ids.keys()])).map((row) => [row.id, row]),
	);
	let failures = 0;
	for (const [id, destination] of ids) {
		const outcome = outcomes.get(id);
		const text = outcomeText(outcome);
		if (
			outcome &&
			["failed", "cancelled", "uncertain"].includes(outcome.status)
		) {
			failures += 1;
		}
		context.output.line(`${destinationLabel(destination)}: ${text}`);
	}
	return failures > 0 ? 1 : 0;
}

const tickCommand: CommandSpec = {
	path: ["notify", "tick"],
	summary:
		"Send what is due: the SQL tick, link polling, then every due message",
	usage:
		"fnb notify tick [--tenant <slug>] [--at <ISO instant>] [--dry-run] [--budget-seconds <n>] [--skip-if-scheduler-healthy]",
	options: {
		...HELP_OPTION,
		tenant: { type: "string" },
		at: { type: "string" },
		"dry-run": { type: "boolean" },
		"budget-seconds": { type: "string" },
		"skip-if-scheduler-healthy": { type: "boolean" },
	},
	details: [
		"Runs one cycle exactly as the notify Edge Function does: app.notify_tick without posting a ticket, the digests that are due (built as their recipients and queued), link polling for bots with a pending code, then claims and sends every due message whose secret this machine holds.",
		"Every send decision (consent, quiet hours, daily caps) is taken in SQL at claim time; a message outside its window is held and released by a later tick.",
		"--dry-run claims nothing and prints each waiting message's decision at the given time, for example 'message 3: held until 2026-11-09 06:00 +07, outside_hours'.",
		"--at simulates the clock; it, a provider base-URL override or NOTIFY_INTEGRATION=1 require --tenant and send only for a fixture tenant (notify-it-…), and --at sends only when the provider base URLs point at a loopback mock server; --dry-run --at works for any tenant.",
		"--budget-seconds bounds the cycle's wall time (default 120).",
		"--skip-if-scheduler-healthy exits at once while the Supabase dispatcher is healthy: schedule enabled, a tick in the last 15 minutes, nothing overdue for more than 10 minutes, no posted ticket expired in the last hour.",
		"Output carries counts only; in CI no shop, member, address or amount is printed.",
	],
	run: tick,
};

const statusCommand: CommandSpec = {
	path: ["notify", "status"],
	summary: "Show the outbox, destinations, open alerts and digests per tenant",
	usage: "fnb notify status [--tenant <slug>] [--days 14] [--at <ISO instant>]",
	options: {
		...HELP_OPTION,
		tenant: { type: "string" },
		days: { type: "string" },
		at: { type: "string" },
	},
	details: [
		"Messages of the last --days by state, the next release time, the oldest queued message and the uncertain count.",
		"Per destination, numbered by creation: kind, status, last success, this month's count (the Zalo Bot Basic plan allows 3,000 a month) and the last error code.",
		"Open alert episodes by rule, digests of the last --days, the notify schedule and its last tick.",
		"In CI tenants are 'tenant n' and destinations 'destination n (kind)'; no name, address, chat id or amount is printed.",
	],
	run: status,
};

const testCommand: CommandSpec = {
	path: ["notify", "test"],
	summary: "Send one test message per active destination of a tenant",
	usage: "fnb notify test --tenant <slug> [--destination <n>]",
	options: {
		...HELP_OPTION,
		tenant: { type: "string" },
		destination: { type: "string" },
	},
	details: [
		"Enqueues a test message per active destination (or for destination n, as numbered by fnb notify status) and dispatches it inline.",
		"Test messages skip quiet hours and caps, never consent or destination state.",
		"Prints sent, 'queued for the Supabase dispatcher' (this machine lacks the destination's secret) or failed (<code>) per destination; exits 1 when a test failed.",
	],
	run: test,
};

export const notifyCommands: readonly CommandSpec[] = [
	tickCommand,
	statusCommand,
	testCommand,
];
