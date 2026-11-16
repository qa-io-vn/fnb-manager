import type { PromotionKind } from "../../../contract/values.js";
import type {
	CardModel,
	ChartModel,
	Comparison,
	SeriesTone,
	TableModel,
} from "../../../model/card.js";
import { withUnit } from "../../../model/comparison.js";
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
	partValue,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import {
	comparisonsFromRangeRows,
	RANGE_INDEX,
	type RangeTotalsRow,
	rangeRow,
	type ThemeCardDefinition,
	type ThemeCardInput,
	TOTALS_LIKE_FOR_LIKE_KEYS,
} from "../../definition.js";
import { bucketGrain } from "../../payments/support.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { promotionsKeys } from "../keys.js";
import {
	type PromotionRow,
	promotionId,
	promotionName,
	promotionRows,
	promotionsCsvName,
	promotionsNeeds,
	type SeriesRow,
	seriesRows,
	totalsRows,
} from "../support.js";

export const DISCOUNT_COST_ID = "discount_cost";
export const DISCOUNT_COST_METRIC = "discount_cost";
export const DISCOUNT_RATE_METRIC = "discount_rate";
export const GROSS_REVENUE_METRIC = "gross_revenue";

export const DISCOUNT_COMPONENTS: readonly PromotionKind[] = [
	"item",
	"bill",
	"voucher",
];

const componentTones: Readonly<Record<PromotionKind, SeriesTone>> = {
	item: "primary",
	bill: "secondary",
	voucher: "tertiary",
};

type ComponentRow = Pick<
	RangeTotalsRow | SeriesRow,
	| "days_with_data"
	| "item_discount_amount"
	| "bill_discount_amount"
	| "voucher_amount"
>;

export function componentAmount(
	row: ComponentRow | undefined,
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

function measured(row: RangeTotalsRow | undefined): RangeTotalsRow | undefined {
	return row === undefined || row.days_with_data === 0 ? undefined : row;
}

function comparisonsOf(
	input: ThemeCardInput,
	pick: (row: RangeTotalsRow) => number | null,
): readonly Comparison[] {
	return comparisonsFromRangeRows({
		context: input.context,
		all: totalsRows(input.results),
		likeForLike: {
			previous: totalsRows(input.results, TOTALS_LIKE_FOR_LIKE_KEYS.previous),
			last_year: totalsRows(input.results, TOTALS_LIKE_FOR_LIKE_KEYS.last_year),
		},
		coverage: input.coverage,
		pick: (row) => (row.days_with_data === 0 ? null : pick(row)),
	});
}

function rateComparisons(input: ThemeCardInput): readonly Comparison[] {
	return withUnit(
		comparisonsOf(input, (row) => row.discount_rate),
		"fraction",
	).map((entry) => ({
		...entry,
		label: part(promotionsKeys.discountCost.rateCompare, {
			reference: partValue(entry.label),
		}),
	}));
}

export function largestPromotion(
	rows: readonly PromotionRow[],
): PromotionRow | null {
	let largest: PromotionRow | null = null;
	for (const row of rows) {
		if (row.discount_amount <= 0) continue;
		if (largest === null || row.discount_amount > largest.discount_amount) {
			largest = row;
		}
	}
	return largest;
}

function largestPart(
	rows: readonly PromotionRow[],
	total: number,
): SentencePart | null {
	const largest = largestPromotion(rows);
	if (largest === null) return null;
	const values = {
		amount: numberValue("money", largest.discount_amount),
		share: numberValue(
			"percent",
			ratio(largest.discount_amount, total, SHARE_DIGITS) ?? 0,
		),
	};
	const name = promotionName(largest);
	return name === null
		? part(promotionsKeys.discountCost.largestUnnamed, {
				...values,
				kind: messageValue(promotionKindKey(largest.promotion_kind)),
			})
		: part(promotionsKeys.discountCost.largest, {
				...values,
				promotion: textValue("text", name),
			});
}

function promotionsTable(
	rows: readonly PromotionRow[],
	total: number,
): TableModel {
	return tableModel({
		captionKey: promotionsKeys.discountCost.table,
		columns: [
			column("kind", reportKeys.table.promotionKind, "message"),
			column("promotion", reportKeys.table.promotion, "text"),
			column("invoices", reportKeys.table.invoices, "count"),
			column("discount", reportKeys.table.discount, "money"),
			column("costShare", reportKeys.table.costShare, "percent"),
			column("firstUsed", promotionsKeys.table.firstUsed, "date"),
			column("lastUsed", promotionsKeys.table.lastUsed, "date"),
		],
		rows: rows.map((row) => ({
			id: promotionId(row),
			cells: {
				kind: promotionKindKey(row.promotion_kind),
				promotion: promotionName(row),
				invoices: row.invoices,
				discount: row.discount_amount,
				costShare: ratio(row.discount_amount, total, SHARE_DIGITS),
				firstUsed: row.first_used_on,
				lastUsed: row.last_used_on,
			},
		})),
		initialSort: { key: "discount", direction: "descending" },
	});
}

function componentsTable(
	current: RangeTotalsRow | undefined,
	previous: RangeTotalsRow | undefined,
): TableModel {
	return tableModel({
		captionKey: promotionsKeys.discountCost.componentsTable,
		columns: [
			column("component", reportKeys.table.component, "message"),
			column("current", reportKeys.table.current, "money"),
			column("previous", reportKeys.table.previous, "money"),
			column("change", reportKeys.table.change, "signedPercent"),
		],
		rows: DISCOUNT_COMPONENTS.map((component) => {
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
	});
}

function chartOf(input: ThemeCardInput): ChartModel | null {
	const rows = seriesRows(input.results);
	if (rows.length === 0) return null;
	return {
		labelKey:
			bucketGrain(input.context.range.days) === "day"
				? promotionsKeys.discountCost.chartDay
				: promotionsKeys.discountCost.chartWeek,
		categories: rows.map((row) => textValue("date", row.bucket_start)),
		series: DISCOUNT_COMPONENTS.map((component) => ({
			label: part(promotionKindKey(component)),
			kind: "bar",
			tone: componentTones[component],
			axis: "left",
			stack: "discount",
			values: rows.map((row) => componentAmount(row, component)),
		})),
		leftUnit: "money",
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

export function buildDiscountCostCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const all = totalsRows(input.results);
	const current = measured(rangeRow(all, RANGE_INDEX.current));
	const previous = measured(rangeRow(all, RANGE_INDEX.previous));
	const cost = current?.discount_amount ?? null;
	const rate = current?.discount_rate ?? null;
	const costComparisons = comparisonsOf(input, (row) => row.discount_amount);
	const chip =
		costComparisons.find((entry) => entry.kind === "previous") ?? null;
	const promotions = promotionRows(input.results);
	const total = sumMoney(promotions.map((row) => row.discount_amount));
	const range = rangeValue(context);
	const values: Record<string, TypedValue> = { range };
	if (cost !== null) values.value = numberValue("money", cost);
	if (chip !== null) values.reference = partValue(chip.label);
	const none = cost === 0;
	const main: readonly SentencePart[] = none
		? [part(promotionsKeys.discountCost.none, { range })]
		: narrate({
				main: {
					up: promotionsKeys.discountCost.up,
					down: promotionsKeys.discountCost.down,
					flat: promotionsKeys.discountCost.flat,
					noReference: promotionsKeys.discountCost.noReference,
					noData: promotionsKeys.discountCost.noData,
				},
				values,
				current: cost,
				comparison: chip,
				notes: [],
				drivers: [],
				decomposition: null,
			});
	const largest = cost === null || none ? null : largestPart(promotions, total);
	return {
		id: DISCOUNT_COST_ID,
		titleKey: promotionsKeys.discountCost.title,
		subtitle: null,
		metricId: DISCOUNT_COST_METRIC,
		relatedMetricIds: [DISCOUNT_RATE_METRIC, GROSS_REVENUE_METRIC],
		headline: {
			value: cost,
			unit: "money",
			caption:
				rate === null
					? null
					: part(promotionsKeys.discountCost.caption, {
							rate: numberValue("percent", rate),
						}),
		},
		comparisons: [...costComparisons, ...rateComparisons(input)],
		decomposition: null,
		narrative: (largest === null ? main : [...main, largest]).slice(0, 3),
		tables: [
			...(promotions.length === 0 ? [] : [promotionsTable(promotions, total)]),
			...(current === undefined ? [] : [componentsTable(current, previous)]),
		],
		chart: cost === null ? null : chartOf(input),
		notice: null,
		markers: themeMarkers(input, true),
		csvName: promotionsCsvName(context, DISCOUNT_COST_ID),
	};
}

export const discountCostCard: ThemeCardDefinition = {
	id: DISCOUNT_COST_ID,
	needs: promotionsNeeds.discountCost,
	visible: () => true,
	build: buildDiscountCostCard,
};
