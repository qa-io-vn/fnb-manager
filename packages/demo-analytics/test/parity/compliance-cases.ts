import type { GeneratedDay } from "@fnb/connector-mock";
import { type CanonicalLine, type CanonicalSale, roundMoney } from "@fnb/core";
import { addDays, type IsoDate } from "@fnb/reports";
import {
	DEMO_BILL_DISCOUNT_NAME,
	DEMO_ITEM_PROMOTION_NAME,
	type DemoDayRewrite,
	type DemoStoreId,
	toDbLineKind,
} from "../../src/index.js";

export const COMPLIANCE_STORE: DemoStoreId = "MOCK-S1";
export const COMPLIANCE_DAYS_BEFORE_AS_OF = 3;
export const GIFT_PROMOTION = {
	id: "PARITY-GIFT",
	name: "Quà tặng kiểm thử",
} as const;
export const ITEM_PROMOTION_ID = "PROMO-04";
export const DEEP_DISCOUNT_SHARE = 0.6;

export type ComplianceCase = "gift_line" | "deep_line" | "deep_bill";

export const COMPLIANCE_CASES: readonly ComplianceCase[] = [
	"gift_line",
	"deep_line",
	"deep_bill",
];

export interface ComplianceCaseSale {
	readonly kind: ComplianceCase;
	readonly saleExternalId: string;
}

export function complianceDay(asOf: IsoDate): IsoDate {
	return addDays(asOf, -COMPLIANCE_DAYS_BEFORE_AS_OF);
}

export function itemLines(sale: CanonicalSale): CanonicalLine[] {
	return sale.lines.filter(
		(line) => toDbLineKind(line.lineKind) === "item" && line.grossAmount > 0,
	);
}

export function plainSale(sale: CanonicalSale): boolean {
	return (
		sale.status === "completed" &&
		sale.itemDiscountAmount === 0 &&
		sale.billDiscountAmount === 0 &&
		sale.voucherAmount === 0 &&
		sale.voucherCode === undefined &&
		sale.payments.length === 1 &&
		itemLines(sale).length >= 2
	);
}

export function discountLine(
	day: GeneratedDay,
	sale: CanonicalSale,
	line: CanonicalLine,
	discount: number,
	promotion: { readonly id: string; readonly name: string },
): void {
	line.discountAmount = discount;
	line.netAmount = roundMoney(line.grossAmount - discount);
	line.promotionExternalId = promotion.id;
	line.promotionName = promotion.name;
	sale.itemDiscountAmount = roundMoney(sale.itemDiscountAmount + discount);
	lowerTotals(day, sale, discount);
}

function lowerTotals(
	day: GeneratedDay,
	sale: CanonicalSale,
	discount: number,
): void {
	sale.netAmount = roundMoney(sale.netAmount - discount);
	sale.paidAmount = sale.netAmount;
	const [payment] = sale.payments;
	if (payment !== undefined) payment.amount = sale.netAmount;
	const shift = day.shifts.find(
		(candidate) => candidate.externalId === sale.shiftExternalId,
	);
	if (shift === undefined) return;
	shift.salesAmount = roundMoney(shift.salesAmount - discount);
	if (payment?.kind === "cash" && shift.cashDrawerAmount !== undefined) {
		shift.cashDrawerAmount = roundMoney(shift.cashDrawerAmount - discount);
	}
}

function rewriteSale(
	day: GeneratedDay,
	sale: CanonicalSale,
	kind: ComplianceCase,
): number {
	const [first] = itemLines(sale);
	if (first === undefined) return 0;
	if (kind === "gift_line") {
		const discount = first.grossAmount;
		discountLine(day, sale, first, discount, GIFT_PROMOTION);
		return discount;
	}
	if (kind === "deep_line") {
		const discount = roundMoney(first.grossAmount * DEEP_DISCOUNT_SHARE);
		discountLine(day, sale, first, discount, {
			id: ITEM_PROMOTION_ID,
			name: DEMO_ITEM_PROMOTION_NAME,
		});
		return discount;
	}
	const discount = roundMoney(sale.netAmount * DEEP_DISCOUNT_SHARE);
	sale.billDiscountAmount = discount;
	sale.billDiscountName = DEMO_BILL_DISCOUNT_NAME;
	lowerTotals(day, sale, discount);
	return discount;
}

export function complianceCaseSales(
	day: GeneratedDay,
): readonly ComplianceCaseSale[] {
	const plain = day.sales.filter(plainSale);
	return COMPLIANCE_CASES.flatMap((kind, index) => {
		const sale = plain[index];
		return sale === undefined
			? []
			: [{ kind, saleExternalId: sale.externalId }];
	});
}

export function complianceCases(asOf: IsoDate): DemoDayRewrite {
	const date = complianceDay(asOf);
	return (store, day) => {
		if (store.id !== COMPLIANCE_STORE || day.date !== date) return day;
		const cases = complianceCaseSales(day);
		const byId = new Map(day.sales.map((sale) => [sale.externalId, sale]));
		let totalDiscount = 0;
		for (const { kind, saleExternalId } of cases) {
			const sale = byId.get(saleExternalId);
			if (sale !== undefined) totalDiscount += rewriteSale(day, sale, kind);
		}
		day.dailyTotal = {
			...day.dailyTotal,
			discountAmount: roundMoney(
				(day.dailyTotal.discountAmount ?? 0) + totalDiscount,
			),
			netAmount: roundMoney(day.dailyTotal.netAmount - totalDiscount),
		};
		return day;
	};
}
