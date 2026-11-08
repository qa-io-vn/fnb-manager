import { accountStatuses } from "../admin/status-queries.js";
import { statusWindow } from "../admin/status-window.js";
import { accountEntries } from "../config/config.js";
import type { CommandContext } from "../context.js";
import { connectAccount } from "../services.js";
import { accountLabel, numberAccounts } from "./account-numbers.js";
import {
	appliedMigrations,
	type DoctorCheck,
	databaseSizeHealth,
	isLocalDatabase,
	migrationDrift,
	migrationFiles,
	pauseRiskHealth,
	syncAgeHealth,
} from "./doctor-checks.js";
import { ageText, hoursSince } from "./formatting.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";

const MEGABYTE = 1024 * 1024;

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
		detail: `${(bytes / MEGABYTE).toFixed(1)} MB of the 500 MB free-plan limit (upgrade trigger about 400 MB)`,
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
		"Sync age: green within 26 h, yellow within 72 h, red beyond. Database size: yellow from 400 MB, red from 475 MB of the 500 MB free plan.",
	],
	run: doctor,
};
