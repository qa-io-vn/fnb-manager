import type { CardDefinition, CardInput } from "../../../definition.js";
import type {
	CardModel,
	Comparison,
	NoticeModel,
} from "../../../model/card.js";
import {
	comparisonsFromMetricRows,
	withUnit,
} from "../../../model/comparison.js";
import { reportKeys } from "../../../model/keys.js";
import { narrate } from "../../../model/narrative.js";
import { difference } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	messageValue,
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
} from "../../../model/values.js";
import { monthKeys } from "../keys.js";
import {
	comparisonOf,
	likeForLikeMetrics,
	metricRows,
	metricValueOf,
	monthCsvName,
	monthMarkers,
	monthNeeds,
	monthValue,
	pointsValue,
} from "../support.js";

export const TOPPING_METRIC = "attach_rate_topping";
export const SNACK_METRIC = "attach_rate_snack";

interface RateSpec {
	readonly id: "topping" | "snack";
	readonly metricId: string;
	readonly labelKey: string;
	readonly previousKey: string;
	readonly lastYearKey: string;
}

const RATES: readonly RateSpec[] = [
	{
		id: "topping",
		metricId: TOPPING_METRIC,
		labelKey: monthKeys.attach.topping,
		previousKey: monthKeys.attach.toppingPrevious,
		lastYearKey: monthKeys.attach.toppingLastYear,
	},
	{
		id: "snack",
		metricId: SNACK_METRIC,
		labelKey: monthKeys.attach.snack,
		previousKey: monthKeys.attach.snackPrevious,
		lastYearKey: monthKeys.attach.snackLastYear,
	},
];

interface RateValues {
	readonly spec: RateSpec;
	readonly current: number | null;
	readonly previous: number | null;
	readonly lastYear: number | null;
	readonly comparisons: readonly Comparison[];
}

function rateValues(input: CardInput, spec: RateSpec): RateValues {
	const metrics = metricRows(input);
	const comparisons = withUnit(
		comparisonsFromMetricRows({
			all: metrics,
			likeForLike: likeForLikeMetrics(input),
			coverage: input.coverage,
			metricId: spec.metricId,
			kinds: ["previous", "last_year"],
			labels: {
				previous: part(spec.previousKey),
				last_year: part(spec.lastYearKey),
			},
		}),
		"fraction",
	);
	return {
		spec,
		current: metricValueOf(metrics, spec.metricId, "current"),
		previous: metricValueOf(metrics, spec.metricId, "previous"),
		lastYear: metricValueOf(metrics, spec.metricId, "last_year"),
		comparisons,
	};
}

function moverClause(rates: readonly RateValues[]): SentencePart | null {
	let mover: { rate: RateValues; change: number } | null = null;
	for (const rate of rates) {
		const previous = comparisonOf(rate.comparisons, "previous");
		const change =
			previous === null || previous.unavailable !== null
				? null
				: previous.difference;
		if (change === null) continue;
		if (mover === null || Math.abs(change) > Math.abs(mover.change)) {
			mover = { rate, change };
		}
	}
	if (mover === null || mover.change === 0) return null;
	if (mover.rate.spec.metricId === TOPPING_METRIC) return null;
	return part(monthKeys.attach.mover, {
		rate: messageValue(mover.rate.spec.labelKey),
		delta: numberValue("percentPoints", mover.change),
	});
}

function noticeOf(topping: RateValues, snack: RateValues): NoticeModel | null {
	if (topping.current !== null) return null;
	return {
		tone: "info",
		part: part(
			snack.current === null
				? monthKeys.attach.notConfigured
				: monthKeys.attach.toppingNotConfigured,
		),
		action: "settings_roles",
	};
}

export function buildAttachRateCard(input: CardInput): CardModel {
	const { context } = input;
	const rates = RATES.map((spec) => rateValues(input, spec));
	const [topping, snack] = rates as [RateValues, RateValues];
	const values: Record<string, TypedValue> = { month: monthValue(context) };
	if (topping.current !== null) {
		values.value = numberValue("percent", topping.current);
	}
	const points = pointsValue(comparisonOf(topping.comparisons, "previous"));
	if (points !== null) values.points = points;
	if (snack.current !== null) {
		values.snack = numberValue("percent", snack.current);
	}
	const parts = narrate({
		main: {
			up: monthKeys.attach.up,
			down: monthKeys.attach.down,
			flat: monthKeys.attach.flat,
			noReference: monthKeys.attach.noReference,
			noData: monthKeys.attach.noData,
		},
		values,
		current: topping.current,
		comparison: comparisonOf(topping.comparisons, "previous"),
		notes: [],
		drivers: [],
		decomposition: null,
	});
	const mover = topping.current === null ? null : moverClause(rates);
	const measured = rates.filter((rate) => rate.current !== null);
	return {
		id: "attach_rate",
		titleKey: monthKeys.attach.title,
		subtitle: null,
		metricId: TOPPING_METRIC,
		relatedMetricIds: [SNACK_METRIC],
		headline: {
			value: topping.current,
			unit: "fraction",
			caption:
				snack.current === null
					? null
					: part(monthKeys.attach.caption, {
							value: numberValue("percent", snack.current),
						}),
		},
		comparisons: rates.flatMap((rate) => rate.comparisons),
		decomposition: null,
		narrative: mover === null ? parts : [...parts, mover].slice(0, 3),
		tables: [
			tableModel({
				captionKey: monthKeys.attach.table,
				columns: [
					column("metric", monthKeys.table.metric, "message"),
					column("current", monthKeys.table.thisMonth, "percent"),
					column("previous", monthKeys.table.previousMonth, "percent"),
					column("change", monthKeys.table.changePoints, "percentPoints"),
					column("lastYear", monthKeys.table.lastYearMonth, "percent"),
				],
				rows: rates.map((rate) => ({
					id: rate.spec.id,
					cells: {
						metric: rate.spec.labelKey,
						current: rate.current,
						previous: rate.previous,
						change: difference(rate.current, rate.previous),
						lastYear: rate.lastYear,
					},
				})),
			}),
		],
		chart:
			measured.length === 0
				? null
				: {
						labelKey: monthKeys.attach.chart,
						categories: rates.map((rate) => messageValue(rate.spec.labelKey)),
						series: [
							{
								label: part(reportKeys.periodRow.current),
								kind: "bar",
								tone: "primary",
								axis: "left",
								stack: null,
								values: rates.map((rate) => rate.current),
							},
							{
								label: part(reportKeys.periodRow.previous),
								kind: "bar",
								tone: "secondary",
								axis: "left",
								stack: null,
								values: rates.map((rate) => rate.previous),
							},
							{
								label: part(reportKeys.periodRow.lastYear),
								kind: "bar",
								tone: "muted",
								axis: "left",
								stack: null,
								values: rates.map((rate) => rate.lastYear),
							},
						],
						leftUnit: "fraction",
						rightUnit: null,
						markLines: [],
						markAreas: [],
					},
		notice: noticeOf(topping, snack),
		markers: monthMarkers(input, true),
		csvName: monthCsvName(context, "attach_rate"),
	};
}

export const attachRateCard: CardDefinition = {
	id: "attach_rate",
	needs: monthNeeds.attach,
	visible: () => true,
	build: buildAttachRateCard,
};
