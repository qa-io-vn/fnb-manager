import { beforeAll, describe, expect, it } from "vitest";
import type { BuiltPack } from "../../../src/pack/build.js";
import { rowScope } from "../../../src/pack/schema.js";
import { buildWith, demoRequest, demoSource } from "../support/demo.js";
import { overriddenSource } from "../support/sources.js";

const SQL_LABELS: Readonly<Record<string, string>> = {
	"MOCK-S1": "S3",
	"MOCK-S2": "S7",
};

describe("store labels", () => {
	let built: BuiltPack;

	beforeAll(async () => {
		built = await buildWith(
			overriddenSource(demoSource(), {
				store_profiles: (rows) =>
					rows.map((row) => ({
						...row,
						label: SQL_LABELS[row.store_id as string] ?? row.label,
					})),
			}),
			demoRequest({ storeIds: ["MOCK-S2", "MOCK-S1"] }),
		);
	});

	it("come from SQL and order the stores of the request", () => {
		expect(built.pack.request.stores).toEqual([
			{ id: "MOCK-S1", label: "S3" },
			{ id: "MOCK-S2", label: "S7" },
		]);
		expect(Object.keys(built.pack.tables.stores?.rows ?? {})).toEqual([
			"S3",
			"S7",
		]);
	});

	it("are the only names of stores in the tables", () => {
		const scopes = new Set<string>();
		for (const [tableId, table] of Object.entries(built.pack.tables)) {
			for (const key of Object.keys(table.rows)) {
				const scope = tableId === "gaps" ? key.split("/")[1] : rowScope(key);
				if (scope !== undefined && /^S\d+$/.test(scope)) scopes.add(scope);
			}
		}
		expect([...scopes].sort()).toEqual(["S3", "S7"]);
		const tablesText = JSON.stringify(built.pack.tables);
		expect(tablesText).not.toContain("MOCK-S1");
		expect(tablesText).not.toContain("MOCK-S2");
		expect(JSON.stringify(built.pack.context)).not.toContain("MOCK-S");
	});
});
