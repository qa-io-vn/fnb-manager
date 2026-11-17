import type { DemoReportSource } from "@fnb/demo-analytics";
import { daysBetween, type ReportFunctionName } from "@fnb/reports";
import { beforeAll, describe, expect, it } from "vitest";
import type { BuiltPack } from "../../src/pack/build.js";
import {
	customerIdentityMetricCount,
	PACK_GAP_CODES,
	PACK_GAPS,
} from "../../src/pack/tables/gaps.js";
import {
	buildWith,
	demoRequest,
	demoSource,
	GOLDEN_AS_OF,
} from "./support/demo.js";
import { overriddenSource, type RowsOverride } from "./support/sources.js";

type Overrides = Partial<Record<ReportFunctionName, RowsOverride>>;
type Row = Record<string, unknown>;

const ALWAYS = ["no_customer_identity/ALL", "staff_hours/ALL"];

function forStore(storeId: string, change: (row: Row) => Row): RowsOverride {
	return (rows) =>
		rows.map((row) => (row.store_id === storeId ? change(row) : row));
}

function forCallOf(storeId: string, change: (row: Row) => Row): RowsOverride {
	return (rows, args) => {
		const ids = args.store_ids as readonly string[];
		return ids.length === 1 && ids[0] === storeId ? rows.map(change) : rows;
	};
}

const CONFIGURED: Overrides = {
	report_settings_of: (rows) =>
		rows.map((row) => ({
			...row,
			seat_count: 30,
			opening_hours_known: true,
			fee_rates_configured: true,
			costs_configured: true,
			roles_configured: true,
		})),
	month_pace: (rows) =>
		rows.map((row) => ({ ...row, target_net_amount: 300_000_000 })),
	store_coverage: (rows) =>
		rows.map((row) => ({
			...row,
			history_start: "2024-12-02",
			unmatched_days: 0,
			unchecked_sales_days: 0,
			stale_days: 0,
		})),
	metric_windows: (rows) =>
		rows.map((row) => ({ ...row, value: row.value ?? 1 })),
	item_margins: (rows) =>
		rows.map((row) => ({ ...row, cost_coverage: 1, margin_rate: 0.6 })),
};

function chain(
	first: RowsOverride | undefined,
	second: RowsOverride,
): RowsOverride {
	return (rows, args) =>
		second(first === undefined ? rows : first(rows, args), args);
}

function configuredWith(extra: Overrides): Overrides {
	const merged: Overrides = { ...CONFIGURED };
	for (const [name, override] of Object.entries(extra) as [
		ReportFunctionName,
		RowsOverride,
	][]) {
		merged[name] = chain(CONFIGURED[name], override);
	}
	return merged;
}

describe("the gaps", () => {
	let source: DemoReportSource;

	async function gapsOf(
		overrides: Overrides,
	): Promise<Record<string, unknown[]>> {
		const built: BuiltPack = await buildWith(
			overriddenSource(source, overrides),
			demoRequest(),
		);
		return (built.pack.tables.gaps?.rows ?? {}) as Record<string, unknown[]>;
	}

	async function addedTo(extra: Overrides): Promise<Record<string, unknown[]>> {
		const rows = await gapsOf(configuredWith(extra));
		return Object.fromEntries(
			Object.entries(rows).filter(([key]) => !ALWAYS.includes(key)),
		);
	}

	beforeAll(async () => {
		source = demoSource();
		await buildWith(source, demoRequest());
	});

	it("links each code to its severity and to the setting that fixes it", () => {
		expect(PACK_GAP_CODES).toHaveLength(15);
		expect(PACK_GAPS.opening_hours.setting).toBe("settings_store");
		expect(PACK_GAPS.item_roles.setting).toBe("settings_roles");
		expect(PACK_GAPS.item_costs.setting).toBe("settings_costs");
		expect(PACK_GAPS.partial_costs.setting).toBe("settings_costs");
		expect(PACK_GAPS.fee_rates.setting).toBe("settings_fees");
		expect(PACK_GAPS.target.setting).toBe("settings_targets");
		expect(PACK_GAPS.unreconciled_days.severity).toBe("high");
	});

	it("lists the demo's missing inputs", async () => {
		const rows = await gapsOf({});
		expect(Object.keys(rows).sort()).toEqual(
			[
				"fee_rates/S1",
				"fee_rates/S2",
				"item_costs/S1",
				"item_costs/S2",
				"no_customer_identity/ALL",
				"opening_hours/S2",
				"partial_scope_window/ALL",
				"seat_count/S2",
				"short_history/S2",
				"staff_hours/ALL",
				"target/S2",
				"unmeasured_kpi/ALL",
				"unmeasured_kpi/S2",
				"unreconciled_days/S1",
				"unreconciled_days/S2",
			].sort(),
		);
		expect(rows["partial_scope_window/ALL"]).toEqual([3, "medium", null]);
		expect(rows["unmeasured_kpi/S2"]).toEqual([2, "medium", null]);
		expect(rows["unreconciled_days/S1"]).toEqual([1, "high", null]);
		expect(rows["opening_hours/S2"]).toEqual([
			null,
			"medium",
			"settings_store",
		]);
	});

	it("keeps only the gaps that always hold once everything is configured", async () => {
		const rows = await gapsOf(CONFIGURED);
		expect(Object.keys(rows).sort()).toEqual(ALWAYS);
		expect(rows["no_customer_identity/ALL"]).toEqual([
			customerIdentityMetricCount(),
			"low",
			null,
		]);
		expect(customerIdentityMetricCount()).toBe(11);
		expect(rows["staff_hours/ALL"]).toEqual([null, "low", null]);
	});

	it("reports each missing setting of a store", async () => {
		expect(
			await addedTo({
				report_settings_of: forStore("MOCK-S1", (row) => ({
					...row,
					opening_hours_known: false,
					roles_configured: false,
				})),
			}),
		).toEqual({
			"opening_hours/S1": [null, "medium", "settings_store"],
			"item_roles/S1": [null, "medium", "settings_roles"],
		});
		expect(
			await addedTo({
				report_settings_of: forStore("MOCK-S2", (row) => ({
					...row,
					seat_count: null,
					fee_rates_configured: false,
					costs_configured: false,
				})),
			}),
		).toEqual({
			"seat_count/S2": [null, "low", "settings_store"],
			"fee_rates/S2": [null, "low", "settings_fees"],
			"item_costs/S2": [null, "medium", "settings_costs"],
		});
	});

	it("reports a missing target per store", async () => {
		expect(
			await addedTo({
				month_pace: forCallOf("MOCK-S1", (row) => ({
					...row,
					target_net_amount: null,
				})),
			}),
		).toEqual({ "target/S1": [null, "low", "settings_targets"] });
	});

	it("counts the items of a scope sold without a full cost", async () => {
		let marked = 0;
		expect(
			await addedTo({
				item_margins: forCallOf("MOCK-S1", (row) => {
					marked += 1;
					return marked <= 3 ? { ...row, cost_coverage: 0.5 } : row;
				}),
			}),
		).toEqual({ "partial_costs/S1": [3, "low", "settings_costs"] });
	});

	it("tells a young store from a short history, with the days of history", async () => {
		const young = "2026-11-02";
		expect(
			await addedTo({
				store_coverage: forStore("MOCK-S2", (row) => ({
					...row,
					history_start: young,
				})),
			}),
		).toEqual({
			"young_store/S2": [10, "medium", null],
			"partial_scope_window/ALL": [11, "medium", null],
		});
		const short = "2026-01-01";
		expect(
			await addedTo({
				store_coverage: forStore("MOCK-S2", (row) => ({
					...row,
					history_start: short,
				})),
			}),
		).toEqual({
			"short_history/S2": [daysBetween(short, GOLDEN_AS_OF) + 1, "low", null],
			"partial_scope_window/ALL": [1, "medium", null],
		});
	});

	it("counts unreconciled and stale days", async () => {
		expect(
			await addedTo({
				store_coverage: (rows) =>
					rows.map((row) =>
						row.store_id === "MOCK-S1"
							? { ...row, unmatched_days: 2, unchecked_sales_days: 1 }
							: { ...row, stale_days: 4 },
					),
			}),
		).toEqual({
			"unreconciled_days/S1": [3, "high", null],
			"stale_aggregates/S2": [4, "medium", null],
		});
	});

	it("counts the trackable KPIs a covered scope does not measure", async () => {
		expect(
			await addedTo({
				metric_windows: forCallOf("MOCK-S1", (row) =>
					row.range_index === 1 && row.metric_id === "avg_ticket"
						? { ...row, value: null }
						: row,
				),
			}),
		).toEqual({ "unmeasured_kpi/S1": [1, "medium", null] });
	});
});
