import { z } from "zod";
import {
	externalId,
	isoDate,
	money,
	optionalText,
	rawPayload,
} from "./common.js";
import {
	channelSchema,
	lineKindSchema,
	paymentKindSchema,
	saleStatusSchema,
} from "./enums.js";

export const canonicalLineSchema = z.object({
	externalId,
	lineKind: lineKindSchema,
	parentLineExternalId: optionalText,
	itemExternalId: optionalText,
	itemName: z.string().min(1),
	baseName: z.string().min(1),
	sizeLabel: optionalText,
	itemTypeExternalId: optionalText,
	itemTypeName: optionalText,
	itemClassName: optionalText,
	unitName: optionalText,
	quantity: z.number().finite(),
	unitPrice: money,
	grossAmount: money,
	discountAmount: money,
	netAmount: money,
	promotionExternalId: optionalText,
	promotionName: optionalText,
	note: optionalText,
	raw: rawPayload,
});

export const canonicalPaymentSchema = z.object({
	methodExternalId: externalId,
	methodName: z.string().min(1),
	kind: paymentKindSchema,
	amount: money,
	feeAmount: money,
	referenceNo: optionalText,
	partnerTransactionId: optionalText,
	raw: rawPayload,
});

export const canonicalSaleSchema = z.object({
	externalId,
	receiptNo: optionalText,
	soldAt: z.date(),
	businessDate: isoDate,
	openedAt: z.date().optional(),
	closedAt: z.date().optional(),
	channel: channelSchema,
	sourceExternalId: optionalText,
	sourceName: optionalText,
	tableName: optionalText,
	areaName: optionalText,
	shiftExternalId: optionalText,
	employeeExternalId: optionalText,
	employeeName: optionalText,
	guestCount: z.number().int().min(0),
	customerPhone: optionalText,
	customerName: optionalText,
	grossAmount: money,
	itemDiscountAmount: money,
	billDiscountAmount: money,
	billDiscountName: optionalText,
	voucherCode: optionalText,
	voucherName: optionalText,
	voucherAmount: money,
	partnerMarketingAmount: money,
	serviceChargeAmount: money,
	shippingFeeAmount: money,
	vatAmount: money,
	netAmount: money,
	paidAmount: money,
	status: saleStatusSchema,
	lines: z.array(canonicalLineSchema),
	payments: z.array(canonicalPaymentSchema),
	raw: rawPayload,
});

export type CanonicalLine = z.infer<typeof canonicalLineSchema>;
export type CanonicalPayment = z.infer<typeof canonicalPaymentSchema>;
export type CanonicalSale = z.infer<typeof canonicalSaleSchema>;
