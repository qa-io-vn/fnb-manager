import { z } from "zod";
import {
	epochMs,
	money,
	optionalEpochMs,
	optionalMoney,
	optionalNumber,
	optionalText,
} from "./common.js";

export const shiftSchema = z.looseObject({
	shift_id: z.string(),
	shift_name: optionalText,
	store_uid: optionalText,
	brand_uid: optionalText,
	company_uid: optionalText,
	user_uid: optionalText,
	user_name: optionalText,
	user_close: optionalText,
	device_code: optionalText,
	device_close: optionalText,
	status: optionalText,
	start_date: epochMs,
	end_date: optionalEpochMs,
	amount: money,
	cash_drawer_total: optionalMoney,
	balance: optionalMoney,
	total_money_received: optionalMoney,
	revenue_apply_formula: optionalMoney,
	number_order: optionalNumber,
	change_after_close: optionalNumber,
	peo_count: optionalNumber,
	description: optionalText,
});

export const cashMovementSchema = z.looseObject({
	id: z.string(),
	shift_id: optionalText,
	shift_name: optionalText,
	time: epochMs,
	type: z.string(),
	amount: money,
	note: optionalText,
	store_uid: optionalText,
	employee_email: optionalText,
	employee_name: optionalText,
	payment_method_id: optionalText,
	payment_method_name: optionalText,
	profession_uid: optionalText,
	profession_name: optionalText,
	cash_id: optionalText,
});

export const cashShiftSchema = z.looseObject({
	id: z.string(),
	shift_id: optionalText,
	shift_name: optionalText,
	start_date: optionalEpochMs,
	end_date: optionalEpochMs,
	user_name: optionalText,
	status: optionalText,
	balance: z.union([z.number(), z.string()]).nullable().optional(),
	amount: z.union([z.number(), z.string()]).nullable().optional(),
	number_order: optionalNumber,
	store_uid: optionalText,
});

export const cashInOutResponseSchema = z.looseObject({
	data: z.array(cashMovementSchema),
	data_shift: z.array(cashShiftSchema).nullable().optional(),
	total_cash_in: optionalMoney,
	total_cash_out: optionalMoney,
	message: optionalText,
	track_id: optionalText,
});

export const itemPriceRowSchema = z.looseObject({
	item_id: z.string(),
	item_name: z.string(),
	unit_id: optionalText,
	item_type_id: optionalText,
	item_type_name: optionalText,
	item_class_id: optionalText,
	item_class_name: optionalText,
	price: money,
	quantity: z.number(),
	amount: money,
	total_amount: optionalMoney,
	discount_amount: optionalMoney,
	voucher_amount: optionalMoney,
	vat_amount: optionalMoney,
	vat_tax_rate: optionalNumber,
});

export type Shift = z.infer<typeof shiftSchema>;
export type CashMovement = z.infer<typeof cashMovementSchema>;
export type CashShift = z.infer<typeof cashShiftSchema>;
export type ItemPriceRow = z.infer<typeof itemPriceRowSchema>;
