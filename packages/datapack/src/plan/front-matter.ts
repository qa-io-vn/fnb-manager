import { z } from "zod";
import { HORIZONS, PACK_LANGUAGES } from "../pack/request.js";
import { MAX_INITIATIVES, PLAN_FORMAT } from "./sections.js";

export const planFrontMatterSchema = z.object({
	format: z.literal(PLAN_FORMAT),
	pack: z.string().regex(/^[0-9a-f]{64}$/),
	title: z.string().min(1).max(120),
	horizon: z.enum(HORIZONS),
	language: z.enum(PACK_LANGUAGES),
	kpis: z.record(
		z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
		z.object({
			scope: z
				.string()
				.regex(/^(ALL|S\d{1,2})$/)
				.default("ALL"),
			target: z.number().finite(),
			baseline: z.number().finite().optional(),
			initiatives: z.array(z.number().int().min(1).max(MAX_INITIATIVES)).min(1),
		}),
	),
});

export type PlanFrontMatter = z.output<typeof planFrontMatterSchema>;
export type PlanFrontMatterInput = z.input<typeof planFrontMatterSchema>;
