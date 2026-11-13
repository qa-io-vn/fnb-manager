import type { PaymentKind } from "@fnb/core";
import type { Sql } from "postgres";
import type {
	DateRange,
	StoreLockOptions,
	StoreUpsertResult,
	SyncRepository,
} from "../repository.js";
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
} from "../rows.js";
import * as accounts from "./accounts.js";
import * as bookkeeping from "./bookkeeping.js";
import * as catalog from "./catalog.js";
import { withStoreWindowLock } from "./locks.js";
import * as sales from "./sales.js";

export class PostgresSyncRepository implements SyncRepository {
	private readonly sql: Sql;

	constructor(sql: Sql) {
		this.sql = sql;
	}

	findAccounts(
		accountKey: string,
		tenantSlug?: string,
	): Promise<AccountRecord[]> {
		return accounts.findAccounts(this.sql, accountKey, tenantSlug);
	}

	upsertAccount(account: AccountUpsert): Promise<AccountRecord> {
		return accounts.upsertAccount(this.sql, account);
	}

	updateAccountStatus(
		accountId: string,
		status: AccountStatus,
		from: readonly AccountStatus[],
	): Promise<boolean> {
		return accounts.updateAccountStatus(this.sql, accountId, status, from);
	}

	findStore(storeId: string): Promise<StoreContext | null> {
		return accounts.findStore(this.sql, storeId);
	}

	readToken(accountId: string): Promise<TokenRecord | null> {
		return accounts.readToken(this.sql, accountId);
	}

	writeToken(accountId: string, token: TokenRecord): Promise<void> {
		return accounts.writeToken(this.sql, accountId, token);
	}

	listStores(accountId: string): Promise<StoreRecord[]> {
		return accounts.listStores(this.sql, accountId);
	}

	async upsertStores(
		account: Pick<AccountRecord, "id" | "tenant_id">,
		stores: StoreUpsert[],
	): Promise<StoreUpsertResult> {
		const counts = await this.sql.begin((tx) =>
			accounts.upsertStores(tx, account, stores),
		);
		return { stores: await this.listStores(account.id), counts };
	}

	replaceCatalog(write: CatalogWrite): Promise<TableCounts> {
		return this.sql.begin((tx) => catalog.replaceCatalog(tx, write));
	}

	paymentMethodKinds(accountId: string): Promise<Record<string, PaymentKind>> {
		return catalog.paymentMethodKinds(this.sql, accountId);
	}

	withStoreLock<T>(
		storeId: string,
		work: () => Promise<T>,
		options?: StoreLockOptions,
	): Promise<T> {
		return withStoreWindowLock(this.sql, storeId, work, options);
	}

	loadStoreWindow(
		storeId: string,
		range: DateRange,
		referencedExternalIds: readonly string[],
	): Promise<StoreWindowState> {
		return sales.loadStoreWindow(
			this.sql,
			storeId,
			range,
			referencedExternalIds,
		);
	}

	applyStoreDay(write: StoreDayWrite): Promise<TableCounts> {
		return this.sql.begin((tx) => sales.applyStoreDay(tx, write));
	}

	applyAdjustments(write: AdjustmentWrite): Promise<TableCounts> {
		return this.sql.begin((tx) => sales.applyAdjustments(tx, write));
	}

	shiftPaymentTotals(
		storeId: string,
		range: DateRange,
		shiftExternalIds: readonly string[],
	): Promise<ShiftPaymentTotal[]> {
		return sales.shiftPaymentTotals(this.sql, storeId, range, shiftExternalIds);
	}

	upsertShifts(storeId: string, shifts: ShiftRow[]): Promise<TableCounts> {
		return this.sql.begin((tx) =>
			bookkeeping.upsertShifts(tx, storeId, shifts),
		);
	}

	localDayTotals(storeId: string, range: DateRange): Promise<LocalDayTotal[]> {
		return sales.localDayTotals(this.sql, storeId, range);
	}

	loadChecks(storeId: string, range: DateRange): Promise<SyncCheckRow[]> {
		return bookkeeping.loadChecks(this.sql, storeId, range);
	}

	upsertChecks(checks: SyncCheckRow[]): Promise<TableCounts> {
		return this.sql.begin((tx) => bookkeeping.upsertChecks(tx, checks));
	}

	staleAnalyticsDates(storeId: string, range: DateRange): Promise<string[]> {
		return bookkeeping.staleAnalyticsDates(this.sql, storeId, range);
	}

	openRun(run: RunStart): Promise<string> {
		return bookkeeping.openRun(this.sql, run);
	}

	closeRun(runId: string, finish: RunFinish): Promise<void> {
		return bookkeeping.closeRun(this.sql, runId, finish);
	}

	closeAbandonedRuns(
		storeId: string,
		startedBefore: string,
		message: string,
	): Promise<number> {
		return bookkeeping.closeAbandonedRuns(
			this.sql,
			storeId,
			startedBefore,
			message,
		);
	}

	markAccountSynced(accountId: string, finishedAt: string): Promise<void> {
		return accounts.markAccountSynced(this.sql, accountId, finishedAt);
	}

	refreshAnalytics(tenantId: string, range: DateRange): Promise<RefreshResult> {
		return bookkeeping.refreshAnalytics(this.sql, tenantId, range);
	}
}
