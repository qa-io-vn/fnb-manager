import {
	isSyncWindowKind,
	MasterDataRunError,
	type StoreRecord,
	SYNC_WINDOW_KINDS,
	SyncEngine,
	type SyncWindowKind,
	WindowRunError,
	type WindowSummary,
} from "@fnb/sync";
import type { AccountEntry } from "../config/accounts.js";
import { accountEntries, accountEntry } from "../config/config.js";
import {
	type CommandContext,
	flag,
	type OptionValues,
	requiredString,
	stringList,
	stringOption,
	triggeredBy,
	UsageError,
} from "../context.js";
import {
	connectAccount,
	readOnlyTokenStore,
	repositoryTokenStore,
} from "../services.js";
import { resolveAccount } from "./accounts.js";
import { windowOption } from "./dates.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";
import {
	masterSummaryText,
	printFlags,
	printWindowSummary,
	windowSummaryMarkdown,
} from "./sync-report.js";

function selectStores(
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

interface SelectedEntry {
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

function selectedEntries(
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

interface WindowRequest {
	window: { fromDate: string; toDate: string };
	kind: SyncWindowKind;
	dryRun: boolean;
	tenant: string | undefined;
	stores: string[];
}

function windowRequest(values: OptionValues): WindowRequest {
	const window = windowOption(
		requiredString(values, "from"),
		requiredString(values, "to"),
	);
	const kind = stringOption(values, "kind") ?? "manual";
	if (!isSyncWindowKind(kind)) {
		throw new UsageError(
			`--kind must be one of ${SYNC_WINDOW_KINDS.join(", ")}`,
		);
	}
	return {
		window,
		kind,
		dryRun: flag(values, "dry-run"),
		tenant: stringOption(values, "tenant"),
		stores: stringList(values, "store"),
	};
}

async function syncOneAccount(
	context: CommandContext,
	request: WindowRequest,
	entry: AccountEntry,
	index: number,
): Promise<boolean> {
	const { output } = context;
	const label = output.label("account", index, entry.key);
	const { repository } = context.services.db();
	const account = await resolveAccount(repository, entry.key, request.tenant);
	if (account.status === "paused") {
		output.line(`${label}: paused, skipped`);
		return true;
	}
	const stores = selectStores(
		await repository.listStores(account.id),
		request.stores,
	);
	if (stores.length === 0) {
		output.line(`${label}: no active stores, nothing to sync`);
		return true;
	}
	const session = await connectAccount(entry, context.env, {
		tokenStore: request.dryRun
			? readOnlyTokenStore(repository, account.id)
			: repositoryTokenStore(repository, account.id),
	});
	const engine = new SyncEngine({
		repository,
		connector: session.connector,
		redact: context.redact,
		triggeredBy: triggeredBy(context.env),
	});
	let summary: WindowSummary;
	try {
		summary = await engine.syncWindow(
			account,
			stores,
			request.window,
			request.kind,
			{
				dryRun: request.dryRun,
			},
		);
	} catch (error) {
		if (!(error instanceof WindowRunError)) {
			throw error;
		}
		summary = error.summary;
	}
	printWindowSummary(context, label, summary, session.httpRequests());
	output.summary(windowSummaryMarkdown(index, summary));
	return summary.status === "succeeded";
}

async function syncWindow(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const request = windowRequest(values);
	const entries = selectedEntries(context, values);
	if (entries.length > 1 && request.stores.length > 0) {
		throw new UsageError(
			"--store applies to one account; drop it or pass --account",
		);
	}
	let failures = 0;
	for (const { entry, index } of entries) {
		const label = context.output.label("account", index, entry.key);
		try {
			if (!(await syncOneAccount(context, request, entry, index))) {
				failures += 1;
			}
		} catch (error) {
			if (error instanceof UsageError && entries.length === 1) {
				throw new UsageError(`${label}: ${error.message}`);
			}
			failures += 1;
			context.output.error(
				`${label}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return failures === 0 ? 0 : 1;
}

async function syncMaster(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const entry = accountEntry(context.env, requiredString(values, "account"));
	const { repository } = context.services.db();
	const account = await resolveAccount(
		repository,
		entry.key,
		stringOption(values, "tenant"),
	);
	const session = await connectAccount(entry, context.env, {
		tokenStore: repositoryTokenStore(repository, account.id),
	});
	const engine = new SyncEngine({
		repository,
		connector: session.connector,
		redact: context.redact,
		triggeredBy: triggeredBy(context.env),
	});
	try {
		const summary = await engine.syncMasterData(account);
		context.output.line(masterSummaryText(summary));
		printFlags(context, summary.flags);
		return 0;
	} catch (error) {
		if (error instanceof MasterDataRunError) {
			context.output.error(`master data sync failed: ${error.message}`);
			return 1;
		}
		throw error;
	}
}

export const syncCommands: CommandSpec[] = [
	{
		path: ["sync", "window"],
		summary: "Pull a business-date window of sales into the database",
		usage:
			"fnb sync window (--account <key> | --account-number <n> | --all-accounts) --from YYYY-MM-DD --to YYYY-MM-DD [--store <external id>]... [--kind backfill|nightly|incremental|manual] [--tenant <slug>] [--dry-run]",
		options: {
			...HELP_OPTION,
			account: { type: "string" },
			"account-number": { type: "string" },
			"all-accounts": { type: "boolean" },
			tenant: { type: "string" },
			from: { type: "string" },
			to: { type: "string" },
			store: { type: "string", multiple: true },
			kind: { type: "string" },
			"dry-run": { type: "boolean" },
		},
		details: [
			"Needs DATABASE_URL (or SUPABASE_DB_URL in CI), POS_ACCOUNTS_JSON and IPOS_APP_KEY for ipos-fabi accounts.",
			"Dates are inclusive business dates in each store's timezone and day start. One month per run keeps a backfill inside the call budget.",
			"--kind defaults to manual, which is recorded as backfill because sync_kind has no manual label.",
			"--account-number picks the n-th entry of POS_ACCOUNTS_JSON (1 = first), so a workflow never has to name the account; --all-accounts runs every entry in order and exits 1 when any of them failed.",
			"--dry-run pulls and compares but writes nothing, not even a sync_runs row or the cached POS token.",
			"Re-running the same window changes nothing; analytics are refreshed afterwards for the window and for any earlier date an adjustment in it changed, when app.refresh_analytics exists.",
		],
		run: syncWindow,
	},
	{
		path: ["sync", "master"],
		summary: "Refresh stores and the catalogue of an account",
		usage: "fnb sync master --account <key> [--tenant <slug>]",
		options: {
			...HELP_OPTION,
			account: { type: "string" },
			tenant: { type: "string" },
		},
		details: [
			"Needs DATABASE_URL and the account's POS_ACCOUNTS_JSON entry.",
			"Updates store timezone and day start from the POS, upserts the catalogue tables and marks rows the POS no longer lists inactive.",
		],
		run: syncMaster,
	},
];
