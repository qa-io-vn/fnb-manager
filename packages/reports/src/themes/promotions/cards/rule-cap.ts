import type { IsoDate } from "../../../contract/values.js";
import type {
	CardModel,
	NoticeModel,
	TableModel,
} from "../../../model/card.js";
import { promotionKindKey, reportKeys } from "../../../model/keys.js";
import { sumMoneyOrNull } from "../../../model/money.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import type { ThemeRow } from "../../contract.js";
import type {
	ThemeCallResults,
	ThemeCardDefinition,
	ThemeCardInput,
} from "../../definition.js";
import { rangeValue, spanValue, themeMarkers } from "../../support.js";
import { promotionsKeys } from "../keys.js";
import {
	type CapPeriod,
	capBases,
	datedBasesValue,
	latestCheck,
	legalBasisValue,
} from "../rules.js";
import {
	complianceCallKey,
	promotionsCsvName,
	promotionsNeeds,
	themeCapPeriods,
} from "../support.js";

export const RULE_CAP_ID = "rule_cap";
export const RULE_CAP_METRIC = "over_cap_promotions";
export const INVOICE_TOTAL_KIND = "invoice_total";

export type ComplianceRow = ThemeRow<"promotion_compliance">;

function earlierDate(left: IsoDate | null, right: IsoDate | null) {
	if (left === null) return right;
	if (right === null) return left;
	return left <= right ? left : right;
}

function laterDate(left: IsoDate | null, right: IsoDate | null) {
	if (left === null) return right;
	if (right === null) return left;
	return left >= right ? left : right;
}

function largerRate(left: number | null, right: number | null) {
	if (left === null) return right;
	if (right === null) return left;
	return Math.max(left, right);
}

function mergedRow(left: ComplianceRow, right: ComplianceRow): ComplianceRow {
	return {
		promotion_kind: left.promotion_kind,
		promotion_key: left.promotion_key,
		promotion_name: left.promotion_name ?? right.promotion_name,
		checked_rows: left.checked_rows + right.checked_rows,
		max_partial_rate: largerRate(left.max_partial_rate, right.max_partial_rate),
		over_cap_rows: left.over_cap_rows + right.over_cap_rows,
		over_cap_discount_amount: sumMoneyOrNull([
			left.over_cap_discount_amount,
			right.over_cap_discount_amount,
		]),
		first_over_cap_on: earlierDate(
			left.first_over_cap_on,
			right.first_over_cap_on,
		),
		last_over_cap_on: laterDate(left.last_over_cap_on, right.last_over_cap_on),
		full_discount_rows: left.full_discount_rows + right.full_discount_rows,
		full_discount_amount: sumMoneyOrNull([
			left.full_discount_amount,
			right.full_discount_amount,
		]),
		first_full_discount_on: earlierDate(
			left.first_full_discount_on,
			right.first_full_discount_on,
		),
		last_full_discount_on: laterDate(
			left.last_full_discount_on,
			right.last_full_discount_on,
		),
	};
}

function codePointOrder(left: string, right: string): number {
	if (left === right) return 0;
	return left < right ? -1 : 1;
}

function isInvoiceTotal(row: ComplianceRow): boolean {
	return row.promotion_kind === INVOICE_TOTAL_KIND;
}

export function complianceRows(
	periods: readonly CapPeriod[],
	results: ThemeCallResults,
): ComplianceRow[] {
	const merged = new Map<string, ComplianceRow>();
	periods.forEach((_period, index) => {
		const rows =
			results.rows(complianceCallKey(index), "promotion_compliance") ?? [];
		for (const row of rows) {
			const id = `${row.promotion_kind}|${row.promotion_key}`;
			const known = merged.get(id);
			merged.set(id, known === undefined ? row : mergedRow(known, row));
		}
	});
	return [...merged.values()].sort(
		(left, right) =>
			Number(isInvoiceTotal(left)) - Number(isInvoiceTotal(right)) ||
			right.over_cap_rows - left.over_cap_rows ||
			codePointOrder(left.promotion_kind, right.promotion_kind) ||
			codePointOrder(left.promotion_key, right.promotion_key),
	);
}

function kindKey(row: ComplianceRow): string {
	return row.promotion_kind === INVOICE_TOTAL_KIND
		? promotionsKeys.ruleCap.invoiceTotal
		: promotionKindKey(row.promotion_kind);
}

function fullKindKey(row: ComplianceRow): string | null {
	if (row.full_discount_rows === 0) return null;
	return row.promotion_kind === "item"
		? promotionsKeys.ruleCap.gift
		: promotionsKeys.ruleCap.freeInvoice;
}

function isVoucher(row: ComplianceRow): boolean {
	return row.promotion_kind === "voucher";
}

export function voucherRows(rows: readonly ComplianceRow[]): ComplianceRow[] {
	return rows.filter(isVoucher);
}

function complianceTable(rows: readonly ComplianceRow[]): TableModel {
	return tableModel({
		captionKey: promotionsKeys.ruleCap.table,
		columns: [
			column("kind", reportKeys.table.promotionKind, "message"),
			column("promotion", reportKeys.table.promotion, "text"),
			column("checked", promotionsKeys.table.checkedRows, "count"),
			column("maxRate", promotionsKeys.table.maxPartialRate, "percent"),
			column("overRows", promotionsKeys.table.overCapRows, "count"),
			column("firstOver", promotionsKeys.table.firstOver, "date"),
			column("lastOver", promotionsKeys.table.lastOver, "date"),
			column("fullKind", promotionsKeys.table.fullKind, "message"),
			column("fullRows", promotionsKeys.table.fullRows, "count"),
			column("firstFull", promotionsKeys.table.firstFull, "date"),
			column("lastFull", promotionsKeys.table.lastFull, "date"),
		],
		rows: rows.map((row) => ({
			id: `${row.promotion_kind}|${row.promotion_key}`,
			cells: {
				kind: kindKey(row),
				promotion: isInvoiceTotal(row) ? null : row.promotion_name,
				checked: row.checked_rows,
				maxRate: row.max_partial_rate,
				overRows: row.over_cap_rows,
				firstOver: row.first_over_cap_on,
				lastOver: row.last_over_cap_on,
				fullKind: fullKindKey(row),
				fullRows: row.full_discount_rows,
				firstFull: row.first_full_discount_on,
				lastFull: row.last_full_discount_on,
			},
		})),
	});
}

function voucherTable(rows: readonly ComplianceRow[]): TableModel {
	return tableModel({
		captionKey: promotionsKeys.ruleCap.voucherTable,
		columns: [
			column("voucher", promotionsKeys.table.voucher, "text"),
			column("checked", promotionsKeys.table.checkedRows, "count"),
			column("maxRate", promotionsKeys.table.maxPartialRate, "percent"),
			column("aboveRows", promotionsKeys.table.aboveCapRows, "count"),
			column("firstAbove", promotionsKeys.table.firstAbove, "date"),
			column("lastAbove", promotionsKeys.table.lastAbove, "date"),
			column("fullRows", promotionsKeys.table.fullRows, "count"),
			column("firstFull", promotionsKeys.table.firstFull, "date"),
			column("lastFull", promotionsKeys.table.lastFull, "date"),
		],
		rows: rows.map((row) => ({
			id: `${row.promotion_kind}|${row.promotion_key}`,
			cells: {
				voucher: row.promotion_name,
				checked: row.checked_rows,
				maxRate: row.max_partial_rate,
				aboveRows: row.over_cap_rows,
				firstAbove: row.first_over_cap_on,
				lastAbove: row.last_over_cap_on,
				fullRows: row.full_discount_rows,
				firstFull: row.first_full_discount_on,
				lastFull: row.last_full_discount_on,
			},
		})),
	});
}

interface FullSummary {
	readonly rows: number;
	readonly first: IsoDate | null;
	readonly last: IsoDate | null;
}

function fullSummary(rows: readonly ComplianceRow[]): FullSummary {
	let summary: FullSummary = { rows: 0, first: null, last: null };
	for (const row of rows) {
		if (row.full_discount_rows === 0) continue;
		summary = {
			rows: summary.rows + row.full_discount_rows,
			first: earlierDate(summary.first, row.first_full_discount_on),
			last: laterDate(summary.last, row.last_full_discount_on),
		};
	}
	return summary;
}

function datesValue(summary: FullSummary): TypedValue {
	const first = summary.first ?? summary.last ?? "";
	const last = summary.last ?? first;
	return first === last
		? textValue("date", first)
		: spanValue({ from: first, to: last });
}

export function giftSummary(rows: readonly ComplianceRow[]): FullSummary {
	return fullSummary(rows.filter((row) => row.promotion_kind === "item"));
}

export function freeInvoiceSummary(
	rows: readonly ComplianceRow[],
): FullSummary {
	const total = rows.find(isInvoiceTotal);
	return fullSummary(
		total === undefined
			? rows.filter(
					(row) =>
						row.promotion_kind === "bill" || row.promotion_kind === "voucher",
				)
			: [total],
	);
}

export function overCapPromotions(
	rows: readonly ComplianceRow[],
): ComplianceRow[] {
	return rows.filter(
		(row) =>
			(row.promotion_kind === "item" || row.promotion_kind === "bill") &&
			row.over_cap_rows > 0,
	);
}

export function vouchersAboveCap(rows: readonly ComplianceRow[]): FullSummary {
	let summary: FullSummary = { rows: 0, first: null, last: null };
	for (const row of voucherRows(rows)) {
		if (row.over_cap_rows === 0) continue;
		summary = {
			rows: summary.rows + row.over_cap_rows,
			first: earlierDate(summary.first, row.first_over_cap_on),
			last: laterDate(summary.last, row.last_over_cap_on),
		};
	}
	return summary;
}

function mainPart(
	input: ThemeCardInput,
	rows: readonly ComplianceRow[],
	cap: number,
): SentencePart {
	const range = rangeValue(input.context);
	const capValue = numberValue("percentExact", cap);
	if (rows.length === 0) {
		return part(promotionsKeys.ruleCap.noDiscount, { range });
	}
	const over = overCapPromotions(rows);
	if (over.length > 0) {
		return part(promotionsKeys.ruleCap.over, {
			count: numberValue("count", over.length),
			cap: capValue,
			range,
			rate: numberValue(
				"percent",
				Math.max(...over.map((row) => row.max_partial_rate ?? cap)),
			),
		});
	}
	const total = rows.find(isInvoiceTotal);
	if (
		total !== undefined &&
		total.over_cap_rows > 0 &&
		voucherRows(rows).length === 0
	) {
		return part(promotionsKeys.ruleCap.overInvoices, {
			cap: capValue,
			range,
			invoices: numberValue("count", total.over_cap_rows),
			rate: numberValue("percent", total.max_partial_rate ?? cap),
		});
	}
	return part(promotionsKeys.ruleCap.none, { cap: capValue, range });
}

function apartParts(
	rows: readonly ComplianceRow[],
	cap: number,
): SentencePart[] {
	const gifts = giftSummary(rows);
	const free = freeInvoiceSummary(rows);
	const vouchers = vouchersAboveCap(rows);
	const full: SentencePart[] = [];
	if (gifts.rows > 0 && free.rows > 0) {
		full.push(
			part(promotionsKeys.ruleCap.giftsAndFree, {
				rows: numberValue("count", gifts.rows),
				giftDates: datesValue(gifts),
				count: numberValue("count", free.rows),
				freeDates: datesValue(free),
			}),
		);
	} else if (gifts.rows > 0) {
		full.push(
			part(promotionsKeys.ruleCap.gifts, {
				rows: numberValue("count", gifts.rows),
				dates: datesValue(gifts),
			}),
		);
	} else if (free.rows > 0) {
		full.push(
			part(promotionsKeys.ruleCap.freeInvoices, {
				count: numberValue("count", free.rows),
				dates: datesValue(free),
			}),
		);
	}
	return [
		...full,
		...(vouchers.rows === 0
			? []
			: [
					part(promotionsKeys.ruleCap.vouchers, {
						count: numberValue("count", vouchers.rows),
						cap: numberValue("percentExact", cap),
						dates: datesValue(vouchers),
					}),
				]),
	];
}

function concentratedNotice(period: CapPeriod): NoticeModel {
	return {
		tone: "info",
		part: part(promotionsKeys.ruleCap.concentrated, {
			basis: legalBasisValue(period.rule.legalBasis),
			rate: numberValue(
				"percentExact",
				period.rule.parameters.concentratedMaxDiscountRate,
			),
			cap: numberValue("percentExact", period.cap),
			checked: textValue("date", period.rule.checkedOn),
		}),
		action: null,
	};
}

export function buildRuleCapCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const periods = themeCapPeriods(context);
	const latest = periods.at(-1);
	const base = {
		id: RULE_CAP_ID,
		titleKey: promotionsKeys.ruleCap.title,
		metricId: RULE_CAP_METRIC,
		relatedMetricIds: [],
		comparisons: [],
		decomposition: null,
		chart: null,
		markers: themeMarkers(input, false),
		csvName: promotionsCsvName(context, RULE_CAP_ID),
	} as const;
	if (latest === undefined) {
		return {
			...base,
			subtitle: null,
			headline: { value: null, unit: "count", caption: null },
			narrative: [
				part(promotionsKeys.ruleCap.noRule, { range: rangeValue(context) }),
			],
			tables: [],
			notice: null,
		};
	}
	const rows = complianceRows(periods, input.results);
	const cap = numberValue("percentExact", latest.cap);
	const bases = capBases(periods);
	const capped = rows.filter((row) => !isVoucher(row));
	const vouchers = voucherRows(rows);
	return {
		...base,
		subtitle: part(promotionsKeys.ruleCap.subtitle, {
			cap,
			basis: datedBasesValue(bases),
			checked: textValue("date", latestCheck(bases)),
		}),
		headline: {
			value: overCapPromotions(rows).length,
			unit: "count",
			caption: part(promotionsKeys.ruleCap.caption, { cap }),
		},
		narrative: [
			mainPart(input, rows, latest.cap),
			...apartParts(rows, latest.cap),
		],
		tables: [
			...(capped.length === 0 ? [] : [complianceTable(capped)]),
			...(vouchers.length === 0 ? [] : [voucherTable(vouchers)]),
		],
		notice: concentratedNotice(latest),
	};
}

export const ruleCapCard: ThemeCardDefinition = {
	id: RULE_CAP_ID,
	needs: promotionsNeeds.ruleCap,
	visible: () => true,
	build: buildRuleCapCard,
};
