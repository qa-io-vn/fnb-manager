import type { LineKind } from "../schemas/enums.js";
import type { CanonicalLine, CanonicalSale } from "../schemas/sale.js";
import { roundMoney, sumMoney } from "./money.js";

const QUANTITY_BEARING_KINDS: ReadonlySet<LineKind> = new Set<LineKind>([
	"item",
	"package_component",
]);

export function countsAsItem(line: Pick<CanonicalLine, "lineKind">): boolean {
	return QUANTITY_BEARING_KINDS.has(line.lineKind);
}

export function itemQuantity(lines: readonly CanonicalLine[]): number {
	return lines
		.filter(countsAsItem)
		.reduce((total, line) => total + line.quantity, 0);
}

export function lineNetTotal(lines: readonly CanonicalLine[]): number {
	return sumMoney(lines.map((line) => line.netAmount));
}

export function paymentTotal(sale: Pick<CanonicalSale, "payments">): number {
	return sumMoney(sale.payments.map((payment) => payment.amount));
}

export function expectedNetFromComponents(
	sale: Pick<
		CanonicalSale,
		| "grossAmount"
		| "itemDiscountAmount"
		| "billDiscountAmount"
		| "voucherAmount"
		| "serviceChargeAmount"
		| "shippingFeeAmount"
		| "vatAmount"
	>,
): number {
	return roundMoney(
		sale.grossAmount -
			sale.itemDiscountAmount -
			sale.billDiscountAmount -
			sale.voucherAmount +
			sale.serviceChargeAmount +
			sale.shippingFeeAmount +
			sale.vatAmount,
	);
}

export function expectedNetFromLines(
	sale: Pick<
		CanonicalSale,
		| "lines"
		| "billDiscountAmount"
		| "voucherAmount"
		| "serviceChargeAmount"
		| "shippingFeeAmount"
		| "vatAmount"
	>,
): number {
	return roundMoney(
		lineNetTotal(sale.lines) -
			sale.billDiscountAmount -
			sale.voucherAmount +
			sale.serviceChargeAmount +
			sale.shippingFeeAmount +
			sale.vatAmount,
	);
}
