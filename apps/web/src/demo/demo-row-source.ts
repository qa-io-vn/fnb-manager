import { MENU } from "@fnb/connector-mock";
import { type CanonicalSale, isExcludedDay, VIETNAM_HOLIDAYS } from "@fnb/core";
import {
	DEMO_POS_ACCOUNT_ID,
	DEMO_TENANT_ID,
	DEMO_TIME_ZONE,
	type DemoDayCache,
	sharedDemoDays,
	toDbLineKind,
} from "@fnb/demo-analytics";
import type {
	InvoiceLineRow,
	InvoiceRow,
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

export { DEMO_TENANT_ID };

const DEMO_CURRENCY = "VND";

export const demoTenant: TenantRow = {
	id: DEMO_TENANT_ID,
	name: "Demo",
	currencyCode: DEMO_CURRENCY,
	timeZone: DEMO_TIME_ZONE,
	countryCode: "VN",
};

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
				lineKind: toDbLineKind(line.lineKind),
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

export function createDemoRowSource(
	now: () => Date = () => new Date(),
	days: DemoDayCache = sharedDemoDays(),
): RowSource {
	const wholeDays = new Map<string, Promise<DemoDayRows>>();

	const storeRows = (): StoreRow[] =>
		days.stores().map((store) => ({
			id: store.id,
			tenantId: DEMO_TENANT_ID,
			name: store.name,
			code: store.id,
			timeZone: store.timeZone,
			businessDayStartMinutes: store.businessDayStartMinutes,
			posAccountId: store.posAccountId,
		}));

	const wholeDay = (storeId: string, date: IsoDate): Promise<DemoDayRows> => {
		const key = `${days.asOf()}|${storeId}|${date}`;
		const known = wholeDays.get(key);
		if (known) return known;
		const pending = days
			.generated(storeId, date)
			.then((day) => (day === null ? noRows : rowsOfSales(storeId, day.sales)));
		wholeDays.set(key, pending);
		pending.catch(() => wholeDays.delete(key));
		return pending;
	};

	const dayRows = async (
		store: StoreRow,
		date: IsoDate,
	): Promise<DemoDayRows> => {
		const instant = now();
		const order = compareIsoDates(date, businessDateOf(instant, store));
		if (order > 0) return noRows;
		const rows = await wholeDay(store.id, date);
		return order === 0 ? soldBy(rows, instant) : rows;
	};

	const collect = async <T>(
		scope: StoreDates,
		pick: (rows: DemoDayRows) => T[],
	): Promise<T[]> => {
		const storeIds = new Set(scope.storeIds);
		const collected: T[] = [];
		for (const store of storeRows()) {
			if (!storeIds.has(store.id)) continue;
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
			posAccountId: DEMO_POS_ACCOUNT_ID,
			externalId: method.externalId,
			name: method.name,
			kind: method.kind,
		}),
	);

	return {
		kind: "demo",
		tenants: async () => [demoTenant],
		stores: async (tenantId) =>
			tenantId === DEMO_TENANT_ID ? storeRows() : [],
		paymentMethods: async () => paymentMethods,
		excludedDates: async (_tenant, dates) =>
			dates.filter((date) => isExcludedDay(VIETNAM_HOLIDAYS, date)),
		invoices: (scope) => collect(scope, (rows) => rows.invoices),
		invoiceLines: (scope) => collect(scope, (rows) => rows.lines),
		payments: (scope) => collect(scope, (rows) => rows.payments),
		freshness: async () => ({ kind: "sample" }),
		verification: async () => ({ kind: "sample" }),
	};
}
