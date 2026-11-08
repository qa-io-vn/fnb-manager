import {
	type CanonicalSale,
	type DataQualityFlag,
	expectedNetFromLines,
	type FlagSeverity,
	moneyEquals,
	paymentTotal,
} from "@fnb/core";

export const FLAG_CODES = {
	duplicateSale: "duplicate_sale",
	missingLines: "missing_lines",
	orphanLines: "orphan_lines",
	paymentsMissing: "payments_missing",
	lineSumMismatch: "line_sum_mismatch",
	paymentSumMismatch: "payment_sum_mismatch",
	unknownItem: "unknown_item",
	unknownItemType: "unknown_item_type",
	shiftWithoutStore: "shift_without_store",
	editWithoutOrigin: "edit_without_origin",
	unknownAdjustmentStatus: "unknown_adjustment_status",
	removedLineWithoutSuffix: "removed_line_without_suffix",
} as const;

export function flag(
	code: string,
	message: string,
	severity: FlagSeverity,
	saleExternalId?: string,
): DataQualityFlag {
	return saleExternalId === undefined
		? { code, message, severity }
		: { code, message, severity, saleExternalId };
}

export function flagsForSale(
	sale: CanonicalSale,
	tolerance: number,
): DataQualityFlag[] {
	const flags: DataQualityFlag[] = [];
	if (sale.lines.length > 0) {
		const fromLines = expectedNetFromLines(sale);
		if (!moneyEquals(fromLines, sale.netAmount, tolerance)) {
			flags.push(
				flag(
					FLAG_CODES.lineSumMismatch,
					`lines give ${fromLines} after bill discount and voucher, invoice net is ${sale.netAmount}`,
					"warn",
					sale.externalId,
				),
			);
		}
	}
	const paid = paymentTotal(sale);
	if (!moneyEquals(paid, sale.netAmount, tolerance)) {
		flags.push(
			flag(
				FLAG_CODES.paymentSumMismatch,
				`payments sum to ${paid}, invoice net is ${sale.netAmount}`,
				"warn",
				sale.externalId,
			),
		);
	}
	return flags;
}
