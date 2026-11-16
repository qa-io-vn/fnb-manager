import type { CardModel, Comparison, TableModel } from "../../../model/card.js";
import { withUnit } from "../../../model/comparison.js";
import { SHARE_DIGITS } from "../../../model/grouping.js";
import { reportKeys } from "../../../model/keys.js";
import { narrate } from "../../../model/narrative.js";
import { ratio } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	partValue,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import { pointsValue } from "../../../reports/month/support.js";
import {
	comparisonsFromRangeRows,
	RANGE_INDEX,
	rangeRow,
	type ThemeCardDefinition,
	type ThemeCardInput,
	TOTALS_LIKE_FOR_LIKE_KEYS,
} from "../../definition.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { promotionsKeys } from "../keys.js";
import {
	type PromotionRow,
	promotionId,
	promotionName,
	promotionRows,
	promotionsCsvName,
	promotionsNeeds,
	totalsRows,
} from "../support.js";

export const VOUCHERS_ID = "vouchers";
export const VOUCHER_SHARE_METRIC = "voucher_invoice_share";

function shareComparisons(input: ThemeCardInput): readonly Comparison[] {
	return withUnit(
		comparisonsFromRangeRows({
			context: input.context,
			all: totalsRows(input.results),
			likeForLike: {
				previous: totalsRows(input.results, TOTALS_LIKE_FOR_LIKE_KEYS.previous),
				last_year: totalsRows(
					input.results,
					TOTALS_LIKE_FOR_LIKE_KEYS.last_year,
				),
			},
			coverage: input.coverage,
			pick: (row) => (row.days_with_data === 0 ? null : row.voucher_share),
		}),
		"fraction",
	);
}

function codePointOrder(left: string, right: string): number {
	if (left === right) return 0;
	return left < right ? -1 : 1;
}

export function mostUsedVoucher(
	rows: readonly PromotionRow[],
): PromotionRow | null {
	const used = rows.filter((row) => row.invoices > 0);
	return (
		[...used].sort(
			(left, right) =>
				right.invoices - left.invoices ||
				right.discount_amount - left.discount_amount ||
				codePointOrder(left.promotion_key, right.promotion_key),
		)[0] ?? null
	);
}

function topPart(rows: readonly PromotionRow[]): SentencePart | null {
	const top = mostUsedVoucher(rows);
	if (top === null) return null;
	const values = {
		invoices: numberValue("count", top.invoices),
		amount: numberValue("money", top.discount_amount),
	};
	const name = promotionName(top);
	return name === null
		? part(promotionsKeys.vouchers.topUnnamed, values)
		: part(promotionsKeys.vouchers.top, {
				...values,
				voucher: textValue("text", name),
			});
}

function vouchersTable(
	rows: readonly PromotionRow[],
	invoices: number | null,
): TableModel {
	return tableModel({
		captionKey: promotionsKeys.vouchers.table,
		columns: [
			column("voucher", promotionsKeys.table.voucher, "text"),
			column("invoices", reportKeys.table.invoices, "count"),
			column("amount", reportKeys.table.discount, "money"),
			column("invoiceShare", promotionsKeys.table.invoiceShare, "percent"),
		],
		rows: rows.map((row) => ({
			id: promotionId(row),
			cells: {
				voucher: promotionName(row),
				invoices: row.invoices,
				amount: row.discount_amount,
				invoiceShare: ratio(row.invoices, invoices, SHARE_DIGITS),
			},
		})),
		initialSort: { key: "invoices", direction: "descending" },
	});
}

export function buildVouchersCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const currentRow = rangeRow(totalsRows(input.results), RANGE_INDEX.current);
	const measured =
		currentRow !== undefined && currentRow.days_with_data > 0
			? currentRow
			: undefined;
	const current = measured?.voucher_share ?? null;
	const comparisons = shareComparisons(input);
	const previous =
		comparisons.find((entry) => entry.kind === "previous") ?? null;
	const vouchers = promotionRows(input.results).filter(
		(row) => row.promotion_kind === "voucher",
	);
	const range = rangeValue(context);
	const values: Record<string, TypedValue> = { range };
	if (current !== null) values.value = numberValue("percent", current);
	const points = pointsValue(previous);
	if (points !== null) values.points = points;
	if (previous !== null) values.reference = partValue(previous.label);
	const none = current === 0;
	const main: readonly SentencePart[] = none
		? [part(promotionsKeys.vouchers.none, { range })]
		: narrate({
				main: {
					up: promotionsKeys.vouchers.up,
					down: promotionsKeys.vouchers.down,
					flat: promotionsKeys.vouchers.flat,
					noReference: promotionsKeys.vouchers.noReference,
					noData: promotionsKeys.vouchers.noData,
				},
				values,
				current,
				comparison: previous,
				notes: [],
				drivers: [],
				decomposition: null,
			});
	const top = current === null || none ? null : topPart(vouchers);
	return {
		id: VOUCHERS_ID,
		titleKey: promotionsKeys.vouchers.title,
		subtitle: null,
		metricId: VOUCHER_SHARE_METRIC,
		relatedMetricIds: [],
		headline: { value: current, unit: "fraction", caption: null },
		comparisons,
		decomposition: null,
		narrative: (top === null ? main : [...main, top]).slice(0, 3),
		tables:
			vouchers.length === 0
				? []
				: [vouchersTable(vouchers, measured?.invoices ?? null)],
		chart: null,
		notice: null,
		markers: themeMarkers(input, true),
		csvName: promotionsCsvName(context, VOUCHERS_ID),
	};
}

export const vouchersCard: ThemeCardDefinition = {
	id: VOUCHERS_ID,
	needs: promotionsNeeds.vouchers,
	visible: () => true,
	build: buildVouchersCard,
};
