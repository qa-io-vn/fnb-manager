import { fastHash } from "./hash.js";
import {
	INVOICE_DIGEST_COLUMNS,
	type InvoiceDigestColumn,
	type InvoiceLineRow,
	type InvoicePaymentRow,
	type InvoiceRow,
	LINE_DIGEST_COLUMNS,
	type LineDigestColumn,
	PAYMENT_DIGEST_COLUMNS,
	type PaymentDigestColumn,
} from "./rows.js";

export type DigestInvoice = Pick<InvoiceRow, InvoiceDigestColumn>;
export type DigestLine = Pick<InvoiceLineRow, LineDigestColumn>;
export type DigestPayment = Pick<InvoicePaymentRow, PaymentDigestColumn>;

function pickValues<T, K extends keyof T>(row: T, columns: readonly K[]) {
	return columns.map((column) => row[column] ?? null);
}

function byText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function sortLines<T extends Pick<InvoiceLineRow, "external_id">>(
	lines: readonly T[],
): T[] {
	return [...lines].sort((left, right) =>
		byText(left.external_id, right.external_id),
	);
}

export function sortPayments<T extends Pick<InvoicePaymentRow, "sequence_no">>(
	payments: readonly T[],
): T[] {
	return [...payments].sort(
		(left, right) => left.sequence_no - right.sequence_no,
	);
}

export function invoiceDigest(
	invoice: DigestInvoice,
	lines: readonly DigestLine[],
	payments: readonly DigestPayment[],
): string {
	return fastHash(
		JSON.stringify([
			pickValues(invoice, INVOICE_DIGEST_COLUMNS),
			sortLines(lines).map((line) => pickValues(line, LINE_DIGEST_COLUMNS)),
			sortPayments(payments).map((payment) =>
				pickValues(payment, PAYMENT_DIGEST_COLUMNS),
			),
		]),
	);
}

export function lineSetKey(
	lines: readonly Pick<
		InvoiceLineRow,
		"external_id" | "item_external_id" | "quantity"
	>[],
): string {
	return fastHash(
		JSON.stringify(
			sortLines(lines).map((line) => [
				line.external_id,
				line.item_external_id ?? null,
				line.quantity,
			]),
		),
	);
}
