import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { aggregatesOnlyIssues } from "../../src/pack/aggregates.js";
import type { BuiltPack } from "../../src/pack/build.js";
import { canonicalJson } from "../../src/pack/canonical.js";
import { TOKEN_LIMIT } from "../../src/pack/estimate.js";
import { parsePack } from "../../src/pack/invariants.js";
import {
	buildGoldenPack,
	DEMO_STORE_IDS,
	demoSource,
	GOLDEN_AS_OF,
	GOLDEN_FOCUS,
} from "./support/demo.js";

const GOLDEN_PATH = join(
	import.meta.dirname,
	"..",
	"fixtures",
	"demo-pack.json",
);

function goldenText(): string {
	return canonicalJson(JSON.parse(readFileSync(GOLDEN_PATH, "utf8")));
}

describe("the golden demo pack", () => {
	let built: BuiltPack;

	beforeAll(async () => {
		built = await buildGoldenPack(demoSource());
	});

	it("is reproduced byte for byte at the fixed clock", () => {
		expect(built.text).toBe(goldenText());
	});

	it("validates, stays within budget and holds aggregates only", async () => {
		const parsed = await parsePack(goldenText());
		expect(parsed.issues).toEqual([]);
		expect(parsed.valid).toBe(true);
		expect(parsed.packId).toBe(built.packId);
		const pack = parsed.pack;
		if (pack === null) throw new Error("the golden pack did not parse");
		expect(aggregatesOnlyIssues(pack)).toEqual([]);
		expect(pack.budget.estimated_tokens).toBeLessThanOrEqual(TOKEN_LIMIT);
		expect(pack.budget.trimmed).toEqual([]);
	});

	it("is a synthetic sample of the two demo stores", () => {
		const pack = built.pack;
		expect(pack.sample).toBe(true);
		expect(pack.request.stores).toEqual([
			{ id: DEMO_STORE_IDS[0], label: "S1" },
			{ id: DEMO_STORE_IDS[1], label: "S2" },
		]);
		expect(pack.request.as_of).toBe(GOLDEN_AS_OF);
		expect(pack.request.focus).toBe(GOLDEN_FOCUS);
		expect(pack.generated_at).toBe("2026-11-12T03:00:00Z");
		const tablesText = JSON.stringify(pack.tables);
		for (const id of DEMO_STORE_IDS) expect(tablesText).not.toContain(id);
	});

	it("holds every table of the pack", () => {
		expect(Object.keys(built.pack.tables).sort()).toEqual(
			[
				"calendar",
				"categories",
				"gaps",
				"heatmap_invoices",
				"heatmap_net",
				"hour_levels",
				"items",
				"kpi",
				"metrics",
				"modifiers",
				"month_to_date",
				"monthly",
				"pairs",
				"payments",
				"promotions",
				"shifts",
				"sizes",
				"stores",
				"weekday",
				"weekly",
			].sort(),
		);
	});
});
