import { z } from "zod";
import {
	epochMs,
	money,
	optionalMoney,
	optionalNumber,
	optionalText,
} from "./common.js";

const revenueTotalsShape = {
	total_sales: money,
	revenue_gross: money,
	revenue_net: money,
	discount_amount: optionalMoney,
	commission_amount: optionalMoney,
	peo_count: optionalNumber,
	deduct_tax_amount: optionalMoney,
};

export const previousPeriodSchema = z.looseObject({
	percentage: optionalNumber,
	revenue_net: optionalMoney,
	revenue_gross: optionalMoney,
	total_sales: optionalNumber,
	start_date: optionalNumber,
	end_date: optionalNumber,
});

export const overviewSchema = z.looseObject({
	...revenueTotalsShape,
	previous_period: previousPeriodSchema.nullable().optional(),
	total_out: optionalMoney,
});

export const dayRowSchema = z.looseObject({
	date: optionalText,
	tran_date: epochMs,
	total_sales: money,
	revenue_gross: money,
	revenue_net: money,
	discount_amount: optionalMoney,
	discount_extra_amount: optionalMoney,
	amount_discount_detail: optionalMoney,
	voucher_amount: optionalMoney,
	vat_amount: optionalMoney,
	ship_fee_amount: optionalMoney,
	commission_amount: optionalMoney,
	peo_count: optionalNumber,
	amount: optionalMoney,
});

export const daysSchema = z.looseObject({
	...revenueTotalsShape,
	list_data: z.array(dayRowSchema),
});

export const hourRowSchema = z.looseObject({
	hour: z.number().int(),
	revenue: money,
	transaction_quantity: z.number(),
	peo_count: optionalNumber,
});

export const weekdayRowSchema = z.looseObject({
	day_of_week: z.string(),
	revenue: money,
	transaction_quantity: z.number(),
	peo_count: optionalNumber,
});

export const storeRowSchema = z.looseObject({
	store_uid: z.string(),
	store_name: z.string(),
	brand_uid: optionalText,
	fb_store_id: optionalText,
	...revenueTotalsShape,
	voucher_amount: optionalMoney,
	vat_amount: optionalMoney,
	ship_fee_amount: optionalMoney,
	service_charge_amount: optionalMoney,
	amount_origin: optionalMoney,
	list_data: z.array(z.looseObject({})).nullable().optional(),
});

export const itemRowSchema = z.looseObject({
	item_id: z.string(),
	item_name: z.string(),
	unit_id: optionalText,
	unit_name: optionalText,
	item_type_id: optionalText,
	item_type_name: optionalText,
	item_class_id: optionalText,
	item_class_name: optionalText,
	quantity_sold: z.number(),
	revenue_gross: money,
	revenue_net: money,
	discount_amount: optionalMoney,
	commission_amount: optionalMoney,
});

export const itemTypeReferenceSchema = z.looseObject({
	item_type_id: z.string(),
	item_type_name: z.string(),
});

export const itemsSchema = z.looseObject({
	list_data_item_return: z.array(itemRowSchema),
	other_data: z.array(itemTypeReferenceSchema).nullable().optional(),
});

export const itemTypeRowSchema = z.looseObject({
	item_type_id: z.string(),
	item_type_name: z.string(),
	total_quantity_sold: z.number(),
	revenue_gross: money,
	revenue_net: money,
	discount_amount: optionalMoney,
	list_data: z.array(z.looseObject({})).nullable().optional(),
});

export const itemClassRowSchema = z.looseObject({
	item_class_id: z.string(),
	item_class_name: z.string(),
	total_quantity_sold: z.number(),
	revenue_gross: money,
	revenue_net: money,
	discount_amount: optionalMoney,
	list_data: z.array(z.looseObject({})).nullable().optional(),
});

export const sourceRowSchema = z.looseObject({
	source_id: z.string(),
	source_name: z.string(),
	total_bill: z.number(),
	revenue_gross: money,
	revenue_net: money,
	discount_amount: optionalMoney,
	commission_amount: optionalMoney,
	peo_count: optionalNumber,
	list_data: z.array(z.looseObject({})).nullable().optional(),
});

export const paymentMethodRowSchema = z.looseObject({
	payment_method_id: z.string(),
	payment_method_name: z.string(),
	total_bill: z.number(),
	total_amount: money,
	total_count: optionalNumber,
	total_payment_fee_amount: optionalMoney,
	list_data: z.array(z.looseObject({})).nullable().optional(),
});

export const promotionRowSchema = z.looseObject({
	promotion_id: optionalText,
	promotion_name: optionalText,
	total_bill: optionalNumber,
	revenue_gross: optionalMoney,
	revenue_net: optionalMoney,
	discount_amount: optionalMoney,
	list_data: z.array(z.looseObject({})).nullable().optional(),
});

export const trendPointSchema = z.looseObject({
	hour: optionalNumber,
	month: optionalNumber,
	day_of_week: optionalText,
	day_of_week_int: optionalNumber,
	revenue_net: money,
	transaction_quantity: z.number(),
});

export const trendSeriesSchema = z.looseObject({
	start_date: epochMs,
	end_date: epochMs,
	store: optionalText,
	list_data: z.array(trendPointSchema),
});

export type SaleOverview = z.infer<typeof overviewSchema>;
export type SaleDays = z.infer<typeof daysSchema>;
export type SaleDayRow = z.infer<typeof dayRowSchema>;
export type SaleHourRow = z.infer<typeof hourRowSchema>;
export type SaleWeekdayRow = z.infer<typeof weekdayRowSchema>;
export type SaleStoreRow = z.infer<typeof storeRowSchema>;
export type SaleItems = z.infer<typeof itemsSchema>;
export type SaleItemRow = z.infer<typeof itemRowSchema>;
export type SaleItemTypeRow = z.infer<typeof itemTypeRowSchema>;
export type SaleItemClassRow = z.infer<typeof itemClassRowSchema>;
export type SaleSourceRow = z.infer<typeof sourceRowSchema>;
export type SalePaymentMethodRow = z.infer<typeof paymentMethodRowSchema>;
export type SalePromotionRow = z.infer<typeof promotionRowSchema>;
export type TrendSeries = z.infer<typeof trendSeriesSchema>;
export type TrendPoint = z.infer<typeof trendPointSchema>;
