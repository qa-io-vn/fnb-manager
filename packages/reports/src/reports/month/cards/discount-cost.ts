import type { AnalyticsRow } from "../../../contract/functions.js";
import type { PromotionKind } from "../../../contract/values.js";
import type { CardDefinition, CardInput } from "../../../definition.js";
import type { CardModel, ChartSeriesModel } from "../../../model/card.js";
import {
	comparisonsFromMetricRows,
	comparisonsFromPeriodRows,
	withUnit,
} from "../../../model/comparison.js";
import { SHARE_DIGITS } from "../../../model/grouping.js";
import { promotionKindKey, reportKeys } from "../../../model/keys.js";
import { sumMoney } from "../../../model/money.js";
import { narrate } from "../../../model/narrative.js";
import { ratio, relativeChange } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	messageValue,
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import { monthKeys } from "../keys.js";
import {
	compareRows,
	comparisonOf,
	likeForLikeMetrics,
	likeForLikeTotals,
	metricRows,
	metricValueOf,
	monthCalls,
	monthCsvName,
	monthLabels,
	monthMarkers,
	monthNeeds,
	monthValue,
	type TotalsRow,
	totalsOf,
} from "../support.js";

type PromotionRow = AnalyticsRow<"promotion_summary">;

export const DISCOUNT_RATE_METRIC = "discount_rate";
const COMPONENTS: readonly PromotionKind[] = ["item", "bill", "voucher"];
const componentTones = {
	item: "primary",
	bill: "secondary",
	voucher: "tertiary",
} as const;
const UNNAMED_KEY = "unnamed";
const PERIODS = [
	{ period: "last_year", labelKey: reportKeys.periodRow.lastYear },
	{ period: "previous", labelKey: reportKeys.periodRow.previous },
	{ period: "current", labelKey: reportKeys.periodRow.current },
] as const;

export function componentAmount(
	row: TotalsRow | undefined,
	component: PromotionKind,
): number | null {
	if (row === undefined || row.days_with_data === 0) return null;
	switch (component) {
		case "item":
			return row.item_discount_amount;
		case "bill":
			return row.bill_discount_amount;
		case "voucher":
			return row.voucher_amount;
	}
}

function promotionName(row: PromotionRow): string | null {
	if (row.promotion_name !== null) return row.promotion_name;
	return row.promotion_key === UNNAMED_KEY ? null : row.promotion_key;
}

function largestPromotion(
	rows: readonly PromotionRow[],
	totalCost: number,
): SentencePart | null {
	const largest = rows.find((row) => row.discount_amount > 0);
	if (largest === undefined) return null;
	const name = promotionName(largest);
	const values = {
		amount: numberValue("money", largest.discount_amount),
		share: numberValue(
			"percent",
			ratio(largest.discount_amount, totalCost, SHARE_DIGITS) ?? 0,
		),
	};
	if (name === null) {
		return part(monthKeys.discounts.largestPromotionUnnamed, {
			...values,
			kind: messageValue(promotionKindKey(largest.promotion_kind)),
		});
	}
	return part(monthKeys.discounts.largestPromotion, {
		...values,
		promotion: textValue("text", name),
	});
}

export function buildDiscountCostCard(input: CardInput): CardModel {
	const { context, coverage } = input;
	const rows = compareRows(input);
	const current = totalsOf(rows, null, "current");
	const cost =
		current === undefined || current.days_with_data === 0
			? null
			: current.discount_amount;
	const metrics = metricRows(input);
	const rate = metricValueOf(metrics, DISCOUNT_RATE_METRIC, "current");
	const costComparisons = comparisonsFromPeriodRows({
		all: rows,
		likeForLike: likeForLikeTotals(input),
		coverage,
		kinds: ["previous", "last_year"],
		pick: (row) => row.discount_amount,
		labels: monthLabels(),
	});
	const rateComparisons = withUnit(
		comparisonsFromMetricRows({
			all: metrics,
			likeForLike: likeForLikeMetrics(input),
			coverage,
			metricId: DISCOUNT_RATE_METRIC,
			kinds: ["previous"],
			labels: {
				previous: part(monthKeys.discounts.ratePrevious),
				last_year: monthLabels().last_year,
			},
		}),
		"fraction",
	);
	const promotions =
		input.results.rows(monthCalls.promotions, "promotion_summary") ?? [];
	const totalCost = sumMoney(promotions.map((row) => row.discount_amount));
	const month = monthValue(context);
	const values: Record<string, TypedValue> = { month };
	if (cost !== null) values.value = numberValue("money", cost);
	const parts =
		cost === 0
			? [part(monthKeys.discounts.none, { month })]
			: narrate({
					main: {
						up: monthKeys.discounts.up,
						down: monthKeys.discounts.down,
						flat: monthKeys.discounts.flat,
						noReference: monthKeys.discounts.noReference,
						noData: monthKeys.discounts.noData,
					},
					values,
					current: cost,
					comparison: comparisonOf(costComparisons, "previous"),
					notes: [],
					drivers: [],
					decomposition: null,
				});
	const promotion =
		cost === null || cost === 0
			? null
			: largestPromotion(promotions, totalCost);
	const periodRows = PERIODS.map(({ period }) => totalsOf(rows, null, period));
	const series: ChartSeriesModel[] = COMPONENTS.map((component) => ({
		label: part(promotionKindKey(component)),
		kind: "bar",
		tone: componentTones[component],
		axis: "left",
		stack: "discount",
		values: periodRows.map((row) => componentAmount(row, component)),
	}));
	return {
		id: "discount_cost",
		titleKey: monthKeys.discounts.title,
		subtitle: null,
		metricId: "discount_cost",
		relatedMetricIds: [
			"discount_rate",
			"gross_revenue",
			"voucher_invoice_share",
		],
		headline: {
			value: cost,
			unit: "money",
			caption:
				rate === null
					? null
					: part(monthKeys.discounts.caption, {
							rate: numberValue("percent", rate),
						}),
		},
		comparisons: [...costComparisons, ...rateComparisons],
		decomposition: null,
		narrative: promotion === null ? parts : [...parts, promotion].slice(0, 3),
		tables: [
			tableModel({
				captionKey: monthKeys.discounts.table,
				columns: [
					column("kind", reportKeys.table.promotionKind, "message"),
					column("promotion", reportKeys.table.promotion, "text"),
					column("invoices", reportKeys.table.invoices, "count"),
					column("discount", reportKeys.table.discount, "money"),
					column("costShare", reportKeys.table.costShare, "percent"),
					column("daysUsed", monthKeys.table.daysUsed, "count"),
				],
				rows: promotions.map((row) => ({
					id: `${row.promotion_kind}|${row.promotion_key}`,
					cells: {
						kind: promotionKindKey(row.promotion_kind),
						promotion: promotionName(row),
						invoices: row.invoices,
						discount: row.discount_amount,
						costShare: ratio(row.discount_amount, totalCost, SHARE_DIGITS),
						daysUsed: row.days_used,
					},
				})),
				initialSort: { key: "discount", direction: "descending" },
			}),
			tableModel({
				captionKey: monthKeys.discounts.componentsTable,
				columns: [
					column("component", reportKeys.table.component, "message"),
					column("current", monthKeys.table.thisMonth, "money"),
					column("previous", monthKeys.table.previousMonth, "money"),
					column("change", reportKeys.table.change, "signedPercent"),
					column("lastYear", monthKeys.table.lastYearMonth, "money"),
				],
				rows: COMPONENTS.map((component) => {
					const now = componentAmount(current, component);
					const before = componentAmount(
						totalsOf(rows, null, "previous"),
						component,
					);
					return {
						id: component,
						cells: {
							component: promotionKindKey(component),
							current: now,
							previous: before,
							change: relativeChange(now, before),
							lastYear: componentAmount(
								totalsOf(rows, null, "last_year"),
								component,
							),
						},
					};
				}),
			}),
		],
		chart:
			cost === null
				? null
				: {
						labelKey: monthKeys.discounts.chart,
						categories: PERIODS.map(({ labelKey }) => messageValue(labelKey)),
						series,
						leftUnit: "money",
						rightUnit: null,
						markLines: [],
						markAreas: [],
					},
		notice: null,
		markers: monthMarkers(input, false),
		csvName: monthCsvName(context, "discount_cost"),
	};
}

export const discountCostCard: CardDefinition = {
	id: "discount_cost",
	needs: monthNeeds.discounts,
	visible: () => true,
	build: buildDiscountCostCard,
};
