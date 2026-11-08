import {
	generateDay,
	MENU,
	type MockProfile,
	mockStore,
	resolveProfile,
} from "@fnb/connector-mock";
import type { CanonicalLine, CanonicalSale, CanonicalStore } from "@fnb/core";
import type {
	InvoiceLineRow,
	InvoiceRow,
	LineKind,
	PaymentMethodRow,
	PaymentRow,
	RowSource,
	StoreDates,
	StoreRow,
	TenantRow,
} from "../data/row-source";
import {
	businessDateOf,
	compareIsoDates,
	type IsoDate,
} from "../lib/business-dates";

export const DEMO_SEED = 20_261_108;
export const DEMO_TENANT_ID = "demo-tenant";
const DEMO_ACCOUNT_ID = "demo-account";

const baseProfile = resolveProfile();

const demoStoreProfiles: readonly Partial<MockProfile>[] = [
	{},
	{ averageSalesPerDay: 72, largeSizeShare: 0.3 },
];

export const demoTenant: TenantRow = {
	id: DEMO_TENANT_ID,
	name: "Demo",
	currencyCode: baseProfile.currency,
	timeZone: baseProfile.timezone,
	countryCode: "VN",
};

interface DemoStore {
	row: StoreRow;
	canonical: CanonicalStore;
	profile: MockProfile;
}

const demoStores: readonly DemoStore[] = demoStoreProfiles.map(
	(overrides, index) => {
		const profile = resolveProfile(overrides);
		const canonical = mockStore(index + 1, profile);
		return {
			profile,
			canonical,
			row: {
				id: canonical.externalId,
				tenantId: DEMO_TENANT_ID,
				name: canonical.name,
				code: canonical.externalId,
				timeZone: canonical.timezone,
				businessDayStartMinutes: canonical.dayStartMinutes,
				posAccountId: DEMO_ACCOUNT_ID,
			},
		};
	},
);

function storedLineKind(kind: CanonicalLine["lineKind"]): LineKind {
	return kind === "package_component" ? "package" : kind;
}

interface DemoDayRows {
	invoices: InvoiceRow[];
	lines: InvoiceLineRow[];
	payments: PaymentRow[];
}

function rowsOfSales(
	storeId: string,
	sales: readonly CanonicalSale[],
): DemoDayRows {
	return {
		invoices: sales.map((sale) => ({
			id: sale.externalId,
			storeId,
			businessDate: sale.businessDate,
			soldAt: sale.soldAt.toISOString(),
			netAmount: sale.netAmount,
			status: sale.status,
		})),
		lines: sales.flatMap((sale) =>
			sale.lines.map((line) => ({
				invoiceId: sale.externalId,
				storeId,
				lineKind: storedLineKind(line.lineKind),
				itemExternalId: line.itemExternalId ?? null,
				itemName: line.itemName,
				quantity: line.quantity,
				netAmount: line.netAmount,
			})),
		),
		payments: sales.flatMap((sale) =>
			sale.payments.map((payment) => ({
				invoiceId: sale.externalId,
				storeId,
				businessDate: sale.businessDate,
				methodExternalId: payment.methodExternalId,
				methodName: payment.methodName,
				amount: payment.amount,
			})),
		),
	};
}

const noRows: DemoDayRows = { invoices: [], lines: [], payments: [] };

function soldBy(rows: DemoDayRows, instant: Date): DemoDayRows {
	const cutOff = instant.getTime();
	const invoices = rows.invoices.filter(
		(invoice) => Date.parse(invoice.soldAt) <= cutOff,
	);
	if (invoices.length === rows.invoices.length) return rows;
	const kept = new Set(invoices.map((invoice) => invoice.id));
	return {
		invoices,
		lines: rows.lines.filter((line) => kept.has(line.invoiceId)),
		payments: rows.payments.filter((payment) => kept.has(payment.invoiceId)),
	};
}

interface YieldingScheduler {
	yield?: () => Promise<void>;
}

function nextTask(): Promise<void> {
	const scheduler = (globalThis as { scheduler?: YieldingScheduler }).scheduler;
	if (typeof scheduler?.yield === "function") return scheduler.yield();
	return new Promise((resolve) => setTimeout(resolve, 0));
}

export function createDemoRowSource(
	now: () => Date = () => new Date(),
): RowSource {
	const generatedDays = new Map<string, Promise<DemoDayRows>>();

	const wholeDay = (store: DemoStore, date: IsoDate): Promise<DemoDayRows> => {
		const key = `${store.row.id}|${date}`;
		const known = generatedDays.get(key);
		if (known) return known;
		const pending = nextTask().then(() =>
			rowsOfSales(
				store.row.id,
				generateDay(DEMO_SEED, store.profile, store.canonical, date, MENU)
					.sales,
			),
		);
		generatedDays.set(key, pending);
		pending.catch(() => generatedDays.delete(key));
		return pending;
	};

	const dayRows = async (
		store: DemoStore,
		date: IsoDate,
	): Promise<DemoDayRows> => {
		const instant = now();
		const order = compareIsoDates(date, businessDateOf(instant, store.row));
		if (order > 0) return noRows;
		const rows = await wholeDay(store, date);
		return order === 0 ? soldBy(rows, instant) : rows;
	};

	const collect = async <T>(
		scope: StoreDates,
		pick: (rows: DemoDayRows) => T[],
	): Promise<T[]> => {
		const storeIds = new Set(scope.storeIds);
		const collected: T[] = [];
		for (const store of demoStores) {
			if (!storeIds.has(store.row.id)) continue;
			for (const date of scope.dates) {
				for (const row of pick(await dayRows(store, date))) {
					collected.push(row);
				}
			}
		}
		return collected;
	};

	const paymentMethods: PaymentMethodRow[] = MENU.catalog.paymentMethods.map(
		(method) => ({
			posAccountId: DEMO_ACCOUNT_ID,
			externalId: method.externalId,
			name: method.name,
			kind: method.kind,
		}),
	);

	return {
		kind: "demo",
		tenants: async () => [demoTenant],
		stores: async (tenantId) =>
			tenantId === DEMO_TENANT_ID ? demoStores.map((store) => store.row) : [],
		paymentMethods: async () => paymentMethods,
		excludedDates: async () => [],
		invoices: (scope) => collect(scope, (rows) => rows.invoices),
		invoiceLines: (scope) => collect(scope, (rows) => rows.lines),
		payments: (scope) => collect(scope, (rows) => rows.payments),
		freshness: async () => ({ kind: "sample" }),
		verification: async () => ({ kind: "sample" }),
	};
}
