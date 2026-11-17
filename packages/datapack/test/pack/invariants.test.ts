import { describe, expect, it, vi } from "vitest";
import {
	TRIM_STEP_IDS,
	TRIM_STEPS,
	withEstimate,
} from "../../src/pack/budget.js";
import { canonicalJson } from "../../src/pack/canonical.js";
import { TOKEN_LIMIT } from "../../src/pack/estimate.js";
import { packIdOf } from "../../src/pack/hash.js";
import {
	checkPackInvariants,
	comparePackTexts,
	parsePack,
	validatePack,
} from "../../src/pack/invariants.js";
import type { DataPack, PackCell, PackTable } from "../../src/pack/schema.js";
import { sealPack } from "../../src/pack/seal.js";
import { UNAVAILABLE_AS_OF } from "./fixture-calendar.js";
import {
	draftPack,
	itemsTable,
	reorderKeys,
	SEED_STORE_A,
	SEED_STORE_B,
	samplePackDraft,
} from "./format-fixtures.js";

vi.mock("../../src/pack/calendar.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../src/pack/calendar.js")>();
	const { fixtureCalendarOf } = await import("./fixture-calendar.js");
	return { ...actual, calendarOf: fixtureCalendarOf };
});

async function sealed(mutate: (draft: DataPack) => DataPack = (d) => d) {
	return (await sealPack(mutate(draftPack()))).pack;
}

async function refreshed(pack: DataPack): Promise<DataPack> {
	const estimated = withEstimate(pack);
	return { ...estimated, pack_id: await packIdOf(estimated) };
}

async function codesOf(value: unknown): Promise<string[]> {
	return (await validatePack(value)).issues.map((issue) => issue.code);
}

function withItemRow(pack: DataPack, row: PackCell[]): DataPack {
	const items = pack.tables.items as PackTable;
	return {
		...pack,
		tables: {
			...pack.tables,
			items: { ...items, rows: { ...items.rows, "ALL/r02": row } },
		},
	};
}

function tenStoreDraft(): DataPack {
	const draft = draftPack();
	const labels = Array.from({ length: 10 }, (_, index) => `S${index + 1}`);
	const wide: PackTable = {
		title: "Bảng tổng hợp",
		grain: "store-period",
		window: "w28",
		notes: "",
		columns: [{ name: "label", unit: "text" }],
		rows: Object.fromEntries(
			["ALL", ...labels].map((scope) => [`${scope}/r01`, ["x".repeat(1200)]]),
		),
	};
	return {
		...draft,
		request: {
			...draft.request,
			stores: labels.map((label, index) => ({
				id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`,
				label,
			})),
		},
		tables: {
			...draft.tables,
			...Object.fromEntries(TRIM_STEPS.map((step) => [step.table, wide])),
		},
	};
}

function withItemCell(pack: DataPack, index: number, cell: PackCell): DataPack {
	const row = [...((pack.tables.items as PackTable).rows["ALL/r02"] ?? [])];
	row[index] = cell;
	return withItemRow(pack, row);
}

describe("validatePack", () => {
	it("accepts a sealed pack, live or sample", async () => {
		const pack = await sealed();
		const validation = await validatePack(pack);
		expect(validation).toEqual({ valid: true, pack, issues: [] });
		expect(await checkPackInvariants(pack)).toEqual([]);
		const sample = (await sealPack(samplePackDraft())).pack;
		expect((await validatePack(sample)).issues).toEqual([]);
	});

	it("refuses a row of the wrong length", async () => {
		const pack = await sealed((d) => withItemRow(d, ["Món", 1, 1]));
		expect((await validatePack(pack)).issues).toEqual([
			{
				code: "row_length",
				path: 'tables.items.rows["ALL/r02"]',
				detail: "3 cells for 7 columns",
			},
		]);
	});

	it("refuses a cell that does not fit its unit", async () => {
		const cases: [number, PackCell][] = [
			[0, 12],
			[1, "12500000"],
			[4, true],
			[5, "yes"],
			[6, "2026-02-30"],
			[6, "11/11/2026"],
		];
		for (const [index, cell] of cases) {
			const pack = await sealed((d) => withItemCell(d, index, cell));
			expect(await codesOf(pack)).toEqual(["cell_unit"]);
		}
	});

	it("refuses more decimals than the unit declares and accepts unrounded KPI values", async () => {
		const tooPrecise: [number, number][] = [
			[1, 12500000.5],
			[2, 1.0005],
			[3, 0.12345],
		];
		for (const [index, value] of tooPrecise) {
			const pack = await sealed((d) => withItemCell(d, index, value));
			expect(await codesOf(pack)).toEqual(["cell_digits"]);
		}
		for (const [index, value] of [
			[1, 12500001],
			[2, 1.001],
			[3, 0.1235],
			[3, 0.1 + 0.2],
		] as const) {
			const pack = await sealed((d) => withItemCell(d, index, value));
			expect(await codesOf(pack)).toEqual([]);
		}
		const usd = await sealed((d) =>
			withItemCell(
				{ ...d, request: { ...d.request, currency: "USD" } },
				1,
				12.35,
			),
		);
		expect(await codesOf(usd)).toEqual([]);
		const usdTooPrecise = await sealed((d) =>
			withItemCell(
				{ ...d, request: { ...d.request, currency: "USD" } },
				1,
				12.345,
			),
		);
		expect(await codesOf(usdTooPrecise)).toEqual(["cell_digits"]);
		const kpi = await sealed((d) => ({
			...d,
			tables: {
				...d.tables,
				kpi: {
					...(d.tables.kpi as PackTable),
					rows: {
						"ALL/avg_ticket": [52314.2714285714, 1.23456789, 0.1, 1, 2, 3],
					},
				},
			},
		}));
		expect(await codesOf(kpi)).toEqual([]);
	});

	it("refuses duplicate columns and rows of a store that is not in the pack", async () => {
		const duplicate = await sealed((d) => ({
			...d,
			tables: {
				...d.tables,
				items: {
					...itemsTable(),
					columns: itemsTable().columns.map((column, index) =>
						index === 1 ? { ...column, name: "name" } : column,
					),
				},
			},
		}));
		expect(await codesOf(duplicate)).toEqual(["column_duplicate"]);
		const unknownScope = await sealed((d) => {
			const items = itemsTable();
			return {
				...d,
				tables: {
					...d.tables,
					items: {
						...items,
						rows: { ...items.rows, "S3/r01": items.rows["S1/r01"] ?? [] },
					},
				},
			};
		});
		expect((await validatePack(unknownScope)).issues).toEqual([
			{
				code: "row_scope_unknown",
				path: 'tables.items.rows["S3/r01"]',
				detail: "S3",
			},
		]);
	});

	it("refuses stores out of label order or repeated", async () => {
		const reversed = await sealed((d) => ({
			...d,
			request: {
				...d.request,
				stores: [
					{ id: SEED_STORE_B, label: "S2" },
					{ id: SEED_STORE_A, label: "S1" },
				],
			},
		}));
		expect(await codesOf(reversed)).toEqual(["store_order"]);
		const tenth = await sealed((d) => ({
			...d,
			request: {
				...d.request,
				stores: [
					{ id: SEED_STORE_A, label: "S2" },
					{ id: SEED_STORE_B, label: "S10" },
				],
			},
			tables: { kpi: d.tables.kpi as PackTable },
		}));
		expect(await codesOf(tenth)).toEqual(["row_scope_unknown"]);
		const repeated = await sealed((d) => ({
			...d,
			request: {
				...d.request,
				stores: [
					{ id: SEED_STORE_A, label: "S1" },
					{ id: SEED_STORE_A, label: "S2" },
				],
			},
		}));
		expect(await codesOf(repeated)).toEqual(["store_duplicate"]);
	});

	it("allows MOCK store ids exactly when the pack is a sample", async () => {
		const liveWithMock = await sealed((d) => ({
			...samplePackDraft(),
			sample: false,
			tables: d.tables,
		}));
		expect(await codesOf(liveWithMock)).toEqual(["sample_ids", "sample_ids"]);
		const sampleWithUuid = await sealed((d) => ({ ...d, sample: true }));
		expect(await codesOf(sampleWithUuid)).toEqual(["sample_ids", "sample_ids"]);
	});

	it("refuses a calendar that differs from the one of the as-of day and horizon", async () => {
		const pack = await sealed((d) => ({
			...d,
			calendar: {
				...d.calendar,
				w28: { from: "2026-10-14", to: "2026-11-11" },
			},
		}));
		expect((await validatePack(pack)).issues).toEqual([
			{
				code: "calendar_mismatch",
				path: "calendar.w28",
				detail: "2026-10-15..2026-11-11",
			},
		]);
	});

	it("reports an as-of day that does not exist or has no calendar instead of throwing", async () => {
		const missingDay = await sealed((d) => ({
			...d,
			request: { ...d.request, as_of: "2026-02-30" },
		}));
		expect((await validatePack(missingDay)).issues).toEqual([
			{ code: "as_of_invalid", path: "request.as_of", detail: "2026-02-30" },
		]);
		const unavailable = await sealed((d) => ({
			...d,
			request: { ...d.request, as_of: UNAVAILABLE_AS_OF },
		}));
		expect((await validatePack(unavailable)).issues).toEqual([
			{ code: "calendar_unavailable", path: "calendar", detail: "no calendar" },
		]);
	});

	it("checks the budget: the limit, the trimming order, the estimate and the ceiling", async () => {
		const pack = await sealed();
		expect(
			await codesOf(
				await refreshed({ ...pack, budget: { ...pack.budget, limit: 29999 } }),
			),
		).toEqual(["budget_limit"]);
		expect(
			await codesOf(
				await refreshed({
					...pack,
					budget: {
						...pack.budget,
						trimmed: ["pairs:all_only", "heatmap_invoices:drop", "unknown"],
					},
				}),
			),
		).toEqual(["budget_trimmed", "budget_trimmed"]);
		const wrongEstimate = {
			...pack,
			budget: {
				...pack.budget,
				estimated_tokens: pack.budget.estimated_tokens + 1,
			},
		};
		expect(
			await codesOf({
				...wrongEstimate,
				pack_id: await packIdOf(wrongEstimate),
			}),
		).toEqual(["budget_estimate"]);
		const huge = await refreshed({
			...pack,
			tables: {
				...pack.tables,
				wide: {
					...itemsTable(),
					rows: { "ALL/r01": ["x".repeat(70000), 1, 1, 0.1, null, null, null] },
				},
			},
		});
		expect(await codesOf(huge)).toEqual(["budget_over"]);
	});

	it("refuses a pack whose pack_id does not recompute", async () => {
		const pack = await sealed();
		const kpi = pack.tables.kpi as PackTable;
		const changed = {
			...pack,
			tables: {
				...pack.tables,
				kpi: {
					...kpi,
					rows: {
						...kpi.rows,
						"S2/avg_ticket": [54211, 53000, 0.0228, 50000, 57000, 12],
					},
				},
			},
		};
		expect((await validatePack(changed)).issues).toEqual([
			{ code: "pack_id_mismatch", path: "pack_id", detail: null },
		]);
	});

	it("reports schema problems with their path and stops there", async () => {
		const pack = await sealed();
		const extra = await validatePack({ ...pack, extra: true });
		expect(extra.valid).toBe(false);
		expect(extra.pack).toBeNull();
		expect(extra.issues.map((issue) => issue.code)).toEqual([
			"schema:unrecognized_keys",
		]);
		const badKey = await validatePack({
			...pack,
			tables: {
				kpi: {
					...(pack.tables.kpi as PackTable),
					rows: { "123": [1, 1, 1, 1, 1, 1] },
				},
			},
		});
		expect(badKey.issues[0]?.code.startsWith("schema:")).toBe(true);
		expect(badKey.issues[0]?.path).toBe('tables.kpi.rows["123"]');
	});

	it("reports a value that is not JSON instead of throwing", async () => {
		const pack = await sealed();
		const notFinite = await validatePack(withItemCell(pack, 1, Number.NaN));
		expect(notFinite.valid).toBe(false);
		expect(notFinite.issues).toEqual([
			{
				code: "not_json",
				path: null,
				detail:
					'pack_invalid: NaN is not finite at tables.items.rows["ALL/r02"][1]',
			},
		]);
		expect(await codesOf({ ...pack, focus: undefined })).toEqual(["not_json"]);
		expect(await codesOf(null)).toEqual(["schema:invalid_type"]);
	});

	it("includes the aggregates-only check", async () => {
		const pack = await sealed((d) => withItemCell(d, 0, "Gọi 0912 345 678"));
		expect(await codesOf(pack)).toEqual(["text_phone"]);
	});

	it("checks the row-key pattern also when called without the schema", async () => {
		const pack = await sealed();
		const items = pack.tables.items as PackTable;
		const spaced = await refreshed({
			...pack,
			tables: {
				...pack.tables,
				items: {
					...items,
					rows: {
						...items.rows,
						"ALL r09": ["Món", 1, 1, 0.1, null, null, null],
					},
				},
			},
		});
		expect(await checkPackInvariants(spaced)).toEqual([
			{ code: "row_key", path: 'tables.items.rows["ALL r09"]', detail: null },
		]);
		expect((await validatePack(spaced)).issues[0]?.code).toBe(
			"schema:invalid_key",
		);
	});

	it("accepts a ten-store pack that the budget trimmed, with the steps it took", async () => {
		const { pack, text } = await sealPack(tenStoreDraft());
		const count = pack.budget.trimmed.length;
		expect(count).toBeGreaterThan(1);
		expect(pack.budget.trimmed).toEqual(TRIM_STEP_IDS.slice(0, count));
		expect(pack.budget.estimated_tokens).toBeLessThanOrEqual(TOKEN_LIMIT);
		expect(pack.request.stores).toHaveLength(10);
		expect(await parsePack(text)).toMatchObject({ valid: true, issues: [] });
	});
});

describe("parsePack", () => {
	it("reads a pack text, recomputes its pack_id and re-serialises it byte for byte", async () => {
		const { text, packId } = await sealPack(draftPack());
		const parsed = await parsePack(text);
		expect(parsed.valid).toBe(true);
		expect(parsed.packId).toBe(packId);
		expect(canonicalJson(parsed.pack as DataPack)).toBe(text);
	});

	it("reads the same pack after a jsonb round trip that reorders keys and adds whitespace", async () => {
		const { text, packId } = await sealPack(draftPack());
		const jsonb = JSON.stringify(reorderKeys(JSON.parse(text)), null, 2);
		expect(jsonb).not.toBe(text);
		const parsed = await parsePack(jsonb);
		expect(parsed.issues).toEqual([]);
		expect(parsed.packId).toBe(packId);
		expect(canonicalJson(parsed.pack as DataPack)).toBe(text);
	});

	it("refuses a text with a duplicate key because its pack_id no longer recomputes", async () => {
		const { text } = await sealPack(draftPack());
		const focus = '"focus":"Tăng giá trị hóa đơn buổi chiều"';
		expect(text).toContain(focus);
		const duplicated = text.replace(
			focus,
			`${focus},"focus":"Giữ giá trị hóa đơn buổi chiều"`,
		);
		const parsed = await parsePack(duplicated);
		expect(parsed.valid).toBe(false);
		expect(parsed.issues.map((issue) => issue.code)).toEqual([
			"pack_id_mismatch",
		]);
	});

	it("refuses a row hidden under __proto__, which the schema reader would drop unseen", async () => {
		const { text } = await sealPack(draftPack());
		const opening = '"rows":{"ALL/r01":["Trà sữa trân châu"';
		expect(text).toContain(opening);
		const hidden = text.replace(
			opening,
			`"rows":{"__proto__":["Gọi 0912 345 678",1,1,0.1,null,null,null],"ALL/r01":["Trà sữa trân châu"`,
		);
		expect(Object.keys(JSON.parse(hidden).tables.items.rows)).toContain(
			"__proto__",
		);
		const parsed = await parsePack(hidden);
		expect(parsed.valid).toBe(false);
		expect(parsed.pack).toBeNull();
		expect(parsed.issues).toEqual([
			{
				code: "schema:changed",
				path: null,
				detail:
					"the schema reader changed the pack, as it does with a key named __proto__",
			},
		]);
	});

	it("reports text that is not JSON", async () => {
		expect(await parsePack("{")).toEqual({
			valid: false,
			pack: null,
			issues: [
				{ code: "not_json", path: null, detail: "the text is not JSON" },
			],
			packId: null,
		});
		const infinite = await parsePack('{"budget":1e400}');
		expect(infinite.issues.map((issue) => issue.code)).toEqual(["not_json"]);
		expect(infinite.packId).toBeNull();
		expect((await parsePack("[1]")).packId).toBeNull();
	});
});

describe("comparePackTexts", () => {
	it("finds two packs identical apart from generated_at", async () => {
		const one = await sealPack(draftPack());
		const two = await sealPack({
			...draftPack(),
			generated_at: "2026-11-12T08:15:00Z",
		});
		expect(one.text).not.toBe(two.text);
		expect(await comparePackTexts(one.text, two.text)).toEqual({
			valid: true,
			identical_apart_from_generated_at: true,
			pack_id_equal: true,
			tables_differing: [],
		});
	});

	it("names the tables that differ", async () => {
		const one = await sealPack(draftPack());
		const two = await sealPack(
			withItemCell(
				{
					...draftPack(),
					tables: { ...draftPack().tables, extra: itemsTable() },
				},
				1,
				9800001,
			),
		);
		expect(await comparePackTexts(one.text, two.text)).toEqual({
			valid: true,
			identical_apart_from_generated_at: false,
			pack_id_equal: false,
			tables_differing: ["extra", "items"],
		});
	});

	it("sees a difference outside the tables only in identity and pack_id", async () => {
		const one = await sealPack(draftPack());
		const two = await sealPack({
			...draftPack(),
			prompt: { ...draftPack().prompt, text: "Viết kế hoạch khác." },
		});
		const comparison = await comparePackTexts(one.text, two.text);
		expect(comparison.identical_apart_from_generated_at).toBe(false);
		expect(comparison.pack_id_equal).toBe(false);
		expect(comparison.tables_differing).toEqual([]);
	});

	it("requires byte identity, not only equal content", async () => {
		const { text } = await sealPack(draftPack());
		const pretty = JSON.stringify(JSON.parse(text), null, 1);
		expect(await comparePackTexts(text, pretty)).toEqual({
			valid: true,
			identical_apart_from_generated_at: false,
			pack_id_equal: true,
			tables_differing: [],
		});
	});

	it("reports an invalid side", async () => {
		const { text } = await sealPack(draftPack());
		const comparison = await comparePackTexts(text, "not json");
		expect(comparison.valid).toBe(false);
		expect(comparison.identical_apart_from_generated_at).toBe(false);
		expect(comparison.pack_id_equal).toBe(false);
		expect(comparison.tables_differing).toEqual(["items", "kpi"]);
	});
});
