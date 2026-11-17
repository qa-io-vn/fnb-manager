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

export const FRONT_MATTER_DELIMITER = "---";

export type FrontMatterStatus = "missing" | "invalid" | "valid";

export interface FrontMatterRead {
	readonly status: FrontMatterStatus;
	readonly frontMatter: PlanFrontMatter | null;
	readonly bodyStart: number;
	readonly invalidPaths: readonly string[];
	readonly extraKeys: readonly string[];
	readonly lines: readonly string[];
}

const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(
	Object.keys(planFrontMatterSchema.shape),
);

const KPI_KEYS: ReadonlySet<string> = new Set(
	Object.keys(planFrontMatterSchema.shape.kpis.valueType.shape),
);

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extraKeysOf(raw: Record<string, unknown>): string[] {
	const extra = Object.keys(raw).filter((key) => !TOP_LEVEL_KEYS.has(key));
	const kpis = raw.kpis;
	if (isPlainObject(kpis)) {
		for (const [id, kpi] of Object.entries(kpis)) {
			if (!isPlainObject(kpi)) continue;
			for (const key of Object.keys(kpi)) {
				if (!KPI_KEYS.has(key)) extra.push(`kpis.${id}.${key}`);
			}
		}
	}
	return extra;
}

function pathsOf(error: z.ZodError): string[] {
	const paths: string[] = [];
	for (const issue of error.issues) {
		const path = issue.path.map(String).join(".");
		if (!paths.includes(path)) paths.push(path);
	}
	return paths;
}

export function readFrontMatter(lines: readonly string[]): FrontMatterRead {
	const missing: FrontMatterRead = {
		status: "missing",
		frontMatter: null,
		bodyStart: 0,
		invalidPaths: [],
		extraKeys: [],
		lines: [],
	};
	if (lines[0] !== FRONT_MATTER_DELIMITER) return missing;
	const end = lines.indexOf(FRONT_MATTER_DELIMITER, 1);
	if (end === -1) return missing;
	const inside = lines.slice(1, end);
	const invalid = (paths: readonly string[], extraKeys: readonly string[]) =>
		({
			status: "invalid",
			frontMatter: null,
			bodyStart: end + 1,
			invalidPaths: paths,
			extraKeys,
			lines: inside,
		}) satisfies FrontMatterRead;
	let raw: unknown;
	try {
		raw = JSON.parse(inside.join("\n"));
	} catch {
		return invalid([""], []);
	}
	if (!isPlainObject(raw)) return invalid([""], []);
	const extraKeys = extraKeysOf(raw);
	const parsed = planFrontMatterSchema.safeParse(raw);
	if (!parsed.success) return invalid(pathsOf(parsed.error), extraKeys);
	return {
		status: "valid",
		frontMatter: parsed.data,
		bodyStart: end + 1,
		invalidPaths: [],
		extraKeys,
		lines: inside,
	};
}

export function frontMatterKeyLine(read: FrontMatterRead, key: string): number {
	const quoted = `"${key}"`;
	for (const [index, line] of read.lines.entries()) {
		const at = line.indexOf(quoted);
		if (at !== -1 && /^\s*:/.test(line.slice(at + quoted.length))) {
			return index + 2;
		}
	}
	return 1;
}
