import type { AccountEntry } from "@fnb/runner";
import type { StoreRecord } from "@fnb/sync";
import { accountEntries, accountEntry } from "../config/config.js";
import {
	type CommandContext,
	flag,
	type OptionValues,
	stringOption,
	UsageError,
} from "../context.js";

export function selectStores(
	stores: readonly StoreRecord[],
	wanted: readonly string[],
): StoreRecord[] {
	if (wanted.length === 0) {
		return stores.filter((store) => store.active);
	}
	const known = new Set(stores.map((store) => store.external_id));
	const unknown = wanted.filter((externalId) => !known.has(externalId));
	if (unknown.length > 0) {
		throw new UsageError(
			`${unknown.length} --store value(s) do not belong to this account`,
		);
	}
	return stores.filter((store) => wanted.includes(store.external_id));
}

export interface SelectedEntry {
	entry: AccountEntry;
	index: number;
}

function accountNumberOption(values: OptionValues): number | undefined {
	const raw = stringOption(values, "account-number");
	if (raw === undefined) {
		return undefined;
	}
	const number = Number(raw);
	if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(number)) {
		throw new UsageError("--account-number must be a whole number from 1");
	}
	return number;
}

export function selectedEntries(
	context: CommandContext,
	values: OptionValues,
): SelectedEntry[] {
	const key = stringOption(values, "account");
	const number = accountNumberOption(values);
	const all = flag(values, "all-accounts");
	const chosen = [key !== undefined, number !== undefined, all].filter(
		Boolean,
	).length;
	if (chosen > 1) {
		throw new UsageError(
			"pass only one of --account, --account-number and --all-accounts",
		);
	}
	if (chosen === 0) {
		throw new UsageError(
			"--account is required (or --account-number or --all-accounts)",
		);
	}
	const entries = accountEntries(context.env);
	if (all) {
		if (entries.length === 0) {
			throw new UsageError("POS_ACCOUNTS_JSON lists no accounts");
		}
		return entries.map((entry, index) => ({ entry, index }));
	}
	if (number !== undefined) {
		const entry = entries[number - 1];
		if (!entry) {
			throw new UsageError(
				`--account-number ${number} is beyond the ${entries.length} POS_ACCOUNTS_JSON entries`,
			);
		}
		return [{ entry, index: number - 1 }];
	}
	const entry = accountEntry(context.env, key ?? "");
	return [
		{
			entry,
			index: entries.findIndex((candidate) => candidate.key === entry.key),
		},
	];
}
