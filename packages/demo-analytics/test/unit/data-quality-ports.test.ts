import {
	addDays,
	INVALID_ARGUMENTS_CODE,
	type ThemeFunctionName,
} from "@fnb/reports";
import { describe, expect, it } from "vitest";
import {
	createDemoReportSource,
	DemoDayCache,
	type DemoDayRewrite,
	DemoSettingsStore,
	demoSettings,
} from "../../src/index.js";
import {
	ATTRIBUTION_STORE,
	attributionDay,
	unattributedCases,
} from "../parity/attribution-cases.js";
import {
	DAILY_RECEIPT_STORE,
	numberedReceipts,
	RUNNING_RECEIPT_STORE,
} from "../parity/receipt-cases.js";

const NOW = new Date("2026-11-04T05:30:00.000Z");
const AS_OF = "2026-11-03";

function source(
	window?: { from: string; to: string },
	rewriteDay: DemoDayRewrite = numberedReceipts(),
) {
	return createDemoReportSource({
		now: () => NOW,
		days: new DemoDayCache({
			now: () => NOW,
			volumeScale: 0.1,
			rewriteDay,
			...(window === undefined ? {} : { window }),
		}),
		settings: new DemoSettingsStore(demoSettings(AS_OF)),
	});
}

const QUALITY: readonly ThemeFunctionName[] = [
	"data_quality_items",
	"data_quality_summary",
	"data_quality_payments",
];

describe("the data-quality ports", () => {
	it("refuse a range over 400 days, a range that ends before it starts and more than 50 stores, as the SQL does", async () => {
		const demo = source();
		for (const name of QUALITY) {
			await expect(
				demo.callTheme(name as "data_quality_items", {
					store_ids: ["MOCK-S1"],
					from_date: addDays(AS_OF, -400),
					to_date: AS_OF,
				}),
				name,
			).rejects.toMatchObject({ code: "22023", functionName: name });
			await expect(
				demo.callTheme(name as "data_quality_items", {
					store_ids: ["MOCK-S1"],
					from_date: AS_OF,
					to_date: addDays(AS_OF, -1),
				}),
				name,
			).rejects.toMatchObject({ code: "22023" });
			await expect(
				demo.callTheme(name as "data_quality_items", {
					store_ids: Array.from({ length: 51 }, () => "MOCK-S1"),
					from_date: AS_OF,
					to_date: AS_OF,
				}),
				name,
			).rejects.toMatchObject({ code: INVALID_ARGUMENTS_CODE });
		}
	});

	it("infers receipt numbering only from 20 numbered days on: a store that restarts every day and one that does not", async () => {
		const range = {
			store_ids: [DAILY_RECEIPT_STORE, RUNNING_RECEIPT_STORE],
			from_date: addDays(AS_OF, -27),
			to_date: AS_OF,
		};
		const short = await source({
			from: addDays(AS_OF, -18),
			to: AS_OF,
		}).callTheme("data_quality_summary", range);
		expect(
			short
				.filter((row) => row.store_id !== null)
				.map((row) => [row.receipt_days, row.receipt_restarts_daily]),
		).toEqual([
			[null, null],
			[null, null],
		]);
		const twenty = await source({
			from: addDays(AS_OF, -19),
			to: AS_OF,
		}).callTheme("data_quality_summary", range);
		expect(
			twenty
				.filter((row) => row.store_id !== null)
				.map((row) => [row.receipt_days, row.receipt_restarts_daily]),
		).toEqual([
			[20, true],
			[20, false],
		]);
		const long = await source().callTheme("data_quality_summary", range);
		const byStore = new Map(long.map((row) => [row.store_id, row]));
		expect(byStore.get(DAILY_RECEIPT_STORE)?.receipt_restarts_daily).toBe(true);
		expect(byStore.get(RUNNING_RECEIPT_STORE)?.receipt_restarts_daily).toBe(
			false,
		);
		expect(
			byStore.get(DAILY_RECEIPT_STORE)?.receipt_days,
		).toBeGreaterThanOrEqual(20);
		expect(long[0]).toMatchObject({
			store_id: null,
			receipt_days: null,
			e_invoice_status: null,
		});
	});

	it("shows the young store without e-invoicing, its opening hours and seats unknown, and no customer or consent", async () => {
		const rows = await source().callTheme("data_quality_summary", {
			store_ids: ["MOCK-S1", "MOCK-S2"],
			from_date: addDays(AS_OF, -6),
			to_date: AS_OF,
		});
		expect(rows.find((row) => row.store_id === "MOCK-S2")).toMatchObject({
			e_invoice_status: "not_configured",
			opening_hours_known: false,
			seat_count: null,
			identified_customers: 0,
			consent_coverage: null,
		});
		expect(rows.find((row) => row.store_id === "MOCK-S1")).toMatchObject({
			e_invoice_status: "configured",
			opening_hours_known: true,
			seat_count: 40,
		});
	});

	it("counts a catalogue modifier sold as an item, and events whose sale has no shift row or that fall outside every shift", async () => {
		const day = attributionDay(AS_OF);
		const range = {
			store_ids: [ATTRIBUTION_STORE],
			from_date: day,
			to_date: day,
		};
		const plain = source();
		const rewritten = source(undefined, unattributedCases(AS_OF));
		const before = await plain.callTheme("data_quality_summary", range);
		const after = await rewritten.callTheme("data_quality_summary", range);
		const storeRow = (rows: typeof after) =>
			rows.find((row) => row.store_id === ATTRIBUTION_STORE);
		expect(storeRow(before)).toMatchObject({
			catalogue_modifier_lines: 0,
			unattributed_events: 0,
		});
		expect(storeRow(after)?.catalogue_modifier_lines).toBe(1);
		expect(storeRow(after)?.unattributed_events).toBeGreaterThanOrEqual(2);
		expect(after[0]).toMatchObject({
			store_id: null,
			catalogue_modifier_lines: 1,
			unattributed_events: storeRow(after)?.unattributed_events,
		});
		const items = await rewritten.callTheme("data_quality_items", range);
		expect(items.filter((row) => row.catalogue_modifier)).toHaveLength(1);
	});
});
