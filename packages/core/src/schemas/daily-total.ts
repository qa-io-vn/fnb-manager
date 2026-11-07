import { z } from "zod";
import { isoDate, money, optionalMoney, rawPayload } from "./common.js";

export const canonicalDailyTotalSchema = z.object({
	businessDate: isoDate,
	invoiceCount: z.number().int().min(0),
	grossAmount: optionalMoney,
	discountAmount: optionalMoney,
	voucherAmount: optionalMoney,
	netAmount: money,
	raw: rawPayload,
});

export type CanonicalDailyTotal = z.infer<typeof canonicalDailyTotalSchema>;
