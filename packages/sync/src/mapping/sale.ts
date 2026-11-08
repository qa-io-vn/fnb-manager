import type {
	CanonicalLine,
	CanonicalPayment,
	CanonicalSale,
	DataQualityFlag,
	LineKind,
} from "@fnb/core";
import { toJson } from "../json.js";
import { formatMoney, formatQuantity } from "../numeric.js";
import { withoutParentFields } from "../payloads.js";
import type {
	DbLineKind,
	InvoiceLineRow,
	InvoicePaymentRow,
	InvoiceRow,
	JsonValue,
	SaleWrite,
} from "../rows.js";
import { isoOrNull, text, textOrNull } from "./text.js";

export interface SaleMappingContext {
	tenantId: string;
	storeId: string;
	posAccountId: string;
	businessDate: string;
}

export interface MappedSale {
	write: SaleWrite;
	flags: DataQualityFlag[];
}

const LINE_KINDS: Readonly<Record<LineKind, DbLineKind>> = {
	item: "item",
	modifier: "modifier",
	package_component: "item",
	service: "service",
	other: "other",
};

export function toDbLineKind(kind: LineKind): DbLineKind {
	return LINE_KINDS[kind];
}

function primaryPayment(
	payments: readonly CanonicalPayment[],
): CanonicalPayment | undefined {
	let best: CanonicalPayment | undefined;
	for (const payment of payments) {
		if (!best || payment.amount > best.amount) {
			best = payment;
		}
	}
	return best;
}

function guestCountOrNull(value: number): number | null {
	return Number.isInteger(value) && value > 0 ? value : null;
}

function uniqueLineIds(
	lines: readonly CanonicalLine[],
	saleExternalId: string,
	flags: DataQualityFlag[],
): string[] {
	const seen = new Map<string, number>();
	return lines.map((line) => {
		const count = (seen.get(line.externalId) ?? 0) + 1;
		seen.set(line.externalId, count);
		if (count === 1) {
			return line.externalId;
		}
		flags.push({
			code: "duplicate_line_id",
			saleExternalId,
			message: `line id ${line.externalId} repeats on sale ${saleExternalId}; stored as occurrence ${count}`,
			severity: "warn",
		});
		return `${line.externalId}#${count}`;
	});
}

function packageExternalId(
	line: CanonicalLine,
	linesById: ReadonlyMap<string, CanonicalLine>,
	saleExternalId: string,
	flags: DataQualityFlag[],
): string | null {
	if (line.lineKind !== "package_component") {
		return null;
	}
	const parent =
		line.parentLineExternalId === undefined
			? undefined
			: linesById.get(line.parentLineExternalId);
	if (!parent?.itemExternalId) {
		flags.push({
			code: "package_component_without_parent",
			saleExternalId,
			message: `package component ${line.externalId} on sale ${saleExternalId} names no parent package line`,
			severity: "info",
		});
		return null;
	}
	return parent.itemExternalId;
}

function mapLine(
	line: CanonicalLine,
	externalId: string,
	context: SaleMappingContext,
	packageId: string | null,
	invoiceRaw: JsonValue | null,
): InvoiceLineRow {
	return {
		tenant_id: context.tenantId,
		store_id: context.storeId,
		external_id: text(externalId),
		parent_line_external_id:
			line.lineKind === "modifier"
				? textOrNull(line.parentLineExternalId)
				: null,
		line_kind: toDbLineKind(line.lineKind),
		item_external_id: textOrNull(line.itemExternalId),
		item_name: text(line.itemName),
		base_name: textOrNull(line.baseName),
		size_label: textOrNull(line.sizeLabel),
		item_type_external_id: textOrNull(line.itemTypeExternalId),
		item_type_name: textOrNull(line.itemTypeName),
		item_class_external_id: null,
		item_class_name: textOrNull(line.itemClassName),
		unit_external_id: null,
		unit_name: textOrNull(line.unitName),
		package_external_id: packageId,
		quantity: formatQuantity(line.quantity),
		list_unit_price: null,
		unit_price: formatMoney(line.unitPrice),
		gross_amount: formatMoney(line.grossAmount),
		discount_amount: formatMoney(line.discountAmount),
		net_amount: formatMoney(line.netAmount),
		promotion_external_id: textOrNull(line.promotionExternalId),
		promotion_name: textOrNull(line.promotionName),
		note: textOrNull(line.note),
		raw: withoutParentFields(toJson(line.raw), invoiceRaw),
	};
}

function mapPayment(
	payment: CanonicalPayment,
	sequenceNo: number,
	context: SaleMappingContext,
	invoiceRaw: JsonValue | null,
): InvoicePaymentRow {
	return {
		tenant_id: context.tenantId,
		store_id: context.storeId,
		sequence_no: sequenceNo,
		business_date: context.businessDate,
		payment_method_external_id: textOrNull(payment.methodExternalId),
		payment_method_name: textOrNull(payment.methodName),
		amount: formatMoney(payment.amount),
		fee_amount: formatMoney(payment.feeAmount),
		reference_no: textOrNull(payment.referenceNo),
		partner_transaction_id: textOrNull(payment.partnerTransactionId),
		raw: withoutParentFields(toJson(payment.raw), invoiceRaw),
	};
}

function mapInvoice(
	sale: CanonicalSale,
	context: SaleMappingContext,
	invoiceRaw: JsonValue | null,
): InvoiceRow {
	const primary = primaryPayment(sale.payments);
	return {
		tenant_id: context.tenantId,
		store_id: context.storeId,
		pos_account_id: context.posAccountId,
		external_id: text(sale.externalId),
		receipt_no: textOrNull(sale.receiptNo),
		sold_at: sale.soldAt.toISOString(),
		business_date: context.businessDate,
		opened_at: isoOrNull(sale.openedAt),
		closed_at: isoOrNull(sale.closedAt),
		table_name: textOrNull(sale.tableName),
		area_name: textOrNull(sale.areaName),
		sale_type: sale.channel,
		source_external_id: textOrNull(sale.sourceExternalId),
		source_name: textOrNull(sale.sourceName),
		employee_external_id: textOrNull(sale.employeeExternalId),
		employee_name: textOrNull(sale.employeeName),
		shift_external_id: textOrNull(sale.shiftExternalId),
		device_code: null,
		guest_count: guestCountOrNull(sale.guestCount),
		customer_phone: textOrNull(sale.customerPhone),
		customer_name: textOrNull(sale.customerName),
		gross_amount: formatMoney(sale.grossAmount),
		item_discount_amount: formatMoney(sale.itemDiscountAmount),
		bill_discount_amount: formatMoney(sale.billDiscountAmount),
		extra_discount_amount: formatMoney(0),
		bill_discount_name: textOrNull(sale.billDiscountName),
		voucher_code: textOrNull(sale.voucherCode),
		voucher_name: textOrNull(sale.voucherName),
		voucher_amount: formatMoney(sale.voucherAmount),
		partner_marketing_amount: formatMoney(sale.partnerMarketingAmount),
		service_charge_amount: formatMoney(sale.serviceChargeAmount),
		shipping_fee_amount: formatMoney(sale.shippingFeeAmount),
		vat_amount: formatMoney(sale.vatAmount),
		net_amount: formatMoney(sale.netAmount),
		paid_amount: formatMoney(sale.paidAmount),
		primary_payment_method_external_id: textOrNull(primary?.methodExternalId),
		primary_payment_method_name: textOrNull(primary?.methodName),
		status: sale.status,
		raw: invoiceRaw,
	};
}

export function mapSale(
	sale: CanonicalSale,
	context: SaleMappingContext,
): MappedSale {
	const flags: DataQualityFlag[] = [];
	const invoiceRaw = toJson(sale.raw);
	const linesById = new Map(sale.lines.map((line) => [line.externalId, line]));
	const lineIds = uniqueLineIds(sale.lines, sale.externalId, flags);
	const lines = sale.lines.map((line, index) =>
		mapLine(
			line,
			lineIds[index] ?? line.externalId,
			context,
			packageExternalId(line, linesById, sale.externalId, flags),
			invoiceRaw,
		),
	);
	const payments = sale.payments.map((payment, index) =>
		mapPayment(payment, index + 1, context, invoiceRaw),
	);
	return {
		write: {
			invoice: mapInvoice(sale, context, invoiceRaw),
			lines,
			payments,
		},
		flags,
	};
}
