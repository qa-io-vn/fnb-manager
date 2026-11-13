import { singleDayWindow, windowDates } from "@fnb/connector-core";
import { shiftIsoDate } from "@fnb/core";
import { toCanonicalStore } from "../mapping/store.js";
import type { DateRange } from "../repository.js";
import type {
	AccountRecord,
	JsonObject,
	StoreRecord,
	TableCounts,
} from "../rows.js";
import { StoreLockBusyError } from "../store-lock.js";
import { type DayDecision, detectChangedDays } from "./change-detection.js";
import { DEFAULT_CHECK_TOLERANCE } from "./checks.js";
import { ConnectorCaller } from "./connector-calls.js";
import { sortedCounts } from "./counts.js";
import { FlagCollector } from "./flags.js";
import { incrementalWindow } from "./incremental-window.js";
import { createRedactor, safeErrorMessage } from "./redact.js";
import { contiguousRanges, refreshAnalytics } from "./refresh.js";
import { RunDeadlineError, RunGuard } from "./run-guard.js";
import { runRows } from "./run-record.js";
import { emptySummary, syncLockedStoreWindow } from "./store-window.js";
import type { StoreWindowContext } from "./store-window-context.js";
import {
	type ChecksSummary,
	type IncrementalDay,
	type IncrementalDayOutcome,
	type IncrementalOptions,
	IncrementalRunError,
	type IncrementalStop,
	type IncrementalSummary,
	type RefreshSummary,
	type StoreWindowSummary,
	type SyncEngineOptions,
} from "./types.js";

export const DEFAULT_LOCK_WAIT_MS = 15_000;
export const ABANDONED_RUN_AFTER_MS = 10 * 60_000;
export const ABANDONED_RUN_MESSAGE =
	"the runner stopped before it closed this run (a platform time or CPU limit, or a crash); a later incremental run closed it";
export const STALE_REFRESH_LOOKBACK_DAYS = 14;

const COUNTED_FIELDS = [
	"pulledSales",
	"inserted",
	"updated",
	"statusChanged",
	"unchanged",
	"voided",
	"edited",
	"voidsSkipped",
	"movedOutOfWindow",
	"newAdjustmentEvents",
	"shifts",
] as const;

function monotonicClock(): number {
	return performance.now();
}

function newestFirst(left: DayDecision, right: DayDecision): number {
	return left.date < right.date ? 1 : left.date > right.date ? -1 : 0;
}

export function staleRefreshRange(
	window: IncrementalSummary["window"],
): DateRange {
	return {
		from: shiftIsoDate(window.toDate, 1 - STALE_REFRESH_LOOKBACK_DAYS),
		to: window.toDate,
	};
}

export interface IncrementalDayCounts {
	checked: number;
	changed: number;
	synced: number;
	handedOff: number;
}

export function incrementalDayCounts(
	days: readonly IncrementalDay[],
): IncrementalDayCounts {
	const checked = days.filter((day) => day.reason !== null);
	const count = (outcome: IncrementalDayOutcome): number =>
		days.filter((day) => day.outcome === outcome).length;
	return {
		checked: checked.length,
		changed: checked.filter((day) => day.outcome !== "unchanged").length,
		synced: count("synced"),
		handedOff: count("handed_off"),
	};
}

export function mergeStoreSummaries(
	store: StoreRecord,
	summaries: readonly StoreWindowSummary[],
	checksAvailable: boolean,
): StoreWindowSummary {
	const merged = emptySummary(store);
	for (const summary of summaries) {
		for (const field of COUNTED_FIELDS) {
			merged[field] += summary[field];
		}
		merged.touchedDates.push(...summary.touchedDates);
		merged.checks.rows.push(...summary.checks.rows);
	}
	merged.touchedDates = [...new Set(merged.touchedDates)].sort();
	const matched = merged.checks.rows.filter((row) => row.is_matched).length;
	merged.checks = {
		available: checksAvailable,
		matched,
		unmatched: merged.checks.rows.length - matched,
		rows: merged.checks.rows,
	};
	return merged;
}

interface IncrementalState {
	days: IncrementalDay[];
	summaries: StoreWindowSummary[];
	stopped: IncrementalStop | null;
	staleDates: string[];
	refreshRetried: string[];
}

async function decideDays(
	options: SyncEngineOptions,
	account: AccountRecord,
	store: StoreRecord,
	window: IncrementalSummary["window"],
	caller: ConnectorCaller,
	flags: FlagCollector,
	signal: AbortSignal,
): Promise<DayDecision[]> {
	const { repository, connector } = options;
	const range = { from: window.fromDate, to: window.toDate };
	const dates = windowDates(window);
	if (!connector.describe().capabilities.controlTotals) {
		const local = await repository.localDayTotals(store.id, range);
		const counts = new Map(
			local.map((total) => [total.business_date, total.invoice_count]),
		);
		return dates.map((date) => ({
			date,
			reason: "unchecked",
			pull: true,
			posInvoiceCount: counts.get(date) ?? 0,
		}));
	}
	const canonical = toCanonicalStore(store, account.tenant_currency);
	const controlTotals = await caller.call("control totals", () =>
		connector.fetchControlTotals(canonical, window, {
			onFlag: flags.sink,
			signal,
		}),
	);
	const [storedChecks, localTotals] = await Promise.all([
		repository.loadChecks(store.id, range),
		repository.localDayTotals(store.id, range),
	]);
	return detectChangedDays({
		dates,
		controlTotals,
		storedChecks,
		localTotals,
		tolerance: options.tolerance ?? DEFAULT_CHECK_TOLERANCE,
	});
}

export async function runSyncIncremental(
	options: SyncEngineOptions,
	account: AccountRecord,
	store: StoreRecord,
	incremental: IncrementalOptions = {},
): Promise<IncrementalSummary> {
	if (store.pos_account_id !== account.id) {
		throw new RangeError(
			"the store passed to syncIncremental belongs to another POS account",
		);
	}
	const { repository } = options;
	const now = options.now ?? (() => new Date());
	const redact = options.redact ?? createRedactor();
	const clock = incremental.clock ?? monotonicClock;
	const startedAt = now();
	const window = incrementalWindow(store, startedAt, incremental.days);
	const guard = new RunGuard({
		budget: incremental.budget,
		model: incremental.costModel,
		clock,
		startedAt: incremental.startedAt,
	});
	const deadline = new AbortController();
	const caller = new ConnectorCaller({
		...options.calls,
		signal: deadline.signal,
	});
	const flags = new FlagCollector();
	const tables: TableCounts = {};
	const checksAvailable =
		options.connector.describe().capabilities.controlTotals;
	const state: IncrementalState = {
		days: [],
		summaries: [],
		stopped: null,
		staleDates: [],
		refreshRetried: [],
	};
	let refresh: RefreshSummary = { status: "skipped" };
	const abandoned = await repository.closeAbandonedRuns(
		store.id,
		new Date(startedAt.getTime() - ABANDONED_RUN_AFTER_MS).toISOString(),
		ABANDONED_RUN_MESSAGE,
	);
	flags.add("abandoned_runs_closed", "warn", abandoned);
	const runId = await repository.openRun({
		tenant_id: account.tenant_id,
		pos_account_id: account.id,
		store_id: store.id,
		store_ids: [store.id],
		kind: "incremental",
		range_start: window.fromDate,
		range_end: window.toDate,
		started_at: startedAt.toISOString(),
		triggered_by: options.triggeredBy ?? null,
	});

	const finish = (
		status: IncrementalSummary["status"],
		error: string | null,
	): IncrementalSummary => {
		const finishedAt = now();
		const merged = mergeStoreSummaries(store, state.summaries, checksAvailable);
		const checks: ChecksSummary = {
			available: merged.checks.available,
			matched: merged.checks.matched,
			unmatched: merged.checks.unmatched,
		};
		return {
			runId,
			status,
			stopped: state.stopped,
			error,
			window,
			days: state.days.map((day) => ({ ...day })),
			startedAt: startedAt.toISOString(),
			finishedAt: finishedAt.toISOString(),
			durationMs: finishedAt.getTime() - startedAt.getTime(),
			connectorCalls: caller.calls,
			retries: caller.retried,
			tables: sortedCounts(tables),
			store: merged,
			checks,
			flags: flags.list(),
			refresh,
			refreshRetried: [...state.refreshRetried],
			estimatedCpuMs: guard.estimatedCpuMs,
		};
	};

	const dayCount = (outcome: IncrementalDayOutcome): number =>
		state.days.filter((day) => day.outcome === outcome).length;

	const close = async (summary: IncrementalSummary): Promise<void> => {
		const days = incrementalDayCounts(state.days);
		const extra: JsonObject = {
			days_checked: days.checked,
			days_changed: days.changed,
			days_synced: days.synced,
			days_handed_off: days.handedOff,
			stale_days_refreshed: state.refreshRetried.length,
			stopped: state.stopped,
			cpu_estimate_ms: summary.estimatedCpuMs,
		};
		await repository.closeRun(runId, {
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
				extra,
			}),
		});
	};

	const markDay = (date: string, outcome: IncrementalDayOutcome): void => {
		const day = state.days.find((candidate) => candidate.date === date);
		if (day) {
			day.outcome = outcome;
		}
	};

	const stopAtDeadline = (error: unknown): void => {
		if (!deadline.signal.aborted) {
			throw error;
		}
		state.stopped = "wall_time";
		flags.add("deadline_reached", "warn");
	};

	const syncChangedDays = async (): Promise<void> => {
		let decisions: DayDecision[];
		try {
			decisions = await decideDays(
				options,
				account,
				store,
				window,
				caller,
				flags,
				deadline.signal,
			);
		} catch (error) {
			stopAtDeadline(error);
			state.days = windowDates(window).map((date) => ({
				date,
				reason: null,
				outcome: "handed_off",
			}));
			return;
		}
		state.days = decisions.map((decision) => ({
			date: decision.date,
			reason: decision.reason,
			outcome: decision.pull ? "pending" : "unchanged",
		}));
		state.staleDates = await repository.staleAnalyticsDates(
			store.id,
			staleRefreshRange(window),
		);
		const paymentKinds = await repository.paymentMethodKinds(account.id);
		for (const decision of decisions
			.filter((day) => day.pull)
			.sort(newestFirst)) {
			state.stopped ??= guard.admit(decision.posInvoiceCount);
			if (state.stopped !== null) {
				markDay(decision.date, "handed_off");
				continue;
			}
			const dayStarted = clock();
			const context: StoreWindowContext = {
				repository,
				connector: options.connector,
				caller,
				flags,
				account,
				window: singleDayWindow(decision.date),
				dryRun: false,
				detectedAt: startedAt.toISOString(),
				tolerance: options.tolerance ?? DEFAULT_CHECK_TOLERANCE,
				paymentKinds,
				tables,
				signal: deadline.signal,
			};
			let summary: StoreWindowSummary;
			try {
				summary = await syncLockedStoreWindow(context, store);
			} catch (error) {
				stopAtDeadline(error);
				markDay(decision.date, "handed_off");
				continue;
			}
			state.summaries.push(summary);
			guard.record(decision.posInvoiceCount, clock() - dayStarted);
			markDay(decision.date, "synced");
		}
	};

	const deadlineTimer = setTimeout(
		() => deadline.abort(new RunDeadlineError(guard.budget.wallClockMs)),
		guard.remainingPosMs,
	);
	try {
		try {
			await repository.withStoreLock(store.id, syncChangedDays, {
				waitMs: incremental.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS,
			});
		} catch (error) {
			if (!(error instanceof StoreLockBusyError)) {
				throw error;
			}
			state.stopped = "store_busy";
			flags.add("store_busy", "info");
		} finally {
			clearTimeout(deadlineTimer);
		}
		const handedOff = dayCount("handed_off");
		flags.add("incremental_handed_off", "warn", handedOff);
		const synced = state.days
			.filter((day) => day.outcome === "synced")
			.map((day) => day.date);
		const touched = state.summaries.flatMap((summary) => summary.touchedDates);
		const retried = state.staleDates.filter((date) => !synced.includes(date));
		const refreshDates = [...synced, ...touched, ...retried];
		if (refreshDates.length > 0 && (incremental.refreshAnalytics ?? true)) {
			state.refreshRetried = retried;
			flags.add("analytics_refresh_retried", "info", retried.length);
			refresh = await refreshAnalytics(
				options,
				account,
				contiguousRanges(refreshDates),
				now,
			);
			if (refresh.status === "failed") {
				flags.add("analytics_refresh_failed", "warn");
			}
		}
	} catch (error) {
		const summary = finish("failed", safeErrorMessage(error, redact));
		await close(summary);
		throw new IncrementalRunError(
			summary.error ?? "incremental sync failed",
			summary,
			{ cause: error },
		);
	}
	const summary = finish(
		state.stopped === null ? "succeeded" : "partial",
		null,
	);
	await close(summary);
	if (summary.status === "succeeded") {
		await repository.markAccountSynced(account.id, summary.finishedAt);
	}
	return summary;
}
