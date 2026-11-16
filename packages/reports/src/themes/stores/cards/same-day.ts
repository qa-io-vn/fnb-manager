import type { IsoDate } from "../../../contract/values.js";
import type { ReportStore } from "../../../definition.js";
import type {
	CardModel,
	ChartModel,
	ColumnKind,
	TableModel,
} from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { sumMoney } from "../../../model/money.js";
import { difference, ratio } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	partValue,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import { hasData } from "../../../reports/year/rules.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import type { RangeSeriesGrain } from "../../range.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { storesKeys } from "../keys.js";
import {
	comparesStores,
	dayRowsOf,
	daysGrain,
	needTwoCard,
	type SeriesRow,
	storeDashed,
	storesCsvName,
	storesNeeds,
	storeTone,
} from "../support.js";

const MEAN_DIGITS = 6;
const INDEX_DIGITS = 4;
export const SAME_DAY_PREVIEW_ROWS = 14;
const ORDINARY_INDEX = 1;

export interface StoreIndex {
	readonly store: ReportStore;
	readonly mean: number | null;
	readonly byBucket: ReadonlyMap<IsoDate, SeriesRow>;
}

export interface BucketGap {
	readonly bucket: IsoDate;
	readonly high: { readonly store: ReportStore; readonly index: number };
	readonly low: { readonly store: ReportStore; readonly index: number };
	readonly gap: number;
}

export function storeIndexOf(
	store: ReportStore,
	rows: readonly SeriesRow[],
): StoreIndex {
	const own = rows.filter((row) => row.store_id === store.id);
	const measured = own.filter((row) => hasData(row) && row.net_amount !== null);
	const days = measured.reduce((total, row) => total + row.days_with_data, 0);
	return {
		store,
		mean: ratio(
			sumMoney(measured.map((row) => row.net_amount)),
			days,
			MEAN_DIGITS,
		),
		byBucket: new Map(own.map((row) => [row.bucket_start, row])),
	};
}

export function bucketIndex(entry: StoreIndex, bucket: IsoDate): number | null {
	const row = entry.byBucket.get(bucket);
	if (!hasData(row) || row.net_amount === null || entry.mean === null) {
		return null;
	}
	return ratio(row.net_amount, row.days_with_data * entry.mean, INDEX_DIGITS);
}

export function bucketsOf(rows: readonly SeriesRow[]): IsoDate[] {
	return [...new Set(rows.map((row) => row.bucket_start))].sort();
}

export function widestBucket(
	entries: readonly StoreIndex[],
	buckets: readonly IsoDate[],
): BucketGap | null {
	let best: BucketGap | null = null;
	for (const bucket of buckets) {
		const indices = entries.flatMap((entry) => {
			const index = bucketIndex(entry, bucket);
			return index === null ? [] : [{ store: entry.store, index }];
		});
		if (indices.length < 2) continue;
		let high = indices[0];
		let low = indices[0];
		for (const candidate of indices) {
			if (high === undefined || candidate.index > high.index) high = candidate;
			if (low === undefined || candidate.index < low.index) low = candidate;
		}
		if (high === undefined || low === undefined) continue;
		const gap = difference(high.index, low.index);
		if (gap === null) continue;
		if (best === null || gap > best.gap) best = { bucket, high, low, gap };
	}
	return best;
}

function bucketValue(bucket: IsoDate, grain: RangeSeriesGrain): TypedValue {
	switch (grain) {
		case "day":
			return partValue(
				part(storesKeys.sameDay.dayBucket, {
					date: textValue("date", bucket),
				}),
			);
		case "week":
			return partValue(
				part(storesKeys.sameDay.weekBucket, {
					date: textValue("date", bucket),
				}),
			);
		case "month":
			return partValue(
				part(storesKeys.sameDay.monthBucket, {
					month: textValue("month", bucket),
				}),
			);
	}
}

function bucketColumn(grain: RangeSeriesGrain): {
	readonly labelKey: string;
	readonly kind: ColumnKind;
} {
	switch (grain) {
		case "day":
			return { labelKey: reportKeys.table.date, kind: "date" };
		case "week":
			return { labelKey: storesKeys.table.weekFrom, kind: "date" };
		case "month":
			return { labelKey: reportKeys.table.month, kind: "month" };
	}
}

function indexTable(
	entries: readonly StoreIndex[],
	buckets: readonly IsoDate[],
	grain: RangeSeriesGrain,
): TableModel {
	const bucket = bucketColumn(grain);
	return tableModel({
		captionKey: storesKeys.sameDay.table,
		columns: [
			column("bucket", bucket.labelKey, bucket.kind),
			column("store", reportKeys.table.store, "text"),
			column("net", reportKeys.table.netAmount, "money"),
			column("index", storesKeys.table.index, "ratio"),
		],
		rows: [...buckets].reverse().flatMap((start) =>
			entries.map((entry) => ({
				id: `${start}-${entry.store.id}`,
				cells: {
					bucket: start,
					store: entry.store.name,
					net: entry.byBucket.get(start)?.net_amount ?? null,
					index: bucketIndex(entry, start),
				},
			})),
		),
		initialSort: { key: "bucket", direction: "descending" },
		previewRows: SAME_DAY_PREVIEW_ROWS,
	});
}

function indexChart(
	entries: readonly StoreIndex[],
	buckets: readonly IsoDate[],
	grain: RangeSeriesGrain,
): ChartModel | null {
	if (buckets.length === 0) return null;
	return {
		labelKey: storesKeys.sameDay.chart,
		categories: buckets.map((bucket) =>
			textValue(grain === "month" ? "month" : "date", bucket),
		),
		series: entries.map((entry, index) => ({
			label: part(storesKeys.storeSeries, {
				store: textValue("text", entry.store.name),
			}),
			kind: "line" as const,
			tone: storeTone(index),
			axis: "left" as const,
			stack: null,
			values: buckets.map((bucket) => bucketIndex(entry, bucket)),
			...(storeDashed(index) ? { dashed: true } : {}),
		})),
		leftUnit: "ratio",
		rightUnit: null,
		markLines: [
			{
				label: part(storesKeys.sameDay.average),
				value: ORDINARY_INDEX,
				axis: "left",
			},
		],
		markAreas: [],
		zeroBased: false,
	};
}

function mainSentence(
	input: ThemeCardInput,
	widest: BucketGap | null,
	hasSales: boolean,
	grain: RangeSeriesGrain,
): SentencePart {
	const range = rangeValue(input.context);
	if (!hasSales) return part(storesKeys.sameDay.noData, { range });
	if (widest === null) return part(storesKeys.sameDay.noOverlap, { range });
	return part(storesKeys.sameDay.main, {
		bucket: bucketValue(widest.bucket, grain),
		high: textValue("text", widest.high.store.name),
		highIndex: numberValue("ratio", widest.high.index),
		low: textValue("text", widest.low.store.name),
		lowIndex: numberValue("ratio", widest.low.index),
	});
}

export function sameDayGrain(input: ThemeCardInput): RangeSeriesGrain {
	return daysGrain(input.context.range.days, input.context.stores.length);
}

export function buildSameDayCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const card = {
		id: "same_day",
		titleKey: storesKeys.sameDay.title,
		metricId: "store_day_gap",
		relatedMetricIds: ["store_day_index", "net_revenue"],
		unit: "ratio",
	} as const;
	if (!comparesStores(context)) return needTwoCard(input, card);
	const rows = dayRowsOf(input.results);
	const grain = sameDayGrain(input);
	const entries = context.stores.map((store) => storeIndexOf(store, rows));
	const storeRows = rows.filter((row) =>
		context.stores.some((store) => store.id === row.store_id),
	);
	const buckets = bucketsOf(storeRows);
	const widest = widestBucket(entries, buckets);
	const hasSales = entries.some((entry) => entry.mean !== null);
	return {
		id: card.id,
		titleKey: card.titleKey,
		subtitle: null,
		metricId: card.metricId,
		relatedMetricIds: card.relatedMetricIds,
		headline: {
			value: widest?.gap ?? null,
			unit: card.unit,
			caption:
				widest === null
					? null
					: part(storesKeys.sameDay.caption, {
							bucket: bucketValue(widest.bucket, grain),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: [mainSentence(input, widest, hasSales, grain)],
		tables: [indexTable(entries, buckets, grain)],
		chart: hasSales ? indexChart(entries, buckets, grain) : null,
		notice: null,
		markers: themeMarkers(input, false),
		csvName: storesCsvName(context, card.id),
	};
}

export const sameDayCard: ThemeCardDefinition = {
	id: "same_day",
	needs: storesNeeds.sameDay,
	visible: () => true,
	build: buildSameDayCard,
};
