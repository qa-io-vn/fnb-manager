import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
	jsonSchemaDocument,
	SCHEMA_DOCUMENTS,
} from "../../scripts/schema-documents.js";
import { dataPackSchema, STORE_ID_PATTERN } from "../../src/pack/schema.js";
import { sealPack } from "../../src/pack/seal.js";
import { planFrontMatterSchema } from "../../src/plan/front-matter.js";
import { draftPack, samplePackDraft } from "./format-fixtures.js";

const packageRoot = join(import.meta.dirname, "..", "..");

type Json = Record<string, unknown>;

function committed(file: string): Json {
	return JSON.parse(readFileSync(join(packageRoot, "schema", file), "utf8"));
}

function asJson(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value));
}

function filesEndingWith(directory: string, suffix: string): string[] {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? filesEndingWith(join(directory, entry.name), suffix)
			: entry.name.endsWith(suffix)
				? [join(directory, entry.name)]
				: [],
	);
}

function jsonFiles(directory: string): string[] {
	return filesEndingWith(directory, ".json");
}

function frontMatterOf(text: string): { readonly value: unknown } | null {
	const lines = text.split(/\r?\n/);
	if (lines[0] !== "---") return null;
	const end = lines.indexOf("---", 1);
	if (end === -1) return null;
	try {
		return { value: JSON.parse(lines.slice(1, end).join("\n")) };
	} catch {
		return null;
	}
}

function compiled(file: string) {
	const ajv = new Ajv2020({
		allErrors: true,
		strict: true,
		allowUnionTypes: true,
	});
	return ajv.compile(committed(file));
}

const PACK_ID = "a".repeat(64);

function planFrontMatter(): Json {
	return {
		format: "fnb-plan/1",
		pack: PACK_ID,
		title: "Kế hoạch 90 ngày",
		horizon: "90d",
		language: "vi",
		kpis: {
			avg_ticket: {
				scope: "ALL",
				target: 55000,
				baseline: 52314.27,
				initiatives: [1, 2],
			},
			items_per_invoice: { scope: "S2", target: 1.9, initiatives: [3] },
		},
	};
}

function withKpi(entry: Json): Json {
	return { ...planFrontMatter(), kpis: { avg_ticket: entry } };
}

describe("the committed JSON Schema files", () => {
	it("equal the generated ones, key order included", () => {
		for (const document of SCHEMA_DOCUMENTS) {
			const generated = jsonSchemaDocument(document);
			expect(JSON.stringify(committed(document.file))).toBe(
				JSON.stringify(generated),
			);
		}
	});

	it("are draft 2020-12 with their urn ids", () => {
		expect(committed("fnb-datapack-1.schema.json").$schema).toBe(
			"https://json-schema.org/draft/2020-12/schema",
		);
		expect(committed("fnb-datapack-1.schema.json").$id).toBe(
			"urn:fnb:datapack:1",
		);
		expect(committed("fnb-plan-1.schema.json").$id).toBe("urn:fnb:plan:1");
	});

	it("describe the input type: the plan schema does not require scope", () => {
		const plan = committed("fnb-plan-1.schema.json") as {
			properties: {
				kpis: {
					additionalProperties: { required: string[]; properties: Json };
				};
			};
		};
		const kpi = plan.properties.kpis.additionalProperties;
		expect(kpi.required).toEqual(["target", "initiatives"]);
		expect(kpi.properties.scope).toMatchObject({ default: "ALL" });
	});

	it("keep the store id pattern of the zod schema", () => {
		const pack = committed("fnb-datapack-1.schema.json") as {
			properties: {
				request: {
					properties: {
						stores: { items: { properties: { id: { pattern: string } } } };
					};
				};
			};
		};
		expect(
			pack.properties.request.properties.stores.items.properties.id.pattern,
		).toBe(STORE_ID_PATTERN.source);
	});
});

describe("Ajv 2020 and zod", () => {
	it("reach the same verdict on valid and invalid packs", async () => {
		const validate = compiled("fnb-datapack-1.schema.json");
		const live = (await sealPack(draftPack())).pack as unknown as Json;
		const sample = (await sealPack(samplePackDraft())).pack as unknown as Json;
		const request = live.request as Json;
		const stores = request.stores as Json[];
		const kpi = (live.tables as Json).kpi as Json;
		const calendar = live.calendar as Json;
		const budget = live.budget as Json;
		const context = live.context as Json;
		const valid: [string, Json][] = [
			["live", live],
			["sample", sample],
			["no tables", { ...live, tables: {} }],
			["window null", { ...live, tables: { kpi: { ...kpi, window: null } } }],
			[
				"owner note",
				{ ...live, request: { ...request, owner_note: "Ghi chú" } },
			],
			["no focus", { ...live, request: { ...request, focus: null } }],
			[
				"unknown store pairing left to the invariants",
				{ ...live, sample: true },
			],
		];
		const invalid: [string, Json][] = [
			["extra key", { ...live, extra: true }],
			[
				"missing pack_id",
				Object.fromEntries(
					Object.entries(live).filter(([key]) => key !== "pack_id"),
				),
			],
			["upper-case pack_id", { ...live, pack_id: "A".repeat(64) }],
			[
				"generated_at with milliseconds",
				{ ...live, generated_at: "2026-11-12T03:00:00.000Z" },
			],
			["another format", { ...live, format: "fnb-datapack/2" }],
			["short version", { ...live, schema_version: "1.0" }],
			["no stores", { ...live, request: { ...request, stores: [] } }],
			[
				"eleven stores",
				{
					...live,
					request: {
						...request,
						stores: Array.from({ length: 11 }, (_, index) => ({
							id: `MOCK-S${index + 1}`,
							label: `S${index + 1}`,
						})),
					},
				},
			],
			[
				"store id shape",
				{
					...live,
					request: { ...request, stores: [{ id: "store-1", label: "S1" }] },
				},
			],
			[
				"upper-case UUID",
				{
					...live,
					request: {
						...request,
						stores: [
							{ ...stores[0], id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
						],
					},
				},
			],
			[
				"store label",
				{
					...live,
					request: { ...request, stores: [{ ...stores[0], label: "s1" }] },
				},
			],
			["currency", { ...live, request: { ...request, currency: "vnd" } }],
			["horizon", { ...live, request: { ...request, horizon: "60d" } }],
			["language", { ...live, request: { ...request, language: "fr" } }],
			["table id", { ...live, tables: { Items: kpi } }],
			["grain", { ...live, tables: { kpi: { ...kpi, grain: "invoice" } } }],
			["window", { ...live, tables: { kpi: { ...kpi, window: "w7" } } }],
			[
				"unit",
				{
					...live,
					tables: {
						kpi: { ...kpi, columns: [{ name: "w28", unit: "percent" }] },
					},
				},
			],
			[
				"column name",
				{
					...live,
					tables: {
						kpi: { ...kpi, columns: [{ name: "W28", unit: "metric" }] },
					},
				},
			],
			[
				"numeric row key",
				{ ...live, tables: { kpi: { ...kpi, rows: { "123": [1] } } } },
			],
			[
				"row key with a space",
				{ ...live, tables: { kpi: { ...kpi, rows: { "ALL r01": [1] } } } },
			],
			[
				"object cell",
				{ ...live, tables: { kpi: { ...kpi, rows: { "ALL/x": [{}] } } } },
			],
			[
				"array cell",
				{ ...live, tables: { kpi: { ...kpi, rows: { "ALL/x": [[1]] } } } },
			],
			[
				"missing notes",
				{
					...live,
					tables: {
						kpi: Object.fromEntries(
							Object.entries(kpi).filter(([key]) => key !== "notes"),
						),
					},
				},
			],
			[
				"short rule",
				{
					...live,
					context: { ...context, rules: [["a", "VN", "2026-01-01"]] },
				},
			],
			[
				"rule date",
				{
					...live,
					context: { ...context, rules: [["a", "VN", "1/1/2026", "x"]] },
				},
			],
			[
				"numeric benchmark",
				{ ...live, context: { ...context, benchmarks: [["a", "b", "c", 1]] } },
			],
			[
				"negative estimate",
				{ ...live, budget: { ...budget, estimated_tokens: -1 } },
			],
			[
				"fractional estimate",
				{ ...live, budget: { ...budget, estimated_tokens: 1.5 } },
			],
			["zero limit", { ...live, budget: { ...budget, limit: 0 } }],
			[
				"missing window",
				{
					...live,
					calendar: Object.fromEntries(
						Object.entries(calendar).filter(([key]) => key !== "band"),
					),
				},
			],
			[
				"extra window",
				{ ...live, calendar: { ...calendar, b1: calendar.band } },
			],
			[
				"range with an extra key",
				{
					...live,
					calendar: {
						...calendar,
						band: { ...(calendar.band as Json), days: 84 },
					},
				},
			],
			[
				"prompt id",
				{ ...live, prompt: { ...(live.prompt as Json), id: "other" } },
			],
			["sample as text", { ...live, sample: "false" }],
			["not an object", [] as unknown as Json],
		];
		for (const [name, value] of [...valid, ...invalid]) {
			const json = asJson(value);
			const zod = dataPackSchema.safeParse(json).success;
			expect(validate(json), name).toBe(zod);
			expect(zod, name).toBe(valid.some(([validName]) => validName === name));
		}
	});

	it("reach the same verdict on every pack fixture file", () => {
		const validate = compiled("fnb-datapack-1.schema.json");
		const files = [
			...jsonFiles(join(packageRoot, "test", "fixtures")),
			...jsonFiles(join(packageRoot, "test", "pack", "fixtures")),
		];
		for (const file of files) {
			const value: unknown = JSON.parse(readFileSync(file, "utf8"));
			if ((value as Json | null)?.format !== "fnb-datapack") continue;
			expect(validate(value), file).toBe(
				dataPackSchema.safeParse(value).success,
			);
		}
	});

	it("reach the same verdict on the front matter of every plan fixture file", () => {
		const validate = compiled("fnb-plan-1.schema.json");
		const verdicts = filesEndingWith(join(packageRoot, "test"), ".md").flatMap(
			(file) => {
				const frontMatter = frontMatterOf(readFileSync(file, "utf8"));
				if (frontMatter === null) return [];
				const zod = planFrontMatterSchema.safeParse(frontMatter.value).success;
				expect(validate(frontMatter.value), file).toBe(zod);
				return [zod];
			},
		);
		expect(verdicts.length).toBeGreaterThan(0);
	});

	it("reach the same verdict on plan front matter, valid or not", () => {
		const validate = compiled("fnb-plan-1.schema.json");
		const valid: [string, unknown][] = [
			["full", planFrontMatter()],
			["without scope", withKpi({ target: 55000, initiatives: [1] })],
			["unknown key", { ...planFrontMatter(), author: "chủ quán" }],
			["unknown kpi key", withKpi({ target: 1, initiatives: [1], note: "x" })],
			["no kpis", { ...planFrontMatter(), kpis: {} }],
			["store scope", withKpi({ scope: "S10", target: 1, initiatives: [7] })],
		];
		const invalid: [string, unknown][] = [
			["initiative 8", withKpi({ target: 1, initiatives: [8] })],
			["initiative 0", withKpi({ target: 1, initiatives: [0] })],
			["fractional initiative", withKpi({ target: 1, initiatives: [1.5] })],
			["no initiatives", withKpi({ target: 1, initiatives: [] })],
			["missing target", withKpi({ initiatives: [1] })],
			["text target", withKpi({ target: "55000", initiatives: [1] })],
			[
				"text baseline",
				withKpi({ target: 1, baseline: "1", initiatives: [1] }),
			],
			["scope S100", withKpi({ scope: "S100", target: 1, initiatives: [1] })],
			[
				"kpi id",
				{
					...planFrontMatter(),
					kpis: { AvgTicket: { target: 1, initiatives: [1] } },
				},
			],
			["pack hash", { ...planFrontMatter(), pack: "abc" }],
			["format", { ...planFrontMatter(), format: "fnb-plan/2" }],
			["empty title", { ...planFrontMatter(), title: "" }],
			["long title", { ...planFrontMatter(), title: "x".repeat(121) }],
			["language", { ...planFrontMatter(), language: "fr" }],
			["horizon", { ...planFrontMatter(), horizon: "1y" }],
			[
				"missing kpis",
				Object.fromEntries(
					Object.entries(planFrontMatter()).filter(([key]) => key !== "kpis"),
				),
			],
			["not an object", "---"],
		];
		for (const [name, value] of [...valid, ...invalid]) {
			const zod = planFrontMatterSchema.safeParse(value).success;
			expect(validate(value), name).toBe(zod);
			expect(zod, name).toBe(valid.some(([validName]) => validName === name));
		}
	});
});
