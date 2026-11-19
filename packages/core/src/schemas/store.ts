import { z } from "zod";
import {
	externalId,
	isoDate,
	minutesOfDay,
	optionalText,
	timezoneName,
} from "./common.js";

/**
 * How often the POS restarts its receipt numbering, as the POS reports it:
 * `daily` (iPOS `tran_no`: the day of the month, then a daily sequence),
 * `yearly`, or `unknown` when the POS does not say or says something else.
 */
export const RECEIPT_NUMBER_RESETS = ["daily", "yearly", "unknown"] as const;
export const receiptNumbersResetSchema = z.enum(RECEIPT_NUMBER_RESETS);
export type ReceiptNumbersReset = z.infer<typeof receiptNumbersResetSchema>;

export const canonicalStoreSchema = z.object({
	externalId,
	name: z.string().min(1),
	address: optionalText,
	timezone: timezoneName,
	dayStartMinutes: minutesOfDay,
	currency: z.string().min(1),
	openedOn: isoDate.optional(),
	receiptNumbersReset: receiptNumbersResetSchema.optional(),
});

export type CanonicalStore = z.infer<typeof canonicalStoreSchema>;
