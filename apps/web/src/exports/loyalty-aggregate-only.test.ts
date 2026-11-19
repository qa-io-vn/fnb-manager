import * as fflate from "fflate";
import { describe, expect, it } from "vitest";
import { COLUMNS, columnsFor, personalColumnsOf } from "./columns";
import {
	EXPORT_TABLES,
	type ExportRequest,
	type ExportStore,
	planExport,
} from "./plan";
import { createExportReader, selectList } from "./reader";
import { runExport } from "./run";
import {
	createFakePostgrest,
	type FakeStore,
	type FakeTables,
} from "./testing/fake-postgrest";
import {
	STORE_ONE,
	STORE_TWO,
	syntheticTables,
} from "./testing/synthetic-data";

// G-25. ISTQB techniques: error guessing and equivalence partitioning (personal box off, personal box on). A tenant with
// loyalty data: every invoice names a member by phone and name, and the database rows carry the membership and customer
// ids as well. Synthetic values only.
const MEMBER_PHONES = ["0900000101", "0900000102", "0900000103"] as const;
const MEMBER_NAMES = ["Synthetic Member One", "Synthetic Member Two"] as const;
const MEMBERSHIP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const CUSTOMER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";
const NOW = new Date("2026-11-16T03:00:00Z");
const strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// a Vietnamese mobile or landline number, local or +84 (the synthetic ids hold runs of zeros, which are no number)
const PHONE_FORM = /(?<!\d)(?:\+?84|0)[235789]\d{8}(?!\d)/;

function exportStore(store: FakeStore): ExportStore {
	return {
		id: store.id,
		label: store.label,
		name: store.name,
		timeZone: store.timeZone,
		businessDayStartMinutes: store.businessDayStartMinutes,
		asOf: "2026-11-15",
	};
}

function loyaltyTables(): FakeTables {
	const base = syntheticTables({
		stores: [STORE_ONE, STORE_TWO],
		from: "2026-10-01",
		to: "2026-11-16",
		invoicesPerDay: 4,
	});
	return {
		...base,
		invoices: base.invoices.map((invoice, index) => ({
			...invoice,
			customer_phone: MEMBER_PHONES[index % MEMBER_PHONES.length] ?? null,
			customer_name: MEMBER_NAMES[index % MEMBER_NAMES.length] ?? null,
			// not part of the exported columns; the database rows carry them, so a select that grew would show them
			membership_id: MEMBERSHIP_ID,
			customer_id: CUSTOMER_ID,
		})) as FakeTables["invoices"],
	};
}

function request(overrides: Partial<ExportRequest> = {}): ExportRequest {
	return {
		stores: [exportStore(STORE_ONE), exportStore(STORE_TWO)],
		firstMonth: "2026-10",
		lastMonth: "2026-11",
		tables: [...EXPORT_TABLES],
		format: "csv",
		dialect: "comma",
		personal: false,
		...overrides,
	};
}

async function exportAll(overrides: Partial<ExportRequest> = {}) {
	const planned = planExport(request(overrides));
	if (!planned.ok) throw new Error(planned.error);
	const fake = createFakePostgrest({
		stores: [STORE_ONE, STORE_TWO],
		tables: loyaltyTables(),
	});
	const result = await runExport(
		planned.plan,
		createExportReader(fake.client),
		{
			now: () => NOW,
			zipEngine: fflate,
		},
	);
	const bytes = new Uint8Array(await result.archive.arrayBuffer());
	const files = fflate.unzipSync(bytes);
	const text = Object.entries(files).map(
		([path, content]) => [path, strict.decode(content)] as const,
	);
	return { fake, text, names: Object.keys(files) };
}

describe("exports of a tenant with loyalty data", () => {
	it("holds no phone, member id, customer id or name without the personal-data box", async () => {
		const { text, names } = await exportAll();
		expect(names.length).toBeGreaterThan(8);
		const all = text.map(([, content]) => content).join("\n");
		for (const phone of MEMBER_PHONES) expect(all).not.toContain(phone);
		for (const name of MEMBER_NAMES) expect(all).not.toContain(name);
		expect(all).not.toContain(MEMBERSHIP_ID);
		expect(all).not.toContain(CUSTOMER_ID);
		expect(all).not.toContain("900000101");
		expect(all.match(new RegExp(PHONE_FORM, "g"))).toBeNull();
		for (const [path, content] of text) {
			// the daily summary counts member invoices and their share, nothing per member
			const header = (content.split("\n", 1)[0] ?? "").replace(
				/member_invoices|member_share/g,
				"",
			);
			expect(header, `${path} header`).not.toMatch(
				/customer_(phone|name|id)|member|phone/,
			);
		}
	});

	it("never asks the database for a member or customer column, with the box off or on", async () => {
		for (const personal of [false, true]) {
			const { fake } = await exportAll({ personal });
			const selects = fake.requests.map((entry) => entry.select).join(",");
			expect(selects.length).toBeGreaterThan(0);
			expect(selects).not.toMatch(/member|customer_id|loyalty|points|stamp/);
			expect(/customer_phone|customer_name/.test(selects)).toBe(personal);
		}
	});

	it("holds the phone and name only when the box is ticked, and still no member id or customer id", async () => {
		const { text } = await exportAll({ personal: true });
		const all = text.map(([, content]) => content).join("\n");
		expect(MEMBER_PHONES.some((phone) => all.includes(phone))).toBe(true);
		expect(MEMBER_NAMES.some((name) => all.includes(name))).toBe(true);
		expect(all).not.toContain(MEMBERSHIP_ID);
		expect(all).not.toContain(CUSTOMER_ID);
	});

	it("keeps member and loyalty fields out of the column lists, and every customer field behind the box", () => {
		for (const table of EXPORT_TABLES) {
			const keys = COLUMNS[table].map((column) => column.key);
			// daily_summary holds the member invoices as a count and a share, nothing per member
			expect(
				keys.filter(
					(key) =>
						/member|loyalty|points|stamp/.test(key) &&
						!["member_invoices", "member_share"].includes(key),
				),
			).toEqual([]);
			expect(keys).not.toContain("customer_id");
			const withoutBox = columnsFor(table, false);
			const customerFields = keys.filter(
				(key) => /customer|phone|name$/.test(key) && key !== "store_name",
			);
			for (const key of customerFields.filter((field) =>
				/customer|phone/.test(field),
			)) {
				expect(personalColumnsOf(table)).toContain(key);
				expect(withoutBox).not.toContain(key);
			}
		}
		for (const table of [
			"invoices",
			"invoice_lines",
			"invoice_payments",
			"shifts",
		] as const) {
			expect(selectList(table, false)).not.toMatch(/customer|phone|member/);
		}
	});
});
