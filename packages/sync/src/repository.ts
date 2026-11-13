import type { PaymentKind } from "@fnb/core";
import type {
	AccountRecord,
	AccountStatus,
	AccountUpsert,
	AdjustmentWrite,
	CatalogWrite,
	LocalDayTotal,
	RefreshResult,
	RunFinish,
	RunStart,
	ShiftPaymentTotal,
	ShiftRow,
	StoreContext,
	StoreDayWrite,
	StoreRecord,
	StoreUpsert,
	StoreWindowState,
	SyncCheckRow,
	TableCounts,
	TokenRecord,
} from "./rows.js";

export interface DateRange {
	from: string;
	to: string;
}

export interface StoreUpsertResult {
	stores: StoreRecord[];
	counts: TableCounts;
}

export interface StoreLockOptions {
	waitMs?: number;
}

export interface SyncRepository {
	findAccounts(
		accountKey: string,
		tenantSlug?: string,
	): Promise<AccountRecord[]>;
	upsertAccount(account: AccountUpsert): Promise<AccountRecord>;
	updateAccountStatus(
		accountId: string,
		status: AccountStatus,
		from: readonly AccountStatus[],
	): Promise<boolean>;
	findStore(storeId: string): Promise<StoreContext | null>;
	readToken(accountId: string): Promise<TokenRecord | null>;
	writeToken(accountId: string, token: TokenRecord): Promise<void>;
	listStores(accountId: string): Promise<StoreRecord[]>;
	upsertStores(
		account: Pick<AccountRecord, "id" | "tenant_id">,
		stores: StoreUpsert[],
	): Promise<StoreUpsertResult>;
	replaceCatalog(catalog: CatalogWrite): Promise<TableCounts>;
	paymentMethodKinds(accountId: string): Promise<Record<string, PaymentKind>>;
	withStoreLock<T>(
		storeId: string,
		work: () => Promise<T>,
		options?: StoreLockOptions,
	): Promise<T>;
	loadStoreWindow(
		storeId: string,
		range: DateRange,
		referencedExternalIds: readonly string[],
	): Promise<StoreWindowState>;
	applyStoreDay(write: StoreDayWrite): Promise<TableCounts>;
	applyAdjustments(write: AdjustmentWrite): Promise<TableCounts>;
	shiftPaymentTotals(
		storeId: string,
		range: DateRange,
		shiftExternalIds: readonly string[],
	): Promise<ShiftPaymentTotal[]>;
	upsertShifts(storeId: string, shifts: ShiftRow[]): Promise<TableCounts>;
	localDayTotals(storeId: string, range: DateRange): Promise<LocalDayTotal[]>;
	loadChecks(storeId: string, range: DateRange): Promise<SyncCheckRow[]>;
	staleAnalyticsDates(storeId: string, range: DateRange): Promise<string[]>;
	upsertChecks(checks: SyncCheckRow[]): Promise<TableCounts>;
	openRun(run: RunStart): Promise<string>;
	closeAbandonedRuns(
		storeId: string,
		startedBefore: string,
		message: string,
	): Promise<number>;
	closeRun(runId: string, finish: RunFinish): Promise<void>;
	markAccountSynced(accountId: string, finishedAt: string): Promise<void>;
	refreshAnalytics(tenantId: string, range: DateRange): Promise<RefreshResult>;
}
