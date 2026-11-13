import type { CardDefinition, CardInput } from "../../../definition.js";
import type {
	CardModel,
	ChartModel,
	TableColumnModel,
	TableModel,
} from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { relativeChange } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	type SentencePart,
	textValue,
} from "../../../model/values.js";
import { yearKeys } from "../keys.js";
import { type SinceBlock, sinceOpeningBlocks } from "../rules.js";
import {
	boundsOf,
	type SinceOpeningStore,
	sinceOpeningStores,
	sinceRows,
	yearCsvName,
	yearMarkers,
	yearNeeds,
} from "../support.js";

export interface StoreBlocks extends SinceOpeningStore {
	readonly blocks: readonly SinceBlock[];
}

export function storeBlocks(input: CardInput): StoreBlocks[] {
	const { yearEnd } = boundsOf(input.context);
	return sinceOpeningStores(input.context, input.coverage).map((entry) => ({
		...entry,
		blocks: sinceOpeningBlocks(
			sinceRows(input, entry.store.id),
			entry.historyStart,
			yearEnd,
		).filter((block) => block.complete),
	}));
}

function changeFromFirst(
	blocks: readonly SinceBlock[],
	block: SinceBlock,
): number | null {
	return relativeChange(block.avgPerDay, blocks[0]?.avgPerDay ?? null);
}

function mainSentence(first: StoreBlocks): SentencePart {
	const store = textValue("text", first.store.name);
	const latest = first.blocks.at(-1);
	if (latest === undefined) {
		return part(yearKeys.since.tooEarly, {
			store,
			date: textValue("date", first.historyStart),
		});
	}
	const value = numberValue("money", latest.avgPerDay ?? 0);
	if (latest.week === 1) {
		return part(yearKeys.since.firstWeek, { store, value });
	}
	const change = changeFromFirst(first.blocks, latest);
	if (change === null) {
		return part(yearKeys.since.latest, {
			store,
			week: numberValue("count", latest.week),
			value,
		});
	}
	return part(yearKeys.since.main, {
		store,
		week: numberValue("count", latest.week),
		value,
		delta: numberValue("signedPercent", change),
	});
}

function sinceTable(entries: readonly StoreBlocks[]): TableModel {
	const withStore = entries.length > 1;
	const columns: TableColumnModel[] = [
		...(withStore ? [column("store", reportKeys.table.store, "text")] : []),
		column("week", yearKeys.table.week, "count"),
		column("from", reportKeys.table.from, "date"),
		column("to", reportKeys.table.to, "date"),
		column("daysWithData", yearKeys.table.daysWithData, "count"),
		column("net", reportKeys.table.netAmount, "money"),
		column("avgPerDay", yearKeys.table.avgDailyNet, "money"),
		column("change", yearKeys.table.changeFirstWeek, "signedPercent"),
	];
	return tableModel({
		captionKey: yearKeys.since.table,
		columns,
		rows: entries.flatMap((entry) =>
			entry.blocks.map((block) => ({
				id: `${entry.store.id}-${block.week}`,
				cells: {
					store: entry.store.name,
					week: block.week,
					from: block.from,
					to: block.to,
					daysWithData: block.daysWithData,
					net: block.net,
					avgPerDay: block.avgPerDay,
					change:
						block.week === 1 ? null : changeFromFirst(entry.blocks, block),
				},
			})),
		),
	});
}

function sinceChart(entries: readonly StoreBlocks[]): ChartModel | null {
	const weeks = Math.max(0, ...entries.map((entry) => entry.blocks.length));
	if (weeks === 0) return null;
	return {
		labelKey: yearKeys.since.chart,
		categories: Array.from({ length: weeks }, (_, offset) =>
			numberValue("count", offset + 1),
		),
		series: entries.map((entry, index) => ({
			label: part(yearKeys.since.series, {
				store: textValue("text", entry.store.name),
			}),
			kind: "line" as const,
			tone: index === 0 ? ("primary" as const) : ("secondary" as const),
			axis: "left" as const,
			stack: null,
			values: Array.from(
				{ length: weeks },
				(_, offset) => entry.blocks[offset]?.avgPerDay ?? null,
			),
		})),
		leftUnit: "money",
		rightUnit: null,
		markLines: [],
		markAreas: [],
		zeroBased: false,
	};
}

export function buildSinceOpeningCard(input: CardInput): CardModel {
	const { context } = input;
	const entries = storeBlocks(input);
	const first = entries[0] ?? null;
	const latest = first?.blocks.at(-1) ?? null;
	return {
		id: "since_opening",
		titleKey: yearKeys.since.title,
		subtitle: null,
		metricId: "since_opening_net",
		relatedMetricIds: [],
		headline: {
			value: latest?.avgPerDay ?? null,
			unit: "money",
			caption:
				latest === null
					? null
					: part(yearKeys.since.caption, {
							week: numberValue("count", latest.week),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: first === null ? [] : [mainSentence(first)],
		tables: [sinceTable(entries)],
		chart: sinceChart(entries),
		notice:
			entries.length === 0
				? null
				: {
						tone: "info",
						part: part(yearKeys.since.notice, {
							store: textValue(
								"text",
								entries.map((entry) => entry.store.name).join(", "),
							),
						}),
						action: null,
					},
		markers: yearMarkers(input, false),
		csvName: yearCsvName(context, "since_opening"),
	};
}

export const sinceOpeningCard: CardDefinition = {
	id: "since_opening",
	needs: yearNeeds.since,
	visible: ({ context, coverage }) =>
		sinceOpeningStores(context, coverage).length > 0,
	build: buildSinceOpeningCard,
};
