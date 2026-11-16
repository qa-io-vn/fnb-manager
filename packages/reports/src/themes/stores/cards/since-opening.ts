import {
	type CardModel,
	type ChartModel,
	MAX_NARRATIVE_PARTS,
	type TableColumnModel,
	type TableModel,
} from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { ratio } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	type SentencePart,
	textValue,
} from "../../../model/values.js";
import { addDays } from "../../../period/dates.js";
import {
	SINCE_OPENING_BLOCK_DAYS,
	type SinceBlock,
	sinceOpeningBlocks,
} from "../../../reports/year/rules.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { themeMarkers } from "../../support.js";
import { storesKeys } from "../keys.js";
import {
	comparesStores,
	needTwoCard,
	type SeriesRow,
	type SincePlan,
	type SinceStore,
	sincePlan,
	sinceRowsOf,
	storeDashed,
	storesCsvName,
	storesNeeds,
	storeTone,
} from "../support.js";

const SHARE_DIGITS = 6;
export const SINCE_PREVIEW_ROWS = 14;

export interface SinceWeek extends SinceBlock {
	readonly tet: boolean;
}

export interface SinceEntry extends SinceStore {
	readonly blocks: readonly SinceWeek[];
}

export interface ComparedWeek {
	readonly week: number;
	readonly other: SinceEntry;
	readonly skippedTet: boolean;
}

function isTetDay(row: SeriesRow): boolean {
	return row.holiday_kind === "tet" || row.tet_days > 0;
}

function withTet(block: SinceBlock, rows: readonly SeriesRow[]): SinceWeek {
	return {
		...block,
		tet: rows.some(
			(row) =>
				row.bucket_start >= block.from &&
				row.bucket_start <= block.to &&
				isTetDay(row),
		),
	};
}

export function sinceEntries(
	input: ThemeCardInput,
	plan: SincePlan,
): SinceEntry[] {
	return plan.stores.map((entry) => {
		if (
			plan.weeks === 0 ||
			entry.completeWeeks === 0 ||
			entry.historyStart === null
		) {
			return { ...entry, blocks: [] };
		}
		const end = addDays(
			entry.historyStart,
			SINCE_OPENING_BLOCK_DAYS * plan.weeks - 1,
		);
		const rows = sinceRowsOf(input.results, entry.store.id);
		return {
			...entry,
			blocks: sinceOpeningBlocks(rows, entry.historyStart, end)
				.filter((block) => block.complete)
				.slice(0, plan.weeks)
				.map((block) => withTet(block, rows)),
		};
	});
}

function weekOf(entry: SinceEntry, week: number): SinceWeek | undefined {
	return entry.blocks[week - 1];
}

function avgOf(entry: SinceEntry, week: number): number | null {
	return weekOf(entry, week)?.avgPerDay ?? null;
}

function comparable(entry: SinceEntry, week: number): boolean {
	const block = weekOf(entry, week);
	return block !== undefined && block.avgPerDay !== null && !block.tet;
}

export function referenceEntry(
	entries: readonly SinceEntry[],
	youngest: SinceEntry,
	week: number,
): SinceEntry | null {
	let best: SinceEntry | null = null;
	for (const entry of entries) {
		if (entry.store.id === youngest.store.id) continue;
		if (entry.historyStart === null || !comparable(entry, week)) continue;
		if (
			best === null ||
			(best.historyStart !== null && entry.historyStart < best.historyStart)
		) {
			best = entry;
		}
	}
	return best;
}

export function comparedWeek(
	entries: readonly SinceEntry[],
	youngest: SinceEntry,
	weeks: number,
): ComparedWeek | null {
	let skippedTet = false;
	for (let week = weeks; week >= 1; week -= 1) {
		const other = comparable(youngest, week)
			? referenceEntry(entries, youngest, week)
			: null;
		if (other !== null) return { week, other, skippedTet };
		if (entries.some((entry) => weekOf(entry, week)?.tet === true)) {
			skippedTet = true;
		}
	}
	return null;
}

function sinceTable(entries: readonly SinceEntry[], weeks: number): TableModel {
	const anyTet = entries.some((entry) =>
		entry.blocks.some((block) => block.tet),
	);
	const columns: TableColumnModel[] = [
		column("week", storesKeys.table.week, "count"),
		column("store", reportKeys.table.store, "text"),
		column("from", reportKeys.table.from, "date"),
		column("to", reportKeys.table.to, "date"),
		column("daysWithData", storesKeys.table.daysWithData, "count"),
		column("net", reportKeys.table.netAmount, "money"),
		column("avgPerDay", storesKeys.table.avgPerDay, "money"),
		...(anyTet ? [column("tet", storesKeys.table.tet, "message")] : []),
	];
	return tableModel({
		captionKey: storesKeys.sinceOpening.table,
		columns,
		rows: Array.from({ length: weeks }, (_, offset) => offset + 1).flatMap(
			(week) =>
				entries.map((entry) => {
					const block = weekOf(entry, week);
					return {
						id: `${week}-${entry.store.id}`,
						cells: {
							week,
							store: entry.store.name,
							from: block?.from ?? null,
							to: block?.to ?? null,
							daysWithData: block?.daysWithData ?? null,
							net: block?.net ?? null,
							avgPerDay: block?.avgPerDay ?? null,
							...(anyTet
								? {
										tet:
											block?.tet === true
												? storesKeys.sinceOpening.tetWeek
												: null,
									}
								: {}),
						},
					};
				}),
		),
		initialSort: { key: "week", direction: "descending" },
		previewRows: SINCE_PREVIEW_ROWS,
	});
}

function sinceChart(
	entries: readonly SinceEntry[],
	weeks: number,
): ChartModel | null {
	const measured = entries.filter((entry) => entry.blocks.length > 0);
	if (weeks === 0 || measured.length === 0) return null;
	return {
		labelKey: storesKeys.sinceOpening.chart,
		categories: Array.from({ length: weeks }, (_, offset) =>
			numberValue("count", offset + 1),
		),
		series: measured.map((entry) => {
			const index = entries.indexOf(entry);
			return {
				label: part(storesKeys.storeSeries, {
					store: textValue("text", entry.store.name),
				}),
				kind: "line" as const,
				tone: storeTone(index),
				axis: "left" as const,
				stack: null,
				values: Array.from({ length: weeks }, (_, offset) =>
					avgOf(entry, offset + 1),
				),
				...(storeDashed(index) ? { dashed: true } : {}),
			};
		}),
		leftUnit: "money",
		rightUnit: null,
		markLines: [],
		markAreas: [],
		zeroBased: false,
	};
}

function mainSentences(
	entries: readonly SinceEntry[],
	youngest: SinceEntry | null,
	weeks: number,
): SentencePart[] {
	if (youngest === null || weeks === 0) {
		return [part(storesKeys.sinceOpening.noData)];
	}
	const store = textValue("text", youngest.store.name);
	const compared = comparedWeek(entries, youngest, weeks);
	const share =
		compared === null
			? null
			: ratio(
					avgOf(youngest, compared.week),
					avgOf(compared.other, compared.week),
					SHARE_DIGITS,
				);
	if (compared !== null && share !== null) {
		const main = part(storesKeys.sinceOpening.main, {
			week: numberValue("count", compared.week),
			store,
			share: numberValue("percent", share),
			other: textValue("text", compared.other.store.name),
		});
		return compared.skippedTet
			? [
					main,
					part(storesKeys.sinceOpening.tetSkipped, {
						week: numberValue("count", compared.week),
					}),
				]
			: [main];
	}
	const value = avgOf(youngest, weeks);
	if (value === null) return [part(storesKeys.sinceOpening.noData)];
	return [
		part(storesKeys.sinceOpening.single, {
			week: numberValue("count", weeks),
			store,
			value: numberValue("money", value),
		}),
	];
}

export function tooYoungNote(
	entries: readonly SinceEntry[],
): SentencePart | null {
	const young = entries.filter(
		(entry) => entry.completeWeeks === 0 && entry.historyStart !== null,
	);
	const [only] = young;
	if (only === undefined) return null;
	if (young.length === 1 && only.historyStart !== null) {
		return part(storesKeys.sinceOpening.tooYoung, {
			store: textValue("text", only.store.name),
			date: textValue("date", only.historyStart),
		});
	}
	return part(storesKeys.sinceOpening.tooYoungMany, {
		stores: textValue(
			"text",
			young.map((entry) => entry.store.name).join(", "),
		),
	});
}

export function buildSinceOpeningCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const card = {
		id: "since_opening",
		titleKey: storesKeys.sinceOpening.title,
		metricId: "since_opening_net",
		relatedMetricIds: ["net_revenue"],
		unit: "money",
	} as const;
	if (!comparesStores(context)) return needTwoCard(input, card);
	const plan = sincePlan(context, input.coverage);
	const entries = sinceEntries(input, plan);
	const youngest =
		plan.youngest === null
			? null
			: (entries.find((entry) => entry.store.id === plan.youngest?.store.id) ??
				null);
	const latest = youngest === null ? null : avgOf(youngest, plan.weeks);
	const note = tooYoungNote(entries);
	return {
		id: card.id,
		titleKey: card.titleKey,
		subtitle:
			plan.weeks === 0
				? null
				: part(storesKeys.sinceOpening.subtitle, {
						weeks: numberValue("count", plan.weeks),
					}),
		metricId: card.metricId,
		relatedMetricIds: card.relatedMetricIds,
		headline: {
			value: latest,
			unit: card.unit,
			caption:
				youngest === null || latest === null
					? null
					: part(storesKeys.sinceOpening.caption, {
							week: numberValue("count", plan.weeks),
							store: textValue("text", youngest.store.name),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: [
			...mainSentences(entries, youngest, plan.weeks),
			...(note === null ? [] : [note]),
		].slice(0, MAX_NARRATIVE_PARTS),
		tables: [sinceTable(entries, plan.weeks)],
		chart: sinceChart(entries, plan.weeks),
		notice: null,
		markers: themeMarkers(input, false),
		csvName: storesCsvName(context, card.id),
	};
}

export const sinceOpeningCard: ThemeCardDefinition = {
	id: "since_opening",
	needs: storesNeeds.sinceOpening,
	visible: () => true,
	build: buildSinceOpeningCard,
};
