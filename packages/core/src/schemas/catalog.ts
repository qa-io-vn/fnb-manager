import { z } from "zod";
import {
	externalId,
	money,
	optionalMoney,
	optionalText,
	rawPayload,
} from "./common.js";
import { paymentKindSchema } from "./enums.js";

export const canonicalItemSchema = z.object({
	externalId,
	name: z.string().min(1),
	baseName: z.string().min(1),
	sizeLabel: optionalText,
	itemTypeExternalId: optionalText,
	itemTypeName: optionalText,
	itemClassName: optionalText,
	listPrice: money,
	takeawayPrice: optionalMoney,
	costPrice: optionalMoney,
	isModifier: z.boolean(),
	active: z.boolean(),
});

export const canonicalItemTypeSchema = z.object({
	externalId,
	name: z.string().min(1),
	parentExternalId: optionalText,
});

export const canonicalItemClassSchema = z.object({
	externalId,
	name: z.string().min(1),
});

export const canonicalModifierSchema = z.object({
	externalId,
	name: z.string().min(1),
	groupName: optionalText,
	appliesToItemExternalIds: z.array(externalId),
	raw: rawPayload,
});

export const canonicalPaymentMethodSchema = z.object({
	externalId,
	name: z.string().min(1),
	kind: paymentKindSchema,
	feePct: z.number().min(0).optional(),
});

export const canonicalSourceSchema = z.object({
	externalId,
	name: z.string().min(1),
	isDelivery: z.boolean(),
});

export const canonicalPromotionSchema = z.object({
	externalId,
	name: z.string().min(1),
	raw: rawPayload,
});

export const canonicalPackageSchema = z.object({
	externalId,
	name: z.string().min(1),
	listPrice: optionalMoney,
	raw: rawPayload,
});

export const canonicalCatalogSchema = z.object({
	items: z.array(canonicalItemSchema),
	itemTypes: z.array(canonicalItemTypeSchema),
	itemClasses: z.array(canonicalItemClassSchema),
	modifiers: z.array(canonicalModifierSchema),
	paymentMethods: z.array(canonicalPaymentMethodSchema),
	sources: z.array(canonicalSourceSchema),
	promotions: z.array(canonicalPromotionSchema),
	packages: z.array(canonicalPackageSchema),
});

export type CanonicalItem = z.infer<typeof canonicalItemSchema>;
export type CanonicalItemType = z.infer<typeof canonicalItemTypeSchema>;
export type CanonicalItemClass = z.infer<typeof canonicalItemClassSchema>;
export type CanonicalModifier = z.infer<typeof canonicalModifierSchema>;
export type CanonicalPaymentMethod = z.infer<
	typeof canonicalPaymentMethodSchema
>;
export type CanonicalSource = z.infer<typeof canonicalSourceSchema>;
export type CanonicalPromotion = z.infer<typeof canonicalPromotionSchema>;
export type CanonicalPackage = z.infer<typeof canonicalPackageSchema>;
export type CanonicalCatalog = z.infer<typeof canonicalCatalogSchema>;
