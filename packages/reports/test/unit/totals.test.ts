import { describe, expect, it } from "vitest";
import {
	comparison,
	coverageModel,
	decompositionInputs,
	part,
	reportKeys,
	storeTotals,
	sumsOfRows,
	unavailableKey,
	youngStoreNote,
	youngStoreState,
} from "../../src/index.js";
import {
	context,
	coverageRow,
	STORE_A,
	STORE_B,
	totalsRow,
} from "./fixtures.js";

const WEEK = context("week", "2026-11-03");
const coverage = coverageModel(
	[
		coverageRow(STORE_A, { history_start: "2024-12-02" }),
		coverageRow(STORE_B, { history_start: "2026-08-31" }),
	],
	WEEK,
);

const rows = [
	totalsRow(null, "current", "2026-11-02", "2026-11-03", {
		net_amount: 9_000_000,
		invoices: 180,
		items_sold: 300,
	}),
	totalsRow(null, "last_year", "2025-11-03", "2025-11-04", {
		net_amount: 4_000_000,
		invoices: 90,
		items_sold: 140,
	}),
	totalsRow(STORE_A, "current", "2026-11-02", "2026-11-03", {
		net_amount: 6_000_000,
		invoices: 120,
		items_sold: 200,
	}),
	totalsRow(STORE_A, "last_year", "2025-11-03", "2025-11-04", {
		net_amount: 4_000_000,
		invoices: 90,
		items_sold: 140,
	}),
	totalsRow(STORE_B, "current", "2026-11-02", "2026-11-03", {
		net_amount: 3_000_000,
		invoices: 60,
		items_sold: 100,
	}),
	totalsRow(STORE_B, "last_year", "2025-11-03", "2025-11-04", {
		days_with_data: 0,
		net_amount: null,
		invoices: null,
		items_sold: null,
	}),
];

describe("shared totals helpers", () => {
	it("adds store rows exactly and skips rows without data", () => {
		expect(
			sumsOfRows([
				totalsRow(STORE_A, "current", "2026-11-03", "2026-11-03", {
					net_amount: 0.1,
					invoices: 1,
					items_sold: 0.001,
				}),
				totalsRow(STORE_B, "current", "2026-11-03", "2026-11-03", {
					net_amount: 0.2,
					invoices: 2,
					items_sold: 0.002,
				}),
				totalsRow(null, "current", "2026-11-03", "2026-11-03", {
					days_with_data: 0,
				}),
				undefined,
			]),
		).toEqual({ net: 0.3, invoices: 3, items: 0.003 });
		expect(sumsOfRows([undefined])).toEqual({
			net: null,
			invoices: null,
			items: null,
		});
	});

	it("decomposes like for like from the covered stores' rows only", () => {
		const lastYear = comparison({
			kind: "last_year",
			label: part(reportKeys.compare.lastYear.week),
			range: { from: "2025-11-03", to: "2025-11-04" },
			current: 6_000_000,
			reference: 4_000_000,
			basis: "like_for_like",
			coveredStores: 1,
			totalStores: 2,
		});
		expect(decompositionInputs(rows, coverage, lastYear)).toEqual({
			current: { net: 6_000_000, invoices: 120, items: 200 },
			reference: { net: 4_000_000, invoices: 90, items: 140 },
		});
		const allStores = comparison({ ...lastYear, basis: "all_stores" });
		expect(decompositionInputs(rows, coverage, allStores)?.current).toEqual({
			net: 9_000_000,
			invoices: 180,
			items: 300,
		});
	});

	it("lines up each store's period rows", () => {
		const totals = storeTotals(WEEK, rows);
		expect(totals.map((entry) => entry.store.id)).toEqual([STORE_A, STORE_B]);
		expect(totals[1]?.lastYear?.days_with_data).toBe(0);
		expect(totals[0]?.previous).toBeUndefined();
	});

	it("names the young store and its state", () => {
		expect(youngStoreState(coverage, STORE_B, "2025-11-03")).toBe(
			unavailableKey("store_too_young", "last_year"),
		);
		expect(youngStoreState(coverage, STORE_A, "2025-11-03")).toBeNull();
		expect(
			youngStoreState(coverage, STORE_B, "2026-10-26", "previous"),
		).toBeNull();
		expect(youngStoreNote(WEEK, coverage, "2025-11-03")).toEqual({
			key: reportKeys.clause.coverage.youngStore,
			values: {
				store: { kind: "text", value: "Store 2" },
				date: { kind: "date", value: "2026-08-31" },
			},
		});
		expect(youngStoreNote(WEEK, coverage, "2026-10-26")).toBeNull();
	});
});
