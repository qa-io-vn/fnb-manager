export {
	invoiceDigest,
	lineSetKey,
	sortLines,
	sortPayments,
} from "./digest.js";
export {
	type ChangeDetectionInput,
	DAY_REASONS,
	type DayDecision,
	type DayReason,
	detectChangedDays,
} from "./engine/change-detection.js";
export {
	allowedDifference,
	buildChecks,
	type CheckTolerance,
	DEFAULT_CHECK_TOLERANCE,
	totalsMatch,
} from "./engine/checks.js";
export {
	ConnectorCaller,
	type ConnectorCallerOptions,
	DEFAULT_CALL_BUDGET,
	DEFAULT_RETRY_POLICY,
	isRetryable,
	type RetryPolicy,
	type Sleep,
	SyncBudgetError,
} from "./engine/connector-calls.js";
export { FlagCollector, type FlagCount } from "./engine/flags.js";
export {
	ABANDONED_RUN_AFTER_MS,
	ABANDONED_RUN_MESSAGE,
	DEFAULT_LOCK_WAIT_MS,
	type IncrementalDayCounts,
	incrementalDayCounts,
	mergeStoreSummaries,
	STALE_REFRESH_LOOKBACK_DAYS,
	staleRefreshRange,
} from "./engine/incremental.js";
export {
	INCREMENTAL_DAYS,
	incrementalWindow,
	type StoreDay,
} from "./engine/incremental-window.js";
export {
	createRedactor,
	describeError,
	type Redactor,
	safeErrorMessage,
} from "./engine/redact.js";
export { contiguousRanges } from "./engine/refresh.js";
export {
	DEFAULT_COST_MODEL,
	type EdgeFunctionLimits,
	type GuardStop,
	INCREMENTAL_BUDGET,
	type RunBudget,
	RunDeadlineError,
	RunGuard,
	type RunGuardOptions,
	SERVER_INCREMENTAL_BUDGET,
	SUPABASE_FREE_PLAN_EDGE_LIMITS,
	type WorkCostModel,
} from "./engine/run-guard.js";
export { SyncEngine } from "./engine/sync-engine.js";
export {
	type ChecksSummary,
	type IncrementalDay,
	type IncrementalDayOutcome,
	type IncrementalOptions,
	IncrementalRunError,
	type IncrementalStop,
	type IncrementalSummary,
	isSyncWindowKind,
	MasterDataRunError,
	type MasterDataSummary,
	type RefreshSummary,
	type StoreChecksSummary,
	type StoreWindowSummary,
	SYNC_WINDOW_KINDS,
	type SyncEngineOptions,
	SyncRunError,
	type SyncWindowKind,
	toDbSyncKind,
	type WindowOptions,
	WindowRunError,
	type WindowSummary,
} from "./engine/types.js";
export { DEFAULT_WINDOW_LOCK_WAIT_MS } from "./engine/window.js";
export { toJson } from "./json.js";
export {
	STORE_LOCK_NAMESPACE,
	STORE_WINDOW_LOCK_NAMESPACE,
	storeLockKey,
	storeWindowLockKey,
} from "./lock-key.js";
export {
	mapCatalog,
	mergeCatalogs,
	resolvePaymentKind,
} from "./mapping/catalog.js";
export { adjustmentEvents, eventKey, mapAdjustment } from "./mapping/event.js";
export { mapSale, toDbLineKind } from "./mapping/sale.js";
export { mapShift } from "./mapping/shift.js";
export { toCanonicalStore, toStoreUpsert } from "./mapping/store.js";
export {
	type InMemoryRepositoryOptions,
	InMemorySyncRepository,
	type MemoryOperation,
} from "./memory/repository.js";
export type { MemoryTables } from "./memory/tables.js";
export {
	formatMoney,
	formatNumeric,
	formatQuantity,
	parseNumeric,
} from "./numeric.js";
export { salePayloadRecord, withoutParentFields } from "./payloads.js";
export { deriveStatus } from "./plan/event-index.js";
export { planStoreDay, type StoreDayPlan } from "./plan/store-day.js";
export type {
	DateRange,
	StoreLockOptions,
	StoreUpsertResult,
	SyncRepository,
} from "./repository.js";
export * from "./rows.js";
export {
	LOCK_POLL_INTERVAL_MS,
	StoreLockBusyError,
} from "./store-lock.js";
