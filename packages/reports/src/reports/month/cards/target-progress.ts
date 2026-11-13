import type { CardDefinition, CardInput } from "../../../definition.js";
import type {
	CardModel,
	ChartModel,
	Comparison,
	NoticeModel,
	TableColumnModel,
	TableModel,
} from "../../../model/card.js";
import { comparison } from "../../../model/comparison.js";
import { reportKeys } from "../../../model/keys.js";
import {
	exactDifference,
	ratio,
	relativeChange,
} from "../../../model/numeric.js";
import { column, STORE_COLUMN, tableModel } from "../../../model/tables.js";
import {
	messageValue,
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import {
	type ForecastMethod,
	forecastLabel,
	forecastLabelKeys,
	forecastOf,
	forecastOrder,
	forecastTargetKeys,
	leadingForecast,
} from "../forecasts.js";
import { monthKeys } from "../keys.js";
import {
	accuracyRows,
	monthCsvName,
	monthMarkers,
	monthNeeds,
	monthRanges,
	monthValue,
	type PaceRow,
	paceRow,
	storePaceRow,
} from "../support.js";
import { type MonthTargets, monthTargets } from "../targets.js";

const SHARE_DIGITS = 6;
const MONEY_DIGITS = 2;
const PROGRESS_FORECAST: ForecastMethod = "forecast_weekday_profile";

function targetComparisons(
	input: CardInput,
	order: readonly ForecastMethod[],
	target: number,
): readonly Comparison[] {
	const ranges = monthRanges(input.context);
	const pace = paceRow(input);
	const storeCount = input.context.stores.length;
	return order.map((method) => {
		const value = forecastOf(pace, method);
		return comparison({
			kind: "target",
			label: part(forecastTargetKeys[method]),
			range: { from: ranges.monthStart, to: ranges.monthEnd },
			current: value,
			reference: target,
			coveredStores: storeCount,
			totalStores: storeCount,
			unavailable: value === null ? "building_baseline" : null,
			unit: "money",
		});
	});
}

function storeTable(
	input: CardInput,
	targets: MonthTargets,
	open: boolean,
): TableModel {
	const { context } = input;
	const columns: TableColumnModel[] = [
		STORE_COLUMN,
		column("target", monthKeys.table.target, "money"),
		column("monthToDate", monthKeys.table.monthToDate, "money"),
		column("progress", monthKeys.table.progress, "percent"),
		...(open
			? [
					column("forecast", monthKeys.table.forecast, "money"),
					column("vsTarget", monthKeys.table.vsTarget, "signedPercent"),
				]
			: []),
		...(targets.missing.length > 0
			? [column("state", reportKeys.table.state, "message")]
			: []),
	];
	return tableModel({
		captionKey: monthKeys.target.table,
		columns,
		rows: context.stores.map((store) => {
			const pace: PaceRow | null = storePaceRow(input, store.id);
			const target = targets.byStore.get(store.id) ?? null;
			const monthToDate = pace?.month_to_date_net_amount ?? null;
			const forecast = forecastOf(pace, PROGRESS_FORECAST);
			return {
				id: store.id,
				cells: {
					store: store.name,
					target,
					monthToDate,
					progress: ratio(monthToDate, target, SHARE_DIGITS),
					forecast,
					vsTarget: relativeChange(forecast, target),
					state: target === null ? monthKeys.target.storeMissing : null,
				},
			};
		}),
	});
}

function progressChart(
	input: CardInput,
	target: number,
	open: boolean,
): ChartModel {
	const pace = paceRow(input);
	const leading = open ? leadingForecast(accuracyRows(input), pace) : null;
	return {
		labelKey: monthKeys.target.chart,
		categories: [monthValue(input.context)],
		series: [
			{
				label: part(monthKeys.target.monthToDate),
				kind: "bar",
				tone: "primary",
				axis: "left",
				stack: null,
				values: [pace?.month_to_date_net_amount ?? null],
			},
			{
				label: part(monthKeys.target.target),
				kind: "bar",
				tone: "muted",
				axis: "left",
				stack: null,
				values: [target],
			},
		],
		leftUnit: "money",
		rightUnit: null,
		markLines:
			leading === null
				? []
				: [
						{
							label: forecastLabel(leading.method),
							value: leading.value,
							axis: "left",
						},
					],
		markAreas: [],
	};
}

function narrativeOf(
	input: CardInput,
	targets: MonthTargets,
	progress: number | null,
	comparisons: readonly Comparison[],
	order: readonly ForecastMethod[],
	open: boolean,
): SentencePart[] {
	const month = monthValue(input.context);
	const pace = paceRow(input);
	const target = targets.total;
	if (target === null || progress === null || pace === null) {
		return [part(monthKeys.target.notSet, { month })];
	}
	const values: Record<string, TypedValue> = {
		month,
		progress: numberValue("percent", progress),
		value: numberValue("money", pace.month_to_date_net_amount),
		target: numberValue("money", target),
	};
	if (!open) return [part(monthKeys.target.final, values)];
	const remaining = exactDifference(target, pace.month_to_date_net_amount);
	const main =
		remaining <= 0 || pace.remaining_days === 0
			? part(monthKeys.target.reached, values)
			: part(monthKeys.target.main, {
					...values,
					needed: numberValue(
						"money",
						ratio(remaining, pace.remaining_days, MONEY_DIGITS) ?? 0,
					),
					days: numberValue("count", pace.remaining_days),
				});
	const leading = leadingForecast(accuracyRows(input), pace);
	const versus =
		leading === null ? undefined : comparisons[order.indexOf(leading.method)];
	if (leading === null || versus === undefined || versus.change === null) {
		return [main];
	}
	return [
		main,
		part(monthKeys.target.forecastClause, {
			method: messageValue(forecastLabelKeys[leading.method]),
			value: numberValue("money", leading.value),
			delta: numberValue("signedPercent", versus.change),
		}),
	];
}

export function buildTargetProgressCard(input: CardInput): CardModel {
	const { context } = input;
	const targets = monthTargets(input);
	const pace = paceRow(input);
	const open = !context.period.complete;
	const order = forecastOrder(accuracyRows(input));
	const target = targets.total;
	const progress =
		target === null || pace === null
			? null
			: ratio(pace.month_to_date_net_amount, target, SHARE_DIGITS);
	const comparisons =
		target === null || !open ? [] : targetComparisons(input, order, target);
	const notice: NoticeModel | null =
		targets.missing.length === 0
			? null
			: {
					tone: "warning",
					part: part(monthKeys.target.missing, {
						stores: textValue(
							"text",
							targets.missing.map((store) => store.name).join(", "),
						),
					}),
					action: "settings_targets",
				};
	return {
		id: "target_progress",
		titleKey: monthKeys.target.title,
		subtitle: null,
		metricId: "target_progress",
		relatedMetricIds: ["net_revenue", "forecast_weekday_profile"],
		headline: {
			value: progress,
			unit: "fraction",
			caption:
				target === null
					? null
					: part(monthKeys.target.caption, {
							target: numberValue("money", target),
						}),
		},
		comparisons,
		decomposition: null,
		narrative: narrativeOf(input, targets, progress, comparisons, order, open),
		tables: [storeTable(input, targets, open)],
		chart: target === null ? null : progressChart(input, target, open),
		notice,
		markers: monthMarkers(input, false),
		csvName: monthCsvName(context, "target_progress"),
	};
}

export const targetProgressCard: CardDefinition = {
	id: "target_progress",
	needs: monthNeeds.target,
	visible: () => true,
	build: buildTargetProgressCard,
};
