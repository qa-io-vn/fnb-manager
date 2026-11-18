import { describe, expect, it } from "vitest";
import { TRIM_STEP_IDS } from "../../src/pack/budget.js";
import { TOKEN_LIMIT } from "../../src/pack/estimate.js";
import { validatePack } from "../../src/pack/invariants.js";
import { PACK_LANGUAGES } from "../../src/pack/request.js";
import type { DataPack, PackTable } from "../../src/pack/schema.js";
import { sealPack } from "../../src/pack/seal.js";
import { strategyPrompt } from "../../src/prompt/prompt.js";
import {
	buildWith,
	demoRequest,
	demoSource,
	GOLDEN_FOCUS,
} from "./support/demo.js";

const TEMPLATE_LABEL = "S1";

function relabelled(key: string, label: string): string | null {
	if (key === TEMPLATE_LABEL) return label;
	if (key.startsWith(`${TEMPLATE_LABEL}/`)) {
		return label + key.slice(TEMPLATE_LABEL.length);
	}
	if (key.endsWith(`/${TEMPLATE_LABEL}`)) {
		return key.slice(0, -TEMPLATE_LABEL.length) + label;
	}
	return null;
}

function widened(pack: DataPack, storeCount: number): DataPack {
	const labels = Array.from(
		{ length: storeCount - pack.request.stores.length },
		(_, index) => `S${pack.request.stores.length + index + 1}`,
	);
	const tables: Record<string, PackTable> = {};
	for (const [id, table] of Object.entries(pack.tables)) {
		const rows = { ...table.rows };
		for (const label of labels) {
			for (const [key, cells] of Object.entries(table.rows)) {
				const copy = relabelled(key, label);
				if (copy !== null) rows[copy] = cells;
			}
		}
		tables[id] = { ...table, rows };
	}
	return {
		...pack,
		budget: { ...pack.budget, estimated_tokens: 0, trimmed: [] },
		pack_id: "",
		request: {
			...pack.request,
			stores: [
				...pack.request.stores,
				...labels.map((label) => ({ id: `MOCK-${label}`, label })),
			],
		},
		tables,
	};
}

describe("the budget with prompt 1.0.0", () => {
	it("fits one to three stores untrimmed and four stores after trimming, in both languages", async () => {
		const source = demoSource();
		for (const language of PACK_LANGUAGES) {
			const one = await buildWith(
				source,
				demoRequest({
					storeIds: ["MOCK-S1"],
					language,
					focus: GOLDEN_FOCUS,
				}),
			);
			const two = await buildWith(
				source,
				demoRequest({ language, focus: GOLDEN_FOCUS }),
			);
			expect(two.pack.prompt).toEqual(strategyPrompt(language));
			const three = await sealPack(widened(two.pack, 3));
			const four = await sealPack(widened(two.pack, 4));
			for (const [stores, sealed] of [
				[1, one],
				[2, two],
				[3, three],
				[4, four],
			] as const) {
				const validation = await validatePack(sealed.pack);
				expect(validation.issues, `${language}, ${stores} stores`).toEqual([]);
				expect(sealed.pack.request.stores).toHaveLength(stores);
				expect(sealed.estimatedTokens).toBeLessThanOrEqual(TOKEN_LIMIT);
			}
			for (const sealed of [one, two, three]) {
				expect(sealed.pack.budget.trimmed).toEqual([]);
			}
			const steps = four.pack.budget.trimmed;
			expect(steps.length).toBeGreaterThan(0);
			expect(steps).toEqual(TRIM_STEP_IDS.slice(0, steps.length));
		}
	});
});
