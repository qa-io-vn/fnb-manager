import { z } from "zod";
import {
	activeFlag,
	optionalEpochMs,
	optionalMoney,
	optionalNumber,
	optionalText,
	uid,
} from "./common.js";

export const storeSchema = z.looseObject({
	id: uid,
	store_id: optionalText,
	store_name: z.string(),
	brand_uid: uid,
	company_uid: uid,
	city_uid: optionalText,
	address: optionalText,
	phone: optionalText,
	active: activeFlag,
	fb_store_id: optionalNumber,
	open_at: optionalNumber,
});

export const itemSchema = z.looseObject({
	id: uid,
	item_id: z.string(),
	item_name: z.string(),
	ots_price: optionalMoney,
	ta_price: optionalMoney,
	cost_price: optionalMoney,
	active: activeFlag,
	deleted: z.boolean().nullable().optional(),
	item_type_uid: optionalText,
	item_class_uid: optionalText,
	unit_uid: optionalText,
	store_uid: optionalText,
	brand_uid: optionalText,
	company_uid: optionalText,
	is_material: optionalNumber,
	is_gift: optionalNumber,
	sort: optionalNumber,
});

export const itemTypeSchema = z.looseObject({
	id: uid,
	item_type_id: z.string(),
	item_type_name: z.string(),
	item_type_parent_id: optionalText,
	active: activeFlag,
	deleted: z.boolean().nullable().optional(),
	sort: optionalNumber,
});

export const itemClassSchema = z.looseObject({
	id: uid,
	item_class_id: z.string(),
	item_class_name: z.string(),
	active: activeFlag,
	deleted: z.boolean().nullable().optional(),
});

export const unitSchema = z.looseObject({
	id: uid,
	unit_id: z.string(),
	unit_name: z.string(),
	sort: optionalNumber,
});

export const customizationOptionSchema = z.looseObject({
	id: optionalText,
	Name: optionalText,
	LstItem_Id: z.array(z.string()).nullable().optional(),
	Max_Permitted: optionalNumber,
	Min_Permitted: optionalNumber,
});

export const customizationSchema = z.looseObject({
	id: uid,
	name: z.string(),
	active: activeFlag,
	list_item: z.array(z.string()).nullable().optional(),
	data: z
		.looseObject({
			LstItem_Options: z.array(customizationOptionSchema).nullable().optional(),
		})
		.nullable()
		.optional(),
	brand_uid: optionalText,
	company_uid: optionalText,
});

export const sourceSchema = z.looseObject({
	id: uid,
	source_id: z.string(),
	source_name: z.string(),
	source_type: z.array(z.string()).nullable().optional(),
	active: activeFlag,
	deleted: z.boolean().nullable().optional(),
});

export const paymentMethodSchema = z.looseObject({
	id: uid,
	payment_method_id: z.string(),
	payment_method_name: z.string(),
	payment_type: optionalNumber,
	payment_fee_extra: optionalMoney,
	payment_fee_type: optionalNumber,
	active: activeFlag,
	deleted: z.boolean().nullable().optional(),
});

export const promotionStoreSchema = z.looseObject({
	promotion_uid: optionalText,
	store_uid: optionalText,
	store_name: optionalText,
	active: activeFlag,
	created_at: optionalEpochMs,
});

export const promotionSchema = z.looseObject({
	promotion_id: z.string(),
	promotion_name: z.string(),
	partner_auto_gen: optionalNumber,
	ids_same_promotion: z.array(z.string()).nullable().optional(),
	promotions: z.array(promotionStoreSchema).nullable().optional(),
});

export const packageSchema = z.looseObject({
	id: uid,
	package_id: z.string(),
	package_name: z.string(),
	ots_value: optionalMoney,
	ta_value: optionalMoney,
	from_date: optionalEpochMs,
	to_date: optionalEpochMs,
	active: activeFlag,
	deleted: z.boolean().nullable().optional(),
	promotion_uid: optionalText,
	store_uid: optionalText,
});

export const userSchema = z.looseObject({
	id: uid,
	full_name: optionalText,
	email: optionalText,
	phone: optionalText,
	role_uid: optionalText,
	role_id: optionalText,
	role_name: optionalText,
	active: activeFlag,
});

export type Store = z.infer<typeof storeSchema>;
export type Item = z.infer<typeof itemSchema>;
export type ItemType = z.infer<typeof itemTypeSchema>;
export type ItemClass = z.infer<typeof itemClassSchema>;
export type Unit = z.infer<typeof unitSchema>;
export type Customization = z.infer<typeof customizationSchema>;
export type CustomizationOption = z.infer<typeof customizationOptionSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export type Promotion = z.infer<typeof promotionSchema>;
export type Package = z.infer<typeof packageSchema>;
export type User = z.infer<typeof userSchema>;
