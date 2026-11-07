import { z } from "zod";
import {
	externalId,
	optionalMoney,
	optionalText,
	rawPayload,
} from "./common.js";
import { adjustmentKindSchema } from "./enums.js";

export const canonicalAdjustmentSchema = z.object({
	kind: adjustmentKindSchema,
	saleExternalId: externalId,
	occurredAt: z.date(),
	amount: optionalMoney,
	reason: optionalText,
	raw: rawPayload,
});

export type CanonicalAdjustment = z.infer<typeof canonicalAdjustmentSchema>;
