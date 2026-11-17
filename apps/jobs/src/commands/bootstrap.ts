import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AccountEntry } from "@fnb/runner";
import type { AccountRecord, StoreRecord } from "@fnb/sync";
import { createAuthUser } from "../admin/auth-users.js";
import {
	databaseBytes,
	masterDataLoaded,
	storedSales,
	uncoveredStoreDays,
} from "../admin/history-queries.js";
import {
	countOwners,
	findAuthUserId,
	findMemberRole,
	findTenant,
	insertTenant,
	type TenantRecord,
	upsertMember,
} from "../admin/tenants.js";
import { accountEntries } from "../config/config.js";
import {
	type CommandContext,
	type OptionValues,
	stringOption,
	UsageError,
} from "../context.js";
import { resolveAccount } from "./accounts.js";
import {
	type BackendTarget,
	backendTarget,
	describeEndpoint,
	WEB_ENV_FILE,
	webEnvPlan,
	webEnvWarnings,
} from "./backend-target.js";
import {
	appliedMigrations,
	databaseSizeDetail,
	migrationDrift,
	migrationFiles,
	toMebibytes,
} from "./doctor-checks.js";
import {
	DEFAULT_MAX_MONTHS,
	DEFAULT_STOP_AFTER_EMPTY_MONTHS,
	type HistoryPort,
	historyFloor,
	latestBusinessDate,
	refreshWindows,
	syncedSpan,
	type WalkedMonth,
	type WalkResult,
	type WalkStop,
	walkHistory,
	walkTotals,
} from "./history-walk.js";
import { onboardCommand } from "./onboard.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";
import { syncAccountWindow } from "./sync.js";
import { selectStores } from "./sync-selection.js";
import {
	EMAIL_PATTERN,
	SLUG_PATTERN,
	tenantInput,
	tenantName,
} from "./tenant.js";

export const DEFAULT_TENANT_SLUG = "live-local";
const MIN_PASSWORD_LENGTH = 12;

export interface BootstrapOptions {
	slug: string;
	name: string;
	email: string | null;
	maxMonths: number;
	stopAfterEmpty: number;
}

type AccountStatus = "walked" | "paused" | "no_stores" | "failed";

interface AccountOutcome {
	label: string;
	status: AccountStatus;
	result: WalkResult | null;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function positiveInteger(
	values: OptionValues,
	name: string,
	fallback: number,
): number {
	const raw = stringOption(values, name);
	if (raw === undefined) {
		return fallback;
	}
	const number = Number(raw);
	if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(number)) {
		throw new UsageError(`--${name} must be a whole number from 1`);
	}
	return number;
}

export function bootstrapOptions(
	context: Pick<CommandContext, "env">,
	values: OptionValues,
): BootstrapOptions {
	const slug =
		stringOption(values, "tenant") ||
		context.env.LIVE_TENANT ||
		DEFAULT_TENANT_SLUG;
	if (!SLUG_PATTERN.test(slug)) {
		throw new UsageError(
			"--tenant must be 2–63 lower-case letters, digits or hyphens",
		);
	}
	const email = (
		stringOption(values, "email") ??
		context.env.FNB_MEMBER_EMAIL ??
		""
	).trim();
	if (email !== "" && !EMAIL_PATTERN.test(email)) {
		throw new UsageError(
			"--email (or FNB_MEMBER_EMAIL) is not an e-mail address",
		);
	}
	return {
		slug,
		name: stringOption(values, "name")?.trim() || slug,
		email: email === "" ? null : email,
		maxMonths: positiveInteger(values, "max-months", DEFAULT_MAX_MONTHS),
		stopAfterEmpty: positiveInteger(
			values,
			"stop-after-empty",
			DEFAULT_STOP_AFTER_EMPTY_MONTHS,
		),
	};
}

function printTarget(context: CommandContext, target: BackendTarget): void {
	const api =
		target.api === null
			? "SUPABASE_URL is not set"
			: `API from SUPABASE_URL (${describeEndpoint(target.api)})`;
	context.output.line(
		`target: database from ${target.databaseVariable} (${describeEndpoint(target.database)}), ${api}`,
	);
	if (target.api === null) {
		context.output.error(
			"target: without SUPABASE_URL neither apps/web/.env.local nor a new owner login can be written; the data still loads",
		);
	}
}

async function databaseProblem(
	context: CommandContext,
): Promise<string | null> {
	const { sql } = context.services.db();
	let applied: string[] | null;
	try {
		applied = await appliedMigrations(sql);
	} catch (error) {
		return `cannot reach the database (${errorText(error)}); start the local stack with pnpm db:start, or check the connection string in .env`;
	}
	if (applied === null) {
		return "the database has no supabase_migrations.schema_migrations table; apply the migrations first";
	}
	const drift = migrationDrift(migrationFiles(context.rootDir), applied);
	if (drift.missing.length > 0) {
		return `${drift.missing.length} migration(s) of supabase/migrations are not applied: run pnpm exec supabase migration up on the local stack (never db reset) or the Migrate workflow on the cloud project`;
	}
	return null;
}

async function ensureTenant(
	context: CommandContext,
	options: BootstrapOptions,
): Promise<TenantRecord> {
	const { sql } = context.services.db();
	const name = tenantName(context, options.slug);
	const existing = await findTenant(sql, options.slug);
	if (existing) {
		context.output.line(`tenant: ${name} exists, kept as it is`);
		return existing;
	}
	const created = await insertTenant(
		sql,
		tenantInput({ slug: options.slug, name: options.name }),
	);
	if (created) {
		context.output.line(`tenant: ${name} was created`);
		return created;
	}
	const raced = await findTenant(sql, options.slug);
	if (!raced) {
		throw new Error("tenant insert neither created nor found a row");
	}
	return raced;
}

async function ensureOwner(
	context: CommandContext,
	tenant: TenantRecord,
	options: BootstrapOptions,
): Promise<boolean> {
	const { output } = context;
	const { sql } = context.services.db();
	const name = tenantName(context, tenant.slug);
	if (options.email === null) {
		const owners = await countOwners(sql, tenant.id);
		if (owners > 0) {
			output.line(`owner: ${name} has ${owners} owner login(s), kept`);
		} else {
			output.error(
				`owner: ${name} has no owner login yet; pass --email <address> (or set FNB_MEMBER_EMAIL) with FNB_MEMBER_PASSWORD in .env to create one. The data still loads.`,
			);
		}
		return true;
	}
	const who = output.ci ? "the login" : options.email;
	let userId = await findAuthUserId(sql, options.email);
	if (userId) {
		const role = await findMemberRole(sql, tenant.id, userId);
		if (role) {
			output.line(`owner: ${who} is already ${role} of ${name}, kept`);
			return true;
		}
	} else {
		const password = context.env.FNB_MEMBER_PASSWORD ?? "";
		if (password.length < MIN_PASSWORD_LENGTH) {
			output.error(
				`owner: no login exists for ${who}; set FNB_MEMBER_PASSWORD (at least ${MIN_PASSWORD_LENGTH} characters) in .env so it can be created, then run this again`,
			);
			return false;
		}
		userId = await createAuthUser(
			context.services.supabaseAdmin(),
			options.email,
			{ kind: "password", password },
		);
		output.line(
			output.ci
				? "owner: login created"
				: `owner: login created for ${options.email}`,
		);
	}
	await upsertMember(sql, tenant.id, userId, "owner");
	output.line(`owner: ${who} is now owner of ${name}`);
	return true;
}

function ensureWebEnv(context: CommandContext): boolean {
	const { output } = context;
	const path = join(context.rootDir, WEB_ENV_FILE);
	if (existsSync(path)) {
		output.line(`web app: ${WEB_ENV_FILE} exists, left as it is`);
		const warnings = webEnvWarnings(readFileSync(path, "utf8"), context.env);
		for (const warning of warnings) {
			output.error(`web app: ${warning}`);
		}
		return warnings.length === 0;
	}
	const plan = webEnvPlan(context.env);
	if (plan.kind === "missing") {
		output.error(
			`web app: ${WEB_ENV_FILE} not written: set ${plan.variables.join(" and ")} in .env (pnpm db:status prints the local values), or copy apps/web/.env.example to it and fill it`,
		);
		return false;
	}
	writeFileSync(path, plan.content, { flag: "wx" });
	output.line(
		`web app: ${WEB_ENV_FILE} written from SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY`,
	);
	return true;
}

async function ensureOnboarded(
	context: CommandContext,
	slug: string,
	entry: AccountEntry,
	label: string,
): Promise<AccountRecord | null> {
	const { sql, repository } = context.services.db();
	const [existing] = await repository.findAccounts(entry.key, slug);
	if (existing && (await masterDataLoaded(sql, existing.id))) {
		context.output.line(`${label}: onboarded with its catalogue, kept`);
		return existing;
	}
	context.output.line(`${label}: onboarding`);
	const code = await onboardCommand.run(context, {
		tenant: slug,
		account: entry.key,
	});
	if (code !== 0) {
		return null;
	}
	return resolveAccount(repository, entry.key, slug);
}

function historyPort(
	context: CommandContext,
	slug: string,
	entry: AccountEntry,
	index: number,
	account: AccountRecord,
	stores: readonly StoreRecord[],
): HistoryPort {
	const { sql } = context.services.db();
	const label = context.output.label("account", index, entry.key);
	const storeIds = stores.map((store) => store.id);
	return {
		isSynced: async (window) =>
			(await uncoveredStoreDays(sql, account.id, storeIds, window)) === 0,
		storedSales: (window) => storedSales(sql, storeIds, window),
		async sync(window) {
			context.output.line(
				`${label} ${window.month}: loading ${window.fromDate}..${window.toDate}`,
			);
			const summary = await syncAccountWindow(
				context,
				{
					window: { fromDate: window.fromDate, toDate: window.toDate },
					kind: "backfill",
					dryRun: false,
					tenant: slug,
					stores: [],
				},
				entry,
				index,
			);
			if (summary === null) {
				return {
					succeeded: false,
					sales: 0,
					error: "the account is paused or has no active store",
				};
			}
			return {
				succeeded: summary.status === "succeeded",
				sales: summary.stores.reduce(
					(sum, store) => sum + store.pulledSales,
					0,
				),
				error: summary.error,
			};
		},
	};
}

export function monthLine(label: string, month: WalkedMonth): string {
	const prefix = `${label} ${month.window.month}`;
	switch (month.action) {
		case "skipped":
			return `${prefix}: already loaded, skipped (${month.sales ?? 0} sales stored)`;
		case "synced":
			return `${prefix}: loaded, ${month.sales ?? 0} sales`;
		default:
			return `${prefix}: failed${month.error ? ` (${month.error})` : ""}`;
	}
}

export function stopText(stop: WalkStop, options: BootstrapOptions): string {
	switch (stop) {
		case "empty_months":
			return `${options.stopAfterEmpty} month(s) without sales`;
		case "before_opening":
			return "stores' opening date";
		case "max_months":
			return `--max-months ${options.maxMonths}`;
		default:
			return "failed month";
	}
}

async function loadAccount(
	context: CommandContext,
	options: BootstrapOptions,
	entry: AccountEntry,
	index: number,
): Promise<AccountOutcome> {
	const { output } = context;
	const label = output.label("account", index, entry.key);
	const account = await ensureOnboarded(context, options.slug, entry, label);
	if (!account) {
		output.error(`${label}: onboarding failed; fix it and run this again`);
		return { label, status: "failed", result: null };
	}
	if (account.status === "paused") {
		output.line(`${label}: paused, skipped`);
		return { label, status: "paused", result: null };
	}
	const { repository } = context.services.db();
	const stores = selectStores(await repository.listStores(account.id), []);
	if (stores.length === 0) {
		output.line(`${label}: no active stores, nothing to load`);
		return { label, status: "no_stores", result: null };
	}
	const result = await walkHistory(
		historyPort(context, options.slug, entry, index, account, stores),
		{
			today: latestBusinessDate(stores, context.now()),
			openedOn: historyFloor(stores),
			stopAfterEmpty: options.stopAfterEmpty,
			maxMonths: options.maxMonths,
			onMonth: (month) => {
				const line = monthLine(label, month);
				if (month.action === "failed") {
					output.error(line);
				} else {
					output.line(line);
				}
			},
		},
	);
	return { label, status: "walked", result };
}

async function refreshLoadedSpan(
	context: CommandContext,
	tenant: TenantRecord,
	results: readonly WalkResult[],
): Promise<boolean> {
	const { output } = context;
	const span = syncedSpan(results);
	if (span === null) {
		output.line("analytics: nothing was loaded in this run, no refresh needed");
		return true;
	}
	const { repository } = context.services.db();
	const windows = refreshWindows(span);
	const started = context.now().getTime();
	let rows = 0;
	for (const window of windows) {
		try {
			const result = await repository.refreshAnalytics(tenant.id, {
				from: window.fromDate,
				to: window.toDate,
			});
			if (!result.available) {
				output.error(
					"analytics: app.refresh_analytics is missing; apply the migrations and run this again",
				);
				return false;
			}
			rows += result.rows;
		} catch (error) {
			output.error(
				`analytics: refreshing ${window.month} failed (${errorText(error)}); run this again`,
			);
			return false;
		}
	}
	const seconds = (context.now().getTime() - started) / 1000;
	output.line(
		`analytics: refreshed ${span.fromDate}..${span.toDate} month by month, ${windows.length} month(s), ${rows} rows in ${seconds.toFixed(1)} s`,
	);
	return true;
}

function printOutcomes(
	context: CommandContext,
	outcomes: readonly AccountOutcome[],
	options: BootstrapOptions,
): void {
	context.output.table(
		[
			"account",
			"loaded",
			"skipped",
			"failed",
			"months with sales",
			"oldest month with sales",
			"stopped at",
		],
		outcomes.map((outcome) => {
			if (outcome.result === null) {
				return [
					outcome.label,
					null,
					null,
					null,
					null,
					null,
					outcome.status.replace("_", " "),
				];
			}
			const totals = walkTotals(outcome.result);
			return [
				outcome.label,
				totals.synced,
				totals.skipped,
				totals.failed,
				totals.withSales,
				totals.oldestWithSales,
				stopText(outcome.result.stop, options),
			];
		}),
	);
}

async function printDatabaseSize(
	context: CommandContext,
	target: BackendTarget,
): Promise<void> {
	const bytes = await databaseBytes(context.services.db().sql);
	context.output.line(
		target.database.locality === "remote"
			? `database: ${databaseSizeDetail(bytes)}`
			: `database: ${toMebibytes(bytes).toFixed(1)} MiB`,
	);
}

function printNextSteps(
	context: CommandContext,
	options: BootstrapOptions,
	webReady: boolean,
): void {
	const { output } = context;
	const login =
		options.email === null
			? "an owner login of the tenant"
			: output.ci
				? "the owner e-mail (--email or FNB_MEMBER_EMAIL) and FNB_MEMBER_PASSWORD"
				: `${options.email} and FNB_MEMBER_PASSWORD`;
	output.line();
	output.line("next steps:");
	output.line(
		webReady
			? "  1. pnpm --filter @fnb/web dev, then open http://localhost:5173"
			: `  1. fix ${WEB_ENV_FILE} as said above, then pnpm --filter @fnb/web dev and open http://localhost:5173`,
	);
	output.line(`  2. sign in with ${login}`);
	output.line(
		"  3. run this again at any time: it skips the months already loaded and loads the current month again",
	);
	output.line(
		`  4. CI=1 pnpm --filter @fnb/jobs fnb -- status${output.ci ? "" : ` --tenant ${options.slug}`} shows the latest verified day per store`,
	);
}

async function bootstrap(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const { output } = context;
	const options = bootstrapOptions(context, values);
	const entries = accountEntries(context.env);
	if (entries.length === 0) {
		throw new UsageError("POS_ACCOUNTS_JSON lists no accounts");
	}
	if (!output.ci) {
		output.line(
			"note: CI is not set, so this output names accounts and stores; pnpm db:load-real sets CI=1 for output you can share",
		);
	}
	const target = backendTarget(context.env);
	printTarget(context, target);
	if (target.problem !== null) {
		output.error(`target: ${target.problem}`);
		return 1;
	}
	const problem = await databaseProblem(context);
	if (problem !== null) {
		output.error(`database: ${problem}`);
		return 1;
	}
	const tenant = await ensureTenant(context, options);
	if (!(await ensureOwner(context, tenant, options))) {
		return 1;
	}
	const webReady = ensureWebEnv(context);
	const outcomes: AccountOutcome[] = [];
	for (const [index, entry] of entries.entries()) {
		const label = output.label("account", index, entry.key);
		try {
			outcomes.push(await loadAccount(context, options, entry, index));
		} catch (error) {
			output.error(`${label}: ${errorText(error)}`);
			outcomes.push({ label, status: "failed", result: null });
		}
	}
	const results = outcomes.flatMap((outcome) =>
		outcome.result === null ? [] : [outcome.result],
	);
	const refreshed = await refreshLoadedSpan(context, tenant, results);
	output.line();
	printOutcomes(context, outcomes, options);
	await printDatabaseSize(context, target);
	printNextSteps(context, options, webReady);
	const failed = outcomes.some(
		(outcome) =>
			outcome.status === "failed" || outcome.result?.stop === "failed",
	);
	return failed || !refreshed ? 1 : 0;
}

export const bootstrapCommand: CommandSpec = {
	path: ["bootstrap"],
	summary:
		"Load the full POS history into the database and point the web app at it (resumable)",
	usage:
		"fnb bootstrap [--tenant <slug>] [--name <name>] [--email <address>] [--max-months <n>] [--stop-after-empty <n>]",
	options: {
		...HELP_OPTION,
		tenant: { type: "string" },
		name: { type: "string" },
		email: { type: "string" },
		"max-months": { type: "string" },
		"stop-after-empty": { type: "string" },
	},
	details: [
		"Needs DATABASE_URL (or SUPABASE_DB_URL), POS_ACCOUNTS_JSON (plus IPOS_APP_KEY for ipos-fabi), SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for apps/web/.env.local, and SUPABASE_SECRET_KEY with FNB_MEMBER_PASSWORD when the owner login has to be created.",
		"Refuses to start when the database and SUPABASE_URL point at different backends (the local stack and a remote project, or two projects), when the database cannot be reached or when a migration of supabase/migrations is not applied. It never resets or stops the stack.",
		`Creates the tenant --tenant (default LIVE_TENANT, else ${DEFAULT_TENANT_SLUG}; --name defaults to the slug) unless it exists, and makes the --email login (or FNB_MEMBER_EMAIL) its owner unless it already has a role there; a missing login is created with FNB_MEMBER_PASSWORD.`,
		`Writes ${WEB_ENV_FILE} from SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY only when the file is missing; an existing file is never overwritten.`,
		"Onboards every POS_ACCOUNTS_JSON entry whose catalogue was never loaded, then walks back one month per sync window --kind backfill run, starting with the current month.",
		"A past month is skipped when every business date of every active store falls inside a succeeded window run of the account that started after that date closed (sync_runs); the current month is always loaded again.",
		`An account's walk stops after --stop-after-empty months in a row without sales (default ${DEFAULT_STOP_AFTER_EMPTY_MONTHS}), before the stores' opening date when every store has one, at --max-months (default ${DEFAULT_MAX_MONTHS}) or at a failed month.`,
		"Each run refreshes the analytics of its month; at the end the span loaded in this invocation is refreshed again month by month, oldest first, so aggregates that reach across a month boundary see both months.",
		"Safe to interrupt and run again. Run it with CI=1 (pnpm db:load-real does) so the output numbers accounts and stores instead of naming them.",
	],
	run: bootstrap,
};
