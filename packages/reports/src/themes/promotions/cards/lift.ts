import type {
	CardModel,
	ChartModel,
	ChartSeriesModel,
	NoticeModel,
	TableModel,
} from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	partValue,
	type SentencePart,
	textValue,
} from "../../../model/values.js";
import type { PromotionComparator } from "../../contract.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { themeKeys } from "../../keys.js";
import { DEFAULT_REPORT_SETTINGS } from "../../settings.js";
import { themeMarkers } from "../../support.js";
import { isLiftFlag, type LiftFlag, promotionsKeys } from "../keys.js";
import {
	LIFT_CARD_ID,
	type LiftRow,
	lacksControlStore,
	liftSummary,
	type PromotionChoice,
} from "../params.js";
import {
	comparatorOf,
	LIFT_BASELINE_WEEKS,
	LIFT_MIN_CONTROL_DAYS,
	liftPreWeeks,
	liftPromotion,
	liftWindow,
	promotionLabel,
	promotionName,
	promotionRows,
	promotionsCalls,
	promotionsCsvName,
	promotionsNeeds,
} from "../support.js";

export const PROMO_NET_LIFT_METRIC = "promo_net_lift";
export const PROMO_LIFT_METRIC = "promo_lift";
export const LIFT_PREVIEW_ROWS = 10;

export const BLOCKING_FLAGS: readonly LiftFlag[] = [
	"no_test_store",
	"no_control_store",
	"few_control_days",
];

export interface LiftSituation {
	readonly noControlStore: boolean;
	readonly fewDaysWithout: boolean;
}

export interface LiftFigures {
	readonly gross: number;
	readonly cost: number;
	readonly net: number;
	readonly days: number;
}

export function liftFlags(summary: LiftRow | null): readonly LiftFlag[] {
	return (summary?.flags ?? []).filter(isLiftFlag);
}

export function blockingFlag(flags: readonly LiftFlag[]): LiftFlag | null {
	return BLOCKING_FLAGS.find((flag) => flags.includes(flag)) ?? null;
}

export function liftFigures(summary: LiftRow | null): LiftFigures | null {
	if (summary === null) return null;
	if (blockingFlag(liftFlags(summary)) !== null) return null;
	const gross = summary.gross_lift_amount;
	const cost = summary.discount_amount;
	const net = summary.net_lift_amount;
	if (gross === null || cost === null || net === null) return null;
	return { gross, cost, net, days: summary.measured_days ?? 0 };
}

function controlWeeks(
	input: ThemeCardInput,
	comparator: PromotionComparator,
): number {
	if (comparator === "baseline") return LIFT_BASELINE_WEEKS;
	return liftPreWeeks(input.results) ?? DEFAULT_REPORT_SETTINGS.promoPreWeeks;
}

export function liftSituation(
	input: ThemeCardInput,
	days: readonly LiftRow[],
): LiftSituation {
	return {
		noControlStore: lacksControlStore(input.results),
		fewDaysWithout:
			days.filter((row) => row.promo_day === false).length <
			LIFT_MIN_CONTROL_DAYS,
	};
}

export function flagKey(flag: LiftFlag, situation: LiftSituation): string {
	if (flag === "few_control_days" && situation.noControlStore) {
		return promotionsKeys.lift.flagNoStore.few_control_days;
	}
	if (flag === "no_control_store" && situation.fewDaysWithout) {
		return promotionsKeys.lift.flagDaily.no_control_store;
	}
	return promotionsKeys.lift.flag[flag];
}

function chosenLabel(
	input: ThemeCardInput,
	choice: PromotionChoice,
): SentencePart {
	const row = promotionRows(input.results, promotionsCalls.promotionsW92).find(
		(entry) =>
			entry.promotion_kind === choice.kind &&
			entry.promotion_key === choice.key,
	);
	return promotionLabel(
		choice.kind,
		promotionName(
			row ?? {
				promotion_key: choice.key,
				promotion_name: null,
			},
		),
	);
}

function flagPart(
	flag: LiftFlag | undefined,
	situation: LiftSituation,
): SentencePart[] {
	return flag === undefined ? [] : [part(flagKey(flag, situation))];
}

function measuredNarrative(
	summary: LiftRow,
	figures: LiftFigures,
	promotion: SentencePart,
	situation: LiftSituation,
): SentencePart[] {
	const main = part(
		figures.net >= 0 ? promotionsKeys.lift.gain : promotionsKeys.lift.loss,
		{
			promotion: partValue(promotion),
			net: numberValue("money", Math.abs(figures.net)),
			gross: numberValue("moneySigned", figures.gross),
			cost: numberValue("money", figures.cost),
			days: numberValue("count", figures.days),
		},
	);
	const trend =
		summary.trend_adjustment_amount === null
			? []
			: [
					part(promotionsKeys.lift.trend, {
						amount: numberValue("moneySigned", summary.trend_adjustment_amount),
						days: numberValue("count", summary.control_days ?? 0),
					}),
				];
	return [main, ...trend, ...flagPart(liftFlags(summary)[0], situation)].slice(
		0,
		3,
	);
}

function dayRows(rows: readonly LiftRow[]): readonly LiftRow[] {
	return rows
		.filter((row) => row.business_date !== null)
		.sort((left, right) => {
			if (left.promo_day !== right.promo_day) return left.promo_day ? -1 : 1;
			return (left.business_date ?? "") < (right.business_date ?? "") ? -1 : 1;
		});
}

function yesNo(value: boolean | null): string {
	return value === true ? promotionsKeys.lift.yes : promotionsKeys.lift.no;
}

function liftTable(days: readonly LiftRow[]): TableModel {
	return tableModel({
		captionKey: promotionsKeys.lift.table,
		columns: [
			column("date", reportKeys.table.date, "date"),
			column("promotionDay", promotionsKeys.table.promotionDay, "message"),
			column("controlDay", promotionsKeys.table.controlDay, "message"),
			column("gross", promotionsKeys.table.gross, "money"),
			column("reference", promotionsKeys.table.reference, "money"),
			column("counterfactual", promotionsKeys.table.counterfactual, "money"),
			column("lift", promotionsKeys.table.lift, "money"),
			column("discount", reportKeys.table.discount, "money"),
		],
		rows: days.map((row) => ({
			id: row.business_date ?? "",
			cells: {
				date: row.business_date,
				promotionDay: yesNo(row.promo_day),
				controlDay: yesNo(row.control_day),
				gross: row.test_gross_amount,
				reference: row.reference_gross_amount,
				counterfactual: row.counterfactual_gross_amount,
				lift: row.gross_lift_amount,
				discount: row.discount_amount,
			},
		})),
		previewRows: LIFT_PREVIEW_ROWS,
	});
}

function liftChart(days: readonly LiftRow[]): ChartModel | null {
	const promoDays = days
		.filter((row) => row.promo_day === true)
		.sort((left, right) =>
			(left.business_date ?? "") < (right.business_date ?? "") ? -1 : 1,
		);
	if (promoDays.length === 0) return null;
	const series: ChartSeriesModel[] = [
		{
			label: part(promotionsKeys.table.gross),
			kind: "bar",
			tone: "primary",
			axis: "left",
			stack: null,
			values: promoDays.map((row) => row.test_gross_amount),
		},
	];
	if (promoDays.some((row) => row.counterfactual_gross_amount !== null)) {
		series.push({
			label: part(promotionsKeys.table.counterfactual),
			kind: "line",
			tone: "secondary",
			axis: "left",
			stack: null,
			values: promoDays.map((row) => row.counterfactual_gross_amount),
		});
	}
	return {
		labelKey: promotionsKeys.lift.chart,
		categories: promoDays.map((row) =>
			textValue("date", row.business_date ?? ""),
		),
		series,
		leftUnit: "money",
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

interface LiftText {
	readonly subtitle: SentencePart;
	readonly narrative: readonly SentencePart[];
	readonly notice: NoticeModel | null;
}

function liftText(
	input: ThemeCardInput,
	choice: PromotionChoice | null,
	summary: LiftRow | null,
	figures: LiftFigures | null,
	situation: LiftSituation,
): LiftText {
	const window = liftWindow(input.context);
	const days = numberValue("count", window.days);
	if (choice === null) {
		return {
			subtitle: part(themeKeys.subtitle.lastDays, { days }),
			narrative: [part(promotionsKeys.lift.none, { days })],
			notice: {
				tone: "info",
				part: part(promotionsKeys.lift.noneNotice),
				action: null,
			},
		};
	}
	const comparator = comparatorOf(input.context);
	const promotion = chosenLabel(input, choice);
	const subtitle = part(promotionsKeys.lift.subtitle, {
		promotion: partValue(promotion),
		days,
		definition: partValue(
			part(promotionsKeys.lift.definition[comparator], {
				weeks: numberValue("count", controlWeeks(input, comparator)),
			}),
		),
	});
	if (summary !== null && figures !== null) {
		return {
			subtitle,
			narrative: measuredNarrative(summary, figures, promotion, situation),
			notice: null,
		};
	}
	const flags = liftFlags(summary);
	const blocking = blockingFlag(flags);
	return {
		subtitle,
		narrative: [
			part(promotionsKeys.lift.notMeasured, {
				promotion: partValue(promotion),
				days,
			}),
			...flagPart(
				flags.find((flag) => flag !== blocking),
				situation,
			),
		],
		notice:
			blocking === null
				? null
				: {
						tone: "warning",
						part: part(flagKey(blocking, situation)),
						action: null,
					},
	};
}

export function buildLiftCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const choice = liftPromotion(context, input.results);
	const rows =
		choice === null
			? []
			: (input.results.rows(promotionsCalls.lift, "promotion_lift") ?? []);
	const summary = liftSummary(rows);
	const figures = liftFigures(summary);
	const days = dayRows(rows);
	const text = liftText(
		input,
		choice,
		summary,
		figures,
		liftSituation(input, days),
	);
	return {
		id: LIFT_CARD_ID,
		titleKey: promotionsKeys.lift.title,
		subtitle: text.subtitle,
		metricId: PROMO_NET_LIFT_METRIC,
		relatedMetricIds: [PROMO_LIFT_METRIC],
		headline: {
			value: figures?.net ?? null,
			unit: "signedMoney",
			caption:
				figures === null
					? null
					: part(promotionsKeys.lift.caption, {
							gross: numberValue("moneySigned", figures.gross),
							cost: numberValue("money", figures.cost),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: text.narrative,
		tables: days.length === 0 ? [] : [liftTable(days)],
		chart: liftChart(days),
		notice: text.notice,
		markers: themeMarkers(input, true),
		csvName: promotionsCsvName(context, LIFT_CARD_ID),
	};
}

export const liftCard: ThemeCardDefinition = {
	id: LIFT_CARD_ID,
	needs: promotionsNeeds.lift,
	visible: () => true,
	build: buildLiftCard,
};
