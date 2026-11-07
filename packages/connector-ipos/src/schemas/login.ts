import { z } from "zod";
import { activeFlag, optionalNumber, optionalText, uid } from "./common.js";
import { dataEnvelope } from "./envelope.js";

export const loginUserSchema = z.looseObject({
	id: uid,
	email: z.string(),
	full_name: optionalText,
	phone: optionalText,
	role_uid: optionalText,
	company_uid: optionalText,
	active: activeFlag,
});

export const userRoleSchema = z.looseObject({
	id: uid,
	role_id: optionalText,
	role_name: optionalText,
	description: optionalText,
	scope: optionalText,
});

export const userPermissionsSchema = z.looseObject({
	id: optionalText,
	user_uid: optionalText,
	company_uid: optionalText,
});

export const companySchema = z.looseObject({
	id: uid,
	company_id: optionalText,
	company_name: optionalText,
	active: activeFlag,
});

export const brandSchema = z.looseObject({
	id: uid,
	brand_id: optionalText,
	brand_name: z.string(),
	active: activeFlag,
	currency: optionalText,
});

export const citySchema = z.looseObject({
	id: uid,
	city_id: optionalText,
	city_name: optionalText,
	active: activeFlag,
});

export const loginStoreSchema = z.looseObject({
	id: uid,
	brand_uid: uid,
	company_uid: uid,
	city_uid: optionalText,
	store_id: optionalText,
	store_name: z.string(),
	address: optionalText,
	phone: optionalText,
	active: activeFlag,
	open_at: optionalNumber,
	fb_store_id: optionalNumber,
});

export const loginPayloadSchema = z.looseObject({
	user: loginUserSchema,
	user_role: userRoleSchema.nullable().optional(),
	user_permissions: userPermissionsSchema.nullable().optional(),
	company: companySchema,
	brands: z.array(brandSchema),
	cities: z.array(citySchema),
	stores: z.array(loginStoreSchema),
	token: z.string().min(1),
});

export const loginResponseSchema = dataEnvelope(loginPayloadSchema);

export type LoginPayload = z.infer<typeof loginPayloadSchema>;
export type LoginUser = z.infer<typeof loginUserSchema>;
export type LoginBrand = z.infer<typeof brandSchema>;
export type LoginStore = z.infer<typeof loginStoreSchema>;
export type LoginCompany = z.infer<typeof companySchema>;
