import { describe, expect, it } from "vitest";
import {
	aggregatesOnlyIssues,
	forbiddenColumnRule,
	MAX_TABLE_ROWS,
	personalTextRules,
} from "../../src/pack/aggregates.js";
import type { DataPack, PackTable } from "../../src/pack/schema.js";
import {
	draftPack,
	itemsTable,
	REPEATED_GROUP_ID,
	SEED_STORE_A,
	SEED_STORE_B,
} from "./format-fixtures.js";

function withItemName(name: string): DataPack {
	const pack = draftPack();
	const items = itemsTable();
	const first = items.rows["ALL/r01"] ?? [];
	return {
		...pack,
		tables: {
			...pack.tables,
			items: {
				...items,
				rows: { ...items.rows, "ALL/r01": [name, ...first.slice(1)] },
			},
		},
	};
}

function withTable(id: string, table: PackTable): DataPack {
	const pack = draftPack();
	return { ...pack, tables: { ...pack.tables, [id]: table } };
}

function codes(pack: DataPack): string[] {
	return aggregatesOnlyIssues(pack).map((issue) => issue.code);
}

describe("aggregatesOnlyIssues", () => {
	it("passes the fixture pack", () => {
		expect(aggregatesOnlyIssues(draftPack())).toEqual([]);
	});

	it("refuses a row-level grain", () => {
		for (const grain of [
			"invoice",
			"line",
			"payment",
			"shift",
			"customer",
			"cashier",
			"store-shift",
			"invoice-period",
		]) {
			const pack = withTable("detail", {
				...itemsTable(),
				grain: grain as PackTable["grain"],
			});
			expect(aggregatesOnlyIssues(pack)).toEqual([
				{
					code: "grain_not_allowed",
					path: "tables.detail.grain",
					detail: grain,
				},
			]);
		}
	});

	it("refuses every forbidden column name and allows aggregate ones", () => {
		const forbidden: [string, string][] = [
			["customer", "person"],
			["cashier", "person"],
			["employees", "person"],
			["customer_name", "person_name"],
			["cashier_name", "person_name"],
			["employee_name", "person_name"],
			["staff_full_name", "person_name"],
			["full_name", "person_name"],
			["customer_id", "person_id"],
			["phone", "phone"],
			["customer_phone", "phone"],
			["mobile", "phone"],
			["email", "email"],
			["e_mail", "email"],
			["cashier_email", "email"],
			["receipt", "receipt"],
			["receipt_no", "receipt"],
			["voucher_code", "voucher_code"],
			["external_id", "external_id"],
			["pos_id", "external_id"],
			["invoice_id", "invoice_id"],
			["invoice_no", "invoice_id"],
			["shift_id", "shift_id"],
			["shift_name", "shift_id"],
			["note", "note"],
			["notes", "note"],
			["ref", "reference"],
			["payment_reference", "reference"],
			["address", "address"],
			["store_address", "address"],
		];
		for (const [name, rule] of forbidden) {
			expect(forbiddenColumnRule(name)).toBe(rule);
			const pack = withTable("detail", {
				...itemsTable(),
				columns: [{ name, unit: "text" }, ...itemsTable().columns.slice(1)],
			});
			expect(aggregatesOnlyIssues(pack)).toEqual([
				{
					code: "column_forbidden",
					path: "tables.detail.columns[0].name",
					detail: `${name}: ${rule}`,
				},
			]);
		}
		for (const name of [
			"name",
			"net",
			"invoices",
			"invoice_count",
			"customer_count",
			"staff_hours",
			"shifts",
			"voucher_share",
			"lines_per_invoice",
			"w28",
			"n",
			"lo",
			"hi",
			"position",
			"external_share_label",
		]) {
			expect(forbiddenColumnRule(name), name).toBe(
				name === "external_share_label" ? "external_id" : null,
			);
		}
	});

	it("allows at most 400 rows per table", () => {
		const rows = (count: number) =>
			Object.fromEntries(
				Array.from({ length: count }, (_, index) => [
					`ALL/d${index}`,
					["Món", 1, 1, 0.1, null, null, null],
				]),
			);
		expect(
			codes(withTable("long", { ...itemsTable(), rows: rows(MAX_TABLE_ROWS) })),
		).toEqual([]);
		expect(
			aggregatesOnlyIssues(
				withTable("long", { ...itemsTable(), rows: rows(MAX_TABLE_ROWS + 1) }),
			),
		).toEqual([
			{
				code: "table_too_long",
				path: "tables.long.rows",
				detail: "401 rows, at most 400",
			},
		]);
	});

	it("refuses contact details, long digit runs and UUIDs in typed texts and table prose", () => {
		const pack = draftPack();
		expect(
			aggregatesOnlyIssues({
				...pack,
				request: { ...pack.request, focus: "Gửi cho chu.quan@example.com" },
			}),
		).toEqual([{ code: "text_email", path: "request.focus", detail: null }]);
		expect(
			aggregatesOnlyIssues({
				...pack,
				request: { ...pack.request, owner_note: "Gọi 0912 345 678 nhé" },
			}),
		).toEqual([
			{ code: "text_phone", path: "request.owner_note", detail: null },
		]);
		expect(codes(withItemName("Combo 123456789"))).toEqual(["text_digit_run"]);
		expect(codes(withItemName(`Món ${REPEATED_GROUP_ID}`))).toEqual([
			"text_digit_run",
			"text_uuid",
		]);
		expect(
			codes(withItemName("Món bbbbbbbb-7b4d-4e8f-9a6b-c1d2e3f4a5b6")),
		).toEqual(["text_uuid"]);
		expect(aggregatesOnlyIssues(withItemName("Trà 0987654321"))).toEqual([
			{
				code: "text_phone",
				path: 'tables.items.rows["ALL/r01"][0]',
				detail: null,
			},
			{
				code: "text_digit_run",
				path: 'tables.items.rows["ALL/r01"][0]',
				detail: null,
			},
		]);
		expect(
			codes(
				withTable("prose", { ...itemsTable(), title: "Liên hệ a@example.org" }),
			),
		).toEqual(["text_email"]);
		expect(
			codes(
				withTable("prose", { ...itemsTable(), notes: "Hotline 1900 1234 56" }),
			),
		).toEqual([]);
		expect(
			codes(
				withTable("prose", { ...itemsTable(), notes: "Hotline 028 3822 1234" }),
			),
		).toEqual(["text_phone"]);
	});

	it("passes identifiers that only look like personal data, and refuses the same strings in an item name", () => {
		const pack = draftPack();
		const lookalikes = {
			...pack,
			pack_id: `123456789${"a".repeat(55)}`,
			generated_at: "2026-11-12T03:00:00Z",
			request: {
				...pack.request,
				stores: [
					{ id: SEED_STORE_A, label: "S1" },
					{ id: REPEATED_GROUP_ID, label: "S2" },
				],
			},
			prompt: { ...pack.prompt, text: "Liên hệ chu.quan@example.com" },
			context: {
				...pack.context,
				note: `Nhóm ${REPEATED_GROUP_ID}, 0912345678`,
			},
			tables: {
				...pack.tables,
				groups: {
					...itemsTable(),
					rows: {
						"S1/g123456789": ["Nhóm", 1, 1, 0.1, null, null, "2026-11-11"],
					},
				},
			},
		} satisfies DataPack;
		expect(aggregatesOnlyIssues(lookalikes)).toEqual([]);
		for (const text of [
			`123456789${"a".repeat(55)}`,
			SEED_STORE_A,
			SEED_STORE_B,
			REPEATED_GROUP_ID,
			"chu.quan@example.com",
		]) {
			expect(codes(withItemName(`Món ${text}`)).length).toBeGreaterThan(0);
		}
	});

	it("does not scan date cells, which the invariants check instead", () => {
		const pack = withItemName("Trà sữa");
		const items = pack.tables.items as PackTable;
		const row = items.rows["ALL/r01"] ?? [];
		expect(
			codes({
				...pack,
				tables: {
					...pack.tables,
					items: {
						...items,
						rows: {
							...items.rows,
							"ALL/r01": [...row.slice(0, 6), "0912345678"],
						},
					},
				},
			}),
		).toEqual([]);
	});

	it("refuses a number that is not finite anywhere in the pack", () => {
		const pack = draftPack();
		expect(
			aggregatesOnlyIssues({
				...pack,
				budget: { ...pack.budget, estimated_tokens: Number.NaN },
			}),
		).toEqual([
			{
				code: "number_not_finite",
				path: "budget.estimated_tokens",
				detail: "NaN",
			},
		]);
		expect(
			codes(
				withTable("odd", {
					...itemsTable(),
					rows: {
						"ALL/r01": [
							"Món",
							Number.POSITIVE_INFINITY,
							1,
							0.1,
							null,
							null,
							null,
						],
					},
				}),
			),
		).toEqual(["number_not_finite"]);
	});
});

describe("the Vietnamese phone shape", () => {
	it("finds phone numbers written in the usual ways", () => {
		for (const text of [
			"0912345678",
			"0912 345 678",
			"091.234.5678",
			"0912-345-678",
			"+84 912 345 678",
			["+84", "912345678"].join(""),
			"84 912 345 678",
			"028 3822 1234",
			"(028) 3822 1234",
			"Gọi 0387654321.",
		]) {
			expect(personalTextRules(text), text).toContain("text_phone");
		}
	});

	it("leaves prices, dates, times and short numbers alone", () => {
		for (const text of [
			"50.000 đ",
			"Giảm 10.000.000 đ",
			"Combo 2 ly 45.000",
			"01.02.2026 10.30",
			"2026-11-11",
			"Ca 1 06:00-14:00",
			"Size L 500ml",
			"12345678",
			"Doanh thu 0,25 tỷ",
			"Tăng 0.5 lên 3.456.789",
		]) {
			expect(personalTextRules(text), text).toEqual([]);
		}
	});

	it("scans long prose in linear time", () => {
		const started = performance.now();
		expect(personalTextRules("x".repeat(200_000))).toEqual([]);
		expect(personalTextRules("1.".repeat(100_000))).toEqual([]);
		expect(performance.now() - started).toBeLessThan(2000);
	});
});
