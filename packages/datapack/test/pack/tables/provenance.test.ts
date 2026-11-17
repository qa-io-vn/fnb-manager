import {
	type AnalyticsRow,
	difference,
	isoWeekKey,
	relativeChange,
	roundHalfAwayFromZero,
	type ThemeRow,
} from "@fnb/reports";
import { beforeAll, describe, expect, it } from "vitest";
import type { BuiltPack } from "../../../src/pack/build.js";
import {
	type ReportRecording,
	recordingReportSource,
} from "../../../src/pack/record.js";
import type { PackCell, PackTable } from "../../../src/pack/schema.js";
import { WEEKDAY_KEYS } from "../../../src/pack/tables/series.js";
import { buildWith, demoRequest, demoSource } from "../support/demo.js";

type Rows = Readonly<Record<string, readonly PackCell[]>>;

function round(
	value: number | null | undefined,
	digits: number,
): number | null {
	return value === null || value === undefined
		? null
		: roundHalfAwayFromZero(value, digits);
}

function cells(table: PackTable | undefined): Rows {
	if (table === undefined) throw new Error("missing table");
	return table.rows;
}

function column(table: PackTable | undefined, name: string): number {
	const index = table?.columns.findIndex((entry) => entry.name === name) ?? -1;
	if (index === -1) throw new Error(`missing column ${name}`);
	return index;
}

describe("every numeric cell comes from a recorded source value", () => {
	let built: BuiltPack;
	let recording: ReportRecording;

	function rowsOf<Row>(key: string): readonly Row[] {
		const call = built.calls.find((entry) => entry.key === key);
		if (call === undefined) throw new Error(`no call ${key}`);
		return call.rows as readonly Row[];
	}

	function storeIdOf(scope: string): string | null {
		return scope === "ALL"
			? null
			: (built.pack.request.stores.find((store) => store.label === scope)?.id ??
					null);
	}

	beforeAll(async () => {
		recording = recordingReportSource(demoSource());
		built = await buildWith(recording.source, demoRequest());
	});

	it("matches the recorded rows of each call to the calls the builder lists", () => {
		const recorded = new Map(
			recording.calls.map((call) => [call.key, call.rows]),
		);
		for (const call of built.calls) {
			expect([...recorded.values()]).toContainEqual(call.rows);
		}
	});

	it("takes the KPI cells exactly as SQL gives them", () => {
		const kpi = cells(built.pack.tables.kpi);
		const windows = ["w28", "p28", "ly28"];
		for (const [key, row] of Object.entries(kpi)) {
			const [scope, metricId] = key.split("/");
			const sql = rowsOf<ThemeRow<"metric_windows">>(`kpi/${scope}`);
			windows.forEach((window, index) => {
				const cell = row[index];
				if (cell === null) return;
				expect(cell, `${key} ${window}`).toBe(
					sql.find(
						(entry) =>
							entry.range_index === index + 1 && entry.metric_id === metricId,
					)?.value,
				);
			});
		}
	});

	it("rounds the weekly, monthly and weekday totals of period_series", () => {
		const series = (key: string) => rowsOf<AnalyticsRow<"period_series">>(key);
		for (const [tableId, bucketOf] of [
			[
				"weekly",
				(row: AnalyticsRow<"period_series">) =>
					isoWeekKey({
						isoYear: row.iso_year ?? 0,
						isoWeek: row.iso_week ?? 0,
					}),
			],
			[
				"monthly",
				(row: AnalyticsRow<"period_series">) => row.bucket_start.slice(0, 7),
			],
			[
				"weekday",
				(row: AnalyticsRow<"period_series">) =>
					WEEKDAY_KEYS[(row.weekday ?? 1) - 1] ?? "",
			],
		] as const) {
			const table = built.pack.tables[tableId];
			for (const [key, row] of Object.entries(cells(table))) {
				const [scope, bucket] = key.split("/");
				const source = series(tableId).find(
					(entry) =>
						entry.store_id === storeIdOf(scope ?? "") &&
						bucketOf(entry) === bucket,
				);
				expect(source, key).toBeDefined();
				expect(row[column(table, "net")], key).toBe(
					round(source?.net_amount, 0),
				);
				expect(row[column(table, "invoices")], key).toBe(source?.invoices);
				expect(row[column(table, "avg_ticket")], key).toBe(
					round(source?.avg_ticket, 0),
				);
				expect(row[column(table, "store_days")], key).toBe(
					source?.days_with_data,
				);
			}
		}
	});

	it("rounds the month to date of month_pace", () => {
		const table = built.pack.tables.month_to_date;
		for (const [scope, row] of Object.entries(cells(table))) {
			const [source] = rowsOf<AnalyticsRow<"month_pace">>(
				`month_to_date/${scope}`,
			);
			expect(row[column(table, "net")]).toBe(
				round(source?.month_to_date_net_amount, 0),
			);
			expect(row[column(table, "forecast_profile")]).toBe(
				round(source?.forecast_weekday_profile_net_amount, 0),
			);
			expect(row[column(table, "elapsed_days")]).toBe(source?.elapsed_days);
		}
	});

	it("writes the heatmaps in thousands and as invoices per day", () => {
		for (const [tableId, pick, digits] of [
			[
				"heatmap_net",
				(row: ThemeRow<"hour_weekday_heatmap">) =>
					row.avg_net_amount === null ? null : row.avg_net_amount / 1000,
				1,
			],
			[
				"heatmap_invoices",
				(row: ThemeRow<"hour_weekday_heatmap">) => row.avg_invoices,
				2,
			],
		] as const) {
			const table = built.pack.tables[tableId];
			for (const [key, row] of Object.entries(cells(table))) {
				const [scope, weekday] = key.split("/");
				const source = rowsOf<ThemeRow<"hour_weekday_heatmap">>(
					`heatmap/${scope}`,
				);
				table?.columns.forEach((entry, index) => {
					const hour = Number(entry.name.slice(1));
					const match = source.find(
						(sourceRow) =>
							sourceRow.hour_local === hour &&
							WEEKDAY_KEYS[sourceRow.weekday - 1] === weekday,
					);
					expect(row[index], `${key} ${entry.name}`).toBe(
						match === undefined ? 0 : round(pick(match), digits),
					);
				});
			}
		}
	});

	it("rounds items, pairs, modifiers, payments and promotions", () => {
		const items = built.pack.tables.items;
		for (const [key, row] of Object.entries(cells(items))) {
			const scope = key.split("/")[0];
			const source = rowsOf<AnalyticsRow<"item_summary">>(
				`items/${scope}`,
			).find((entry) => entry.item_name === row[column(items, "name")]);
			expect(row[column(items, "qty")], key).toBe(round(source?.quantity, 3));
			expect(row[column(items, "net")], key).toBe(round(source?.net_amount, 0));
			expect(row[column(items, "share")], key).toBe(
				round(source?.net_share, 4),
			);
			expect(row[column(items, "net_change")], key).toBe(
				round(
					relativeChange(source?.net_amount, source?.compare_net_amount),
					4,
				),
			);
			expect(row[column(items, "first_sold")], key).toBe(source?.first_sold_on);
		}
		const pairs = built.pack.tables.pairs;
		for (const [key, row] of Object.entries(cells(pairs))) {
			const source = rowsOf<ThemeRow<"basket_pairs">>(
				`pairs/${key.split("/")[0]}`,
			).find(
				(entry) => entry.item_a_name === row[0] && entry.item_b_name === row[1],
			);
			expect(row[column(pairs, "invoices")], key).toBe(source?.pair_invoices);
			expect(row[column(pairs, "confidence_ab")], key).toBe(
				round(source?.confidence_a_to_b, 4),
			);
			expect(row[column(pairs, "lift")], key).toBe(round(source?.lift, 2));
		}
		const modifiers = built.pack.tables.modifiers;
		for (const [key, row] of Object.entries(cells(modifiers))) {
			const source = rowsOf<ThemeRow<"modifier_summary">>(
				`modifiers/${key.split("/")[0]}`,
			).find((entry) => entry.modifier_name === row[0]);
			expect(row[column(modifiers, "lines")], key).toBe(source?.lines);
			expect(row[column(modifiers, "share")], key).toBe(
				round(source?.share, 4),
			);
			expect(row[column(modifiers, "share_change")], key).toBe(
				round(difference(source?.share, source?.compare_share), 4),
			);
		}
		const payments = built.pack.tables.payments;
		for (const [key, row] of Object.entries(cells(payments))) {
			const source = rowsOf<AnalyticsRow<"payment_summary">>(
				`payments/${key.split("/")[0]}`,
			).find((entry) => entry.payment_method_name === row[0]);
			expect(row[column(payments, "amount")], key).toBe(
				round(source?.amount, 0),
			);
			expect(row[column(payments, "share")], key).toBe(round(source?.share, 4));
			expect(row[column(payments, "invoices")], key).toBe(source?.invoices);
		}
		const promotions = built.pack.tables.promotions;
		for (const [key, row] of Object.entries(cells(promotions))) {
			const source = rowsOf<AnalyticsRow<"promotion_summary">>(
				`promotions/${key.split("/")[0]}`,
			).find((entry) => entry.promotion_name === row[0]);
			expect(row[column(promotions, "discount")], key).toBe(
				round(source?.discount_amount, 0),
			);
			expect(row[column(promotions, "days")], key).toBe(source?.days_used);
		}
	});

	it("takes the store columns from store_profiles and store_coverage", () => {
		const stores = built.pack.tables.stores;
		const profiles = rowsOf<ThemeRow<"store_profiles">>("profiles");
		const coverage = rowsOf<AnalyticsRow<"store_coverage">>("coverage");
		for (const [label, row] of Object.entries(cells(stores))) {
			const profile = profiles.find((entry) => entry.label === label);
			const covered = coverage.find(
				(entry) => entry.store_id === profile?.store_id,
			);
			expect(row[column(stores, "name")]).toBe(profile?.name);
			expect(row[column(stores, "seats")]).toBe(profile?.seat_count);
			expect(row[column(stores, "history_start")]).toBe(covered?.history_start);
			expect(row[column(stores, "unmatched_days")]).toBe(
				covered?.unmatched_days,
			);
			expect(row[column(stores, "unchecked_days")]).toBe(
				covered?.unchecked_sales_days,
			);
		}
	});

	it("shows a store-day without a matched check in the stores table", () => {
		const stores = built.pack.tables.stores;
		const rows = cells(stores);
		expect(rows.S1?.[column(stores, "unmatched_days")]).toBe(1);
		expect(rows.S1?.[column(stores, "verified")]).toBe(false);
		expect(rows.S2?.[column(stores, "unchecked_days")]).toBe(1);
		expect(rows.S2?.[column(stores, "verified")]).toBe(false);
		expect(built.pack.tables.gaps?.rows["unreconciled_days/S1"]?.[0]).toBe(1);
	});
});
