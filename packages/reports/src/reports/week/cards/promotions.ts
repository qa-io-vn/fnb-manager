import type { AnalyticsRow } from "../../../contract/functions.js";
import type { PromotionKind } from "../../../contract/values.js";
import type { CardDefinition, CardInput } from "../../../definition.js";
import type {
	CardModel,
	ChartSeriesModel,
	SeriesTone,
} from "../../../model/card.js";
import {
	comparisonsFromMetricRows,
	comparisonsFromPeriodRows,
	withUnit,
} from "../../../model/comparison.js";
import { promotionKindKey, reportKeys } from "../../../model/keys.js";
import { narrate } from "../../../model/narrative.js";
import { relativeChange } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	comparisonOf,
	likeForLikeMetrics,
	likeForLikeTotals,
	type TotalsRow,
	totalsOf,
} from "../../../model/totals.js";
import {
	messageValue,
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import { periodKey } from "../../../period/periods.js";
import { weekKeys } from "../keys.js";
import {
	compareRows,
	lastWeekRange,
	metricRows,
	noDataNotice,
	weekCalls,
	weekCsvName,
	weekLabels,
	weekMarkers,
	weekNeeds,
	weekValue,
} from "../support.js";

type PromotionRow = AnalyticsRow<"promotion_summary">;

const COMPONENTS: readonly PromotionKind[] = ["item", "bill", "voucher"];
const componentTones: Readonly<Record<PromotionKind, SeriesTone>> = {
	item: "primary",
	bill: "secondary",
	voucher: "tertiary",
};
export const UNNAMED_PROMOTION_KEY = "unnamed";
export const DISCOUNT_RATE_METRIC = "discount_rate";
export const VOUCHER_SHARE_METRIC = "voucher_invoice_share";

export function promotionKey(
	row: Pick<PromotionRow, "promotion_kind" | "promotion_key">,
): string {
	return `${row.promotion_kind}|${row.promotion_key}`;
}

export function promotionName(row: PromotionRow): string | null {
	if (row.promotion_name !== null) return row.promotion_name;
	return row.promotion_key === UNNAMED_PROMOTION_KEY ? null : row.promotion_key;
}

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

function largestPart(rows: readonly PromotionRow[]): SentencePart | null {
	const largest = rows.find((row) => row.discount_amount > 0);
	if (largest === undefined) return null;
	const name = promotionName(largest);
	const amount = numberValue("money", largest.discount_amount);
	if (name === null) {
		return part(weekKeys.promotions.largestUnnamed, {
			kind: messageValue(promotionKindKey(largest.promotion_kind)),
			amount,
		});
	}
	return part(weekKeys.promotions.largest, {
		promotion: textValue("text", name),
		amount,
	});
}

function metricValueOf(
	rows: readonly AnalyticsRow<"metric_compare">[],
	metricId: string,
): number | null {
	return (
		rows.find((row) => row.metric_id === metricId && row.period === "current")
			?.value ?? null
	);
}

export function buildPromotionsCard(input: CardInput): CardModel {
	const { context, coverage } = input;
	const rows = compareRows(input);
	const current = totalsOf(rows, null, "current");
	const previous = totalsOf(rows, null, "previous");
	const cost =
		current === undefined || current.days_with_data === 0
			? null
			: current.discount_amount;
	const metrics = metricRows(input);
	const rate = metricValueOf(metrics, DISCOUNT_RATE_METRIC);
	const voucherShare = metricValueOf(metrics, VOUCHER_SHARE_METRIC);
	const costComparisons = comparisonsFromPeriodRows({
		all: rows,
		likeForLike: likeForLikeTotals(input.results),
		coverage,
		kinds: ["previous"],
		pick: (row) => row.discount_amount,
		labels: weekLabels(),
	});
	const rateComparisons = withUnit(
		comparisonsFromMetricRows({
			all: metrics,
			likeForLike: likeForLikeMetrics(input.results),
			coverage,
			metricId: DISCOUNT_RATE_METRIC,
			kinds: ["previous"],
			labels: {
				previous: part(weekKeys.promotions.rateComparePrevious),
				last_year: part(weekLabels().last_year.key),
			},
		}),
		"fraction",
	);
	const promotions =
		input.results.rows(weekCalls.promotions, "promotion_summary") ?? [];
	const lastWeek =
		input.results.rows(weekCalls.promotionsPrevious, "promotion_summary") ?? [];
	const lastWeekByKey = new Map(
		lastWeek.map((row) => [promotionKey(row), row.discount_amount]),
	);
	const lastWeekMeasured =
		previous !== undefined && previous.days_with_data > 0;
	const values: Record<string, TypedValue> = { period: weekValue(context) };
	if (cost !== null) values.value = numberValue("money", cost);
	const none = cost === 0;
	const main: readonly SentencePart[] = none
		? [part(weekKeys.promotions.none, { period: weekValue(context) })]
		: narrate({
				main: {
					up: weekKeys.promotions.up,
					down: weekKeys.promotions.down,
					flat: weekKeys.promotions.flat,
					noReference: weekKeys.promotions.noReference,
					noData: weekKeys.promotions.noData,
				},
				values,
				current: cost,
				comparison: comparisonOf(costComparisons, "previous"),
				notes: [],
				drivers: [],
				decomposition: null,
			});
	const largest = cost === null || none ? null : largestPart(promotions);
	const voucher =
		cost === null || none || voucherShare === null
			? null
			: part(weekKeys.promotions.voucherShare, {
					share: numberValue("percent", voucherShare),
				});
	const narrative = [
		...main,
		...(largest === null ? [] : [largest]),
		...(voucher === null ? [] : [voucher]),
	].slice(0, 3);
	const previousWeek = periodKey("week", lastWeekRange(context).from);
	const series: ChartSeriesModel[] = COMPONENTS.map((component) => ({
		label: part(weekKeys.promotions.series[component]),
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
		id: "promotions",
		titleKey: weekKeys.promotions.title,
		subtitle: null,
		metricId: "discount_cost",
		relatedMetricIds: [DISCOUNT_RATE_METRIC, VOUCHER_SHARE_METRIC],
		headline: {
			value: cost,
			unit: "money",
			caption:
				rate === null
					? null
					: part(weekKeys.promotions.caption, {
							rate: numberValue("percent", rate),
						}),
		},
		comparisons: [...costComparisons, ...rateComparisons],
		decomposition: null,
		narrative,
		tables: [
			tableModel({
				captionKey: weekKeys.promotions.table,
				columns: [
					column("kind", reportKeys.table.promotionKind, "message"),
					column("promotion", reportKeys.table.promotion, "text"),
					column("invoices", reportKeys.table.invoices, "count"),
					column("discount", reportKeys.table.discount, "money"),
					column("lastWeek", weekKeys.table.lastWeekDiscount, "money"),
					column("change", weekKeys.table.changeLastWeek, "signedPercent"),
					column("daysUsed", weekKeys.table.daysUsed, "count"),
				],
				rows: promotions.map((row) => {
					const before =
						lastWeekByKey.get(promotionKey(row)) ??
						(lastWeekMeasured ? 0 : null);
					return {
						id: promotionKey(row),
						cells: {
							kind: promotionKindKey(row.promotion_kind),
							promotion: promotionName(row),
							invoices: row.invoices,
							discount: row.discount_amount,
							lastWeek: before,
							change: relativeChange(row.discount_amount, before),
							daysUsed: row.days_used,
						},
					};
				}),
				initialSort: { key: "discount", direction: "descending" },
			}),
		],
		chart: {
			labelKey: weekKeys.promotions.chart,
			categories: [
				textValue("isoWeek", previousWeek),
				textValue("isoWeek", context.period.key),
			],
			series,
			leftUnit: "money",
			rightUnit: null,
			markLines: [],
			markAreas: [],
		},
		notice: cost === null ? noDataNotice() : null,
		markers: weekMarkers(input, false),
		csvName: weekCsvName(context, "promotions"),
	};
}

export const promotionsCard: CardDefinition = {
	id: "promotions",
	needs: weekNeeds.promotions,
	visible: () => true,
	build: buildPromotionsCard,
};
