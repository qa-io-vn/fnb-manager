import { z } from "zod";
import { PROMPT_ID } from "../prompt/prompt.js";
import { PACK_WINDOWS } from "./calendar.js";
import { HORIZONS, MAX_PACK_STORES, PACK_LANGUAGES } from "./request.js";
import { PACK_GRAINS, PACK_UNITS } from "./units.js";

export const DATA_PACK_FORMAT = "fnb-datapack";
export const DATA_PACK_SCHEMA_VERSION = "1.0.0";
export const DATA_PACK_BUILDER_VERSION = "1.0.0";

export const ROW_KEY_PATTERN = /^(?=[A-Za-z0-9_./-]*[A-Za-z])[A-Za-z0-9_./-]+$/;
export const TABLE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
export const COLUMN_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
export const STORE_ID_PATTERN =
	/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|MOCK-S[0-9]{1,2})$/;
export const STORE_LABEL_PATTERN = /^S[0-9]{1,2}$/;
export const SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
export const PACK_ID_PATTERN = /^[0-9a-f]{64}$/;
export const GENERATED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
export const LIVE_STORE_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SAMPLE_STORE_ID_PATTERN = /^MOCK-S[0-9]{1,2}$/;
export const ALL_SCOPE = "ALL";

export function rowScope(rowKey: string): string {
	const slash = rowKey.indexOf("/");
	return slash === -1 ? rowKey : rowKey.slice(0, slash);
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const semver = z.string().regex(SEMVER_PATTERN);
const language = z.enum(PACK_LANGUAGES);
const dateRange = z.strictObject({ from: isoDate, to: isoDate });

export const packCellSchema = z.union([
	z.number(),
	z.string(),
	z.boolean(),
	z.null(),
]);

export const packColumnSchema = z.strictObject({
	name: z.string().regex(COLUMN_NAME_PATTERN),
	unit: z.enum(PACK_UNITS),
});

export const packTableSchema = z.strictObject({
	title: z.string(),
	grain: z.enum(PACK_GRAINS),
	window: z.enum(PACK_WINDOWS).nullable(),
	notes: z.string(),
	columns: z.array(packColumnSchema),
	rows: z.record(z.string().regex(ROW_KEY_PATTERN), z.array(packCellSchema)),
});

const calendarShape = Object.fromEntries(
	PACK_WINDOWS.map((name) => [name, dateRange]),
) as Record<(typeof PACK_WINDOWS)[number], typeof dateRange>;

export const dataPackSchema = z.strictObject({
	budget: z.strictObject({
		estimated_tokens: z.number().int().nonnegative(),
		limit: z.number().int().positive(),
		trimmed: z.array(z.string()),
	}),
	builder_version: semver,
	calendar: z.strictObject(calendarShape),
	context: z.strictObject({
		benchmarks: z.array(
			z.tuple([z.string(), z.string(), z.string(), z.string()]),
		),
		note: z.string(),
		rules: z.array(z.tuple([z.string(), z.string(), isoDate, z.string()])),
	}),
	format: z.literal(DATA_PACK_FORMAT),
	generated_at: z.string().regex(GENERATED_AT_PATTERN),
	pack_id: z.string().regex(PACK_ID_PATTERN),
	prompt: z.strictObject({
		id: z.literal(PROMPT_ID),
		language,
		text: z.string(),
		version: semver,
	}),
	request: z.strictObject({
		as_of: isoDate,
		currency: z.string().regex(/^[A-Z]{3}$/),
		focus: z.string().nullable(),
		horizon: z.enum(HORIZONS),
		language,
		owner_note: z.string().nullable(),
		stores: z
			.array(
				z.strictObject({
					id: z.string().regex(STORE_ID_PATTERN),
					label: z.string().regex(STORE_LABEL_PATTERN),
				}),
			)
			.min(1)
			.max(MAX_PACK_STORES),
	}),
	sample: z.boolean(),
	schema_version: semver,
	tables: z.record(z.string().regex(TABLE_ID_PATTERN), packTableSchema),
});

export type PackCell = z.output<typeof packCellSchema>;
export type PackColumn = z.output<typeof packColumnSchema>;
export type PackTable = z.output<typeof packTableSchema>;
export type DataPack = z.output<typeof dataPackSchema>;
