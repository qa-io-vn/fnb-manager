import { z } from "zod";
import { optionalText } from "./common.js";

export const errorEnvelopeSchema = z.looseObject({
	error: z.looseObject({
		code: z.union([z.number(), z.string()]).nullable().optional(),
		message: optionalText,
		debug_message: optionalText,
	}),
	track_id: optionalText,
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export function dataEnvelope<TData extends z.ZodType>(data: TData) {
	return z.looseObject({
		data,
		message: optionalText,
		track_id: optionalText,
	});
}

export function cursorEnvelope<TData extends z.ZodType>(data: TData) {
	return z.looseObject({
		data,
		next_cursor: z.number().int().nullable().optional(),
		message: optionalText,
		track_id: optionalText,
	});
}

export function pageEnvelope<TData extends z.ZodType>(data: TData) {
	return z.looseObject({
		data,
		page: z.number().int(),
		num_results: z.number().int().nullable().optional(),
		total_pages: z.number().int(),
		message: optionalText,
		track_id: optionalText,
	});
}

export function readErrorEnvelope(body: unknown): ErrorEnvelope | null {
	const parsed = errorEnvelopeSchema.safeParse(body);
	return parsed.success ? parsed.data : null;
}
