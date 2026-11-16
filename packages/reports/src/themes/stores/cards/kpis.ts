import type {
	CardModel,
	ChartModel,
	Comparison,
	NoticeModel,
	TableCell,
	TableModel,
	TableRowModel,
} from "../../../model/card.js";
import { reportKeys, unavailableKey } from "../../../model/keys.js";
import { ratio, relativeChange } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	type SentencePart,
	textValue,
} from "../../../model/values.js";
import {
	comparisonsFromRangeRows,
	RANGE_INDEX,
	type RangeTotalsRow,
	rangeRow,
	type ThemeCardDefinition,
	type ThemeCardInput,
} from "../../definition.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { storesKeys } from "../keys.js";
import {
	comparesStores,
	needTwoCard,
	type ProductivityRow,
	productivityRowsOf,
	storesCalls,
	storesCsvName,
	storesNeeds,
	storeTone,
	totalsRowsOf,
} from "../support.js";

const SHARE_DIGITS = 6;
const ALL_STORES_ROW = "all";
export const EVEN_GAP = 0.0005;
export const NOT_CONFIGURED_CELL = unavailableKey("not_configured", "previous");
const STORE_TOO_YOUNG_CELL = unavailableKey("store_too_young", "previous");

export const KPI_METRIC_IDS = [
	"net_revenue",
	"invoices",
	"avg_ticket",
	"items_per_ticket",
	"avg_item_price",
	"cash_share",
	"discount_rate",
	"voucher_invoice_share",
	"customer_capture_rate",
	"sales_per_opening_hour",
	"revpash",
] as const;

export interface StoreKpis {
	readonly id: string;
	readonly label: string;
	readonly current: RangeTotalsRow | undefined;
	readonly previous: RangeTotalsRow | undefined;
	readonly productivity: ProductivityRow | undefined;
	readonly young: boolean;
}

export interface AllStoresKpis extends StoreKpis {
	readonly netChange: Comparison | null;
	readonly ticketChange: Comparison | null;
}

export type GapResult =
	| {
			readonly kind: "gap";
			readonly high: StoreKpis;
			readonly low: StoreKpis;
			readonly gap: number;
	  }
	| { readonly kind: "even" };

function productivityOf(
	rows: readonly ProductivityRow[],
	storeId: string | null,
): ProductivityRow | undefined {
	return rows.find((row) => row.store_id === storeId);
}

export function storeKpis(input: ThemeCardInput): StoreKpis[] {
	const { context, coverage } = input;
	const totals = totalsRowsOf(input.results);
	const productivity = productivityRowsOf(input.results);
	return context.stores.map((store) => ({
		id: store.id,
		label: store.name,
		current: rangeRow(totals, RANGE_INDEX.current, store.id),
		previous: rangeRow(totals, RANGE_INDEX.previous, store.id),
		productivity: productivityOf(productivity, store.id),
		young: coverage.isYoungAt(store.id, context.range.previous.from),
	}));
}

function previousComparison(
	input: ThemeCardInput,
	pick: (row: RangeTotalsRow) => number | null,
): Comparison | null {
	const [previous] = comparisonsFromRangeRows({
		context: input.context,
		all: totalsRowsOf(input.results),
		likeForLike: {
			previous: totalsRowsOf(input.results, storesCalls.totalsLikeForLike),
		},
		coverage: input.coverage,
		pick,
		kinds: ["previous"],
	});
	return previous ?? null;
}

export function allStoresKpis(input: ThemeCardInput): AllStoresKpis {
	const totals = totalsRowsOf(input.results);
	const netChange = previousComparison(input, (row) => row.net_amount);
	return {
		id: ALL_STORES_ROW,
		label:
			netChange?.basis === "like_for_like"
				? storesKeys.kpis.allStoresLikeForLike
				: storesKeys.kpis.allStores,
		current: rangeRow(totals, RANGE_INDEX.current),
		previous: rangeRow(totals, RANGE_INDEX.previous),
		productivity: productivityOf(productivityRowsOf(input.results), null),
		young: false,
		netChange,
		ticketChange: previousComparison(input, (row) => row.avg_ticket),
	};
}

function hasSales(row: ProductivityRow | undefined): row is ProductivityRow {
	return row !== undefined && row.days_with_sales > 0;
}

export function salesPerHourCell(row: ProductivityRow | undefined): TableCell {
	if (!hasSales(row)) return null;
	if (row.opening_minutes === null) return NOT_CONFIGURED_CELL;
	return row.sales_per_opening_hour;
}

export function revpashCell(row: ProductivityRow | undefined): TableCell {
	if (!hasSales(row)) return null;
	if (row.opening_minutes === null || row.seat_minutes === null) {
		return NOT_CONFIGURED_CELL;
	}
	return row.revpash;
}

function lacksSetup(row: ProductivityRow | undefined): boolean {
	return (
		hasSales(row) && (row.opening_minutes === null || row.seat_count === null)
	);
}

function storeChangeCell(
	entry: StoreKpis,
	pick: (row: RangeTotalsRow) => number | null,
): TableCell {
	if (entry.current === undefined) return null;
	if (entry.young) return STORE_TOO_YOUNG_CELL;
	return relativeChange(
		pick(entry.current),
		entry.previous === undefined ? null : pick(entry.previous),
	);
}

function comparisonCell(change: Comparison | null): TableCell {
	if (change === null) return null;
	if (change.unavailable !== null) {
		return unavailableKey(change.unavailable, "previous");
	}
	return change.change;
}

function rowOf(
	entry: StoreKpis,
	changes: { readonly net: TableCell; readonly ticket: TableCell },
): TableRowModel {
	const row = entry.current;
	return {
		id: entry.id,
		cells: {
			store: entry.label,
			net: row?.net_amount ?? null,
			netChange: changes.net,
			invoices: row?.invoices ?? null,
			avgTicket: row?.avg_ticket ?? null,
			ticketChange: changes.ticket,
			itemsPerTicket: row?.items_per_ticket ?? null,
			avgItemPrice: row?.avg_item_price ?? null,
			cashShare: row?.cash_share ?? null,
			discountRate: row?.discount_rate ?? null,
			voucherShare: row?.voucher_share ?? null,
			captureRate: row?.identified_share ?? null,
			salesPerHour: salesPerHourCell(entry.productivity),
			revpash: revpashCell(entry.productivity),
		},
	};
}

function storeRowOf(entry: StoreKpis): TableRowModel {
	return rowOf(entry, {
		net: storeChangeCell(entry, (totals) => totals.net_amount),
		ticket: storeChangeCell(entry, (totals) => totals.avg_ticket),
	});
}

function allStoresRowOf(all: AllStoresKpis): TableRowModel {
	return rowOf(all, {
		net: comparisonCell(all.netChange),
		ticket: comparisonCell(all.ticketChange),
	});
}

function netOf(entry: StoreKpis): number | null {
	return entry.current?.net_amount ?? null;
}

function byNetDescending(left: StoreKpis, right: StoreKpis): number {
	return (netOf(right) ?? -Infinity) - (netOf(left) ?? -Infinity);
}

function kpiTable(
	stores: readonly StoreKpis[],
	all: AllStoresKpis,
): TableModel {
	return tableModel({
		captionKey: storesKeys.kpis.table,
		columns: [
			column("store", reportKeys.table.store, "label"),
			column("net", reportKeys.table.netAmount, "money"),
			column("netChange", storesKeys.table.netChange, "signedPercent"),
			column("invoices", reportKeys.table.invoices, "count"),
			column("avgTicket", reportKeys.table.avgTicket, "money"),
			column("ticketChange", storesKeys.table.ticketChange, "signedPercent"),
			column("itemsPerTicket", reportKeys.table.itemsPerTicket, "ratio"),
			column("avgItemPrice", reportKeys.table.avgItemPrice, "money"),
			column("cashShare", storesKeys.table.cashShare, "percent"),
			column("discountRate", storesKeys.table.discountRate, "percent"),
			column("voucherShare", storesKeys.table.voucherShare, "percent"),
			column("captureRate", reportKeys.table.captureRate, "percent"),
			column("salesPerHour", storesKeys.table.salesPerHour, "money"),
			column("revpash", storesKeys.table.revpash, "money"),
		],
		rows: [
			...[...stores].sort(byNetDescending).map(storeRowOf),
			allStoresRowOf(all),
		],
	});
}

function netChart(stores: readonly StoreKpis[]): ChartModel | null {
	if (stores.every((entry) => netOf(entry) === null)) return null;
	return {
		labelKey: storesKeys.kpis.chart,
		categories: stores.map((entry) => textValue("text", entry.label)),
		series: [
			{
				label: part(reportKeys.periodRow.previous),
				kind: "bar",
				tone: "muted",
				axis: "left",
				stack: null,
				values: stores.map((entry) => entry.previous?.net_amount ?? null),
			},
			{
				label: part(reportKeys.periodRow.current),
				kind: "bar",
				tone: storeTone(0),
				axis: "left",
				stack: null,
				values: stores.map(netOf),
			},
		],
		leftUnit: "money",
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

export function widestGap(
	stores: readonly StoreKpis[],
	pick: (row: RangeTotalsRow) => number | null,
): GapResult | null {
	let high: { entry: StoreKpis; value: number } | null = null;
	let low: { entry: StoreKpis; value: number } | null = null;
	let measured = 0;
	for (const entry of stores) {
		const value = entry.current === undefined ? null : pick(entry.current);
		if (value === null) continue;
		measured += 1;
		if (high === null || value > high.value) high = { entry, value };
		if (low === null || value < low.value) low = { entry, value };
	}
	if (high === null || low === null || measured < 2) return null;
	const gap = relativeChange(high.value, low.value);
	if (gap === null) return null;
	if (high.entry === low.entry || gap < EVEN_GAP) return { kind: "even" };
	return { kind: "gap", high: high.entry, low: low.entry, gap };
}

export function leadingStore(stores: readonly StoreKpis[]): StoreKpis | null {
	let best: StoreKpis | null = null;
	for (const entry of stores) {
		const net = netOf(entry);
		if (net === null) continue;
		if (best === null || net > (netOf(best) ?? 0)) best = entry;
	}
	return best;
}

function storeName(entry: StoreKpis) {
	return textValue("text", entry.label);
}

function gapValues(gap: Extract<GapResult, { kind: "gap" }>) {
	return {
		high: storeName(gap.high),
		low: storeName(gap.low),
		gap: numberValue("percent", gap.gap),
	};
}

export function gapSentences(
	input: ThemeCardInput,
	ticket: GapResult | null,
	items: GapResult | null,
): SentencePart[] {
	const range = rangeValue(input.context);
	if (ticket === null) return [part(storesKeys.kpis.noGap, { range })];
	const parts: SentencePart[] = [
		ticket.kind === "even"
			? part(storesKeys.kpis.mainEven, { range })
			: part(storesKeys.kpis.main, { range, ...gapValues(ticket) }),
	];
	if (items !== null) {
		parts.push(
			items.kind === "even"
				? part(storesKeys.kpis.itemsEven)
				: part(storesKeys.kpis.items, gapValues(items)),
		);
	}
	return parts;
}

function likeForLikeSentence(all: AllStoresKpis): SentencePart | null {
	const change = all.netChange;
	if (change === null || change.basis !== "like_for_like") return null;
	return part(storesKeys.kpis.likeForLike, {
		covered: numberValue("count", change.coveredStores),
		total: numberValue("count", change.totalStores),
	});
}

function setupNotice(stores: readonly StoreKpis[]): NoticeModel | null {
	return stores.some((entry) => lacksSetup(entry.productivity))
		? {
				tone: "info",
				part: part(storesKeys.kpis.notConfiguredNotice),
				action: "settings_store",
			}
		: null;
}

export function buildKpisCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const card = {
		id: "kpis",
		titleKey: storesKeys.kpis.title,
		metricId: "store_net_share",
		relatedMetricIds: KPI_METRIC_IDS,
		unit: "fraction",
	} as const;
	if (!comparesStores(context)) return needTwoCard(input, card);
	const stores = storeKpis(input);
	const all = allStoresKpis(input);
	const total = netOf(all);
	const leader = total === null ? null : leadingStore(stores);
	const share =
		leader === null ? null : ratio(netOf(leader), total, SHARE_DIGITS);
	const likeForLike = likeForLikeSentence(all);
	const narrative =
		total === null || all.current?.days_with_data === 0
			? [part(storesKeys.kpis.noData, { range: rangeValue(context) })]
			: [
					...gapSentences(
						input,
						widestGap(stores, (row) => row.avg_ticket),
						widestGap(stores, (row) => row.items_per_ticket),
					),
					...(likeForLike === null ? [] : [likeForLike]),
				];
	return {
		id: card.id,
		titleKey: card.titleKey,
		subtitle: null,
		metricId: card.metricId,
		relatedMetricIds: card.relatedMetricIds,
		headline: {
			value: share,
			unit: card.unit,
			caption:
				leader === null || share === null
					? null
					: part(storesKeys.kpis.caption, { store: storeName(leader) }),
		},
		comparisons: [],
		decomposition: null,
		narrative,
		tables: [kpiTable(stores, all)],
		chart: netChart(stores),
		notice: setupNotice(stores),
		markers: themeMarkers(input, true),
		csvName: storesCsvName(context, card.id),
	};
}

export const kpisCard: ThemeCardDefinition = {
	id: "kpis",
	needs: storesNeeds.kpis,
	wide: true,
	visible: () => true,
	build: buildKpisCard,
};
