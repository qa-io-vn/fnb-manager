import type { AnalyticsRow } from "../../../contract/functions.js";
import type { PromotionKind } from "../../../contract/values.js";
import type { CardDefinition, CardInput } from "../../../definition.js";
import type { CardModel, ChartSeriesModel } from "../../../model/card.js";
import {
	comparisonsFromMetricRows,
	comparisonsFromPeriodRows,
	withUnit,
} from "../../../model/comparison.js";
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
import { addDays } from "../../../period/dates.js";
import { dayKeys } from "../keys.js";
import {
	compareRows,
	comparisonOf,
	dayCalls,
	dayCsvName,
	dayLabels,
	dayMarkers,
	dayNeeds,
	dayValue,
	likeForLikeMetrics,
	likeForLikeTotals,
	metricRows,
	type TotalsRow,
	totalsOf,
} from "../support.js";

type PromotionRow = AnalyticsRow<"promotion_summary">;

const COMPONENTS: readonly PromotionKind[] = ["item", "bill", "voucher"];
const componentTones = {
	item: "primary",
	bill: "secondary",
	voucher: "tertiary",
} as const;
const UNNAMED_KEY = "unnamed";
const SHARE_DIGITS = 6;

function componentAmount(
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

export function promotionName(row: PromotionRow): string | null {
	if (row.promotion_name !== null) return row.promotion_name;
	return row.promotion_key === UNNAMED_KEY ? null : row.promotion_key;
}

function largestPromotion(rows: readonly PromotionRow[]): SentencePart | null {
	const largest = rows.find((row) => row.discount_amount > 0);
	if (largest === undefined) return null;
	const name = promotionName(largest);
	const amount = numberValue("money", largest.discount_amount);
	if (name === null) {
		return part(dayKeys.discounts.largestPromotionUnnamed, {
			kind: messageValue(promotionKindKey(largest.promotion_kind)),
			amount,
		});
	}
	return part(dayKeys.discounts.largestPromotion, {
		promotion: textValue("text", name),
		amount,
	});
}

export function buildDiscountsCard(input: CardInput): CardModel {
	const { context, coverage } = input;
	const rows = compareRows(input);
	const current = totalsOf(rows, null, "current");
	const previous = totalsOf(rows, null, "previous");
	const cost =
		current === undefined || current.days_with_data === 0
			? null
			: current.discount_amount;
	const rate = current?.discount_rate ?? null;
	const costComparisons = comparisonsFromPeriodRows({
		all: rows,
		likeForLike: likeForLikeTotals(input),
		coverage,
		kinds: ["previous"],
		pick: (row) => row.discount_amount,
		labels: dayLabels(),
	});
	const rateComparisons = withUnit(
		comparisonsFromMetricRows({
			all: metricRows(input),
			likeForLike: likeForLikeMetrics(input),
			coverage,
			metricId: "discount_rate",
			kinds: ["previous", "last_year"],
			labels: {
				previous: part(dayKeys.discounts.rateComparePrevious),
				last_year: part(dayKeys.discounts.rateCompareLastYear),
			},
		}),
		"fraction",
	);
	const promotions =
		input.results.rows(dayCalls.promotions, "promotion_summary") ?? [];
	const totalCost = sumMoney(promotions.map((row) => row.discount_amount));
	const values: Record<string, TypedValue> = { day: dayValue(context) };
	if (cost !== null) values.value = numberValue("money", cost);
	const parts =
		cost === 0
			? [part(dayKeys.discounts.none, { day: dayValue(context) })]
			: narrate({
					main: {
						up: dayKeys.discounts.up,
						down: dayKeys.discounts.down,
						flat: dayKeys.discounts.flat,
						noReference: dayKeys.discounts.noReference,
						noData: dayKeys.discounts.noData,
					},
					values,
					current: cost,
					comparison: comparisonOf(costComparisons, "previous"),
					notes: [],
					drivers: [],
					decomposition: null,
				});
	const promotion =
		cost === null || cost === 0 ? null : largestPromotion(promotions);
	const day = context.period.end;
	const previousDay = addDays(day, -1);
	const series: ChartSeriesModel[] = COMPONENTS.map((component) => ({
		label: part(promotionKindKey(component)),
		kind: "bar",
		tone: componentTones[component],
		axis: "left",
		stack: "discount",
		values: [
			componentAmount(previous, component),
			componentAmount(current, component),
		],
	}));
	return {
		id: "discounts",
		titleKey: dayKeys.discounts.title,
		subtitle: null,
		metricId: "discount_cost",
		relatedMetricIds: [
			"discount_rate",
			"voucher_invoice_share",
			"gross_revenue",
		],
		headline: {
			value: cost,
			unit: "money",
			caption:
				rate === null
					? null
					: part(dayKeys.discounts.caption, {
							rate: numberValue("percent", rate),
						}),
		},
		comparisons: [...costComparisons, ...rateComparisons],
		decomposition: null,
		narrative: promotion === null ? parts : [...parts, promotion].slice(0, 3),
		tables: [
			tableModel({
				captionKey: dayKeys.discounts.table,
				columns: [
					column("kind", reportKeys.table.promotionKind, "message"),
					column("promotion", reportKeys.table.promotion, "text"),
					column("invoices", reportKeys.table.invoices, "count"),
					column("discount", reportKeys.table.discount, "money"),
					column("costShare", reportKeys.table.costShare, "percent"),
				],
				rows: promotions.map((row) => ({
					id: `${row.promotion_kind}|${row.promotion_key}`,
					cells: {
						kind: promotionKindKey(row.promotion_kind),
						promotion: promotionName(row),
						invoices: row.invoices,
						discount: row.discount_amount,
						costShare: ratio(row.discount_amount, totalCost, SHARE_DIGITS),
					},
				})),
				initialSort: { key: "discount", direction: "descending" },
			}),
			tableModel({
				captionKey: dayKeys.discounts.componentsTable,
				columns: [
					column("component", reportKeys.table.component, "message"),
					column("current", reportKeys.table.current, "money"),
					column("previous", dayKeys.table.previousDay, "money"),
					column("change", dayKeys.table.changePrevious, "signedPercent"),
				],
				rows: COMPONENTS.map((component) => {
					const now = componentAmount(current, component);
					const before = componentAmount(previous, component);
					return {
						id: component,
						cells: {
							component: promotionKindKey(component),
							current: now,
							previous: before,
							change: relativeChange(now, before),
						},
					};
				}),
			}),
		],
		chart: {
			labelKey: dayKeys.discounts.chart,
			categories: [textValue("date", previousDay), textValue("date", day)],
			series,
			leftUnit: "money",
			rightUnit: null,
			markLines: [],
			markAreas: [],
		},
		notice: null,
		markers: dayMarkers(input, false),
		csvName: dayCsvName(context, "discounts"),
	};
}

export const discountsCard: CardDefinition = {
	id: "discounts",
	needs: dayNeeds.discounts,
	visible: () => true,
	build: buildDiscountsCard,
};
