import { z } from "zod";
import {
	epochMs,
	money,
	optionalEpochMs,
	optionalMoney,
	optionalNumber,
	optionalText,
} from "./common.js";

export const SALE_EDIT_DELETE_STATUSES = ["DELETE", "EDIT"] as const;
export const REMOVED_LINE_SUFFIX = "_REMOVE";

export const saleEditDeleteRowSchema = z.looseObject({
	tran_id: z.string(),
	origin_tran_id: optionalText,
	first_origin_tran_id: optionalText,
	tran_no: optionalText,
	shift_id: optionalText,
	store_uid: optionalText,
	store_name: optionalText,
	table_name: optionalText,
	employee_uid: optionalText,
	employee_name: optionalText,
	sale_note: optionalText,
	status: z.string(),
	total_amount_origin: money,
	total_amount: money,
	tran_date: epochMs,
	updated_at: epochMs,
	payment_method_id: optionalText,
	payment_method_name: optionalText,
	tran_id_of_partner: optionalText,
	trace_no: optionalText,
	source_voucher: z.unknown().optional(),
	source_deli: z.unknown().optional(),
	extra_data: z.unknown().optional(),
});

export const posCmsShiftSchema = z.looseObject({
	shift_id: optionalText,
	shift_name: optionalText,
	store_uid: optionalText,
	user_name: optionalText,
	status: optionalText,
	start_date: optionalEpochMs,
	end_date: optionalEpochMs,
});

export const saleEditDeleteResponseSchema = z.looseObject({
	data: z.array(saleEditDeleteRowSchema),
	data_shift: z.array(posCmsShiftSchema).nullable().optional(),
	message: optionalText,
	track_id: optionalText,
});

export const snapshotLineSchema = z.looseObject({
	id: optionalText,
	id_sale_detail: optionalText,
	item_id: optionalText,
	item_name: optionalText,
	item_type_id: optionalText,
	item_type_name: optionalText,
	item_class_id: optionalText,
	item_class_name: optionalText,
	quantity: z.number(),
	price: money,
	price_org: optionalMoney,
	amount: money,
	note: optionalText,
	package_id: optionalText,
	promotion_id: optionalText,
	sale_detail_type: optionalNumber,
	toppings: z.array(z.unknown()).nullable().optional(),
});

export const snapshotPaymentSchema = z.looseObject({
	payment_method_id: optionalText,
	payment_method_name: optionalText,
	amount: money,
	trace_no: optionalText,
	is_paid: z.union([z.number(), z.boolean()]).nullable().optional(),
	payment_fee_amount: optionalMoney,
});

export const saleSnapshotSchema = z.looseObject({
	tran_id: optionalText,
	tran_no: optionalText,
	tran_date: optionalEpochMs,
	start_date: optionalEpochMs,
	total_amount: optionalMoney,
	amount_origin: optionalMoney,
	state_action_bill: optionalNumber,
	sale_type: optionalText,
	order_type: optionalText,
	table_id: optionalText,
	area_id: optionalText,
	shift_id: optionalText,
	device_code: optionalText,
	version_app: optionalText,
	extra_data: z.unknown().optional(),
	sale_detail: z.array(snapshotLineSchema).nullable().optional(),
	sale_payment_method: z.array(snapshotPaymentSchema).nullable().optional(),
});

export const changeLogLineSchema = z.looseObject({
	id: optionalText,
	id_sale_detail: z.string(),
	item_id: z.string(),
	item_name: z.string(),
	item_type_id: optionalText,
	item_type_name: optionalText,
	item_class_id: optionalText,
	item_class_name: optionalText,
	quantity: z.number(),
	price: money,
	price_org: optionalMoney,
	amount: money,
	sort_index: optionalNumber,
	unit_id: optionalText,
	note: optionalText,
	hour: optionalNumber,
	minute: optionalNumber,
	is_printed: optionalNumber,
	quantity_print_temp: optionalNumber,
	order_no: z.union([z.number(), z.string()]).nullable().optional(),
	device_code: optionalText,
	employee_id: optionalText,
	employee_name: optionalText,
	status: optionalText,
	toppings: z.array(z.unknown()).nullable().optional(),
});

export const removedItemEventSchema = z.looseObject({
	tran_id: z.string(),
	tran_no: optionalText,
	store_uid: optionalText,
	log_type: optionalText,
	log_date: epochMs,
	updated_at: optionalNumber,
	state_action: optionalNumber,
	table_name: optionalText,
	employee_name: optionalText,
	total_tran_id: optionalNumber,
	sale_detail: z.array(changeLogLineSchema).nullable().optional(),
});

export const saleChangeSnapshotSchema = z.looseObject({
	tran_id: optionalText,
	tran_no: optionalText,
	total_amount: optionalMoney,
	amount_origin: optionalMoney,
	state_action_bill: optionalNumber,
	is_edited: z.union([z.number(), z.boolean()]).nullable().optional(),
	extra_data: z.unknown().optional(),
	sale_detail: z.array(changeLogLineSchema).nullable().optional(),
	sale_payment_method: z.array(z.unknown()).nullable().optional(),
});

export const saleChangeLogRowSchema = z.looseObject({
	tran_id: z.string(),
	created_at: optionalNumber,
	updated_at: optionalNumber,
	fmt_created_at: optionalText,
	fmt_updated_at: optionalText,
	device_code: optionalText,
	start_date: optionalEpochMs,
	log_type: optionalText,
	table_name: optionalText,
	change_data: saleChangeSnapshotSchema.nullable().optional(),
	sale_current: z.unknown().optional(),
});

export const outOfStockRowSchema = z.looseObject({
	item_id: optionalText,
	item_name: optionalText,
	store_uid: optionalText,
});

export type SaleEditDeleteRow = z.infer<typeof saleEditDeleteRowSchema>;
export type PosCmsShift = z.infer<typeof posCmsShiftSchema>;
export type SaleSnapshot = z.infer<typeof saleSnapshotSchema>;
export type SnapshotLine = z.infer<typeof snapshotLineSchema>;
export type SnapshotPayment = z.infer<typeof snapshotPaymentSchema>;
export type ChangeLogLine = z.infer<typeof changeLogLineSchema>;
export type RemovedItemEvent = z.infer<typeof removedItemEventSchema>;
export type SaleChangeLogRow = z.infer<typeof saleChangeLogRowSchema>;
export type OutOfStockRow = z.infer<typeof outOfStockRowSchema>;

export type SaleEditDeleteStatus = (typeof SALE_EDIT_DELETE_STATUSES)[number];

export function knownEditDeleteStatus(
	status: string,
): SaleEditDeleteStatus | null {
	const normalised = status.trim().toUpperCase();
	return (
		SALE_EDIT_DELETE_STATUSES.find((known) => known === normalised) ?? null
	);
}

export function hasRemovedLineSuffix(
	line: Pick<ChangeLogLine, "id_sale_detail">,
): boolean {
	return line.id_sale_detail.endsWith(REMOVED_LINE_SUFFIX);
}

export function isRemovedLine(line: Pick<ChangeLogLine, "quantity">): boolean {
	return line.quantity < 0;
}
