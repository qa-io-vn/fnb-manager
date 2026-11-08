import { accountStatuses, storeStatuses } from "../admin/status-queries.js";
import { STATUS_WINDOW_DAYS, statusWindow } from "../admin/status-window.js";
import { accountEntries } from "../config/config.js";
import {
	type CommandContext,
	type OptionValues,
	stringOption,
} from "../context.js";
import {
	accountLabel,
	type ListedAccount,
	type NumberedAccount,
	numberAccounts,
} from "./account-numbers.js";
import { ageText } from "./formatting.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";

function storesInAccountOrder<T extends { pos_account_id: string }>(
	stores: readonly T[],
	accounts: readonly NumberedAccount<ListedAccount & { id: string }>[],
): T[] {
	const position = new Map(
		accounts.map((numbered, index) => [numbered.account.id, index]),
	);
	return [...stores].sort(
		(left, right) =>
			(position.get(left.pos_account_id) ?? 0) -
			(position.get(right.pos_account_id) ?? 0),
	);
}

async function status(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const { output } = context;
	const { sql } = context.services.db();
	const now = context.now();
	const window = statusWindow(now);
	const accounts = numberAccounts(
		accountEntries(context.env),
		await accountStatuses(sql, stringOption(values, "tenant"), window),
	);
	if (accounts.length === 0) {
		output.line("no POS accounts onboarded");
		return 0;
	}
	const labels = new Map(
		accounts.map((numbered) => [
			numbered.account.id,
			accountLabel(output, numbered),
		]),
	);
	const stores = await storeStatuses(
		sql,
		accounts.map(({ account }) => account.id),
		window,
	);
	output.table(
		[
			"account",
			"status",
			"last run",
			"result",
			"age",
			"last success",
			`flagged ${window.days}d`,
			`failed ${window.days}d`,
		],
		accounts.map((numbered) => [
			accountLabel(output, numbered),
			numbered.account.status,
			numbered.account.last_run_kind,
			numbered.account.last_run_status,
			ageText(numbered.account.last_run_started_at, now),
			ageText(numbered.account.last_success_at, now),
			numbered.account.flagged_runs,
			numbered.account.failed_runs,
		]),
	);
	output.line();
	output.table(
		[
			"account",
			"store",
			"active",
			"latest verified day",
			"latest sales day",
			`unmatched ${window.days}d`,
			`checked ${window.days}d`,
		],
		storesInAccountOrder(stores, accounts).map((store, index) => [
			labels.get(store.pos_account_id) ?? "?",
			output.label("store", index, store.name),
			store.active ? "yes" : "no",
			store.latest_verified_day,
			store.latest_invoice_day,
			store.unmatched_days,
			store.checked_days,
		]),
	);
	return 0;
}

export const statusCommand: CommandSpec = {
	path: ["status"],
	summary:
		"Show the last run per account and the reconciliation state per store",
	usage: "fnb status [--tenant <slug>]",
	options: { ...HELP_OPTION, tenant: { type: "string" } },
	details: [
		"Needs DATABASE_URL (or SUPABASE_DB_URL).",
		"A run is flagged when it raised warning-level data-quality flags or left a store-day unmatched.",
		`Every ${STATUS_WINDOW_DAYS}d column covers the same window, the ${STATUS_WINDOW_DAYS} days ending now: flagged and failed count the runs started in it; unmatched and checked count the sync_checks rows of the store-days that closed in it, the ${STATUS_WINDOW_DAYS} business dates ending yesterday in each store's timezone and day start (the dates the nightly run covers). Today is still open and never counted, so a store whose every day was reconciled shows ${STATUS_WINDOW_DAYS}; a day without a row was never reconciled (the connector had no control totals or the day was not synced).`,
		"In CI an account listed in POS_ACCOUNTS_JSON is called by its position there (account 1 is the first entry); an onboarded account missing from it is called other 1, other 2, … in tenant and key order, and its stores carry that label.",
	],
	run: status,
};
