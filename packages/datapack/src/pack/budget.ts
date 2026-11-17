import { canonicalJson } from "./canonical.js";
import { formatDecimal } from "./decimal.js";
import { DataPackError } from "./errors.js";
import { TOKEN_LIMIT, tokensForBytes, utf8Length } from "./estimate.js";
import {
	ALL_SCOPE,
	type DataPack,
	type PackTable,
	rowScope,
} from "./schema.js";

export const TRIM_ACTIONS = ["drop", "all_only"] as const;

export type TrimAction = (typeof TRIM_ACTIONS)[number];

export interface TrimStep {
	readonly table: string;
	readonly action: TrimAction;
}

export const TRIM_STEPS: readonly TrimStep[] = [
	{ table: "heatmap_invoices", action: "drop" },
	{ table: "pairs", action: "all_only" },
	{ table: "modifiers", action: "all_only" },
	{ table: "sizes", action: "all_only" },
	{ table: "hour_levels", action: "all_only" },
	{ table: "heatmap_net", action: "all_only" },
	{ table: "monthly", action: "all_only" },
	{ table: "items", action: "all_only" },
];

export function trimStepId(step: TrimStep): string {
	return `${step.table}:${step.action}`;
}

export const TRIM_STEP_IDS: readonly string[] = TRIM_STEPS.map(trimStepId);

const PACK_ID_PLACEHOLDER = "0".repeat(64);
const GENERATED_AT_PLACEHOLDER = "0000-00-00T00:00:00Z";

export function packEstimate(pack: DataPack): number {
	const zero = canonicalJson({
		...pack,
		budget: { ...pack.budget, estimated_tokens: 0 },
		generated_at: GENERATED_AT_PLACEHOLDER,
		pack_id: PACK_ID_PLACEHOLDER,
	});
	const otherBytes = utf8Length(zero) - formatDecimal(0).length;
	let estimate = 0;
	for (;;) {
		const next = tokensForBytes(otherBytes + formatDecimal(estimate).length);
		if (next === estimate) return estimate;
		estimate = next;
	}
}

export function withEstimate(pack: DataPack): DataPack {
	return {
		...pack,
		budget: { ...pack.budget, estimated_tokens: packEstimate(pack) },
	};
}

function trimTable(
	tables: DataPack["tables"],
	step: TrimStep,
): DataPack["tables"] {
	const table = tables[step.table];
	if (table === undefined || !Object.hasOwn(tables, step.table)) return tables;
	if (step.action === "drop") {
		return Object.fromEntries(
			Object.entries(tables).filter(([id]) => id !== step.table),
		);
	}
	const kept = Object.entries(table.rows).filter(
		([key]) => rowScope(key) === ALL_SCOPE,
	);
	if (kept.length === Object.keys(table.rows).length) return tables;
	const trimmed: PackTable = { ...table, rows: Object.fromEntries(kept) };
	return { ...tables, [step.table]: trimmed };
}

function budgeted(
	draft: DataPack,
	tables: DataPack["tables"],
	trimmed: readonly string[],
): DataPack {
	return withEstimate({
		...draft,
		tables,
		budget: { estimated_tokens: 0, limit: TOKEN_LIMIT, trimmed: [...trimmed] },
	});
}

export function trimToBudget(draft: DataPack): DataPack {
	const trimmed: string[] = [];
	let tables = draft.tables;
	let pack = budgeted(draft, tables, trimmed);
	for (const step of TRIM_STEPS) {
		if (pack.budget.estimated_tokens <= TOKEN_LIMIT) return pack;
		const next = trimTable(tables, step);
		if (next === tables) continue;
		tables = next;
		trimmed.push(trimStepId(step));
		pack = budgeted(draft, tables, trimmed);
	}
	if (pack.budget.estimated_tokens > TOKEN_LIMIT) {
		throw new DataPackError(
			"pack_over_budget",
			`the pack is estimated at ${pack.budget.estimated_tokens} tokens, above ${TOKEN_LIMIT}, after trimming ${trimmed.length === 0 ? "nothing" : trimmed.join(", ")}`,
		);
	}
	return pack;
}
