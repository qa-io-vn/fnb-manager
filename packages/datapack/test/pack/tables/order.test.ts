import { beforeAll, describe, expect, it } from "vitest";
import type { BuiltPack } from "../../../src/pack/build.js";
import { canonicalJson } from "../../../src/pack/canonical.js";
import { buildWith, demoRequest, demoSource } from "../support/demo.js";
import { shuffled, shuffledSource } from "../support/sources.js";

const RANKED_TABLES = [
	"items",
	"categories",
	"sizes",
	"pairs",
	"modifiers",
	"payments",
	"promotions",
	"calendar",
] as const;

describe("the declared orders", () => {
	let plain: BuiltPack;
	let shuffledPacks: BuiltPack[];

	beforeAll(async () => {
		const base = demoSource();
		plain = await buildWith(base, demoRequest());
		shuffledPacks = [];
		for (const seed of [1, 7, 2026]) {
			shuffledPacks.push(
				await buildWith(shuffledSource(base, seed), demoRequest()),
			);
		}
	});

	it("shuffles the source rows for real", () => {
		const rows = Array.from({ length: 20 }, (_, index) => index);
		expect(shuffled(rows, 7)).not.toEqual(rows);
		expect([...shuffled(rows, 7)].sort((a, b) => a - b)).toEqual(rows);
	});

	it("gives the same rank keys and bytes for every ranked table", () => {
		for (const built of shuffledPacks) {
			for (const id of RANKED_TABLES) {
				const table = built.pack.tables[id];
				const expected = plain.pack.tables[id];
				expect(Object.keys(table?.rows ?? {}).sort(), id).toEqual(
					Object.keys(expected?.rows ?? {}).sort(),
				);
				expect(canonicalJson(table ?? null), id).toBe(
					canonicalJson(expected ?? null),
				);
			}
		}
	});

	it("gives the same bytes for the whole pack", () => {
		for (const built of shuffledPacks) {
			expect(built.text).toBe(plain.text);
		}
	});

	it("numbers the ranks of each scope from r01 without a hole", () => {
		for (const id of RANKED_TABLES.filter((table) => table !== "calendar")) {
			const byScope = new Map<string, string[]>();
			for (const key of Object.keys(plain.pack.tables[id]?.rows ?? {})) {
				const [scope, rank] = key.split("/");
				byScope.set(scope ?? "", [
					...(byScope.get(scope ?? "") ?? []),
					rank ?? "",
				]);
			}
			expect(byScope.size, id).toBeGreaterThan(0);
			for (const [scope, ranks] of byScope) {
				expect(ranks.sort(), `${id} ${scope}`).toEqual(
					ranks.map((_, index) => `r${String(index + 1).padStart(2, "0")}`),
				);
			}
		}
	});
});
