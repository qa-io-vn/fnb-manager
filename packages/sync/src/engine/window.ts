import { assertWindow, type BusinessDateWindow } from "@fnb/connector-core";
import type { AccountRecord, StoreRecord, TableCounts } from "../rows.js";
import { DEFAULT_CHECK_TOLERANCE } from "./checks.js";
import { ConnectorCaller } from "./connector-calls.js";
import { sortedCounts } from "./counts.js";
import { FlagCollector } from "./flags.js";
import { createRedactor, safeErrorMessage } from "./redact.js";
import { refreshAnalytics, refreshRanges } from "./refresh.js";
import { runRows } from "./run-record.js";
import { type StoreWindowContext, syncStoreWindow } from "./store-window.js";
import {
	type ChecksSummary,
	type RefreshSummary,
	type StoreWindowSummary,
	type SyncEngineOptions,
	type SyncWindowKind,
	toDbSyncKind,
	type WindowOptions,
	WindowRunError,
	type WindowSummary,
} from "./types.js";

function byExternalId(left: StoreRecord, right: StoreRecord): number {
	return left.external_id < right.external_id
		? -1
		: left.external_id > right.external_id
			? 1
			: 0;
}

function summariseChecks(stores: readonly StoreWindowSummary[]): ChecksSummary {
	const available =
		stores.length > 0 && stores.every((store) => store.checks.available);
	return {
		available,
		matched: stores.reduce((sum, store) => sum + store.checks.matched, 0),
		unmatched: stores.reduce((sum, store) => sum + store.checks.unmatched, 0),
	};
}

export const DEFAULT_WINDOW_LOCK_WAIT_MS = 10 * 60_000;

export async function runSyncWindow(
	options: SyncEngineOptions,
	account: AccountRecord,
	stores: readonly StoreRecord[],
	window: BusinessDateWindow,
	kind: SyncWindowKind,
	windowOptions: WindowOptions = {},
): Promise<WindowSummary> {
	assertWindow(window);
	const foreign = stores.filter((store) => store.pos_account_id !== account.id);
	if (foreign.length > 0) {
		throw new RangeError(
			`${foreign.length} store(s) passed to syncWindow belong to another POS account`,
		);
	}
	const now = options.now ?? (() => new Date());
	const redact = options.redact ?? createRedactor();
	const dryRun = windowOptions.dryRun ?? false;
	const startedAt = now();
	const caller = new ConnectorCaller(options.calls);
	const flags = new FlagCollector();
	const tables: TableCounts = {};
	const storeSummaries: StoreWindowSummary[] = [];
	let refreshSummary: RefreshSummary = { status: "skipped" };
	const runId = dryRun
		? null
		: await options.repository.openRun({
				tenant_id: account.tenant_id,
				pos_account_id: account.id,
				store_id: stores.length === 1 ? (stores[0]?.id ?? null) : null,
				store_ids: stores.map((store) => store.id).sort(),
				kind: toDbSyncKind(kind),
				range_start: window.fromDate,
				range_end: window.toDate,
				started_at: startedAt.toISOString(),
				triggered_by: options.triggeredBy ?? null,
			});

	const finish = (
		status: WindowSummary["status"],
		error: string | null,
	): WindowSummary => {
		const finishedAt = now();
		return {
			runId,
			kind,
			dbKind: toDbSyncKind(kind),
			window,
			dryRun,
			status,
			error,
			startedAt: startedAt.toISOString(),
			finishedAt: finishedAt.toISOString(),
			durationMs: finishedAt.getTime() - startedAt.getTime(),
			connectorCalls: caller.calls,
			retries: caller.retried,
			tables: sortedCounts(tables),
			stores: storeSummaries,
			checks: summariseChecks(storeSummaries),
			flags: flags.list(),
			refresh: refreshSummary,
		};
	};

	const close = async (summary: WindowSummary): Promise<void> => {
		if (runId === null) {
			return;
		}
		await options.repository.closeRun(runId, {
			status: summary.status,
			finished_at: summary.finishedAt,
			error_message: summary.error,
			rows_upserted: runRows(tables, {
				connectorCalls: summary.connectorCalls,
				retries: summary.retries,
				flags,
				checks: summary.checks,
				refreshMs:
					"durationMs" in summary.refresh ? summary.refresh.durationMs : null,
				refreshStatus: summary.refresh.status,
			}),
		});
	};

	try {
		const paymentKinds = await options.repository.paymentMethodKinds(
			account.id,
		);
		const context: StoreWindowContext = {
			repository: options.repository,
			connector: options.connector,
			caller,
			flags,
			account,
			window,
			dryRun,
			detectedAt: startedAt.toISOString(),
			tolerance: options.tolerance ?? DEFAULT_CHECK_TOLERANCE,
			paymentKinds,
			tables,
		};
		const ordered = [...stores].sort(byExternalId);
		for (const store of ordered) {
			storeSummaries.push(
				await syncStoreWindow(
					context,
					store,
					windowOptions.lockWaitMs ?? DEFAULT_WINDOW_LOCK_WAIT_MS,
				),
			);
		}
		if (!dryRun && (windowOptions.refreshAnalytics ?? true)) {
			const touched = storeSummaries.flatMap((store) => store.touchedDates);
			refreshSummary = await refreshAnalytics(
				options,
				account,
				refreshRanges(window, touched),
				now,
			);
			if (refreshSummary.status === "failed") {
				flags.add("analytics_refresh_failed", "warn");
			}
		}
	} catch (error) {
		const summary = finish("failed", safeErrorMessage(error, redact));
		await close(summary);
		throw new WindowRunError(summary.error ?? "sync failed", summary, {
			cause: error,
		});
	}
	const summary = finish("succeeded", null);
	await close(summary);
	if (!dryRun) {
		await options.repository.markAccountSynced(account.id, summary.finishedAt);
	}
	return summary;
}
