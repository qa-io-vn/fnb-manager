import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
	packEstimate,
	TRIM_STEP_IDS,
	TRIM_STEPS,
	trimStepId,
	trimToBudget,
	withEstimate,
} from "../../src/pack/budget.js";
import { canonicalJson } from "../../src/pack/canonical.js";
import { DataPackError } from "../../src/pack/errors.js";
import {
	estimateTokens,
	packSize,
	TOKEN_FLOOR,
	TOKEN_LIMIT,
	utf8Length,
} from "../../src/pack/estimate.js";
import type { DataPack, PackTable } from "../../src/pack/schema.js";
import { draftPack } from "./format-fixtures.js";

const LABELS = Array.from({ length: 10 }, (_, index) => `S${index + 1}`);

function storeId(index: number): string {
	return `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`;
}

function wideTable(width: number, scopes: readonly string[]): PackTable {
	return {
		title: "Bảng tổng hợp",
		grain: "store-period",
		window: "w28",
		notes: "",
		columns: [{ name: "label", unit: "text" }],
		rows: Object.fromEntries(
			scopes.map((scope) => [`${scope}/r01`, ["x".repeat(width)]]),
		),
	};
}

function tenStorePack(width: number, extra: Record<string, PackTable> = {}) {
	const draft = draftPack();
	const scopes = ["ALL", ...LABELS];
	const tables: Record<string, PackTable> = { ...extra };
	for (const step of TRIM_STEPS) {
		tables[step.table] = wideTable(width, scopes);
	}
	return {
		...draft,
		request: {
			...draft.request,
			stores: LABELS.map((label, index) => ({ id: storeId(index), label })),
		},
		tables,
	} satisfies DataPack;
}

function applySteps(pack: DataPack, count: number): DataPack {
	let tables = { ...pack.tables };
	for (const step of TRIM_STEPS.slice(0, count)) {
		const table = tables[step.table];
		if (table === undefined) continue;
		if (step.action === "drop") {
			const { [step.table]: _dropped, ...rest } = tables;
			tables = rest;
		} else {
			tables[step.table] = {
				...table,
				rows: Object.fromEntries(
					Object.entries(table.rows).filter(([key]) => key.startsWith("ALL/")),
				),
			};
		}
	}
	return {
		...pack,
		tables,
		budget: {
			...pack.budget,
			trimmed: TRIM_STEP_IDS.slice(0, count),
		},
	};
}

describe("estimateTokens", () => {
	it("is ceil(UTF-8 bytes × 5 ÷ 11)", () => {
		expect(estimateTokens("")).toBe(0);
		expect(estimateTokens("a")).toBe(1);
		expect(estimateTokens("a".repeat(11))).toBe(5);
		expect(estimateTokens("a".repeat(12))).toBe(6);
		expect(estimateTokens("a".repeat(22))).toBe(10);
		expect(estimateTokens("a".repeat(23))).toBe(11);
		expect(estimateTokens("ữ")).toBe(2);
		expect(estimateTokens("\u{1f600}")).toBe(2);
		expect(estimateTokens("a".repeat(66000))).toBe(TOKEN_LIMIT);
		expect(estimateTokens("a".repeat(66001))).toBe(TOKEN_LIMIT + 1);
		expect(estimateTokens("a".repeat(1_100_000))).toBe(500_000);
	});

	it("counts UTF-8 bytes like an independent encoder", () => {
		for (const text of [
			"Trà sữa trân châu",
			"Trè sữa",
			"\u{1f600}｡ ",
			"\ud800",
			canonicalJson(draftPack()),
		]) {
			expect(utf8Length(text)).toBe(Buffer.byteLength(text, "utf8"));
		}
	});

	it("reports a pack under 15,000 as small and refuses only above 30,000", () => {
		expect(packSize(0)).toBe("small");
		expect(packSize(TOKEN_FLOOR - 1)).toBe("small");
		expect(packSize(TOKEN_FLOOR)).toBe("within_budget");
		expect(packSize(TOKEN_LIMIT)).toBe("within_budget");
		expect(packSize(TOKEN_LIMIT + 1)).toBe("over_budget");
	});
});

describe("the estimate of a pack", () => {
	it("equals the estimate of its own canonical text, across digit boundaries", () => {
		const draft = draftPack();
		const bare = {
			...draft,
			prompt: { ...draft.prompt, text: "" },
			tables: {},
		};
		const base = utf8Length(canonicalJson(bare));
		const targets = [1000, 10000];
		let crossed = 0;
		for (const target of targets) {
			const around = Math.ceil((target * 11) / 5) - base;
			for (let padding = around - 30; padding <= around + 30; padding += 1) {
				const pack = withEstimate({
					...bare,
					prompt: { ...bare.prompt, text: "x".repeat(padding) },
				});
				const estimate = pack.budget.estimated_tokens;
				expect(estimateTokens(canonicalJson(pack))).toBe(estimate);
				if (estimate === target) crossed += 1;
			}
		}
		expect(crossed).toBeGreaterThan(0);
	});

	it("does not depend on the values of pack_id and generated_at", () => {
		const draft = draftPack();
		expect(
			packEstimate({
				...draft,
				pack_id: "",
				generated_at: "",
				budget: { ...draft.budget, estimated_tokens: 77 },
			}),
		).toBe(packEstimate(draft));
	});
});

describe("trimToBudget", () => {
	it("declares eight steps with unique ids", () => {
		expect(TRIM_STEPS).toHaveLength(8);
		expect(new Set(TRIM_STEP_IDS).size).toBe(8);
		expect(TRIM_STEP_IDS).toEqual(TRIM_STEPS.map(trimStepId));
		expect(TRIM_STEP_IDS[0]).toBe("heatmap_invoices:drop");
	});

	it("leaves a pack within budget untouched and records the estimate", () => {
		const draft = draftPack();
		const pack = trimToBudget(draft);
		expect(pack.tables).toBe(draft.tables);
		expect(pack.budget).toEqual({
			estimated_tokens: packEstimate(pack),
			limit: TOKEN_LIMIT,
			trimmed: [],
		});
	});

	it("trims a ten-store pack in the declared order, stopping once it fits", () => {
		const draft = tenStorePack(1200);
		expect(packEstimate(draft)).toBeGreaterThan(TOKEN_LIMIT);
		const pack = trimToBudget(draft);
		const count = pack.budget.trimmed.length;
		expect(count).toBeGreaterThan(1);
		expect(count).toBeLessThan(TRIM_STEPS.length);
		expect(pack.budget.trimmed).toEqual(TRIM_STEP_IDS.slice(0, count));
		expect(pack.budget.estimated_tokens).toBeLessThanOrEqual(TOKEN_LIMIT);
		expect(pack.budget.estimated_tokens).toBe(packEstimate(pack));
		expect(packEstimate(applySteps(draft, count - 1))).toBeGreaterThan(
			TOKEN_LIMIT,
		);
		expect(pack.tables).toEqual(applySteps(draft, count).tables);
		expect(Object.keys(pack.tables)).not.toContain("heatmap_invoices");
		expect(Object.keys(pack.tables.pairs?.rows ?? {})).toEqual(["ALL/r01"]);
	});

	it("records only the steps that changed the pack", () => {
		const { pairs: _pairs, ...tables } = tenStorePack(1200).tables;
		const pack = trimToBudget({ ...tenStorePack(1200), tables });
		expect(pack.budget.trimmed).not.toContain("pairs:all_only");
		expect(pack.budget.trimmed[0]).toBe("heatmap_invoices:drop");
		expect(pack.budget.trimmed[1]).toBe("modifiers:all_only");
	});

	it("fails with pack_over_budget after the last step, having applied every step", () => {
		const draft = tenStorePack(600, { kpi: wideTable(70000, ["ALL"]) });
		let thrown: unknown;
		try {
			trimToBudget(draft);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(DataPackError);
		expect((thrown as DataPackError).code).toBe("pack_over_budget");
		expect((thrown as DataPackError).message).toContain(
			TRIM_STEP_IDS.join(", "),
		);
		expect(packEstimate(applySteps(draft, TRIM_STEPS.length))).toBeGreaterThan(
			TOKEN_LIMIT,
		);
	});
});
