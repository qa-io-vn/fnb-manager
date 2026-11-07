import { z } from "zod";

export const channelSchema = z.enum([
	"dine_in",
	"take_away",
	"delivery",
	"other",
]);
export const lineKindSchema = z.enum([
	"item",
	"modifier",
	"package_component",
	"service",
	"other",
]);
export const paymentKindSchema = z.enum([
	"cash",
	"ewallet",
	"bank_transfer",
	"card",
	"voucher",
	"other",
]);
export const saleStatusSchema = z.enum(["completed", "edited", "voided"]);
export const adjustmentKindSchema = z.enum([
	"voided",
	"edited",
	"line_removed",
]);
export const flagSeveritySchema = z.enum(["info", "warn"]);

export type Channel = z.infer<typeof channelSchema>;
export type LineKind = z.infer<typeof lineKindSchema>;
export type PaymentKind = z.infer<typeof paymentKindSchema>;
export type SaleStatus = z.infer<typeof saleStatusSchema>;
export type AdjustmentKind = z.infer<typeof adjustmentKindSchema>;
export type FlagSeverity = z.infer<typeof flagSeveritySchema>;

export const CHANNELS = channelSchema.options;
export const LINE_KINDS = lineKindSchema.options;
export const PAYMENT_KINDS = paymentKindSchema.options;
