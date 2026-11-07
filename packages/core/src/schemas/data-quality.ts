import { z } from "zod";
import { externalId } from "./common.js";
import { flagSeveritySchema } from "./enums.js";

export const dataQualityFlagSchema = z.object({
	code: z.string().min(1),
	saleExternalId: externalId.optional(),
	message: z.string().min(1),
	severity: flagSeveritySchema,
});

export type DataQualityFlag = z.infer<typeof dataQualityFlagSchema>;
