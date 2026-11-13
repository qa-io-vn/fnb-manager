import type { PaymentKind } from "@fnb/core";
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
import { MemoryLocks } from "./locks.js";
import * as sales from "./sales.js";
import {
	byText,
	MemoryState,
	type MemoryTables,
	type MemoryTenant,
	type StoredCatalogRow,
} from "./tables.js";

export type MemoryOperation = keyof SyncRepository;

export interface InMemoryRepositoryOptions {
	now?: () => Date;
	analyticsAvailable?: boolean;
	failOn?: (operation: MemoryOperation) => Error | undefined;
}

export class InMemorySyncRepository implements SyncRepository {
	readonly refreshCalls: { tenantId: string; range: DateRange }[] = [];
	private readonly refreshes: bookkeeping.MemoryRefresh[] = [];
	private readonly state: MemoryState;
	private readonly locks = new MemoryLocks();
	private readonly analyticsAvailable: boolean;
	private readonly failOn: InMemoryRepositoryOptions["failOn"];

	constructor(options: InMemoryRepositoryOptions = {}) {
		this.state = new MemoryState(options.now ?? (() => new Date()));
		this.analyticsAvailable = options.analyticsAvailable ?? true;
		this.failOn = options.failOn;
	}

	get tables(): MemoryTables {
		return this.state.tables;
	}

	get heldLocks(): ReadonlySet<string> {
		return this.locks.heldLocks;
	}

	get lockLog(): readonly string[] {
		return this.locks.lockLog;
	}

	get windowLockLog(): readonly string[] {
		return this.locks.windowLockLog;
	}

	get windowLocksHeld(): number {
		return this.locks.windowLocksHeld;
	}

	addTenant(slug: string, currency = "VND"): MemoryTenant {
		return accounts.addTenant(this.state, slug, currency);
	}

	addStore(
		account: Pick<AccountRecord, "id" | "tenant_id">,
		store: StoreUpsert,
	): StoreRecord {
		return accounts.addStore(this.state, account, store);
	}

	snapshot(): Record<string, unknown[]> {
		const sorted = <T extends { id: string }>(rows: readonly T[]) =>
			[...rows].sort((left, right) => byText(left.id, right.id));
		const { tables } = this.state;
		return structuredClone({
			invoices: sorted(tables.invoices),
			invoice_lines: sorted(tables.lines),
			invoice_payments: sorted(tables.payments),
			invoice_events: sorted(tables.events),
			shifts: sorted(tables.shifts),
			sync_checks: sorted(tables.checks),
		});
	}

	catalogRows(table: string): StoredCatalogRow[] {
		return catalog.catalogRows(this.state, table);
	}

	async findAccounts(
		accountKey: string,
		tenantSlug?: string,
	): Promise<AccountRecord[]> {
		this.guard("findAccounts");
		return accounts.findAccounts(this.state, accountKey, tenantSlug);
	}

	async upsertAccount(account: AccountUpsert): Promise<AccountRecord> {
		this.guard("upsertAccount");
		return accounts.upsertAccount(this.state, account);
	}

	async updateAccountStatus(
		accountId: string,
		status: AccountStatus,
		from: readonly AccountStatus[],
	): Promise<boolean> {
		this.guard("updateAccountStatus");
		return accounts.updateAccountStatus(this.state, accountId, status, from);
	}

	async findStore(storeId: string): Promise<StoreContext | null> {
		this.guard("findStore");
		return accounts.findStore(this.state, storeId);
	}

	async readToken(accountId: string): Promise<TokenRecord | null> {
		this.guard("readToken");
		return this.state.tables.tokens.get(accountId) ?? null;
	}

	async writeToken(accountId: string, token: TokenRecord): Promise<void> {
		this.guard("writeToken");
		this.state.tables.tokens.set(accountId, { ...token });
	}

	async listStores(accountId: string): Promise<StoreRecord[]> {
		this.guard("listStores");
		return accounts.listStores(this.state, accountId);
	}

	async upsertStores(
		account: Pick<AccountRecord, "id" | "tenant_id">,
		stores: StoreUpsert[],
	): Promise<StoreUpsertResult> {
		this.guard("upsertStores");
		return accounts.upsertStores(this.state, account, stores);
	}

	async replaceCatalog(write: CatalogWrite): Promise<TableCounts> {
		this.guard("replaceCatalog");
		return catalog.replaceCatalog(this.state, write);
	}

	async paymentMethodKinds(
		accountId: string,
	): Promise<Record<string, PaymentKind>> {
		this.guard("paymentMethodKinds");
		return catalog.paymentMethodKinds(this.state, accountId);
	}

	async withStoreLock<T>(
		storeId: string,
		work: () => Promise<T>,
		options?: StoreLockOptions,
	): Promise<T> {
		this.guard("withStoreLock");
		return this.locks.withWindowLock(storeId, work, options);
	}

	async loadStoreWindow(
		storeId: string,
		range: DateRange,
		referencedExternalIds: readonly string[],
	): Promise<StoreWindowState> {
		this.guard("loadStoreWindow");
		return sales.loadStoreWindow(
			this.state,
			storeId,
			range,
			referencedExternalIds,
		);
	}

	applyStoreDay(write: StoreDayWrite): Promise<TableCounts> {
		return this.write("applyStoreDay", write.store_id, () =>
			sales.applyStoreDay(this.state, write),
		);
	}

	applyAdjustments(write: AdjustmentWrite): Promise<TableCounts> {
		return this.write("applyAdjustments", write.store_id, () =>
			sales.applyAdjustments(this.state, write),
		);
	}

	async shiftPaymentTotals(
		storeId: string,
		range: DateRange,
		shiftExternalIds: readonly string[],
	): Promise<ShiftPaymentTotal[]> {
		this.guard("shiftPaymentTotals");
		return sales.shiftPaymentTotals(
			this.state,
			storeId,
			range,
			shiftExternalIds,
		);
	}

	upsertShifts(storeId: string, shifts: ShiftRow[]): Promise<TableCounts> {
		return this.write("upsertShifts", storeId, () =>
			bookkeeping.upsertShifts(this.state, shifts),
		);
	}

	async localDayTotals(
		storeId: string,
		range: DateRange,
	): Promise<LocalDayTotal[]> {
		this.guard("localDayTotals");
		return sales.localDayTotals(this.state, storeId, range);
	}

	async loadChecks(storeId: string, range: DateRange): Promise<SyncCheckRow[]> {
		this.guard("loadChecks");
		return bookkeeping.loadChecks(this.state, storeId, range);
	}

	async upsertChecks(checks: SyncCheckRow[]): Promise<TableCounts> {
		this.guard("upsertChecks");
		return bookkeeping.upsertChecks(this.state, checks);
	}

	async staleAnalyticsDates(
		storeId: string,
		range: DateRange,
	): Promise<string[]> {
		this.guard("staleAnalyticsDates");
		return bookkeeping.staleAnalyticsDates(
			this.state,
			this.refreshes,
			storeId,
			range,
		);
	}

	async openRun(run: RunStart): Promise<string> {
		this.guard("openRun");
		return bookkeeping.openRun(this.state, run);
	}

	async closeRun(runId: string, finish: RunFinish): Promise<void> {
		this.guard("closeRun");
		bookkeeping.closeRun(this.state, runId, finish);
	}

	async closeAbandonedRuns(
		storeId: string,
		startedBefore: string,
		message: string,
	): Promise<number> {
		this.guard("closeAbandonedRuns");
		return bookkeeping.closeAbandonedRuns(
			this.state,
			storeId,
			startedBefore,
			message,
		);
	}

	async markAccountSynced(
		accountId: string,
		finishedAt: string,
	): Promise<void> {
		this.guard("markAccountSynced");
		accounts.markAccountSynced(this.state, accountId, finishedAt);
	}

	async refreshAnalytics(
		tenantId: string,
		range: DateRange,
	): Promise<RefreshResult> {
		this.guard("refreshAnalytics");
		if (!this.analyticsAvailable) {
			return { available: false };
		}
		this.refreshCalls.push({ tenantId, range });
		this.refreshes.push({
			tenantId,
			range: { ...range },
			startedAt: this.state.timestamp(),
		});
		return { available: true, rows: 0 };
	}

	private guard(operation: MemoryOperation): void {
		const error = this.failOn?.(operation);
		if (error) {
			throw error;
		}
	}

	private write<T>(
		operation: MemoryOperation,
		storeId: string,
		work: () => T,
	): Promise<T> {
		return this.locks.transaction(this.state, storeId, () => {
			this.guard(operation);
			return work();
		});
	}
}
