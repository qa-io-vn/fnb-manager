import { connectAccount } from "@fnb/runner";
import {
	accountStatuses,
	openingHoursCoverage,
	openSyncAlerts,
} from "../admin/status-queries.js";
import { statusWindow } from "../admin/status-window.js";
import { accountEntries } from "../config/config.js";
import type { CommandContext } from "../context.js";
import { accountLabel, numberAccounts } from "./account-numbers.js";
import {
	alertCounts,
	alertsCheck,
	appliedMigrations,
	type DoctorCheck,
	databaseSizeDetail,
	databaseSizeHealth,
	isLocalDatabase,
	migrationDrift,
	migrationFiles,
	openingHoursCheck,
	pauseRiskHealth,
	syncAgeHealth,
} from "./doctor-checks.js";
import { ageText, hoursSince } from "./formatting.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";

async function databaseChecks(context: CommandContext): Promise<DoctorCheck[]> {
	const { sql, setting } = context.services.db();
	const checks: DoctorCheck[] = [];
	const [info] = await sql<{ size: string; version: string }[]>`
		select pg_database_size(current_database())::text as size, current_setting('server_version') as version
	`;
	const bytes = Number(info?.size ?? 0);
	checks.push({
		name: "database",
		health: "green",
		detail: `reachable through ${setting.variable}, PostgreSQL ${info?.version ?? "?"}`,
	});
	checks.push({
		name: "database size",
		health: databaseSizeHealth(bytes),
		detail: databaseSizeDetail(bytes),
	});
	const applied = await appliedMigrations(sql);
	const files = migrationFiles(context.rootDir);
	if (applied === null) {
		checks.push({
			name: "migrations",
			health: "red",
			detail: "supabase_migrations.schema_migrations is missing",
		});
	} else {
		const drift = migrationDrift(files, applied);
		checks.push({
			name: "migrations",
			health:
				drift.missing.length > 0
					? "red"
					: drift.unknown.length > 0
						? "yellow"
						: "green",
			detail: `${applied.length} applied, ${files.length} files, ${drift.missing.length} not applied${drift.missing.length > 0 ? ` (${drift.missing.join(", ")})` : ""}, ${drift.unknown.length} applied without a file`,
		});
	}
	return checks;
}

async function accountChecks(context: CommandContext): Promise<DoctorCheck[]> {
	const entries = accountEntries(context.env);
	if (entries.length === 0) {
		return [
			{
				name: "POS accounts",
				health: "yellow",
				detail: "POS_ACCOUNTS_JSON lists no accounts",
			},
		];
	}
	const checks: DoctorCheck[] = [];
	for (const [index, entry] of entries.entries()) {
		const name = `login ${context.output.label("account", index, entry.key)}`;
		try {
			await connectAccount(entry, context.env);
			checks.push({
				name,
				health: "green",
				detail: `authenticated through ${entry.connector}`,
			});
		} catch (error) {
			checks.push({
				name,
				health: "red",
				detail: context.redact(
					error instanceof Error ? error.message : String(error),
				),
			});
		}
	}
	return checks;
}

async function syncChecks(
	context: CommandContext,
	local: boolean,
): Promise<DoctorCheck[]> {
	const { sql } = context.services.db();
	const now = context.now();
	const window = statusWindow(now);
	const accounts = numberAccounts(
		accountEntries(context.env),
		await accountStatuses(sql, undefined, window),
	);
	const checks: DoctorCheck[] = accounts.map((numbered) => {
		const { account } = numbered;
		return {
			name: `last sync ${accountLabel(context.output, numbered)}`,
			health:
				account.status === "paused"
					? "yellow"
					: syncAgeHealth(hoursSince(account.last_success_at, now)),
			detail: `${account.status}, last successful window ${ageText(account.last_success_at, now)} ago, ${account.failed_runs} failed run(s) in ${window.days} days`,
		};
	});
	if (accounts.length === 0) {
		checks.push({
			name: "last sync",
			health: "yellow",
			detail: "no POS account onboarded yet",
		});
	}
	const latest = accounts
		.map(({ account }) => account.last_success_at)
		.filter((value): value is Date => value !== null)
		.sort((left, right) => right.getTime() - left.getTime())[0];
	const idleHours = hoursSince(latest ?? null, now);
	checks.push(
		local
			? {
					name: "pause risk",
					health: "unavailable",
					detail:
						"local stack; the free-plan pause applies to the cloud project only",
				}
			: {
					name: "pause risk",
					health: pauseRiskHealth(idleHours === null ? null : idleHours / 24),
					detail: `free projects pause after 7 days without activity; last successful sync ${ageText(latest ?? null, now)} ago`,
				},
	);
	return checks;
}

async function scheduleCheck(context: CommandContext): Promise<DoctorCheck> {
	const name = "incremental schedule";
	try {
		const enabled = await context.services
			.db()
			.runner.incrementalScheduleEnabled();
		return enabled
			? {
					name,
					health: "green",
					detail:
						"enabled: pg_cron calls sync-incremental every 30 minutes for each store that is open",
				}
			: {
					name,
					health: "yellow",
					detail:
						"disabled: only the nightly run refreshes the data; docs/go-live.md shows how to enable it",
				};
	} catch {
		return {
			name,
			health: "unavailable",
			detail: "app.incremental_sync_settings is missing; apply the migrations",
		};
	}
}

async function incrementalChecks(
	context: CommandContext,
): Promise<DoctorCheck[]> {
	const { sql } = context.services.db();
	const checks: DoctorCheck[] = [];
	const alerts = await openSyncAlerts(sql);
	checks.push(
		alerts === null
			? {
					name: "sync alerts",
					health: "unavailable",
					detail: "app.sync_alerts is missing; apply the migrations",
				}
			: alertsCheck(
					alertCounts(alerts),
					await context.services.db().runner.incrementalScheduleEnabled(),
				),
	);
	const coverage = await openingHoursCoverage(sql);
	checks.push(
		coverage === null
			? {
					name: "opening hours",
					health: "unavailable",
					detail: "app.opening_hours_known is missing; apply the migrations",
				}
			: openingHoursCheck(coverage),
	);
	return checks;
}

const UNMEASURED: DoctorCheck[] = [
	{
		name: "disk",
		health: "unavailable",
		detail:
			"not measurable from the database; see the Supabase dashboard usage page",
	},
	{
		name: "egress",
		health: "unavailable",
		detail:
			"not measurable from the database; see the Supabase dashboard usage page",
	},
];

async function doctor(context: CommandContext): Promise<number> {
	const checks: DoctorCheck[] = [];
	let databaseReachable = true;
	try {
		checks.push(...(await databaseChecks(context)));
	} catch (error) {
		databaseReachable = false;
		checks.push({
			name: "database",
			health: "red",
			detail: context.redact(
				error instanceof Error ? error.message : String(error),
			),
		});
	}
	checks.push(...(await accountChecks(context)));
	if (databaseReachable) {
		const local = isLocalDatabase(context.services.db().setting.url);
		checks.push(...(await syncChecks(context, local)));
		checks.push(await scheduleCheck(context));
		checks.push(...(await incrementalChecks(context)));
	}
	checks.push(...UNMEASURED);
	context.output.table(
		["check", "health", "detail"],
		checks.map((check) => [check.name, check.health, check.detail]),
	);
	const red = checks.filter((check) => check.health === "red").length;
	context.output.line();
	context.output.line(
		red === 0 ? "doctor: nothing red" : `doctor: ${red} red check(s)`,
	);
	return red === 0 ? 0 : 1;
}

export const doctorCommand: CommandSpec = {
	path: ["doctor"],
	summary:
		"Check the database, migrations, POS logins, sync freshness and free-plan limits",
	usage: "fnb doctor",
	options: { ...HELP_OPTION },
	details: [
		"Needs DATABASE_URL (or SUPABASE_DB_URL) and POS_ACCOUNTS_JSON; every configured account logs in once.",
		"In CI a login and the last sync of an account listed in POS_ACCOUNTS_JSON are labelled by its position there (account 1 is the first entry); the last sync of an onboarded account missing from it is labelled other 1, other 2, … in tenant and key order, as in fnb status.",
		"Exits 1 when any check is red. Disk and egress are reported as unavailable: only the Supabase dashboard measures them.",
		"Sync age: green within 26 h, yellow within 72 h, red beyond. Database size is in MiB (1 MiB = 1,048,576 bytes), the unit of pg_size_pretty with which Supabase measures its 500 MB free-plan quota: yellow from 400 MiB, red from 475 MiB.",
		"Sync alerts: red while app.sync_alerts holds an open alert, raised by the scheduler itself at every tick: a watched store over the 90-minute dead-man threshold, or a scheduled call that expired unclaimed. Opening hours: yellow when an active store's hours were entered without a usable span (it is then synced at every tick).",
	],
	run: doctor,
};
