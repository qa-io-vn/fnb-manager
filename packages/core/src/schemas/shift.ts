import { z } from "zod";
import {
	externalId,
	money,
	optionalMoney,
	optionalText,
	rawPayload,
} from "./common.js";

export const canonicalShiftSchema = z.object({
	externalId,
	name: optionalText,
	cashierExternalId: optionalText,
	cashierName: optionalText,
	openedAt: z.date(),
	closedAt: z.date().optional(),
	salesAmount: money,
	ordersCount: z.number().int().min(0),
	cashDrawerAmount: optionalMoney,
	openingFloatAmount: optionalMoney,
	changedAfterClose: z.boolean(),
	status: optionalText,
	deviceCode: optionalText,
	raw: rawPayload,
});

export type CanonicalShift = z.infer<typeof canonicalShiftSchema>;
