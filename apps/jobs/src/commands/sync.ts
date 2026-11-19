import {
	type AccountEntry,
	type ConnectorSession,
	clearAuthFailure,
	connectAccount,
	loyaltyLine,
	readOnlyTokenStore,
	repositoryTokenStore,
} from "@fnb/runner";
import {
	isSyncWindowKind,
	MasterDataRunError,
	SYNC_WINDOW_KINDS,
	SyncEngine,
	type SyncWindowKind,
	WindowRunError,
	type WindowSummary,
} from "@fnb/sync";
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
import { resolveAccount } from "./accounts.js";
import { windowOption } from "./dates.js";
import {
	guardTenant,
	iposSnapshots,
	printIposMode,
	tenantFor,
} from "./ipos.js";
import { nightlyAfterWindow, reconcileAfterWindow } from "./loyalty.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";
import {
	checkYesterdayFreshness,
	reportAuthFailure,
	reportRunFailure,
} from "./sync-alerts.js";
import { syncIncrementalCommand } from "./sync-incremental.js";
import {
	masterSummaryText,
	printFlags,
	printWindowSummary,
	windowSummaryMarkdown,
} from "./sync-report.js";
import { selectedEntries, selectStores } from "./sync-selection.js";

export interface WindowRequest {
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

export async function syncAccountWindow(
	context: CommandContext,
	request: WindowRequest,
	entry: AccountEntry,
	index: number,
): Promise<WindowSummary | null> {
	const { output } = context;
	const label = output.label("account", index, entry.key);
	const { repository } = context.services.db();
	const account = await resolveAccount(
		repository,
		entry.key,
		tenantFor(context, entry, request.tenant),
	);
	await guardTenant(context, [entry], account.tenant_id, {
		claim: !request.dryRun,
	});
	if (account.status === "paused") {
		output.line(`${label}: paused, skipped`);
		return null;
	}
	const stores = selectStores(
		await repository.listStores(account.id),
		request.stores,
	);
	if (stores.length === 0) {
		output.line(`${label}: no active stores, nothing to sync`);
		return null;
	}
	const configured = accountEntries(context.env);
	let session: ConnectorSession;
	try {
		session = await connectAccount(entry, context.env, {
			tokenStore: request.dryRun
				? readOnlyTokenStore(repository, account.id)
				: repositoryTokenStore(repository, account.id),
			snapshots: iposSnapshots(context),
		});
	} catch (error) {
		if (!request.dryRun) {
			await reportAuthFailure(context, configured, account, error);
		}
		throw error;
	}
	if (!request.dryRun) {
		await clearAuthFailure(repository, account);
	}
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
	printWindowSummary(
		context,
		label,
		summary,
		session.httpRequests(),
		session.ipos,
	);
	output.summary(windowSummaryMarkdown(index, summary));
	if (!request.dryRun && summary.runId !== null) {
		const loyalty = await reconcileAfterWindow(
			context.services.db().runner,
			account.tenant_id,
			summary.window,
			context.now(),
			context.redact,
		);
		if (loyalty.status !== "skipped" || loyalty.reason !== "not_wired") {
			output.line(`${label}: ${loyaltyLine(loyalty)}`);
		}
	}
	await reportRunFailure(context, configured, account, summary);
	if (request.kind === "nightly" && !request.dryRun) {
		await checkYesterdayFreshness(context, configured, account, stores);
		const nightly = await nightlyAfterWindow(
			context.services.db().runner,
			account.tenant_id,
			label,
			context.now(),
			context.redact,
		);
		if (nightly !== null) {
			output.line(nightly);
			output.summary(`- ${nightly}`);
		}
	}
	return summary;
}

async function syncOneAccount(
	context: CommandContext,
	request: WindowRequest,
	entry: AccountEntry,
	index: number,
): Promise<boolean> {
	const summary = await syncAccountWindow(context, request, entry, index);
	return summary === null || summary.status === "succeeded";
}

async function syncWindow(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const request = windowRequest(values);
	const entries = selectedEntries(context, values);
	await printIposMode(
		context,
		entries.map(({ entry }) => entry),
	);
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
	await printIposMode(context, [entry]);
	const { repository } = context.services.db();
	const account = await resolveAccount(
		repository,
		entry.key,
		tenantFor(context, entry, stringOption(values, "tenant")),
	);
	await guardTenant(context, [entry], account.tenant_id, { claim: true });
	let session: ConnectorSession;
	try {
		session = await connectAccount(entry, context.env, {
			tokenStore: repositoryTokenStore(repository, account.id),
			snapshots: iposSnapshots(context),
		});
	} catch (error) {
		await reportAuthFailure(
			context,
			accountEntries(context.env),
			account,
			error,
		);
		throw error;
	}
	await clearAuthFailure(repository, account);
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
	syncIncrementalCommand,
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
			"With ipos-fabi accounts the first line names the iPOS mode. IPOS_REAL_API=off answers every iPOS request from the local snapshot, writes into mock-local unless --tenant names another tenant loaded from the snapshot, and refuses a tenant that holds real iPOS data; on (the default) refuses a tenant loaded from the snapshot.",
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
