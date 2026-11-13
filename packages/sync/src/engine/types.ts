import type { BusinessDateWindow, PosConnector } from "@fnb/connector-core";
import type { PaymentKindOptions } from "@fnb/core";
import type { SyncRepository } from "../repository.js";
import type { DbSyncKind, SyncCheckRow, TableCounts } from "../rows.js";
import type { DayReason } from "./change-detection.js";
import type { CheckTolerance } from "./checks.js";
import type { ConnectorCallerOptions } from "./connector-calls.js";
import type { FlagCount } from "./flags.js";
import type { Redactor } from "./redact.js";
import type { GuardStop, RunBudget, WorkCostModel } from "./run-guard.js";

export const SYNC_WINDOW_KINDS = [
	"backfill",
	"nightly",
	"incremental",
	"manual",
] as const;

export type SyncWindowKind = (typeof SYNC_WINDOW_KINDS)[number];

const DB_KINDS: Readonly<Record<SyncWindowKind, DbSyncKind>> = {
	backfill: "backfill",
	nightly: "nightly",
	incremental: "incremental",
	manual: "backfill",
};

export function toDbSyncKind(kind: SyncWindowKind): DbSyncKind {
	return DB_KINDS[kind];
}

export function isSyncWindowKind(value: string): value is SyncWindowKind {
	return (SYNC_WINDOW_KINDS as readonly string[]).includes(value);
}

export interface SyncEngineOptions {
	repository: SyncRepository;
	connector: PosConnector;
	now?: () => Date;
	calls?: ConnectorCallerOptions;
	redact?: Redactor;
	tolerance?: CheckTolerance;
	paymentKinds?: PaymentKindOptions;
	triggeredBy?: string;
}

export interface WindowOptions {
	dryRun?: boolean;
	refreshAnalytics?: boolean;
	lockWaitMs?: number;
}

export type RefreshSummary =
	| { status: "refreshed"; rows: number; durationMs: number }
	| { status: "unavailable" }
	| { status: "skipped" }
	| { status: "failed"; durationMs: number; error: string };

export interface StoreChecksSummary {
	available: boolean;
	matched: number;
	unmatched: number;
	rows: SyncCheckRow[];
}

export interface StoreWindowSummary {
	storeId: string;
	externalId: string;
	name: string;
	pulledSales: number;
	inserted: number;
	updated: number;
	statusChanged: number;
	unchanged: number;
	voided: number;
	edited: number;
	voidsSkipped: number;
	movedOutOfWindow: number;
	newAdjustmentEvents: number;
	touchedDates: string[];
	shifts: number;
	checks: StoreChecksSummary;
}

export interface ChecksSummary {
	available: boolean;
	matched: number;
	unmatched: number;
}

export interface WindowSummary {
	runId: string | null;
	kind: SyncWindowKind;
	dbKind: DbSyncKind;
	window: BusinessDateWindow;
	dryRun: boolean;
	status: "succeeded" | "failed";
	error: string | null;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	connectorCalls: number;
	retries: number;
	tables: TableCounts;
	stores: StoreWindowSummary[];
	checks: ChecksSummary;
	flags: FlagCount[];
	refresh: RefreshSummary;
}

export interface MasterDataSummary {
	runId: string;
	status: "succeeded" | "failed";
	error: string | null;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	connectorCalls: number;
	retries: number;
	stores: { discovered: number; active: number; deactivated: number };
	tables: TableCounts;
	flags: FlagCount[];
}

export interface IncrementalOptions {
	days?: number;
	budget?: RunBudget;
	costModel?: WorkCostModel;
	clock?: () => number;
	startedAt?: number;
	lockWaitMs?: number;
	refreshAnalytics?: boolean;
}

export type IncrementalStop = GuardStop | "store_busy";

export type IncrementalDayOutcome =
	| "synced"
	| "unchanged"
	| "handed_off"
	| "pending";

export interface IncrementalDay {
	date: string;
	reason: DayReason | null;
	outcome: IncrementalDayOutcome;
}

export interface IncrementalSummary {
	runId: string;
	status: "succeeded" | "partial" | "failed";
	stopped: IncrementalStop | null;
	error: string | null;
	window: BusinessDateWindow;
	days: IncrementalDay[];
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	connectorCalls: number;
	retries: number;
	tables: TableCounts;
	store: StoreWindowSummary;
	checks: ChecksSummary;
	flags: FlagCount[];
	refresh: RefreshSummary;
	refreshRetried: string[];
	estimatedCpuMs: number;
}

export class SyncRunError<TSummary> extends Error {
	readonly summary: TSummary;

	constructor(message: string, summary: TSummary, options?: ErrorOptions) {
		super(message, options);
		this.name = "SyncRunError";
		this.summary = summary;
	}
}

export class WindowRunError extends SyncRunError<WindowSummary> {
	constructor(message: string, summary: WindowSummary, options?: ErrorOptions) {
		super(message, summary, options);
		this.name = "WindowRunError";
	}
}

export class MasterDataRunError extends SyncRunError<MasterDataSummary> {
	constructor(
		message: string,
		summary: MasterDataSummary,
		options?: ErrorOptions,
	) {
		super(message, summary, options);
		this.name = "MasterDataRunError";
	}
}

export class IncrementalRunError extends SyncRunError<IncrementalSummary> {
	constructor(
		message: string,
		summary: IncrementalSummary,
		options?: ErrorOptions,
	) {
		super(message, summary, options);
		this.name = "IncrementalRunError";
	}
}
