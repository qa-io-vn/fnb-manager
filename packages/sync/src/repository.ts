import type { PaymentKind } from "@fnb/core";
import type {
	AccountRecord,
	AccountUpsert,
	AdjustmentWrite,
	CatalogWrite,
	LocalDayTotal,
	RefreshResult,
	RunFinish,
	RunStart,
	ShiftPaymentTotal,
	ShiftRow,
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

export interface SyncRepository {
	findAccounts(
		accountKey: string,
		tenantSlug?: string,
	): Promise<AccountRecord[]>;
	upsertAccount(account: AccountUpsert): Promise<AccountRecord>;
	readToken(accountId: string): Promise<TokenRecord | null>;
	writeToken(accountId: string, token: TokenRecord): Promise<void>;
	listStores(accountId: string): Promise<StoreRecord[]>;
	upsertStores(
		account: Pick<AccountRecord, "id" | "tenant_id">,
		stores: StoreUpsert[],
	): Promise<StoreUpsertResult>;
	replaceCatalog(catalog: CatalogWrite): Promise<TableCounts>;
	paymentMethodKinds(accountId: string): Promise<Record<string, PaymentKind>>;
	withStoreLock<T>(storeId: string, work: () => Promise<T>): Promise<T>;
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
	upsertChecks(checks: SyncCheckRow[]): Promise<TableCounts>;
	openRun(run: RunStart): Promise<string>;
	closeRun(runId: string, finish: RunFinish): Promise<void>;
	markAccountSynced(accountId: string, finishedAt: string): Promise<void>;
	refreshAnalytics(tenantId: string, range: DateRange): Promise<RefreshResult>;
}
