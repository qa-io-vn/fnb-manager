import { shiftIsoDate } from "@fnb/core";
import {
	type FastLaneRun,
	fastLaneEnabled,
	fastLaneWindow,
	LOYALTY_FAST_LANE_VARIABLE,
	type LoyaltyCounts,
	type LoyaltyDatabase,
	type LoyaltyStepOutcome,
	loyaltyLine,
	outcomeLine,
	reconcileLoyaltySafely,
	runIncrementalStore,
	windowDays,
} from "@fnb/runner";
import {
	type Redactor,
	type SyncRepository,
	safeErrorMessage,
} from "@fnb/sync";
import { findTenant } from "../admin/tenants.js";
import { accountEntries } from "../config/config.js";
import {
	type CommandContext,
	flag,
	type OptionValues,
	stringOption,
	triggeredBy,
	UsageError,
} from "../context.js";
import { iposSnapshots } from "./ipos.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";

export const NIGHTLY_RECONCILE_DAYS = 14;
export const FAST_LANE_CLAIM_LIMIT = 5;

export interface LoyaltyTenant {
	readonly tenantId: string;
	readonly slug: string;
}

export interface NightlyTenantOutcome {
	readonly slug: string;
	readonly reconcile: LoyaltyStepOutcome;
	readonly nightly:
		| { readonly status: "done"; readonly counts: LoyaltyCounts }
		| { readonly status: "failed"; readonly error: string };
}

export interface NightlyOptions {
	readonly database: Pick<
		LoyaltyDatabase,
		"reconcileLoyalty" | "loyaltyNightly"
	>;
	readonly tenants: readonly LoyaltyTenant[];
	readonly at: Date;
	readonly businessDate: string;
	readonly redact: Redactor;
	readonly days?: number;
}

export async function runLoyaltyNightly(
	options: NightlyOptions,
): Promise<NightlyTenantOutcome[]> {
	const days = options.days ?? NIGHTLY_RECONCILE_DAYS;
	const window = {
		fromDate: shiftIsoDate(options.businessDate, -(days - 1)),
		toDate: options.businessDate,
	};
	const outcomes: NightlyTenantOutcome[] = [];
	for (const tenant of options.tenants) {
		const reconcile = await reconcileLoyaltySafely(
			options.database,
			tenant.tenantId,
			window,
			options.at,
			options.redact,
		);
		let nightly: NightlyTenantOutcome["nightly"];
		try {
			nightly = {
				status: "done",
				counts: await options.database.loyaltyNightly(
					tenant.tenantId,
					options.at,
				),
			};
		} catch (error) {
			nightly = {
				status: "failed",
				error: safeErrorMessage(error, options.redact),
			};
		}
		outcomes.push({ slug: tenant.slug, reconcile, nightly });
	}
	return outcomes;
}

function countsText(counts: LoyaltyCounts): string {
	const parts = Object.entries(counts)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([key, value]) => `${key} ${value}`);
	return parts.length > 0 ? parts.join(", ") : "nothing to do";
}

export function nightlyLines(
	outcomes: readonly NightlyTenantOutcome[],
	ci = false,
): string[] {
	if (outcomes.length === 0) {
		return ["loyalty nightly: no tenant has an active or paused programme"];
	}
	return outcomes.flatMap((outcome, index) => {
		// With CI set the output numbers tenants instead of naming them.
		const name = ci ? `tenant ${index + 1}` : outcome.slug;
		return [
			`${name}: ${loyaltyLine(outcome.reconcile)}`,
			outcome.nightly.status === "done"
				? `${name}: nightly ${countsText(outcome.nightly.counts)}`
				: `${name}: nightly failed (${outcome.nightly.error})`,
		];
	});
}

export function nightlyFailures(
	outcomes: readonly NightlyTenantOutcome[],
): number {
	return outcomes.filter(
		(outcome) =>
			outcome.reconcile.status === "failed" ||
			outcome.nightly.status === "failed",
	).length;
}

function localDate(at: Date, timezone: string): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(at);
}

function asOf(context: CommandContext, values: OptionValues): Date {
	const text = stringOption(values, "as-of");
	if (text === undefined) {
		return context.now();
	}
	const parsed = new Date(text);
	if (Number.isNaN(parsed.getTime()) || !/[zZ]|[+-]\d{2}:\d{2}$/.test(text)) {
		throw new UsageError(
			"--as-of takes an ISO instant with its offset, such as 2026-11-20T04:00:00+07:00",
		);
	}
	return parsed;
}

async function selectedTenants(
	context: CommandContext,
	values: OptionValues,
	database: Pick<LoyaltyDatabase, "loyaltyTenants">,
): Promise<{ tenants: LoyaltyTenant[]; timezone: string }> {
	const slug = stringOption(values, "tenant")?.trim();
	const { sql } = context.services.db();
	if (slug !== undefined) {
		const tenant = await findTenant(sql, slug);
		if (tenant === null) {
			throw new UsageError(
				context.output.ci
					? "no tenant with that slug"
					: `no tenant with slug "${slug}"`,
			);
		}
		return {
			tenants: [{ tenantId: tenant.id, slug: tenant.slug }],
			timezone: tenant.timezone,
		};
	}
	if (!flag(values, "all-tenants")) {
		throw new UsageError(
			"name a tenant with --tenant <slug> or pass --all-tenants",
		);
	}
	return {
		tenants: await database.loyaltyTenants(),
		timezone: "Asia/Ho_Chi_Minh",
	};
}

async function loyaltyNightly(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const { runner: database } = context.services.db();
	const at = asOf(context, values);
	const { tenants, timezone } = await selectedTenants(
		context,
		values,
		database,
	);
	const outcomes = await runLoyaltyNightly({
		database,
		tenants,
		at,
		businessDate: localDate(at, timezone),
		redact: context.redact,
	});
	const lines = nightlyLines(outcomes, context.output.ci);
	for (const line of lines) {
		context.output.line(line);
	}
	context.output.summary(
		["### Loyalty nightly", "", ...lines.map((line) => `- ${line}`), ""].join(
			"\n",
		),
	);
	return nightlyFailures(outcomes) === 0 ? 0 : 1;
}

async function loyaltyReconcile(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const { runner, sql } = context.services.db();
	const slug = stringOption(values, "tenant")?.trim();
	const from = stringOption(values, "from");
	const to = stringOption(values, "to");
	if (slug === undefined || from === undefined || to === undefined) {
		throw new UsageError(
			"fnb loyalty reconcile needs --tenant, --from and --to",
		);
	}
	const tenant = await findTenant(sql, slug);
	if (tenant === null) {
		throw new UsageError(
			context.output.ci
				? "no tenant with that slug"
				: `no tenant with slug "${slug}"`,
		);
	}
	const outcome = await reconcileLoyaltySafely(
		runner,
		tenant.id,
		{ fromDate: from, toDate: to },
		context.now(),
		context.redact,
	);
	const line = `${tenant.slug}: ${loyaltyLine(outcome)}`;
	context.output.line(line);
	context.output.summary(`- ${line}`);
	return outcome.status === "failed" ? 1 : 0;
}

export interface FastLaneOptions {
	readonly database: Pick<
		LoyaltyDatabase,
		"claimFastLaneRuns" | "finishFastLaneRun"
	>;
	readonly repository: Pick<SyncRepository, "findStore">;
	readonly at: Date;
	readonly limit: number;
	readonly run: (run: FastLaneRun, days: number) => Promise<string>;
}

export async function runFastLane(
	options: FastLaneOptions,
): Promise<{ run: number; outcomes: string[] }> {
	const claimed = await options.database.claimFastLaneRuns(
		options.at,
		options.limit,
	);
	const outcomes: string[] = [];
	for (const run of claimed) {
		const context = await options.repository.findStore(run.storeId);
		if (context === null) {
			await options.database.finishFastLaneRun(
				run.runId,
				"store_unknown",
				options.at,
			);
			outcomes.push("store_unknown");
			continue;
		}
		const days = windowDays(fastLaneWindow(context.store, options.at));
		const outcome = await options.run(run, days);
		await options.database.finishFastLaneRun(run.runId, outcome, options.at);
		outcomes.push(outcome);
	}
	return { run: claimed.length, outcomes };
}

async function loyaltyFastLane(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	if (!fastLaneEnabled(context.env)) {
		const line = `loyalty fast lane: off; set ${LOYALTY_FAST_LANE_VARIABLE}=on to run the requested store syncs (each one calls the POS)`;
		context.output.line(line);
		context.output.summary(`- ${line}`);
		return 0;
	}
	const { repository, runner } = context.services.db();
	const entries = accountEntries(context.env);
	const limitText = stringOption(values, "limit");
	const limit =
		limitText === undefined ? FAST_LANE_CLAIM_LIMIT : Number(limitText);
	if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
		throw new UsageError("--limit takes a whole number from 1 to 50");
	}
	let failures = 0;
	const result = await runFastLane({
		database: runner,
		repository,
		at: context.now(),
		limit,
		run: async (run, days) => {
			const outcome = await runIncrementalStore({
				repository,
				database: runner,
				entries,
				environment: context.env,
				snapshots: iposSnapshots(context),
				storeId: run.storeId,
				notifier: context.notifier,
				redact: context.redact,
				triggeredBy: triggeredBy(context.env),
				now: context.now,
				incremental: { days },
				log: (line) => context.output.error(line),
			});
			context.output.line(`fast lane: ${outcomeLine(outcome)}`);
			if (outcome.kind === "failed") {
				failures += 1;
			}
			return outcome.kind === "ran" ? outcome.summary.status : outcome.kind;
		},
	});
	const line = `loyalty fast lane: ${result.run} run(s) claimed${result.run > 0 ? ` (${result.outcomes.join(", ")})` : ""}`;
	context.output.line(line);
	context.output.summary(`- ${line}`);
	return failures === 0 ? 0 : 1;
}

export const loyaltyCommands: readonly CommandSpec[] = [
	{
		path: ["loyalty", "nightly"],
		summary:
			"Reconcile the last 14 business days, claw back voided or edited earns, expire stamps and points, store the liability",
		usage:
			"fnb loyalty nightly (--tenant <slug> | --all-tenants) [--as-of <ISO instant>]",
		options: {
			...HELP_OPTION,
			tenant: { type: "string" },
			"all-tenants": { type: "boolean" },
			"as-of": { type: "string" },
		},
		details: [
			"Runs after the nightly sync, in the database only: it calls no POS. For each tenant with an active or paused programme it runs app.reconcile_loyalty over the last 14 business days, then app.loyalty_nightly (clawbacks of invoices the re-pull marked voided or edited, stamp and point expiry, the day's liability row).",
			"Prints counts only. A tenant whose step fails is reported and the others still run; the exit code is 1 when any tenant failed.",
		],
		run: loyaltyNightly,
	},
	{
		path: ["loyalty", "reconcile"],
		summary:
			"Run the loyalty matching paths A to D for one tenant over a range of business days",
		usage:
			"fnb loyalty reconcile --tenant <slug> --from YYYY-MM-DD --to YYYY-MM-DD",
		options: {
			...HELP_OPTION,
			tenant: { type: "string" },
			from: { type: "string" },
			to: { type: "string" },
		},
		details: [
			"The step every sync run already ends with; idempotent. Prints counts only.",
		],
		run: loyaltyReconcile,
	},
	{
		path: ["loyalty", "fast-lane"],
		summary: `Run the fast-lane store syncs that check-ins and receipt claims requested (only with ${LOYALTY_FAST_LANE_VARIABLE}=on)`,
		usage: "fnb loyalty fast-lane [--limit <n>]",
		options: { ...HELP_OPTION, limit: { type: "string" } },
		details: [
			`Off unless ${LOYALTY_FAST_LANE_VARIABLE}=on: each run is an incremental sync of one store over the business days of its last 60 minutes, so it calls the POS. Nothing schedules this command; requests are coalesced in the database to at most one run per store every 5 minutes.`,
			"Uses the same account entries, iPOS mode and tenant guard as fnb sync incremental, and ends with the loyalty reconciliation like every incremental run.",
		],
		run: loyaltyFastLane,
	},
];

export async function reconcileAfterWindow(
	database: unknown,
	tenantId: string,
	window: { fromDate: string; toDate: string },
	at: Date,
	redact: Redactor,
): Promise<LoyaltyStepOutcome> {
	const candidate = database as Partial<LoyaltyDatabase> | null;
	return reconcileLoyaltySafely(
		candidate && typeof candidate.reconcileLoyalty === "function"
			? (candidate as Pick<LoyaltyDatabase, "reconcileLoyalty">)
			: undefined,
		tenantId,
		window,
		at,
		redact,
	);
}

export async function nightlyAfterWindow(
	database: unknown,
	tenantId: string,
	slug: string,
	at: Date,
	redact: Redactor,
): Promise<string | null> {
	const candidate = database as Partial<LoyaltyDatabase> | null;
	if (!candidate || typeof candidate.loyaltyNightly !== "function") {
		return null;
	}
	try {
		const counts = await candidate.loyaltyNightly(tenantId, at);
		return `${slug}: loyalty nightly ${countsText(counts)}`;
	} catch (error) {
		return `${slug}: loyalty nightly failed (${safeErrorMessage(error, redact)})`;
	}
}
