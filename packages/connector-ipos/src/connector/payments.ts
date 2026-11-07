import { type CanonicalPayment, classifyPaymentKind } from "@fnb/core";
import type { Invoice, Payment } from "../schemas/accounting.js";
import type { ResolvedIposOptions } from "./options.js";

const UNKNOWN_METHOD = "Không rõ";

function methodName(name: string | null | undefined): string {
	const trimmed = name?.trim();
	return trimmed ? trimmed : UNKNOWN_METHOD;
}

export function mapPayment(
	row: Payment,
	options: ResolvedIposOptions,
): CanonicalPayment {
	const name = methodName(row.payment_method_name);
	return {
		methodExternalId: row.payment_method_id,
		methodName: name,
		kind: classifyPaymentKind(name, {
			overrides: options.paymentKindOverrides,
		}),
		amount: row.amount,
		feeAmount: row.payment_fee_amount ?? 0,
		referenceNo: row.trace_no?.trim() || undefined,
		partnerTransactionId: row.tran_id_of_partner?.trim() || undefined,
		raw: row,
	};
}

export function paymentFromInvoiceHeader(
	invoice: Invoice,
	options: ResolvedIposOptions,
): CanonicalPayment | null {
	const methodId = invoice.payment_method_id?.trim();
	if (!methodId) {
		return null;
	}
	const name = methodName(invoice.payment_method_name);
	return {
		methodExternalId: methodId,
		methodName: name,
		kind: classifyPaymentKind(name, {
			overrides: options.paymentKindOverrides,
		}),
		amount: invoice.total_amount,
		feeAmount: 0,
		raw: { derivedFromInvoiceHeader: true, tran_id: invoice.tran_id },
	};
}
