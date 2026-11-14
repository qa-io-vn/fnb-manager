import type { ReportStore } from "../../../definition.js";
import type { CardModel, ChartModel, TableModel } from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { difference, ratio } from "../../../model/numeric.js";
import { column, storeComparisonTable } from "../../../model/tables.js";
import {
	isMultiStore,
	pickFrom,
	storeTotals,
	totalsOf,
} from "../../../model/totals.js";
import {
	numberValue,
	part,
	type SentencePart,
	textValue,
} from "../../../model/values.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { revenueKeys } from "../keys.js";
import { revenueCsvName, revenueNeeds } from "../support.js";
import { periodRows } from "./totals.js";

const SHARE_DIGITS = 6;

export interface StoreShare {
	readonly store: ReportStore;
	readonly net: number | null;
	readonly share: number | null;
	readonly previousShare: number | null;
	readonly change: number | null;
}

export function storeShares(input: ThemeCardInput): StoreShare[] {
	const rows = periodRows(input);
	const total = pickFrom(
		totalsOf(rows, null, "current"),
		(row) => row.net_amount,
	);
	const previousTotal = pickFrom(
		totalsOf(rows, null, "previous"),
		(row) => row.net_amount,
	);
	return storeTotals(input.context, rows).map(
		({ store, current, previous }) => {
			const net = pickFrom(current, (row) => row.net_amount);
			const before = pickFrom(previous, (row) => row.net_amount);
			const share =
				total === null ? null : ratio(net ?? 0, total, SHARE_DIGITS);
			const previousShare =
				previousTotal === null
					? null
					: ratio(before ?? 0, previousTotal, SHARE_DIGITS);
			return {
				store,
				net,
				share,
				previousShare,
				change: difference(share, previousShare),
			};
		},
	);
}

function largest(shares: readonly StoreShare[]): StoreShare | null {
	let best: StoreShare | null = null;
	for (const entry of shares) {
		if (entry.share === null) continue;
		if (best === null || entry.share > (best.share ?? 0)) best = entry;
	}
	return best;
}

function shareTable(shares: readonly StoreShare[]): TableModel {
	return storeComparisonTable({
		captionKey: revenueKeys.storeShare.table,
		stores: shares.map((entry) => entry.store),
		columns: [
			column("net", reportKeys.table.netAmount, "money"),
			column("share", revenueKeys.table.share, "percent"),
			column("previousShare", revenueKeys.table.previousShare, "percent"),
			column("change", revenueKeys.table.changePoints, "percentPoints"),
		],
		cells: (store) => {
			const entry = shares.find((candidate) => candidate.store.id === store.id);
			return {
				net: entry?.net ?? null,
				share: entry?.share ?? null,
				previousShare: entry?.previousShare ?? null,
				change: entry?.change ?? null,
			};
		},
		initialSort: { key: "share", direction: "descending" },
	});
}

function shareChart(shares: readonly StoreShare[]): ChartModel {
	return {
		labelKey: revenueKeys.storeShare.chart,
		categories: [
			{ kind: "message", value: revenueKeys.storeShare.previous },
			{ kind: "message", value: revenueKeys.storeShare.current },
		],
		series: shares.map((entry, index) => ({
			label: part(revenueKeys.storeShare.storeSeries, {
				store: textValue("text", entry.store.name),
			}),
			kind: "bar" as const,
			tone:
				index === 0
					? ("primary" as const)
					: index === 1
						? ("secondary" as const)
						: index === 2
							? ("tertiary" as const)
							: ("muted" as const),
			axis: "left" as const,
			stack: "share",
			values: [entry.previousShare, entry.share],
		})),
		leftUnit: "fraction",
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

function mainClause(
	input: ThemeCardInput,
	top: StoreShare | null,
): SentencePart {
	const range = rangeValue(input.context);
	if (top === null || top.share === null) {
		return part(revenueKeys.storeShare.noData, { range });
	}
	return part(revenueKeys.storeShare.main, {
		range,
		store: textValue("text", top.store.name),
		share: numberValue("percent", top.share),
		delta: numberValue("percentPoints", top.change ?? 0),
	});
}

export function buildStoreShareCard(input: ThemeCardInput): CardModel {
	const shares = storeShares(input);
	const top = largest(shares);
	return {
		id: "store_share",
		titleKey: revenueKeys.storeShare.title,
		subtitle: null,
		metricId: "store_net_share",
		relatedMetricIds: ["net_revenue"],
		headline: {
			value: top?.share ?? null,
			unit: "fraction",
			caption:
				top === null
					? null
					: part(revenueKeys.storeShare.caption, {
							store: textValue("text", top.store.name),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: [mainClause(input, top)],
		tables: [shareTable(shares)],
		chart: top === null ? null : shareChart(shares),
		notice: null,
		markers: themeMarkers(input, false),
		csvName: revenueCsvName(input.context, "store_share"),
	};
}

export const revenueStoreShareCard: ThemeCardDefinition = {
	id: "store_share",
	needs: revenueNeeds.stores,
	visible: ({ context }) => isMultiStore(context),
	build: buildStoreShareCard,
};
