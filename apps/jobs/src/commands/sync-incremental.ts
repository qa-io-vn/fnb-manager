import {
	BudgetConfigError,
	budgetMilliseconds,
	outcomeLine,
	outcomeReport,
	runIncrementalStore,
} from "@fnb/runner";
import { type RunBudget, SERVER_INCREMENTAL_BUDGET } from "@fnb/sync";
import { accountEntries } from "../config/config.js";
import {
	type CommandContext,
	flag,
	type OptionValues,
	stringList,
	stringOption,
	triggeredBy,
	UsageError,
} from "../context.js";
import { resolveAccount } from "./accounts.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";
import { selectedEntries, selectStores } from "./sync-selection.js";

function markdownRow(report: Record<string, unknown>): string {
	const days = (report.days ?? {}) as Record<string, unknown>;
	return `| ${String(report.label)} | ${String(report.status ?? report.outcome)} | ${String(days.checked ?? "–")} | ${String(days.changed ?? "–")} | ${String(days.synced ?? "–")} | ${String(days.handed_off ?? "–")} | ${String(report.connector_calls ?? "–")} |`;
}

export function incrementalBudgetOption(values: OptionValues): RunBudget {
	try {
		return {
			wallClockMs: budgetMilliseconds(
				"--wall-budget-ms",
				stringOption(values, "wall-budget-ms"),
				SERVER_INCREMENTAL_BUDGET.wallClockMs,
			),
			cpuMs: budgetMilliseconds(
				"--cpu-budget-ms",
				stringOption(values, "cpu-budget-ms"),
				SERVER_INCREMENTAL_BUDGET.cpuMs,
			),
		};
	} catch (error) {
		if (error instanceof BudgetConfigError) {
			throw new UsageError(error.message);
		}
		throw error;
	}
}

async function syncIncremental(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const budget = incrementalBudgetOption(values);
	const wanted = stringList(values, "store");
	const selected = selectedEntries(context, values);
	if (selected.length > 1 && wanted.length > 0) {
		throw new UsageError(
			"--store applies to one account; drop it or pass --account",
		);
	}
	const entries = accountEntries(context.env);
	const { repository, runner } = context.services.db();
	const rows: string[] = [];
	let failures = 0;
	for (const { entry } of selected) {
		const account = await resolveAccount(
			repository,
			entry.key,
			stringOption(values, "tenant"),
		);
		const stores = selectStores(
			await repository.listStores(account.id),
			wanted,
		);
		for (const store of stores) {
			const outcome = await runIncrementalStore({
				repository,
				database: runner,
				entries,
				environment: context.env,
				storeId: store.id,
				notifier: context.notifier,
				redact: context.redact,
				triggeredBy: triggeredBy(context.env),
				now: context.now,
				incremental: { budget },
				retryAuthFailed: flag(values, "retry-auth-failed"),
				log: (line) => context.output.error(line),
			});
			context.output.line(outcomeLine(outcome));
			rows.push(markdownRow(outcomeReport(outcome)));
			if (outcome.kind === "failed") {
				failures += 1;
			}
		}
	}
	context.output.summary(
		[
			"### Incremental sync",
			"",
			"| store | result | days checked | changed | synced | handed off | connector calls |",
			"|---|---|---|---|---|---|---|",
			...rows,
			"",
		].join("\n"),
	);
	return failures === 0 ? 0 : 1;
}

export const syncIncrementalCommand: CommandSpec = {
	path: ["sync", "incremental"],
	summary:
		"Check the last three business days of each store against the POS daily totals and pull only the changed days",
	usage:
		"fnb sync incremental (--account <key> | --account-number <n> | --all-accounts) [--store <external id>]... [--tenant <slug>] [--retry-auth-failed] [--wall-budget-ms <n>] [--cpu-budget-ms <n>]",
	options: {
		...HELP_OPTION,
		account: { type: "string" },
		"account-number": { type: "string" },
		"all-accounts": { type: "boolean" },
		tenant: { type: "string" },
		store: { type: "string", multiple: true },
		"retry-auth-failed": { type: "boolean" },
		"wall-budget-ms": { type: "string" },
		"cpu-budget-ms": { type: "string" },
	},
	details: [
		"The same run the sync-incremental Edge Function makes, one store at a time, for a deployment that schedules it from a small server instead of pg_cron.",
		"Each store's window is its last three business dates ending today in its timezone and day start. One control-totals call per store decides which days changed; only those are pulled, newest first, inside a wall-time and estimated-CPU budget per store. Days left over are handed to the nightly run and the run is recorded as partial.",
		`No Edge Function limit applies to this runner, so each store's budget defaults to ${SERVER_INCREMENTAL_BUDGET.wallClockMs / 60_000} minutes of wall time and ${SERVER_INCREMENTAL_BUDGET.cpuMs / 60_000} minutes of estimated CPU; --wall-budget-ms and --cpu-budget-ms change it (105000 and 1200 reproduce the Free-plan budget of the Edge Function). A POS call still running at the end of the wall-time budget is cut off and its day handed off.`,
		"A store whose window lock is held by another run for more than 15 s is left alone and recorded as partial. A store that went more than 90 minutes of opening hours without a successful sync raises the dead-man's switch before the run.",
		"A login the POS rejects marks the account auth_failed and alerts once; such an account is skipped until --retry-auth-failed or any sync window run logs in again.",
	],
	run: syncIncremental,
};
