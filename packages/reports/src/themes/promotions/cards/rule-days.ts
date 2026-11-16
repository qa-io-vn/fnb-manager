import type { CardModel, TableModel } from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	type SentencePart,
	textValue,
} from "../../../model/values.js";
import { addDays } from "../../../period/dates.js";
import type { ThemeRow } from "../../contract.js";
import type {
	ThemeCallResults,
	ThemeCardDefinition,
	ThemeCardInput,
} from "../../definition.js";
import { spanValue, themeMarkers } from "../../support.js";
import { promotionsKeys } from "../keys.js";
import {
	type DiscountDaysPlan,
	legalBasisValue,
	needsDaysUnderRule,
} from "../rules.js";
import {
	promotionsCalls,
	promotionsCsvName,
	promotionsNeeds,
	themeDiscountDaysPlan,
} from "../support.js";

export const RULE_DAYS_ID = "rule_days";
export const RULE_DAYS_METRIC = "discount_days";
export const RULE_DAYS_TABLE_ROWS = 30;
export const RULE_DAYS_PREVIEW_ROWS = 10;

export type DiscountDaysRow = ThemeRow<"item_discount_days">;

export function discountDaysRows(
	results: ThemeCallResults,
	key: string = promotionsCalls.discountDays,
): readonly DiscountDaysRow[] {
	return results.rows(key, "item_discount_days") ?? [];
}

export function rowsUnderRule(
	plan: DiscountDaysPlan,
	results: ThemeCallResults,
): readonly DiscountDaysRow[] {
	if (plan.underRule === null || !plan.counted) return [];
	return discountDaysRows(
		results,
		needsDaysUnderRule(plan)
			? promotionsCalls.discountDaysUnderRule
			: promotionsCalls.discountDays,
	);
}

function itemName(row: DiscountDaysRow): string {
	return row.item_name ?? row.item_external_id;
}

export function mostDiscounted(
	rows: readonly DiscountDaysRow[],
): DiscountDaysRow | null {
	let most: DiscountDaysRow | null = null;
	for (const row of rows) {
		if (row.price_discount_days <= 0) continue;
		if (most === null || row.price_discount_days > most.price_discount_days) {
			most = row;
		}
	}
	return most;
}

export function overTheLimit(
	plan: DiscountDaysPlan,
	results: ThemeCallResults,
): DiscountDaysRow[] {
	if (plan.underRule === null) return [];
	const limit = plan.underRule.rule.parameters.maxDaysPerItemYear;
	return rowsUnderRule(plan, results).filter(
		(row) => row.price_discount_days > limit,
	);
}

function statusPart(plan: DiscountDaysPlan): SentencePart {
	if (plan.inForce !== null) {
		return part(promotionsKeys.ruleDays.limit, {
			basis: legalBasisValue(plan.inForce.legalBasis),
			limit: numberValue("count", plan.inForce.parameters.maxDaysPerItemYear),
			checked: textValue("date", plan.inForce.checkedOn),
		});
	}
	if (plan.ended !== null && plan.ended.validTo !== null) {
		return part(promotionsKeys.ruleDays.repealed, {
			limit: numberValue("count", plan.ended.parameters.maxDaysPerItemYear),
			basis: legalBasisValue(plan.ended.legalBasis),
			from: textValue("date", addDays(plan.ended.validTo, 1)),
			checked: textValue("date", plan.ended.checkedOn),
		});
	}
	return part(promotionsKeys.ruleDays.noRule);
}

function countPart(
	plan: DiscountDaysPlan,
	results: ThemeCallResults,
	rows: readonly DiscountDaysRow[],
): SentencePart | null {
	if (!plan.counted) return null;
	if (mostDiscounted(rows) === null) {
		return part(promotionsKeys.ruleDays.none, {
			dates: spanValue({ from: plan.yearStart, to: plan.asOf }),
		});
	}
	if (plan.underRule === null) return null;
	const limit = numberValue(
		"count",
		plan.underRule.rule.parameters.maxDaysPerItemYear,
	);
	const dates = spanValue({ from: plan.yearStart, to: plan.underRule.to });
	const over = overTheLimit(plan, results);
	const most = mostDiscounted(over);
	return most === null
		? part(promotionsKeys.ruleDays.noneOver, { limit, dates })
		: part(promotionsKeys.ruleDays.over, {
				count: numberValue("count", over.length),
				limit,
				dates,
				item: textValue("text", itemName(most)),
				days: numberValue("count", most.price_discount_days),
			});
}

function captionPart(
	plan: DiscountDaysPlan,
	most: DiscountDaysRow | null,
): SentencePart {
	const year = textValue("year", String(plan.year));
	const informational = plan.inForce === null;
	if (most === null) {
		return part(
			informational
				? promotionsKeys.ruleDays.captionYearInfo
				: promotionsKeys.ruleDays.captionYear,
			{ year },
		);
	}
	return part(
		informational
			? promotionsKeys.ruleDays.captionInfo
			: promotionsKeys.ruleDays.caption,
		{ year, item: textValue("text", itemName(most)) },
	);
}

function daysTable(rows: readonly DiscountDaysRow[]): TableModel {
	return tableModel({
		captionKey: promotionsKeys.ruleDays.table,
		columns: [
			column("item", reportKeys.table.item, "text"),
			column("priceDays", promotionsKeys.table.priceDays, "count"),
			column("lineDays", promotionsKeys.table.lineDays, "count"),
			column("billDays", promotionsKeys.table.billDays, "count"),
			column("giftDays", promotionsKeys.table.giftDays, "count"),
			column("voucherDays", promotionsKeys.table.voucherDays, "count"),
			column("firstPrice", promotionsKeys.table.firstPriceDiscount, "date"),
			column("lastPrice", promotionsKeys.table.lastPriceDiscount, "date"),
		],
		rows: rows.slice(0, RULE_DAYS_TABLE_ROWS).map((row) => ({
			id: row.item_external_id,
			cells: {
				item: itemName(row),
				priceDays: row.price_discount_days,
				lineDays: row.line_price_discount_days,
				billDays: row.bill_discount_days,
				giftDays: row.gift_days,
				voucherDays: row.voucher_days,
				firstPrice: row.first_price_discount_on,
				lastPrice: row.last_price_discount_on,
			},
		})),
		previewRows: RULE_DAYS_PREVIEW_ROWS,
	});
}

export function buildRuleDaysCard(input: ThemeCardInput): CardModel {
	const { context, results } = input;
	const plan = themeDiscountDaysPlan(context);
	const rows = plan.counted ? discountDaysRows(results) : [];
	const most = mostDiscounted(rows);
	const count = countPart(plan, results, rows);
	return {
		id: RULE_DAYS_ID,
		titleKey: promotionsKeys.ruleDays.title,
		subtitle: null,
		metricId: RULE_DAYS_METRIC,
		relatedMetricIds: [],
		headline: {
			value: most?.price_discount_days ?? 0,
			unit: "count",
			caption: captionPart(plan, most),
		},
		comparisons: [],
		decomposition: null,
		narrative: [
			statusPart(plan),
			...(count === null ? [] : [count]),
			part(promotionsKeys.ruleDays.basis),
		],
		tables: rows.length === 0 ? [] : [daysTable(rows)],
		chart: null,
		notice: null,
		markers: themeMarkers(input, false),
		csvName: promotionsCsvName(context, RULE_DAYS_ID),
	};
}

export const ruleDaysCard: ThemeCardDefinition = {
	id: RULE_DAYS_ID,
	needs: promotionsNeeds.ruleDays,
	visible: () => true,
	build: buildRuleDaysCard,
};
