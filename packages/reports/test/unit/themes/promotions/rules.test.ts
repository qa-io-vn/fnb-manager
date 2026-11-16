import { type PromotionRule, promotionRules } from "@fnb/core";
import { describe, expect, it } from "vitest";
import type { CardModel } from "../../../../src/model/card.js";
import type { SentencePart, TypedValue } from "../../../../src/model/values.js";
import type { ThemeContext } from "../../../../src/themes/context.js";
import type { ThemeCallResults } from "../../../../src/themes/definition.js";
import {
	buildCatalogueCard,
	CATALOGUE_UNUSED_DAYS,
} from "../../../../src/themes/promotions/cards/catalogue.js";
import {
	buildRuleCapCard,
	complianceRows,
} from "../../../../src/themes/promotions/cards/rule-cap.js";
import {
	buildRuleDaysCard,
	RULE_DAYS_TABLE_ROWS,
} from "../../../../src/themes/promotions/cards/rule-days.js";
import { promotionsTheme } from "../../../../src/themes/promotions/definition.js";
import { promotionsKeys } from "../../../../src/themes/promotions/keys.js";
import {
	capPeriods,
	discountDaysPlan,
	legalBasisValue,
	needsDaysUnderRule,
} from "../../../../src/themes/promotions/rules.js";
import {
	complianceCallKey,
	promotionsCalls,
} from "../../../../src/themes/promotions/support.js";
import { customRange } from "../../../../src/themes/range.js";
import { coverageRow, STORE_A } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import {
	cardInput,
	catalogueRow,
	complianceRow,
	discountDaysRow,
} from "./support.js";

const VN = promotionRules("VN");
const CHECKED_ON = "2026-11-12";
const LAST_DAY_OF_THE_LIMIT = "2026-06-25";
const REPEAL_DATE = "2026-06-26";

function endingOn(asOf: string, from?: string): ThemeContext {
	const context = themeContext("28d", [STORE_A], { asOf });
	return from === undefined
		? context
		: { ...context, range: customRange(from, asOf, asOf) };
}

function build(
	builder: (input: ReturnType<typeof cardInput>) => CardModel,
	context: ThemeContext,
	calls: Readonly<Record<string, readonly unknown[]>>,
): CardModel {
	return builder(cardInput(context, calls, [coverageRow(STORE_A)]));
}

function keys(card: CardModel): string[] {
	return card.narrative.map((sentence) => sentence.key);
}

function sentence(card: CardModel, key: string): SentencePart {
	const found = card.narrative.find((entry) => entry.key === key);
	if (found === undefined) throw new Error(`no ${key} in ${card.id}`);
	return found;
}

function nested(value: TypedValue | undefined): SentencePart {
	if (value?.kind !== "part") throw new Error("not a nested sentence");
	return value.value;
}

function span(from: string, to: string): TypedValue {
	return {
		kind: "part",
		value: {
			key: "theme.range.span",
			values: {
				from: { kind: "date", value: from },
				to: { kind: "date", value: to },
			},
		},
	};
}

function callArgs(context: ThemeContext, key: string): unknown {
	return promotionsTheme.primaryCalls(context).find((call) => call.key === key)
		?.args;
}

function capRule(
	validFrom: string,
	validTo: string | null,
	maxDiscountRate: number,
): PromotionRule {
	return {
		id: "discount_cap",
		countryCode: "XX",
		validFrom,
		validTo,
		parameters: { maxDiscountRate, concentratedMaxDiscountRate: 1 },
		legalBasis: {
			instrument: "circular",
			number: "1/2030/TT-BCT",
			articles: [1],
		},
		sources: [{ title: "Synthetic", url: "https://example.com/rule" }],
		checkedOn: "2030-01-01",
		legalWatch: false,
		notes: [{ en: "Synthetic rule.", vi: "Quy định giả lập." }],
	};
}

function daysRule(validFrom: string, validTo: string | null): PromotionRule {
	return {
		id: "discount_days",
		countryCode: "XX",
		validFrom,
		validTo,
		parameters: { maxDaysPerItemYear: 90, counts: "price_discounts" },
		legalBasis: { instrument: "decree", number: "2/2030/NĐ-CP", articles: [3] },
		sources: [{ title: "Synthetic", url: "https://example.com/days" }],
		checkedOn: "2030-01-01",
		legalWatch: false,
		notes: [{ en: "Synthetic rule.", vi: "Quy định giả lập." }],
	};
}

describe("the rule calls of Khuyến mãi", () => {
	it("asks for the catalogue on the last day, the compliance with the cap in force and the discount days of the year of the range's end", () => {
		const context = endingOn("2026-11-06");
		expect(callArgs(context, promotionsCalls.catalogue)).toEqual({
			store_ids: [STORE_A],
			as_of_date: "2026-11-06",
		});
		expect(callArgs(context, complianceCallKey(0))).toEqual({
			store_ids: [STORE_A],
			from_date: context.range.from,
			to_date: "2026-11-06",
			cap_rate: 0.5,
		});
		expect(callArgs(context, complianceCallKey(1))).toBeUndefined();
		expect(callArgs(context, promotionsCalls.discountDays)).toEqual({
			store_ids: [STORE_A],
			calendar_year: 2026,
			as_of_date: "2026-11-06",
		});
		expect(callArgs(context, promotionsCalls.discountDaysUnderRule)).toEqual({
			store_ids: [STORE_A],
			calendar_year: 2026,
			as_of_date: LAST_DAY_OF_THE_LIMIT,
		});
	});

	it("plans the second discount-day call only when the constants end the limit inside the year and the range ends after its last day", () => {
		expect(
			callArgs(
				endingOn(LAST_DAY_OF_THE_LIMIT),
				promotionsCalls.discountDaysUnderRule,
			),
		).toBeUndefined();
		expect(
			callArgs(endingOn(REPEAL_DATE), promotionsCalls.discountDaysUnderRule),
		).toMatchObject({ as_of_date: LAST_DAY_OF_THE_LIMIT });
		expect(
			callArgs(endingOn("2025-12-31"), promotionsCalls.discountDaysUnderRule),
		).toBeUndefined();
		const synthetic = [daysRule("2020-01-01", "2030-03-31")];
		const inside = discountDaysPlan(synthetic, "2030-05-01");
		expect(needsDaysUnderRule(inside)).toBe(true);
		expect(inside.underRule?.to).toBe("2030-03-31");
		expect(inside.inForce).toBeNull();
		expect(inside.ended?.validTo).toBe("2030-03-31");
		const after = discountDaysPlan(synthetic, "2031-02-01");
		expect(needsDaysUnderRule(after)).toBe(false);
		expect(after.underRule).toBeNull();
		expect(after.ended?.validTo).toBe("2030-03-31");
		const open = discountDaysPlan([daysRule("2020-01-01", null)], "2031-02-01");
		expect(needsDaysUnderRule(open)).toBe(false);
		expect(open.inForce?.validTo).toBeNull();
		expect(discountDaysPlan([], "2031-02-01")).toMatchObject({
			inForce: null,
			ended: null,
			underRule: null,
		});
	});

	it("keeps one compliance call across the repeal and the circular's start, and splits it where the cap changes", () => {
		expect(
			capPeriods(VN, { from: "2026-06-01", to: "2026-07-31" }).map((period) => [
				period.from,
				period.to,
				period.cap,
			]),
		).toEqual([["2026-06-01", "2026-07-31", 0.5]]);
		const handover = capPeriods(VN, { from: "2025-06-01", to: "2025-07-10" });
		expect(handover.map((period) => [period.from, period.to])).toEqual([
			["2025-06-01", "2025-07-10"],
		]);
		expect(handover[0]?.rule.legalBasis.number).toBe("39/2025/TT-BCT");
		expect(
			handover[0]?.segments.map((segment) => [
				segment.from,
				segment.to,
				segment.rule.legalBasis.number,
			]),
		).toEqual([
			["2025-06-01", "2025-06-30", "81/2018/NĐ-CP"],
			["2025-07-01", "2025-07-10", "39/2025/TT-BCT"],
		]);
		expect(
			capPeriods(
				[
					capRule("2030-01-01", "2030-01-15", 0.4),
					capRule("2030-01-16", null, 0.3),
				],
				{ from: "2029-12-25", to: "2030-01-31" },
			).map((period) => [period.from, period.to, period.cap]),
		).toEqual([
			["2030-01-01", "2030-01-15", 0.4],
			["2030-01-16", "2030-01-31", 0.3],
		]);
	});

	it("adds up the rows of two cap periods per promotion and keeps the whole invoice last", () => {
		const periods = capPeriods(
			[
				capRule("2030-01-01", "2030-01-15", 0.4),
				capRule("2030-01-16", null, 0.3),
			],
			{ from: "2030-01-01", to: "2030-01-31" },
		);
		const answered: Record<string, readonly unknown[]> = {
			[complianceCallKey(0)]: [
				complianceRow({
					over_cap_rows: 2,
					max_partial_rate: 0.45,
					over_cap_discount_amount: 20_000,
					first_over_cap_on: "2030-01-03",
					last_over_cap_on: "2030-01-09",
				}),
				complianceRow({
					promotion_kind: "invoice_total",
					promotion_key: "all",
					promotion_name: null,
					checked_rows: 100,
				}),
			],
			[complianceCallKey(1)]: [
				complianceRow({
					promotion_kind: "invoice_total",
					promotion_key: "all",
					promotion_name: null,
					checked_rows: 80,
					full_discount_rows: 1,
					first_full_discount_on: "2030-01-20",
					last_full_discount_on: "2030-01-20",
				}),
				complianceRow({
					over_cap_rows: 1,
					max_partial_rate: 0.35,
					over_cap_discount_amount: 5_000,
					first_over_cap_on: "2030-01-18",
					last_over_cap_on: "2030-01-18",
				}),
				complianceRow({ promotion_kind: "bill", promotion_key: "Giảm 5%" }),
			],
		};
		const results: ThemeCallResults = {
			rows: (key: string) => answered[key] as never,
		};
		const rows = complianceRows(periods, results);
		expect(rows.map((row) => row.promotion_kind)).toEqual([
			"item",
			"bill",
			"invoice_total",
		]);
		expect(rows[0]).toMatchObject({
			checked_rows: 80,
			over_cap_rows: 3,
			max_partial_rate: 0.45,
			over_cap_discount_amount: 25_000,
			first_over_cap_on: "2030-01-03",
			last_over_cap_on: "2030-01-18",
		});
		expect(rows[2]).toMatchObject({
			checked_rows: 180,
			full_discount_rows: 1,
			first_full_discount_on: "2030-01-20",
		});
	});
});

describe("the Mức giảm tối đa card", () => {
	const context = endingOn("2026-11-06");

	it("counts a 60 % line and a 60 % bill over the cap, names gifts and free invoices apart with their dates, and keeps the whole invoice last", () => {
		const card = build(buildRuleCapCard, context, {
			[complianceCallKey(0)]: [
				complianceRow({
					promotion_kind: "voucher",
					promotion_key: "Voucher 20k",
					promotion_name: "Voucher 20k",
					max_partial_rate: 0.3,
				}),
				complianceRow({
					promotion_kind: "invoice_total",
					promotion_key: "all",
					promotion_name: null,
					checked_rows: 300,
					max_partial_rate: 0.62,
					over_cap_rows: 6,
					first_over_cap_on: "2026-10-10",
					last_over_cap_on: "2026-10-20",
					full_discount_rows: 2,
					full_discount_amount: 180_000,
					first_full_discount_on: "2026-10-18",
					last_full_discount_on: "2026-10-30",
				}),
				complianceRow({
					promotion_key: "TANG-01",
					promotion_name: "Tặng bánh",
					checked_rows: 5,
					max_partial_rate: null,
					full_discount_rows: 5,
					full_discount_amount: 125_000,
					first_full_discount_on: "2026-10-15",
					last_full_discount_on: "2026-11-01",
				}),
				complianceRow({
					promotion_name: "Giảm 60% món",
					checked_rows: 10,
					max_partial_rate: 0.6,
					over_cap_rows: 3,
					first_over_cap_on: "2026-10-12",
					last_over_cap_on: "2026-10-20",
				}),
				complianceRow({
					promotion_kind: "bill",
					promotion_key: "Giảm 60% hóa đơn",
					promotion_name: "Giảm 60% hóa đơn",
					checked_rows: 4,
					max_partial_rate: 0.6,
					over_cap_rows: 4,
					first_over_cap_on: "2026-10-10",
					last_over_cap_on: "2026-10-11",
				}),
			],
		});
		expect(card.id).toBe("rule_cap");
		expect(card.metricId).toBe("over_cap_promotions");
		expect(card.headline).toEqual({
			value: 2,
			unit: "count",
			caption: {
				key: promotionsKeys.ruleCap.caption,
				values: { cap: { kind: "percentExact", value: 0.5 } },
			},
		});
		expect(keys(card)).toEqual([
			promotionsKeys.ruleCap.over,
			promotionsKeys.ruleCap.giftsAndFree,
		]);
		expect(sentence(card, promotionsKeys.ruleCap.over).values).toMatchObject({
			count: { kind: "count", value: 2 },
			cap: { kind: "percentExact", value: 0.5 },
			rate: { kind: "percent", value: 0.6 },
		});
		expect(sentence(card, promotionsKeys.ruleCap.giftsAndFree).values).toEqual({
			rows: { kind: "count", value: 5 },
			giftDates: span("2026-10-15", "2026-11-01"),
			count: { kind: "count", value: 2 },
			freeDates: span("2026-10-18", "2026-10-30"),
		});
		const single = build(buildRuleCapCard, context, {
			[complianceCallKey(0)]: [
				complianceRow({
					promotion_kind: "invoice_total",
					promotion_key: "all",
					promotion_name: null,
					full_discount_rows: 1,
					first_full_discount_on: "2026-10-22",
					last_full_discount_on: "2026-10-22",
				}),
			],
		});
		expect(
			sentence(single, promotionsKeys.ruleCap.freeInvoices).values.dates,
		).toEqual({ kind: "date", value: "2026-10-22" });
		const giftsOnly = build(buildRuleCapCard, context, {
			[complianceCallKey(0)]: [
				complianceRow({
					max_partial_rate: null,
					full_discount_rows: 2,
					first_full_discount_on: "2026-10-03",
					last_full_discount_on: "2026-10-05",
				}),
			],
		});
		expect(keys(giftsOnly)).toEqual([
			promotionsKeys.ruleCap.none,
			promotionsKeys.ruleCap.gifts,
		]);
		const table = card.tables[0];
		expect(
			table?.rows.map((row) => [row.cells.kind, row.cells.promotion]),
		).toEqual([
			["report.promotionKind.bill", "Giảm 60% hóa đơn"],
			["report.promotionKind.item", "Giảm 60% món"],
			["report.promotionKind.item", "Tặng bánh"],
			[promotionsKeys.ruleCap.invoiceTotal, null],
		]);
		expect(card.tables[1]?.captionKey).toBe(
			promotionsKeys.ruleCap.voucherTable,
		);
		expect(card.tables[1]?.rows.map((row) => row.cells.voucher)).toEqual([
			"Voucher 20k",
		]);
		expect(table?.rows[2]?.cells).toMatchObject({
			overRows: 0,
			fullKind: promotionsKeys.ruleCap.gift,
			fullRows: 5,
			firstFull: "2026-10-15",
			lastFull: "2026-11-01",
		});
		expect(table?.rows[0]?.cells.fullKind).toBeNull();
		expect(table?.rows[3]?.cells).toMatchObject({
			fullKind: promotionsKeys.ruleCap.freeInvoice,
			overRows: 6,
		});
		expect(table?.initialSort).toBeNull();
		expect(card.csvName).toBe(
			`khuyen-mai-rule_cap-${context.range.from}_${context.range.to}`,
		);
	});

	it("names the basis and the check date in the subtitle and the state-run concentrated programmes in a note", () => {
		const card = build(buildRuleCapCard, context, {
			[complianceCallKey(0)]: [complianceRow()],
		});
		expect(card.subtitle?.key).toBe(promotionsKeys.ruleCap.subtitle);
		expect(card.subtitle?.values.cap).toEqual({
			kind: "percentExact",
			value: 0.5,
		});
		expect(card.subtitle?.values.checked).toEqual({
			kind: "date",
			value: CHECKED_ON,
		});
		const basis = nested(card.subtitle?.values.basis);
		expect(basis.key).toBe(promotionsKeys.rules.basisOne);
		expect(basis.values.article).toEqual({ kind: "text", value: "4" });
		expect(nested(basis.values.instrument)).toEqual({
			key: promotionsKeys.rules.instrument.circular,
			values: { number: { kind: "text", value: "39/2025/TT-BCT" } },
		});
		expect(card.notice).toEqual({
			tone: "info",
			part: {
				key: promotionsKeys.ruleCap.concentrated,
				values: {
					basis: card.subtitle?.values.basis,
					rate: { kind: "percentExact", value: 1 },
					cap: { kind: "percentExact", value: 0.5 },
					checked: { kind: "date", value: CHECKED_ON },
				},
			},
			action: null,
		});
		const before = build(buildRuleCapCard, endingOn("2025-06-30"), {
			[complianceCallKey(0)]: [complianceRow()],
		});
		expect(
			nested(nested(before.subtitle?.values.basis).values.instrument).values
				.number,
		).toEqual({ kind: "text", value: "81/2018/NĐ-CP" });
	});

	it("names both instruments with their dates in the subtitle when a range spans the circular's start", () => {
		const card = build(buildRuleCapCard, endingOn("2025-07-10", "2025-06-01"), {
			[complianceCallKey(0)]: [complianceRow()],
		});
		expect(
			callArgs(endingOn("2025-07-10", "2025-06-01"), complianceCallKey(1)),
		).toBeUndefined();
		const list = nested(card.subtitle?.values.basis);
		expect(list.key).toBe(promotionsKeys.rules.basisList);
		const first = nested(list.values.first);
		const rest = nested(list.values.rest);
		expect([first.key, rest.key]).toEqual([
			promotionsKeys.rules.basisDuring,
			promotionsKeys.rules.basisDuring,
		]);
		expect(first.values.dates).toEqual(span("2025-06-01", "2025-06-30"));
		expect(rest.values.dates).toEqual(span("2025-07-01", "2025-07-10"));
		expect(
			[first, rest].map(
				(entry) =>
					nested(nested(entry.values.basis).values.instrument).values.number,
			),
		).toEqual([
			{ kind: "text", value: "81/2018/NĐ-CP" },
			{ kind: "text", value: "39/2025/TT-BCT" },
		]);
		expect(nested(first.values.basis).values.article).toEqual({
			kind: "text",
			value: "7",
		});
		expect(card.subtitle?.values.checked).toEqual({
			kind: "date",
			value: CHECKED_ON,
		});
	});

	it("lists vouchers apart from the cap with their own sentence and table, and leaves the whole-invoice count to the table while a voucher was used", () => {
		const card = build(buildRuleCapCard, context, {
			[complianceCallKey(0)]: [
				complianceRow({
					promotion_kind: "voucher",
					promotion_key: "Voucher 20k",
					promotion_name: "Voucher 20k",
					checked_rows: 155,
					max_partial_rate: 0.666667,
					over_cap_rows: 6,
					first_over_cap_on: "2026-10-17",
					last_over_cap_on: "2026-11-01",
				}),
				complianceRow({ max_partial_rate: 0.1 }),
				complianceRow({
					promotion_kind: "invoice_total",
					promotion_key: "all",
					promotion_name: null,
					max_partial_rate: 0.666667,
					over_cap_rows: 6,
				}),
			],
		});
		expect(card.headline.value).toBe(0);
		expect(keys(card)).toEqual([
			promotionsKeys.ruleCap.none,
			promotionsKeys.ruleCap.vouchers,
		]);
		expect(sentence(card, promotionsKeys.ruleCap.vouchers).values).toEqual({
			count: { kind: "count", value: 6 },
			cap: { kind: "percentExact", value: 0.5 },
			dates: span("2026-10-17", "2026-11-01"),
		});
		expect(card.tables.map((table) => table.captionKey)).toEqual([
			promotionsKeys.ruleCap.table,
			promotionsKeys.ruleCap.voucherTable,
		]);
		expect(card.tables[0]?.rows.map((row) => row.cells.kind)).toEqual([
			"report.promotionKind.item",
			promotionsKeys.ruleCap.invoiceTotal,
		]);
		expect(card.tables[1]?.rows[0]?.cells).toMatchObject({
			voucher: "Voucher 20k",
			checked: 155,
			aboveRows: 6,
			firstAbove: "2026-10-17",
			lastAbove: "2026-11-01",
		});
	});

	it("names gift lines and a fully free invoice in one sentence apart from the cap, with their table labels, when nothing went over it", () => {
		const card = build(buildRuleCapCard, context, {
			[complianceCallKey(0)]: [
				complianceRow({
					max_partial_rate: null,
					full_discount_rows: 3,
					first_full_discount_on: "2026-10-20",
					last_full_discount_on: "2026-10-20",
				}),
				complianceRow({
					promotion_kind: "bill",
					promotion_key: "Mời khách",
					promotion_name: "Mời khách",
					max_partial_rate: null,
					full_discount_rows: 1,
					first_full_discount_on: "2026-10-22",
					last_full_discount_on: "2026-10-22",
				}),
				complianceRow({
					promotion_kind: "invoice_total",
					promotion_key: "all",
					promotion_name: null,
					max_partial_rate: 0.1,
					full_discount_rows: 1,
					first_full_discount_on: "2026-10-22",
					last_full_discount_on: "2026-10-22",
				}),
			],
		});
		expect(card.headline.value).toBe(0);
		expect(keys(card)).toEqual([
			promotionsKeys.ruleCap.none,
			promotionsKeys.ruleCap.giftsAndFree,
		]);
		expect(
			sentence(card, promotionsKeys.ruleCap.giftsAndFree).values,
		).toMatchObject({
			giftDates: { kind: "date", value: "2026-10-20" },
			freeDates: { kind: "date", value: "2026-10-22" },
		});
		expect(
			card.tables[0]?.rows.map((row) => [
				row.cells.overRows,
				row.cells.fullKind,
			]),
		).toEqual([
			[0, promotionsKeys.ruleCap.freeInvoice],
			[0, promotionsKeys.ruleCap.gift],
			[0, promotionsKeys.ruleCap.freeInvoice],
		]);
	});

	it("names the invoices over the cap when no single promotion is, and says when there was nothing to check", () => {
		const invoices = build(buildRuleCapCard, context, {
			[complianceCallKey(0)]: [
				complianceRow({ max_partial_rate: 0.3 }),
				complianceRow({
					promotion_kind: "invoice_total",
					promotion_key: "all",
					promotion_name: null,
					max_partial_rate: 0.55,
					over_cap_rows: 2,
				}),
			],
		});
		expect(invoices.headline.value).toBe(0);
		expect(keys(invoices)).toEqual([promotionsKeys.ruleCap.overInvoices]);
		expect(invoices.narrative[0]?.values).toMatchObject({
			invoices: { kind: "count", value: 2 },
			rate: { kind: "percent", value: 0.55 },
		});
		const empty = build(buildRuleCapCard, context, {
			[complianceCallKey(0)]: [],
		});
		expect(empty.headline.value).toBe(0);
		expect(keys(empty)).toEqual([promotionsKeys.ruleCap.noDiscount]);
		expect(empty.tables).toEqual([]);
	});
});

describe("the Số ngày giảm giá bán trong năm card", () => {
	it("reads the limit in force up to 25/06/2026, calls out an item over 120 price-discount days and shows gift and voucher days beside them", () => {
		const context = endingOn(LAST_DAY_OF_THE_LIMIT);
		const card = build(buildRuleDaysCard, context, {
			[promotionsCalls.discountDays]: [
				discountDaysRow({
					item_external_id: "CF-01",
					item_name: "Cà phê sữa",
					price_discount_days: 121,
					line_price_discount_days: 100,
					bill_discount_days: 30,
					gift_days: 20,
					voucher_days: 50,
				}),
				discountDaysRow({
					item_external_id: "TS-01",
					item_name: "Trà sữa",
					price_discount_days: 100,
					line_price_discount_days: 90,
					bill_discount_days: 20,
					gift_days: 60,
					voucher_days: 80,
				}),
			],
		});
		expect(card.metricId).toBe("discount_days");
		expect(card.headline).toEqual({
			value: 121,
			unit: "count",
			caption: {
				key: promotionsKeys.ruleDays.caption,
				values: {
					year: { kind: "year", value: "2026" },
					item: { kind: "text", value: "Cà phê sữa" },
				},
			},
		});
		expect(keys(card)).toEqual([
			promotionsKeys.ruleDays.limit,
			promotionsKeys.ruleDays.over,
			promotionsKeys.ruleDays.basis,
		]);
		const limit = sentence(card, promotionsKeys.ruleDays.limit);
		expect(limit.values.limit).toEqual({ kind: "count", value: 120 });
		expect(limit.values.checked).toEqual({ kind: "date", value: CHECKED_ON });
		expect(
			nested(nested(limit.values.basis).values.instrument).values.number,
		).toEqual({ kind: "text", value: "81/2018/NĐ-CP" });
		expect(sentence(card, promotionsKeys.ruleDays.over).values).toEqual({
			count: { kind: "count", value: 1 },
			limit: { kind: "count", value: 120 },
			dates: span("2026-01-01", LAST_DAY_OF_THE_LIMIT),
			item: { kind: "text", value: "Cà phê sữa" },
			days: { kind: "count", value: 121 },
		});
		expect(card.tables[0]?.rows[1]?.cells).toEqual({
			item: "Trà sữa",
			priceDays: 100,
			lineDays: 90,
			billDays: 20,
			giftDays: 60,
			voucherDays: 80,
			firstPrice: "2026-01-05",
			lastPrice: "2026-06-20",
		});
	});

	it("labels the count information only from 26/06/2026 with the reported repeal, and judges the limit on the days up to 25/06/2026 only", () => {
		const context = endingOn(REPEAL_DATE);
		const card = build(buildRuleDaysCard, context, {
			[promotionsCalls.discountDays]: [
				discountDaysRow({
					item_external_id: "CT-01",
					item_name: "Cà phê trứng",
					price_discount_days: 125,
				}),
				discountDaysRow({ price_discount_days: 121 }),
			],
			[promotionsCalls.discountDaysUnderRule]: [
				discountDaysRow({
					item_external_id: "CT-01",
					item_name: "Cà phê trứng",
					price_discount_days: 124,
				}),
				discountDaysRow({ price_discount_days: 120 }),
			],
		});
		expect(card.headline.value).toBe(125);
		expect(card.headline.caption?.key).toBe(
			promotionsKeys.ruleDays.captionInfo,
		);
		expect(keys(card)).toEqual([
			promotionsKeys.ruleDays.repealed,
			promotionsKeys.ruleDays.over,
			promotionsKeys.ruleDays.basis,
		]);
		const repealed = sentence(card, promotionsKeys.ruleDays.repealed);
		expect(repealed.values.from).toEqual({ kind: "date", value: REPEAL_DATE });
		expect(repealed.values.limit).toEqual({ kind: "count", value: 120 });
		expect(repealed.values.checked).toEqual({
			kind: "date",
			value: CHECKED_ON,
		});
		expect(nested(repealed.values.basis).values.article).toEqual({
			kind: "text",
			value: "10",
		});
		expect(sentence(card, promotionsKeys.ruleDays.over).values).toMatchObject({
			count: { kind: "count", value: 1 },
			item: { kind: "text", value: "Cà phê trứng" },
			days: { kind: "count", value: 124 },
			dates: span("2026-01-01", LAST_DAY_OF_THE_LIMIT),
		});
	});

	it("does not call out an item over 120 only when the days after 25/06/2026 are counted", () => {
		const card = build(buildRuleDaysCard, endingOn("2026-11-06"), {
			[promotionsCalls.discountDays]: [
				discountDaysRow({ price_discount_days: 150 }),
			],
			[promotionsCalls.discountDaysUnderRule]: [
				discountDaysRow({ price_discount_days: 110 }),
			],
		});
		expect(card.headline.value).toBe(150);
		expect(keys(card)).toEqual([
			promotionsKeys.ruleDays.repealed,
			promotionsKeys.ruleDays.noneOver,
			promotionsKeys.ruleDays.basis,
		]);
	});

	it("never adds gift or voucher days to the price-discount days", () => {
		const card = build(buildRuleDaysCard, endingOn(LAST_DAY_OF_THE_LIMIT), {
			[promotionsCalls.discountDays]: [
				discountDaysRow({
					price_discount_days: 60,
					gift_days: 100,
					voucher_days: 100,
				}),
				discountDaysRow({
					item_external_id: "BN-01",
					item_name: "Bánh",
					price_discount_days: 0,
					line_price_discount_days: 0,
					bill_discount_days: 0,
					gift_days: 170,
					first_price_discount_on: null,
					last_price_discount_on: null,
				}),
			],
		});
		expect(card.headline.value).toBe(60);
		expect(keys(card)).toContain(promotionsKeys.ruleDays.noneOver);
	});

	it("says when no item was discounted, keeps the information label without an item and shows the top 30 items only", () => {
		const empty = build(buildRuleDaysCard, endingOn("2026-11-06"), {
			[promotionsCalls.discountDays]: [],
			[promotionsCalls.discountDaysUnderRule]: [],
		});
		expect(empty.headline).toMatchObject({ value: 0 });
		expect(empty.headline.caption?.key).toBe(
			promotionsKeys.ruleDays.captionYearInfo,
		);
		expect(keys(empty)).toEqual([
			promotionsKeys.ruleDays.repealed,
			promotionsKeys.ruleDays.none,
			promotionsKeys.ruleDays.basis,
		]);
		expect(empty.narrative[1]?.values.dates).toEqual(
			span("2026-01-01", "2026-11-06"),
		);
		expect(empty.tables).toEqual([]);
		const many = build(buildRuleDaysCard, endingOn(LAST_DAY_OF_THE_LIMIT), {
			[promotionsCalls.discountDays]: Array.from({ length: 35 }, (_, index) =>
				discountDaysRow({
					item_external_id: `M-${index}`,
					price_discount_days: 50 - index,
				}),
			),
		});
		expect(many.tables[0]?.rows).toHaveLength(RULE_DAYS_TABLE_ROWS);
		expect(many.tables[0]?.previewRows).toBe(10);
	});

	it("states the limit without a count for a year before 2023, which is never asked for", () => {
		const context = endingOn("2022-12-31");
		expect(callArgs(context, promotionsCalls.discountDays)).toBeUndefined();
		expect(
			callArgs(context, promotionsCalls.discountDaysUnderRule),
		).toBeUndefined();
		const card = build(buildRuleDaysCard, context, {});
		expect(keys(card)).toEqual([
			promotionsKeys.ruleDays.limit,
			promotionsKeys.ruleDays.basis,
		]);
		expect(card.tables).toEqual([]);
	});

	it("drops the over-the-limit sentence for a year that starts after the limit ended", () => {
		const context = endingOn("2027-03-01");
		expect(
			callArgs(context, promotionsCalls.discountDaysUnderRule),
		).toBeUndefined();
		const card = build(buildRuleDaysCard, context, {
			[promotionsCalls.discountDays]: [
				discountDaysRow({ price_discount_days: 30 }),
			],
		});
		expect(keys(card)).toEqual([
			promotionsKeys.ruleDays.repealed,
			promotionsKeys.ruleDays.basis,
		]);
	});
});

describe("the Danh mục khuyến mãi card", () => {
	const context = endingOn("2026-11-06");

	it("counts the promotions used in the range and the active catalogue promotions unused for more than 90 days", () => {
		const card = build(buildCatalogueCard, context, {
			[promotionsCalls.catalogue]: [
				catalogueRow({ last_used_on: "2026-11-02" }),
				catalogueRow({
					promotion_kind: "bill",
					promotion_key: "Giảm 5% hóa đơn",
					promotion_name: "Giảm 5% hóa đơn",
					in_catalogue: false,
					catalogue_active: null,
					last_used_on: "2026-10-15",
				}),
				catalogueRow({
					promotion_key: "KM-02",
					promotion_name: "Combo sáng",
					last_used_on: "2026-08-07",
				}),
				catalogueRow({
					promotion_key: "KM-03",
					promotion_name: "Combo trưa",
					last_used_on: "2026-08-08",
				}),
				catalogueRow({
					promotion_key: "KM-04",
					promotion_name: "Combo tối",
					first_used_on: null,
					last_used_on: null,
					days_used_365: 0,
					discount_365: 0,
				}),
				catalogueRow({
					promotion_key: "KM-05",
					promotion_name: "Tết 2025",
					catalogue_active: false,
					first_used_on: null,
					last_used_on: null,
				}),
			],
		});
		expect(card.id).toBe("catalogue");
		expect(card.metricId).toBe("promotions_used");
		expect(card.headline.value).toBe(2);
		expect(keys(card)).toEqual([
			promotionsKeys.catalogue.used,
			promotionsKeys.catalogue.stale,
		]);
		expect(card.narrative[1]?.values).toEqual({
			count: { kind: "count", value: 2 },
			days: { kind: "count", value: CATALOGUE_UNUSED_DAYS },
			date: { kind: "date", value: "2026-11-06" },
		});
		expect(
			card.tables[0]?.rows.map((row) => [
				row.cells.inCatalogue,
				row.cells.active,
			]),
		).toEqual([
			[promotionsKeys.catalogue.listed, promotionsKeys.catalogue.active],
			[promotionsKeys.catalogue.unlisted, null],
			[promotionsKeys.catalogue.listed, promotionsKeys.catalogue.active],
			[promotionsKeys.catalogue.listed, promotionsKeys.catalogue.active],
			[promotionsKeys.catalogue.listed, promotionsKeys.catalogue.active],
			[promotionsKeys.catalogue.listed, promotionsKeys.catalogue.inactive],
		]);
		expect(card.notice).toBeNull();
	});

	it("says when no promotion was used, when every active one was used recently and when the catalogue has none", () => {
		const recent = build(buildCatalogueCard, context, {
			[promotionsCalls.catalogue]: [
				catalogueRow({ last_used_on: "2026-09-01" }),
			],
		});
		expect(keys(recent)).toEqual([
			promotionsKeys.catalogue.none,
			promotionsKeys.catalogue.allRecent,
		]);
		const empty = build(buildCatalogueCard, context, {
			[promotionsCalls.catalogue]: [],
		});
		expect(empty.headline.value).toBe(0);
		expect(keys(empty)).toEqual([
			promotionsKeys.catalogue.none,
			promotionsKeys.catalogue.noCatalogue,
		]);
		expect(empty.tables).toEqual([]);
	});

	it("warns about a lucky-draw keyword in the name of a used or active promotion, with the rule's articles and source date", () => {
		const card = build(buildCatalogueCard, context, {
			[promotionsCalls.catalogue]: [
				catalogueRow({ promotion_name: "Bốc thăm trúng thưởng T11" }),
				catalogueRow({
					promotion_kind: "bill",
					promotion_key: "QUAY SO MAY MAN",
					promotion_name: "QUAY SO MAY MAN",
					in_catalogue: false,
					catalogue_active: null,
					last_used_on: "2026-10-20",
				}),
				catalogueRow({
					promotion_key: "KM-09",
					promotion_name: "Vòng quay may mắn 2024",
					catalogue_active: false,
					last_used_on: "2024-12-31",
				}),
			],
		});
		const notice = card.notice;
		expect(notice?.tone).toBe("warning");
		expect(notice?.part.key).toBe(promotionsKeys.catalogue.luckyDraw);
		expect(notice?.part.values.checked).toEqual({
			kind: "date",
			value: CHECKED_ON,
		});
		const basis = nested(notice?.part.values.basis);
		expect(basis).toMatchObject({
			key: promotionsKeys.rules.basisMany,
			values: {
				articles: { kind: "text", value: "13" },
				last: { kind: "text", value: "19" },
			},
		});
		expect(nested(basis.values.instrument).key).toBe(
			promotionsKeys.rules.instrument.decree,
		);
		const matches = nested(notice?.part.values.matches);
		expect(matches.key).toBe(promotionsKeys.catalogue.luckyDrawMore);
		expect(matches.values.others).toEqual({ kind: "count", value: 1 });
		expect(nested(matches.values.first)).toEqual({
			key: promotionsKeys.catalogue.luckyDrawMatch,
			values: {
				promotion: { kind: "text", value: "Bốc thăm trúng thưởng T11" },
				keyword: { kind: "text", value: "bốc thăm" },
			},
		});
	});

	it("reports a name without tone marks as a possible match and stays quiet without a keyword", () => {
		const possible = build(buildCatalogueCard, context, {
			[promotionsCalls.catalogue]: [
				catalogueRow({ promotion_name: "CT_BOC_THAM_T11" }),
			],
		});
		expect(nested(possible.notice?.part.values.matches)).toEqual({
			key: promotionsKeys.catalogue.luckyDrawPossible,
			values: {
				promotion: { kind: "text", value: "CT_BOC_THAM_T11" },
				keyword: { kind: "text", value: "bốc thăm" },
			},
		});
		const quiet = build(buildCatalogueCard, context, {
			[promotionsCalls.catalogue]: [
				catalogueRow({ promotion_name: "Giảm 10% món" }),
				catalogueRow({ promotion_name: "Mua 2 tặng 1" }),
			],
		});
		expect(quiet.notice).toBeNull();
	});
});

describe("the legal basis of a rule", () => {
	it("names the instrument and one article, or several with the last one apart", () => {
		expect(
			legalBasisValue({
				instrument: "circular",
				number: "39/2025/TT-BCT",
				articles: [4],
			}),
		).toEqual({
			kind: "part",
			value: {
				key: promotionsKeys.rules.basisOne,
				values: {
					instrument: {
						kind: "part",
						value: {
							key: promotionsKeys.rules.instrument.circular,
							values: { number: { kind: "text", value: "39/2025/TT-BCT" } },
						},
					},
					article: { kind: "text", value: "4" },
				},
			},
		});
		expect(
			nested(
				legalBasisValue({
					instrument: "decree",
					number: "1/2030/NĐ-CP",
					articles: [8, 9, 11],
				}),
			).values,
		).toMatchObject({
			articles: { kind: "text", value: "8, 9" },
			last: { kind: "text", value: "11" },
		});
	});
});
