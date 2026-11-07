import { z } from "zod";
import {
	externalId,
	isoDate,
	minutesOfDay,
	optionalText,
	timezoneName,
} from "./common.js";

export const canonicalStoreSchema = z.object({
	externalId,
	name: z.string().min(1),
	address: optionalText,
	timezone: timezoneName,
	dayStartMinutes: minutesOfDay,
	currency: z.string().min(1),
	openedOn: isoDate.optional(),
});

export type CanonicalStore = z.infer<typeof canonicalStoreSchema>;
