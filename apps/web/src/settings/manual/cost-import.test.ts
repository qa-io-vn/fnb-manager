import { DemoSettingsStore } from "@fnb/demo-analytics";
import { describe, expect, it } from "vitest";
import { UTF8_BOM } from "../../lib/csv";
import type { DateOrder } from "../../lib/csv-parse";
import { type ItemEntry, type Membership, SettingsWriteError } from "../source";
import {
	COST_IMPORT_MAX_ROWS,
	type CostFileLine,
	type CostImportContext,
	type CostImportPreview,
	type CostImportStore,
	costImportContextOf,
	costImportPreview,
	costTemplateCsv,
	costTemplateFileName,
	costTemplateRows,
	readCostCell,
	readCostFile,
	readDateOrder,
	shownImportRows,
} from "./cost-import";
import type { CostItem, CostSale } from "./costs";
import { createDemoManualSource } from "./demo-manual-source";
import type { ItemCostRow } from "./source";

const TODAY = "2026-11-16";
const STORE = "S1";
const OTHER_STORE = "S2";
const HEADER = "ma_mon,ten_mon,size,ma_cua_hang,gia_von,tu_ngay";
const SEMICOLON_HEADER = "ma_mon;ten_mon;size;ma_cua_hang;gia_von;tu_ngay";

const STORES: readonly CostImportStore[] = [
	{ id: STORE, name: "Cửa hàng một", code: "ch1", posAccountId: "A" },
	{ id: OTHER_STORE, name: "Cửa hàng hai", code: "CH2", posAccountId: "B" },
];

function entry(
	id: string,
	name: string,
	fields: Partial<ItemEntry> = {},
): ItemEntry {
	return {
		posAccountId: "A",
		itemExternalId: id,
		name,
		sizeLabel: null,
		listPrice: 40_000,
		isModifier: false,
		active: true,
		inCatalogue: true,
		posItemTypeExternalId: "T1",
		overrideItemTypeExternalId: null,
		audit: null,
		...fields,
	};
}

const ENTRIES: readonly ItemEntry[] = [
	entry("I1", "Trà sữa trân châu", { sizeLabel: "M" }),
	entry("I2", "Bánh flan", { listPrice: 20_000 }),
	entry("I3", "Cà phê sữa", { posAccountId: "B", listPrice: 30_000 }),
	entry("I3", "Cà phê sữa", { listPrice: 25_000 }),
];

const SALES: readonly CostSale[] = [
	{
		itemExternalId: "SOLD-ONLY",
		name: "Món đã bán",
		sizeLabel: null,
		category: null,
		netAmount: 1,
	},
];

function cost(
	storeId: string | null,
	itemExternalId: string,
	costAmount: number,
	effectiveFrom: string,
): ItemCostRow {
	return {
		id: `${storeId ?? "all"}-${itemExternalId}-${effectiveFrom}`,
		storeId,
		itemExternalId,
		costAmount,
		effectiveFrom,
		audit: null,
	};
}

const OWNER: Membership = { role: "owner", storeIds: null };

function contextOf(
	fields: {
		scope?: string | null;
		rows?: readonly ItemCostRow[];
		membership?: Membership;
		stores?: readonly CostImportStore[];
		fractionDigits?: number;
	} = {},
): CostImportContext {
	return costImportContextOf({
		scope: fields.scope ?? null,
		stores: fields.stores ?? STORES,
		membership: fields.membership ?? OWNER,
		entries: ENTRIES,
		sales: SALES,
		rows: fields.rows ?? [],
		today: TODAY,
		fractionDigits: fields.fractionDigits ?? 0,
	});
}

function linesOf(text: string): readonly CostFileLine[] {
	const file = readCostFile(text);
	if (!file.ok) throw new Error(`unreadable test file: ${file.problem.kind}`);
	return file.lines;
}

function previewOf(
	body: readonly string[],
	context: CostImportContext = contextOf(),
	order: DateOrder = "dmy",
	header = HEADER,
): CostImportPreview {
	return costImportPreview(
		linesOf([header, ...body].join("\r\n")),
		order,
		context,
	);
}

function outcomes(preview: CostImportPreview) {
	return preview.rows.map((row) => [row.line, row.outcome]);
}

const ITEMS: readonly CostItem[] = [
	{
		itemExternalId: "I1",
		name: "Trà sữa trân châu",
		sizeLabel: "M",
		category: "Trà sữa",
		listPrice: 40_000,
		soldAmount: 1,
	},
	{
		itemExternalId: "I2",
		name: "Bánh flan",
		sizeLabel: null,
		category: null,
		listPrice: 20_000,
		soldAmount: null,
	},
	{
		itemExternalId: "=I4",
		name: '+ Món lạ, "đặc biệt"',
		sizeLabel: null,
		category: null,
		listPrice: null,
		soldAmount: null,
	},
];

describe("the cost template", () => {
	it("lists the scope's items with today's own cost and its ISO date, blank without one, under ASCII headers", () => {
		const rows = [
			cost(null, "I1", 12_000, "2023-01-01"),
			cost(null, "I1", 15_000, "2026-12-01"),
			cost(STORE, "I2", 8_000, "2024-05-01"),
		];
		expect(
			costTemplateRows({
				items: ITEMS,
				storeId: null,
				storeCode: null,
				rows,
				today: TODAY,
			}),
		).toEqual([
			{
				ma_mon: "I1",
				ten_mon: "Trà sữa trân châu",
				size: "M",
				ma_cua_hang: "",
				gia_von: 12_000,
				tu_ngay: "2023-01-01",
			},
			{
				ma_mon: "I2",
				ten_mon: "Bánh flan",
				size: "",
				ma_cua_hang: "",
				gia_von: null,
				tu_ngay: "",
			},
			{
				ma_mon: "=I4",
				ten_mon: '+ Món lạ, "đặc biệt"',
				size: "",
				ma_cua_hang: "",
				gia_von: null,
				tu_ngay: "",
			},
		]);
	});

	it("writes a store's code on every row and leaves a cost it only inherits from all stores blank", () => {
		const rows = [
			cost(null, "I1", 12_000, "2023-01-01"),
			cost(STORE, "I2", 8_000, "2024-05-01"),
		];
		const template = costTemplateRows({
			items: ITEMS.slice(0, 2),
			storeId: STORE,
			storeCode: " ch1 ",
			rows,
			today: TODAY,
		});
		expect(
			template.map((row) => [row.ma_cua_hang, row.gia_von, row.tu_ngay]),
		).toEqual([
			["ch1", null, ""],
			["ch1", 8_000, "2024-05-01"],
		]);
		expect(
			costTemplateRows({
				items: ITEMS.slice(0, 1),
				storeId: STORE,
				storeCode: null,
				rows,
				today: TODAY,
			})[0]?.ma_cua_hang,
		).toBe("");
	});

	it("starts with the BOM in both dialects, keeps the Vietnamese names through a strict UTF-8 decode and neutralises formulas", () => {
		const input = {
			items: ITEMS,
			storeId: null,
			storeCode: null,
			rows: [cost(null, "I1", 12_000, "2023-01-01")],
			today: TODAY,
		};
		const comma = costTemplateCsv(input, "comma");
		const bytes = new TextEncoder().encode(comma);
		expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
		const decoded = new TextDecoder("utf-8", {
			fatal: true,
			ignoreBOM: true,
		}).decode(bytes);
		expect(decoded.split("\r\n")).toEqual([
			`${UTF8_BOM}${HEADER}`,
			"I1,Trà sữa trân châu,M,,12000,2023-01-01",
			"I2,Bánh flan,,,,",
			'\'=I4,"\'+ Món lạ, ""đặc biệt""",,,,',
			"",
		]);
		const semicolon = costTemplateCsv(input, "semicolon");
		expect(semicolon.startsWith(`${UTF8_BOM}${SEMICOLON_HEADER}\r\n`)).toBe(
			true,
		);
		expect(semicolon).toContain("I1;Trà sữa trân châu;M;;12000;2023-01-01");
	});

	it("names the file in ASCII after the scope", () => {
		expect(costTemplateFileName(null, null, TODAY)).toBe(
			"gia-von-tat-ca-cua-hang-2026-11-16.csv",
		);
		expect(costTemplateFileName(STORE, "Đông A 1", TODAY)).toBe(
			"gia-von-dong-a-1-2026-11-16.csv",
		);
		expect(costTemplateFileName(STORE, null, TODAY)).toBe(
			"gia-von-cua-hang-2026-11-16.csv",
		);
	});
});

describe("reading a cost file", () => {
	it("reads comma and semicolon files, with or without a BOM, by header name in any order", () => {
		const expected = { ma_mon: "I1", gia_von: "25.000", tu_ngay: "2023-01-01" };
		for (const text of [
			`${UTF8_BOM}${HEADER}\r\nI1,Trà sữa,M,,25.000,2023-01-01\r\n`,
			`${HEADER}\nI1,Trà sữa,M,,25.000,2023-01-01`,
			`${UTF8_BOM}${SEMICOLON_HEADER}\r\nI1;Trà sữa;M;;25.000;2023-01-01\r\n`,
			`${SEMICOLON_HEADER}\nI1;Trà sữa;M;;25.000;2023-01-01\n`,
			" GIA_VON ; Ma_Mon ; tu_ngay\n25.000;I1;2023-01-01",
		]) {
			const [line] = linesOf(text);
			expect(line).toMatchObject({ line: 2, cells: expected });
		}
	});

	it("needs the item code and cost columns, a closed quote and at least one row", () => {
		expect(readCostFile("ten_mon,gia_von\nTrà,1000")).toEqual({
			ok: false,
			problem: { kind: "missingColumns", columns: ["ma_mon"] },
		});
		expect(readCostFile("ten_mon\nTrà")).toEqual({
			ok: false,
			problem: { kind: "missingColumns", columns: ["ma_mon", "gia_von"] },
		});
		expect(readCostFile(`${HEADER}\nI1,"Trà,M,,1000,`)).toEqual({
			ok: false,
			problem: { kind: "unreadable", error: "unterminatedQuote", line: 2 },
		});
		expect(readCostFile(`${HEADER}\n`)).toEqual({
			ok: false,
			problem: { kind: "noRows" },
		});
		expect(readCostFile("")).toEqual({
			ok: false,
			problem: { kind: "noRows" },
		});
	});
});

describe("reading a VND cost", () => {
	it.each([
		["25.000", 25_000],
		["25,000", 25_000],
		["25000", 25_000],
		["1.250.000", 1_250_000],
		["25 000", 25_000],
		["25.000 ₫", 25_000],
		["25000đ", 25_000],
		["0", 0],
		["100.000.000", 100_000_000],
	])("reads %s as %d whole đồng", (text, amount) => {
		expect(readCostCell(text, 0)).toEqual({ amount, issue: null });
	});

	it.each(["8333,33", "25.000,5", "8333.33", "25.5", "25000,00"])(
		"refuses %s with the whole-đồng message instead of reading another amount",
		(text) => {
			expect(readCostCell(text, 0)).toEqual({
				amount: null,
				issue: { key: "costWholeDong" },
			});
		},
	);

	it("refuses a blank, a negative, an amount over the limit and text that is not money", () => {
		expect(readCostCell(" ", 0).issue).toEqual({ key: "costRequired" });
		expect(readCostCell("-5.000", 0).issue).toEqual({
			key: "costAtLeast",
			min: 0,
		});
		expect(readCostCell("100.000.001", 0).issue).toEqual({
			key: "costAtMost",
			max: 100_000_000,
		});
		expect(readCostCell("hai mươi", 0).issue).toEqual({
			key: "costNotAmount",
		});
		expect(readCostCell("12.34.56", 0).issue).toEqual({
			key: "costNotAmount",
		});
		for (const huge of [
			"1234567890123456",
			"1.234.567.890.123.456",
			"9999999999999999999 ₫",
		]) {
			expect(readCostCell(huge, 0).issue).toEqual({
				key: "costAtMost",
				max: 100_000_000,
			});
		}
		expect(readCostCell("-1234567890123456", 0).issue).toEqual({
			key: "costAtLeast",
			min: 0,
		});
	});

	it("reads a currency with cents to its decimals and refuses more", () => {
		expect(readCostCell("12,50", 2)).toEqual({ amount: 12.5, issue: null });
		expect(readCostCell("12.5055", 2).issue).toEqual({
			key: "costDecimals",
			digits: 2,
		});
	});
});

describe("the date order of a file", () => {
	it("follows the order a date proves, and asks only when an ambiguous date leaves it open", () => {
		expect(readDateOrder(["13/04/2026", "03/04/2026"], "mdy")).toEqual({
			detected: "dmy",
			used: "dmy",
			needsChoice: false,
			rejected: null,
		});
		expect(readDateOrder(["04/13/2026", "03/04/2026"], "dmy")).toMatchObject({
			detected: "mdy",
			used: "mdy",
			needsChoice: false,
		});
		expect(readDateOrder(["03/04/2026", "2026-01-01"], "dmy")).toEqual({
			detected: "unknown",
			used: "dmy",
			needsChoice: true,
			rejected: null,
		});
		expect(readDateOrder(["01/01/2026", "2026-01-01"], "mdy")).toMatchObject({
			detected: "unknown",
			used: "mdy",
			needsChoice: false,
		});
	});

	it("reads conflicting orders by the more frequent one, rejecting the other, and asks on a tie", () => {
		expect(
			readDateOrder(["13/04/2026", "14/04/2026", "04/15/2026"], "mdy"),
		).toEqual({
			detected: "conflict",
			used: "dmy",
			needsChoice: false,
			rejected: "mdy",
		});
		expect(readDateOrder(["13/04/2026", "04/15/2026"], "mdy")).toEqual({
			detected: "conflict",
			used: "mdy",
			needsChoice: true,
			rejected: "dmy",
		});
	});
});

describe("the import preview", () => {
	it("gives every outcome its row", () => {
		const context = contextOf({
			rows: [cost(null, "I2", 9_000, "2023-01-01")],
			membership: { role: "manager", storeIds: [STORE] },
			scope: STORE,
		});
		const preview = previewOf(
			[
				"I1,Trà sữa,M,,25.000,2024-01-01",
				"NOPE,Không có,,,25.000,2024-01-01",
				"I1,Trà sữa,M,XX,25.000,2024-01-01",
				"I1,Trà sữa,M,CH2,25.000,2024-01-01",
				'I1,Trà sữa,M,,"8333,33",2024-01-05',
				"I2,Bánh flan,,,12.000,",
				"I3,Cà phê,,,26.000,2024-01-01",
				"I1,Trà sữa,M,,27.000,2024-02-01",
				"I1,Trà sữa,M,,28.000,2024-02-01",
			],
			context,
		);
		expect(outcomes(preview)).toEqual([
			[2, "ok"],
			[3, "unknown_item"],
			[4, "unknown_store"],
			[5, "out_of_scope"],
			[6, "invalid_cost"],
			[7, "invalid_date"],
			[8, "cost_above_price"],
			[9, "duplicate_in_file"],
			[10, "ok"],
		]);
		expect(preview.rows[1]).toMatchObject({
			storeId: STORE,
			costAmount: 25_000,
			effectiveFrom: "2024-01-01",
		});
		expect(preview.rows[2]).toMatchObject({
			storeId: undefined,
			storeCode: "XX",
			costAmount: 25_000,
		});
		expect(preview.rows[5]?.issue).toEqual({ key: "dateBlankInherited" });
		expect(preview.rows[6]?.listPrice).toBe(25_000);
		expect(preview.rows[7]?.usedLine).toBe(10);
		expect(preview.rows[8]?.replacesLines).toEqual([9]);
		expect(preview.changes).toEqual([
			{
				storeId: STORE,
				itemExternalId: "I1",
				costAmount: 25_000,
				effectiveFrom: "2024-01-01",
			},
			{
				storeId: STORE,
				itemExternalId: "I3",
				costAmount: 26_000,
				effectiveFrom: "2024-01-01",
			},
			{
				storeId: STORE,
				itemExternalId: "I1",
				costAmount: 28_000,
				effectiveFrom: "2024-02-01",
			},
		]);
		expect(preview.counts).toMatchObject({
			ok: 2,
			cost_above_price: 1,
			duplicate_in_file: 1,
			invalid_cost: 1,
			invalid_date: 1,
		});
	});

	it("matches a store code trimmed and upper-cased among the visible stores, and refuses a code two stores share", () => {
		const preview = previewOf(
			["I1,,,  Ch1 ,25000,2024-01-01", "I1,,,ch2,25000,2024-01-01"],
			contextOf({
				stores: [
					...STORES,
					{ id: "S3", name: "Cửa hàng ba", code: "CH2 ", posAccountId: "A" },
				],
			}),
		);
		expect(outcomes(preview)).toEqual([
			[2, "ok"],
			[3, "ambiguous_store"],
		]);
		expect(preview.rows[0]?.storeId).toBe(STORE);
	});

	it("reads a blank store code as the page's scope and a blank date as 01/01/2023 while the item has no cost there", () => {
		const rows = [cost(null, "I2", 9_000, "2023-01-01")];
		const all = previewOf(
			["I1,,,,25000,", "I2,,,,12000,"],
			contextOf({ rows }),
		);
		expect(outcomes(all)).toEqual([
			[2, "ok"],
			[3, "invalid_date"],
		]);
		expect(all.changes).toEqual([
			{
				storeId: null,
				itemExternalId: "I1",
				costAmount: 25_000,
				effectiveFrom: "2023-01-01",
			},
		]);
		const store = previewOf(
			["I1,,,,25000,", "I2,,,,12000,"],
			contextOf({ rows, scope: STORE }),
		);
		expect(outcomes(store)).toEqual([
			[2, "ok"],
			[3, "invalid_date"],
		]);
		expect(store.changes[0]?.storeId).toBe(STORE);
	});

	it("skips rows without a cost or a date, and reports a cost without a date or a date without a cost", () => {
		const preview = previewOf([
			"I1,Trà sữa,M,,,",
			",,,,,",
			"I2,Bánh flan,,,,2024-01-01",
		]);
		expect(preview.blankCount).toBe(2);
		expect(outcomes(preview)).toEqual([[4, "invalid_cost"]]);
		expect(preview.rows[0]?.issue).toEqual({ key: "costRequired" });
		expect(preview.changes).toEqual([]);
	});

	it("reads ISO dates, slash dates in the order the file proves, and an ambiguous file in the chosen order", () => {
		expect(
			previewOf([
				"I1,,,,1000,2024-03-04",
				"I2,,,,1000,13/04/2024",
				"I3,,,,1000,03/04/2024",
			]).changes.map((change) => change.effectiveFrom),
		).toEqual(["2024-03-04", "2024-04-13", "2024-04-03"]);
		expect(
			previewOf(["I1,,,,1000,04/13/2024", "I2,,,,1000,03/04/2024"]).changes.map(
				(change) => change.effectiveFrom,
			),
		).toEqual(["2024-04-13", "2024-03-04"]);
		const ambiguous = ["I1,,,,1000,03/04/2024", "I2,,,,1000,1/2/2024"];
		const dayFirst = previewOf(ambiguous);
		expect(dayFirst.dates.needsChoice).toBe(true);
		expect(dayFirst.changes.map((change) => change.effectiveFrom)).toEqual([
			"2024-04-03",
			"2024-02-01",
		]);
		const monthFirst = previewOf(ambiguous, contextOf(), "mdy");
		expect(monthFirst.changes.map((change) => change.effectiveFrom)).toEqual([
			"2024-03-04",
			"2024-01-02",
		]);
	});

	it("marks the rows of the rarer order invalid when the dates conflict, and refuses unreadable and out-of-range dates", () => {
		const preview = previewOf([
			"I1,,,,1000,13/04/2024",
			"I2,,,,1000,14/04/2024",
			"I3,,,,1000,04/15/2024",
			"SOLD-ONLY,,,,1000,31/02/2024",
			"I1,,,,1000,2022-12-31",
			"I2,,,,1000,2028-01-01",
		]);
		expect(preview.dates).toMatchObject({ detected: "conflict", used: "dmy" });
		expect(preview.rows.map((row) => row.issue)).toEqual([
			null,
			null,
			{ key: "dateOtherOrder" },
			{ key: "dateUnreadable" },
			{ key: "dateRange", min: "2023-01-01", max: "2027-12-31" },
			{ key: "dateRange", min: "2023-01-01", max: "2027-12-31" },
		]);
	});

	it("knows items by code from the catalogue of every account, the sales and the saved costs, never by name", () => {
		const context = contextOf({ rows: [cost(null, "GONE", 1, "2023-01-01")] });
		const preview = previewOf(
			[
				"I3,Tên bị lỗi mã hóa,,,1000,2024-01-01",
				"SOLD-ONLY,,,,1000,2024-01-01",
				"GONE,,,,2000,2024-01-01",
				"'=I4,,,,1000,2024-01-01",
				",Trà sữa trân châu,,,1000,2024-01-01",
			],
			context,
		);
		expect(outcomes(preview)).toEqual([
			[2, "ok"],
			[3, "ok"],
			[4, "ok"],
			[5, "unknown_item"],
			[6, "unknown_item"],
		]);
		expect(preview.rows[0]?.item?.name).toBe("Cà phê sữa");
		expect(preview.rows[3]?.itemExternalId).toBe("=I4");
	});

	it("leaves out costs equal to the saved row, and shows them only when a duplicate involves them", () => {
		const rows = [cost(null, "I1", 25_000, "2023-01-01")];
		const preview = previewOf(
			[
				"I1,,,,25.000,2023-01-01",
				"I2,,,,1.000,2023-01-01",
				"I2,,,,2.000,2023-01-01",
			],
			contextOf({ rows }),
		);
		expect(outcomes(preview)).toEqual([
			[2, "unchanged"],
			[3, "duplicate_in_file"],
			[4, "ok"],
		]);
		expect(shownImportRows(preview.rows).map((row) => row.line)).toEqual([
			3, 4,
		]);
		expect(preview.changes).toHaveLength(1);
	});

	it("re-imports an unchanged template as nothing to save, and an edited cost as exactly that row, in both dialects", () => {
		const rows = [
			cost(null, "I1", 12_000, "2023-01-01"),
			cost(null, "I2", 8_000, "2024-05-01"),
		];
		for (const dialect of ["comma", "semicolon"] as const) {
			const template = costTemplateCsv(
				{
					items: ITEMS.slice(0, 2),
					storeId: null,
					storeCode: null,
					rows,
					today: TODAY,
				},
				dialect,
			);
			const unchanged = costImportPreview(
				linesOf(template),
				"dmy",
				contextOf({ rows }),
			);
			expect(unchanged.changes).toEqual([]);
			expect(unchanged.counts.unchanged).toBe(2);
			const edited = costImportPreview(
				linesOf(template.replace("12000", "13.500")),
				"dmy",
				contextOf({ rows }),
			);
			expect(edited.changes).toEqual([
				{
					storeId: null,
					itemExternalId: "I1",
					costAmount: 13_500,
					effectiveFrom: "2023-01-01",
				},
			]);
		}
	});

	it("refuses more than 2,000 rows to save before anything is sent", () => {
		const body = (count: number) =>
			Array.from({ length: count }, (_, index) => {
				const item = ["I1", "I2", "I3"][Math.floor(index / 1_000)];
				const day = new Date(Date.UTC(2023, 0, 1 + (index % 1_000)))
					.toISOString()
					.slice(0, 10);
				return `${item},,,,1000,${day}`;
			});
		expect(previewOf(body(COST_IMPORT_MAX_ROWS)).tooMany).toBe(false);
		const over = previewOf(body(COST_IMPORT_MAX_ROWS + 1));
		expect(over.changes).toHaveLength(COST_IMPORT_MAX_ROWS + 1);
		expect(over.tooMany).toBe(true);
	});

	it("saves its rows in one call that writes none of them when the database's amount check refuses one, and the preview itself never sends such an amount", async () => {
		const store = new DemoSettingsStore();
		const before = store.costs();
		const preview = previewOf([
			"I1,,,,1000,2024-01-01",
			"I2,,,,2000,2024-01-01",
			"I3,,,,100.000.001,2024-01-01",
		]);
		expect(outcomes(preview)).toEqual([
			[2, "ok"],
			[3, "ok"],
			[4, "invalid_cost"],
		]);
		const demo = createDemoManualSource(store);
		const refusal = await demo
			.saveItemCosts("tenant", [
				...preview.changes,
				{
					storeId: null,
					itemExternalId: "I3",
					costAmount: 100_000_001,
					effectiveFrom: "2024-01-01",
				},
			])
			.catch((error: unknown) => error);
		expect(refusal).toBeInstanceOf(SettingsWriteError);
		expect(refusal).toMatchObject({
			code: "invalid",
			constraint: "item_costs_amount_whole_dong",
		});
		expect(store.costs()).toEqual(before);
		await demo.saveItemCosts("tenant", preview.changes);
		expect(
			store
				.costs()
				.map((row) => [row.itemExternalId, row.costAmount, row.effectiveFrom]),
		).toEqual([
			["I1", 1_000, "2024-01-01"],
			["I2", 2_000, "2024-01-01"],
		]);
	});

	it("lets a later row win a duplicate only when it can be saved, so a broken row never discards a good one", () => {
		const preview = previewOf([
			"I1,,,,1000,2024-01-01",
			'I1,,,,"8333,33",2024-01-01',
			"I2,,,,2000,2024-01-01",
			"I2,,,,2000,31/02/2024",
			"I2,,,,2500,2024-01-01",
		]);
		expect(outcomes(preview)).toEqual([
			[2, "ok"],
			[3, "invalid_cost"],
			[4, "duplicate_in_file"],
			[5, "invalid_date"],
			[6, "ok"],
		]);
		expect(preview.changes).toEqual([
			{
				storeId: null,
				itemExternalId: "I1",
				costAmount: 1_000,
				effectiveFrom: "2024-01-01",
			},
			{
				storeId: null,
				itemExternalId: "I2",
				costAmount: 2_500,
				effectiveFrom: "2024-01-01",
			},
		]);
	});

	it("numbers each row by its line in the file, past blank lines and line breaks inside a quoted name", () => {
		const preview = costImportPreview(
			linesOf(
				[
					HEADER,
					"",
					"NOPE,,,,1000,2024-01-01",
					'I1,"Trà sữa',
					'trân châu",M,,1000,2024-01-01',
					"",
					"",
					"BAD,,,,1000,2024-01-01",
				].join("\r\n"),
			),
			"dmy",
			contextOf(),
		);
		expect(outcomes(preview)).toEqual([
			[3, "unknown_item"],
			[4, "ok"],
			[8, "unknown_item"],
		]);
	});

	it("lets only rows that could be saved vote on the date order", () => {
		const preview = previewOf([
			"NOPE,,,,1000,13/04/2024",
			"I1,,,XX,1000,14/04/2024",
			'I2,,,,"8333,33",15/04/2024',
			"I3,,,,1000,04/16/2024",
			"I1,,,,1000,03/04/2024",
		]);
		expect(preview.dates).toMatchObject({ detected: "mdy", used: "mdy" });
		expect(preview.changes.map((change) => change.effectiveFrom)).toEqual([
			"2024-04-16",
			"2024-03-04",
		]);
		const ambiguous = previewOf([
			"NOPE,,,,1000,13/04/2024",
			"I1,,,,1000,03/04/2024",
		]);
		expect(ambiguous.dates).toMatchObject({
			detected: "unknown",
			needsChoice: true,
		});
	});

	it("accepts only the items the tab lists for the row's scope: no modifiers, nothing out of the catalogue or of another account, unless sold or already costed there", () => {
		const entries: readonly ItemEntry[] = [
			entry("I1", "Trà sữa"),
			entry("TOPPING", "Trân châu", { isModifier: true }),
			entry("RETIRED", "Món cũ", { inCatalogue: false }),
			entry("B-ONLY", "Món tài khoản B", { posAccountId: "B" }),
			entry("SOLD-RETIRED", "Món cũ đã bán", { inCatalogue: false }),
			entry("COSTED-RETIRED", "Món cũ có giá", { inCatalogue: false }),
		];
		const context = (scope: string | null) =>
			costImportContextOf({
				scope,
				stores: STORES,
				membership: OWNER,
				entries,
				sales: [{ ...SALES[0], itemExternalId: "SOLD-RETIRED" } as CostSale],
				rows: [cost(STORE, "COSTED-RETIRED", 1_000, "2023-01-01")],
				today: TODAY,
				fractionDigits: 0,
			});
		const body = [
			"I1,,,ch1,1000,2024-01-01",
			"TOPPING,,,ch1,1000,2024-01-01",
			"RETIRED,,,ch1,1000,2024-01-01",
			"B-ONLY,,,ch1,1000,2024-01-01",
			"B-ONLY,,,CH2,1000,2024-01-01",
			"B-ONLY,,,,1000,2024-01-01",
			"SOLD-RETIRED,,,ch1,1000,2024-01-01",
			"COSTED-RETIRED,,,ch1,1000,2024-01-02",
			"COSTED-RETIRED,,,,1000,2024-01-02",
		];
		const fromAllStores = previewOf(body, context(null));
		expect(outcomes(fromAllStores)).toEqual([
			[2, "ok"],
			[3, "unknown_item"],
			[4, "unknown_item"],
			[5, "unknown_item"],
			[6, "ok"],
			[7, "ok"],
			[8, "unknown_item"],
			[9, "ok"],
			[10, "unknown_item"],
		]);
		expect(fromAllStores.rows[1]?.issue).toEqual({ key: "itemNotListed" });
		const fromStoreOne = previewOf(body, context(STORE));
		expect(fromStoreOne.rows[6]?.outcome).toBe("ok");
		expect(fromStoreOne.rows[5]?.outcome).toBe("unknown_item");
	});

	it("tells a blank date in a store that only inherits the all-store cost apart from one in a scope with its own cost, and counts the rows without a store code", () => {
		const rows = [
			cost(null, "I1", 9_000, "2023-01-01"),
			cost(STORE, "I2", 9_000, "2023-01-01"),
		];
		const preview = previewOf(
			["I1,,,ch1,10000,", "I2,,,ch1,10000,", "I1,,,,10000,", "I3,,,,10000,"],
			contextOf({ rows }),
		);
		expect(preview.rows.map((row) => row.issue)).toEqual([
			{ key: "dateBlankInherited" },
			{ key: "dateBlank" },
			{ key: "dateBlank" },
			null,
		]);
		expect(preview.blankCodeCount).toBe(2);
	});
});
