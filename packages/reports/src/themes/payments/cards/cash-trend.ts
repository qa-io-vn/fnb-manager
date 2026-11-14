import type { CardModel, ChartModel, Comparison } from "../../../model/card.js";
import { comparison } from "../../../model/comparison.js";
import { reportKeys } from "../../../model/keys.js";
import { sumMoney } from "../../../model/money.js";
import { narrate } from "../../../model/narrative.js";
import { difference, ratio, relativeChange } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	partValue,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import { CASH_SHARE_METRIC } from "../../../reports/month/cards/payment-mix.js";
import { pointsValue } from "../../../reports/month/support.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { paymentsKeys } from "../keys.js";
import {
	type BucketGrain,
	bucketGrain,
	paymentsCsvName,
	paymentsNeeds,
	type SeriesRow,
	seriesRows,
} from "../support.js";

const SHARE_DIGITS = 6;
const TREND_PREVIEW_ROWS = 10;
const DAYS_PER_WEEK = 7;
export const SIGNAL_MIN_CASH_RISE = 0.01;
export const SIGNAL_MIN_NET_DROP = 0.05;
export const SIGNAL_MIN_WEEKS_PER_HALF = 2;

export interface WindowTotals {
	readonly cashShare: number | null;
	readonly netPerDay: number | null;
}

function windowTotals(rows: readonly SeriesRow[]): WindowTotals {
	return {
		cashShare: ratio(
			sumMoney(rows.map((row) => row.cash_amount)),
			sumMoney(rows.map((row) => row.paid_amount)),
			SHARE_DIGITS,
		),
		netPerDay: ratio(
			sumMoney(rows.map((row) => row.net_amount)),
			rows.reduce((total, row) => total + row.calendar_days, 0),
			SHARE_DIGITS,
		),
	};
}

export function signalHalves(
	rows: readonly SeriesRow[],
	grain: BucketGrain,
): readonly [readonly SeriesRow[], readonly SeriesRow[]] | null {
	if (grain === "day") {
		const weeks = Math.floor(rows.length / (2 * DAYS_PER_WEEK));
		if (weeks < SIGNAL_MIN_WEEKS_PER_HALF) return null;
		const size = weeks * DAYS_PER_WEEK;
		return [
			rows.slice(rows.length - 2 * size, rows.length - size),
			rows.slice(rows.length - size),
		];
	}
	const whole = rows.filter((row) => row.calendar_days === DAYS_PER_WEEK);
	const size = Math.floor(whole.length / 2);
	if (size < SIGNAL_MIN_WEEKS_PER_HALF) return null;
	return [whole.slice(0, size), whole.slice(whole.length - size)];
}

export function cashRisesWhileNetFalls(
	rows: readonly SeriesRow[],
	grain: BucketGrain,
): boolean {
	const halves = signalHalves(rows, grain);
	if (halves === null) return false;
	const [before, after] = halves.map(windowTotals) as [
		WindowTotals,
		WindowTotals,
	];
	const cashRise = difference(after.cashShare, before.cashShare);
	const netChange = relativeChange(after.netPerDay, before.netPerDay);
	return (
		cashRise !== null &&
		netChange !== null &&
		cashRise >= SIGNAL_MIN_CASH_RISE &&
		netChange <= -SIGNAL_MIN_NET_DROP
	);
}

function bucketValue(row: SeriesRow, weekly: boolean): TypedValue {
	return partValue(
		part(
			weekly ? paymentsKeys.trend.weekBucket : paymentsKeys.trend.dayBucket,
			{
				date: textValue("date", row.bucket_start),
			},
		),
	);
}

function firstBucketComparison(
	input: ThemeCardInput,
	first: SeriesRow,
	last: SeriesRow,
	weekly: boolean,
): Comparison {
	const stores = input.context.stores.length;
	return comparison({
		kind: "previous",
		label: part(paymentsKeys.trend.firstBucket, {
			bucket: bucketValue(first, weekly),
		}),
		range: { from: first.bucket_start, to: first.bucket_end },
		current: last.cash_share,
		reference: first.cash_share,
		coveredStores: stores,
		totalStores: stores,
		unit: "fraction",
	});
}

function chartOf(rows: readonly SeriesRow[]): ChartModel | null {
	if (rows.length === 0) return null;
	return {
		labelKey: paymentsKeys.trend.chart,
		categories: rows.map((row) => textValue("date", row.bucket_start)),
		series: [
			{
				label: part(paymentsKeys.table.cashAmount),
				kind: "bar",
				tone: "primary",
				axis: "left",
				stack: null,
				values: rows.map((row) => row.cash_amount),
			},
			{
				label: part(paymentsKeys.table.cashShare),
				kind: "line",
				tone: "secondary",
				axis: "right",
				stack: null,
				values: rows.map((row) => row.cash_share),
			},
		],
		leftUnit: "money",
		rightUnit: "fraction",
		markLines: [],
		markAreas: [],
	};
}

export function buildCashTrendCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const rows = seriesRows(input.results);
	const measured = rows.filter((row) => row.cash_share !== null);
	const first = measured[0] ?? null;
	const last = measured.at(-1) ?? null;
	const current = last?.cash_share ?? null;
	const grain = bucketGrain(context.range.days);
	const weekly = grain === "week";
	const storesJoined =
		first !== null &&
		input.coverage.forReference(first.bucket_start).state === "partial";
	const chip =
		first !== null && last !== null && first !== last && !storesJoined
			? firstBucketComparison(input, first, last, weekly)
			: null;
	const values: Record<string, TypedValue> = { range: rangeValue(context) };
	if (current !== null) values.value = numberValue("percent", current);
	if (last !== null) values.bucket = bucketValue(last, weekly);
	if (first !== null) values.first = bucketValue(first, weekly);
	const points = pointsValue(chip);
	if (points !== null) values.points = points;
	const notes: SentencePart[] =
		storesJoined && first !== null
			? [
					part(paymentsKeys.trend.storesJoined, {
						first: bucketValue(first, weekly),
					}),
				]
			: cashRisesWhileNetFalls(rows, grain)
				? [part(paymentsKeys.trend.signal)]
				: [];
	return {
		id: "cash_trend",
		titleKey: paymentsKeys.trend.title,
		subtitle: null,
		metricId: CASH_SHARE_METRIC,
		relatedMetricIds: [],
		headline: { value: current, unit: "fraction", caption: null },
		comparisons: chip === null ? [] : [chip],
		decomposition: null,
		narrative: narrate({
			main: {
				up: paymentsKeys.trend.up,
				down: paymentsKeys.trend.down,
				flat: paymentsKeys.trend.flat,
				noReference: paymentsKeys.trend.noReference,
				noData: paymentsKeys.trend.noData,
			},
			values,
			current,
			comparison: chip,
			notes,
			drivers: [],
			decomposition: null,
		}),
		tables: [
			tableModel({
				captionKey: paymentsKeys.trend.table,
				columns: [
					column(
						"bucket",
						weekly ? paymentsKeys.table.weekFrom : paymentsKeys.table.day,
						"date",
					),
					column("net", reportKeys.table.netAmount, "money"),
					column("cashAmount", paymentsKeys.table.cashAmount, "money"),
					column("cashShare", paymentsKeys.table.cashShare, "percent"),
				],
				rows: rows.map((row) => ({
					id: row.bucket_start,
					cells: {
						bucket: row.bucket_start,
						net: row.net_amount,
						cashAmount: row.cash_amount,
						cashShare: row.cash_share,
					},
				})),
				initialSort: { key: "bucket", direction: "descending" },
				previewRows: TREND_PREVIEW_ROWS,
			}),
		],
		chart: chartOf(rows),
		notice: null,
		markers: themeMarkers(input, true),
		csvName: paymentsCsvName(context, "cash_trend"),
	};
}

export const cashTrendCard: ThemeCardDefinition = {
	id: "cash_trend",
	needs: paymentsNeeds.trend,
	visible: () => true,
	build: buildCashTrendCard,
};
