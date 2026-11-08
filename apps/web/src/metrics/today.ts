import {
	type InvoiceLineRow,
	type InvoiceRow,
	type PaymentKind,
	type PaymentMethodRow,
	type PaymentRow,
	paymentKinds,
	type StoreRow,
} from "../data/row-source";
import {
	addDays,
	businessDateOf,
	type IsoDate,
	localHourOf,
	minutesIntoBusinessDay,
	sameWeekdayHistory,
} from "../lib/business-dates";
import { median, shareOf, sum } from "./statistics";

export const BASELINE_WEEKS = 8;
export const TOP_ITEM_LIMIT = 5;
const HOURS_PER_DAY = 24;

export type DayFocus = "today" | "yesterday";

export interface StoreDayPlan {
	store: StoreRow;
	today: IsoDate;
	yesterday: IsoDate;
	history: Record<DayFocus, IsoDate[]>;
	elapsedMinutes: number;
}

export interface TodayPlan {
	stores: StoreDayPlan[];
	requiredDates: IsoDate[];
	todayDates: IsoDate[];
	yesterdayDates: IsoDate[];
}

export function planToday(stores: readonly StoreRow[], now: Date): TodayPlan {
	const plans = stores.map((store) => {
		const today = businessDateOf(now, store);
		const yesterday = addDays(today, -1);
		return {
			store,
			today,
			yesterday,
			history: {
				today: sameWeekdayHistory(today, BASELINE_WEEKS),
				yesterday: sameWeekdayHistory(yesterday, BASELINE_WEEKS),
			},
			elapsedMinutes: minutesIntoBusinessDay(now, today, store),
		};
	});
	const unique = (dates: IsoDate[]) => [...new Set(dates)].sort();
	return {
		stores: plans,
		requiredDates: unique(
			plans.flatMap((plan) => [
				plan.today,
				plan.yesterday,
				...plan.history.today,
				...plan.history.yesterday,
			]),
		),
		todayDates: unique(plans.map((plan) => plan.today)),
		yesterdayDates: unique(plans.map((plan) => plan.yesterday)),
	};
}

export interface DayTotals {
	net: number;
	invoices: number;
	avgTicket: number | null;
}

export interface Baseline {
	net: number | null;
	invoices: number | null;
	avgTicket: number | null;
	sampleDays: number;
}

export interface StoreDayReport {
	storeId: string;
	storeName: string;
	date: IsoDate;
	current: DayTotals;
	baseline: Baseline;
}

export interface HourlyPoint {
	hour: number;
	current: number | null;
	baseline: number;
}

export interface DayReport {
	focus: DayFocus;
	date: IsoDate | null;
	totals: DayTotals;
	baseline: Baseline;
	stores: StoreDayReport[];
	cutAtMinutes: number | null;
	hourly: HourlyPoint[];
}

export interface ItemSummary {
	key: string;
	name: string;
	quantity: number;
	net: number;
	share: number | null;
}

export interface PaymentMethodSummary {
	key: string;
	name: string | null;
	kind: PaymentKind;
	amount: number;
	share: number | null;
}

export interface PaymentKindSummary {
	kind: PaymentKind;
	amount: number;
	share: number | null;
}

export interface PaymentSplit {
	methods: PaymentMethodSummary[];
	kinds: PaymentKindSummary[];
	total: number;
	cashToCount: number;
}

export interface TodayRows {
	invoices: readonly InvoiceRow[];
	lines: readonly InvoiceLineRow[];
	payments: readonly PaymentRow[];
	paymentMethods: readonly PaymentMethodRow[];
	excludedDates: ReadonlySet<IsoDate>;
}

export interface TodayReport {
	plan: TodayPlan;
	today: DayReport;
	yesterday: DayReport;
	topItems: ItemSummary[];
	payments: PaymentSplit;
}

export function isCountedSale(invoice: InvoiceRow): boolean {
	return invoice.status !== "voided";
}

export function summarize(invoices: readonly InvoiceRow[]): DayTotals {
	const net = sum(invoices.map((invoice) => invoice.netAmount));
	const count = invoices.length;
	return { net, invoices: count, avgTicket: count === 0 ? null : net / count };
}

export function medianBaseline(days: readonly DayTotals[]): Baseline {
	const withData = days.filter((day) => day.invoices > 0);
	return {
		net: median(withData.map((day) => day.net)),
		invoices: median(withData.map((day) => day.invoices)),
		avgTicket: median(withData.map((day) => day.net / day.invoices)),
		sampleDays: withData.length,
	};
}

class InvoiceIndex {
	private readonly byStoreDay = new Map<string, InvoiceRow[]>();

	constructor(invoices: readonly InvoiceRow[], storeIds: ReadonlySet<string>) {
		for (const invoice of invoices) {
			if (!isCountedSale(invoice) || !storeIds.has(invoice.storeId)) continue;
			const key = InvoiceIndex.key(invoice.storeId, invoice.businessDate);
			const bucket = this.byStoreDay.get(key) ?? [];
			bucket.push(invoice);
			this.byStoreDay.set(key, bucket);
		}
	}

	static key(storeId: string, date: IsoDate): string {
		return `${storeId}|${date}`;
	}

	on(
		store: StoreRow,
		date: IsoDate,
		cutAtMinutes: number | null,
	): InvoiceRow[] {
		const invoices =
			this.byStoreDay.get(InvoiceIndex.key(store.id, date)) ?? [];
		if (cutAtMinutes === null) return invoices;
		return invoices.filter(
			(invoice) =>
				minutesIntoBusinessDay(new Date(invoice.soldAt), date, store) <=
				cutAtMinutes,
		);
	}
}

function dateOf(plan: StoreDayPlan, focus: DayFocus): IsoDate {
	return focus === "today" ? plan.today : plan.yesterday;
}

function addTotals(totals: readonly DayTotals[]): DayTotals {
	const net = sum(totals.map((total) => total.net));
	const invoices = sum(totals.map((total) => total.invoices));
	return { net, invoices, avgTicket: invoices === 0 ? null : net / invoices };
}

const MINUTES_PER_HOUR = 60;

function firstHourOf(firstStore: StoreDayPlan | undefined): number {
	return Math.floor(
		(firstStore?.store.businessDayStartMinutes ?? 0) / MINUTES_PER_HOUR,
	);
}

function hourAxis(firstStore: StoreDayPlan | undefined): number[] {
	const startHour = firstHourOf(firstStore);
	return Array.from(
		{ length: HOURS_PER_DAY },
		(_, offset) => (startHour + offset) % HOURS_PER_DAY,
	);
}

function lastElapsedAxisIndex(
	firstStore: StoreDayPlan | undefined,
	cutAtMinutes: number | null,
): number {
	if (cutAtMinutes === null || firstStore === undefined) {
		return HOURS_PER_DAY - 1;
	}
	const clockMinutes =
		firstStore.store.businessDayStartMinutes + Math.max(cutAtMinutes, 0);
	return Math.floor(clockMinutes / MINUTES_PER_HOUR) - firstHourOf(firstStore);
}

function hourlyNet(
	entries: readonly { store: StoreRow; invoices: readonly InvoiceRow[] }[],
): number[] {
	const buckets = Array.from({ length: HOURS_PER_DAY }, () => 0);
	for (const { store, invoices } of entries) {
		for (const invoice of invoices) {
			const hour = localHourOf(new Date(invoice.soldAt), store.timeZone);
			buckets[hour] = (buckets[hour] ?? 0) + invoice.netAmount;
		}
	}
	return buckets;
}

function trimQuietHours(points: HourlyPoint[]): HourlyPoint[] {
	const active = (point: HourlyPoint) =>
		(point.current !== null && point.current !== 0) || point.baseline !== 0;
	const first = points.findIndex(active);
	if (first === -1) return [];
	const last = points.length - 1 - [...points].reverse().findIndex(active);
	return points.slice(first, last + 1);
}

function buildDayReport(
	focus: DayFocus,
	plan: TodayPlan,
	index: InvoiceIndex,
	excludedDates: ReadonlySet<IsoDate>,
): DayReport {
	const cutFor = (storePlan: StoreDayPlan) =>
		focus === "today" ? storePlan.elapsedMinutes : null;
	const isExcludedWeek = (week: number) =>
		plan.stores.some((storePlan) => {
			const date = storePlan.history[focus][week];
			return date === undefined || excludedDates.has(date);
		});
	const weeks = Array.from(
		{ length: BASELINE_WEEKS },
		(_, week) => week,
	).filter((week) => !isExcludedWeek(week));
	const historyInvoices = (
		storePlan: StoreDayPlan,
		week: number,
		cut: number | null,
	) => index.on(storePlan.store, storePlan.history[focus][week] ?? "", cut);

	const stores = plan.stores.map((storePlan) => {
		const cut = cutFor(storePlan);
		return {
			storeId: storePlan.store.id,
			storeName: storePlan.store.name,
			date: dateOf(storePlan, focus),
			current: summarize(
				index.on(storePlan.store, dateOf(storePlan, focus), null),
			),
			baseline: medianBaseline(
				weeks.map((week) => summarize(historyInvoices(storePlan, week, cut))),
			),
		};
	});

	const weeklyTotals = weeks.map((week) =>
		addTotals(
			plan.stores.map((storePlan) =>
				summarize(historyInvoices(storePlan, week, cutFor(storePlan))),
			),
		),
	);

	const currentCurve = hourlyNet(
		plan.stores.map((storePlan) => ({
			store: storePlan.store,
			invoices: index.on(storePlan.store, dateOf(storePlan, focus), null),
		})),
	);
	const historyCurves = weeks
		.map((week) =>
			plan.stores.map((storePlan) => ({
				store: storePlan.store,
				invoices: historyInvoices(storePlan, week, null),
			})),
		)
		.filter((entries) => entries.some((entry) => entry.invoices.length > 0))
		.map(hourlyNet);
	const firstStore = plan.stores[0];
	const cutAtMinutes =
		focus === "today" && firstStore ? cutFor(firstStore) : null;
	const lastElapsed = lastElapsedAxisIndex(firstStore, cutAtMinutes);
	const hourly = trimQuietHours(
		hourAxis(firstStore).map((hour, position) => ({
			hour,
			current: position > lastElapsed ? null : (currentCurve[hour] ?? 0),
			baseline: median(historyCurves.map((curve) => curve[hour] ?? 0)) ?? 0,
		})),
	);

	return {
		focus,
		date: firstStore ? dateOf(firstStore, focus) : null,
		totals: addTotals(stores.map((store) => store.current)),
		baseline: medianBaseline(weeklyTotals),
		stores,
		cutAtMinutes,
		hourly,
	};
}

function todayInvoiceIds(
	plan: TodayPlan,
	index: InvoiceIndex,
): ReadonlySet<string> {
	return new Set(
		plan.stores.flatMap((storePlan) =>
			index
				.on(storePlan.store, storePlan.today, null)
				.map((invoice) => invoice.id),
		),
	);
}

export function topItems(
	lines: readonly InvoiceLineRow[],
	countedInvoiceIds: ReadonlySet<string>,
	limit: number = TOP_ITEM_LIMIT,
): ItemSummary[] {
	const byKey = new Map<string, Omit<ItemSummary, "share">>();
	for (const line of lines) {
		if (line.lineKind !== "item" || !countedInvoiceIds.has(line.invoiceId))
			continue;
		const key = line.itemExternalId ?? line.itemName;
		const entry = byKey.get(key) ?? {
			key,
			name: line.itemName,
			quantity: 0,
			net: 0,
		};
		entry.quantity += line.quantity;
		entry.net += line.netAmount;
		byKey.set(key, entry);
	}
	const entries = [...byKey.values()];
	const total = sum(entries.map((entry) => entry.net));
	return entries
		.sort(
			(left, right) =>
				right.net - left.net ||
				right.quantity - left.quantity ||
				left.name.localeCompare(right.name),
		)
		.slice(0, limit)
		.map((entry) => ({ ...entry, share: shareOf(entry.net, total) }));
}

export function paymentKindResolver(
	methods: readonly PaymentMethodRow[],
	stores: readonly StoreRow[],
): (payment: PaymentRow) => PaymentKind {
	const accountByStore = new Map(
		stores.map((store) => [store.id, store.posAccountId]),
	);
	const kindByMethod = new Map(
		methods.map((method) => [
			`${method.posAccountId}|${method.externalId}`,
			method.kind,
		]),
	);
	return (payment) => {
		const account = accountByStore.get(payment.storeId);
		if (account === undefined || payment.methodExternalId === null)
			return "other";
		return (
			kindByMethod.get(`${account}|${payment.methodExternalId}`) ?? "other"
		);
	};
}

export function paymentSplit(
	payments: readonly PaymentRow[],
	countedInvoiceIds: ReadonlySet<string>,
	kindOf: (payment: PaymentRow) => PaymentKind,
): PaymentSplit {
	const methods = new Map<string, Omit<PaymentMethodSummary, "share">>();
	for (const payment of payments) {
		if (!countedInvoiceIds.has(payment.invoiceId)) continue;
		const kind = kindOf(payment);
		const name = payment.methodName ?? payment.methodExternalId;
		const key = `${kind}|${name ?? ""}`;
		const entry = methods.get(key) ?? { key, name, kind, amount: 0 };
		entry.amount += payment.amount;
		methods.set(key, entry);
	}
	const entries = [...methods.values()];
	const total = sum(entries.map((entry) => entry.amount));
	const kinds = paymentKinds
		.map((kind) => ({
			kind,
			amount: sum(
				entries
					.filter((entry) => entry.kind === kind)
					.map((entry) => entry.amount),
			),
		}))
		.filter((entry) => entries.some((method) => method.kind === entry.kind))
		.map((entry) => ({ ...entry, share: shareOf(entry.amount, total) }))
		.sort((left, right) => right.amount - left.amount);
	return {
		methods: entries
			.map((entry) => ({ ...entry, share: shareOf(entry.amount, total) }))
			.sort((left, right) => right.amount - left.amount),
		kinds,
		total,
		cashToCount: sum(
			entries
				.filter((entry) => entry.kind === "cash")
				.map((entry) => entry.amount),
		),
	};
}

export function computeToday(
	stores: readonly StoreRow[],
	rows: TodayRows,
	now: Date,
): TodayReport {
	const plan = planToday(stores, now);
	const index = new InvoiceIndex(
		rows.invoices,
		new Set(stores.map((store) => store.id)),
	);
	const countedToday = todayInvoiceIds(plan, index);
	return {
		plan,
		today: buildDayReport("today", plan, index, rows.excludedDates),
		yesterday: buildDayReport("yesterday", plan, index, rows.excludedDates),
		topItems: topItems(rows.lines, countedToday),
		payments: paymentSplit(
			rows.payments,
			countedToday,
			paymentKindResolver(rows.paymentMethods, stores),
		),
	};
}
