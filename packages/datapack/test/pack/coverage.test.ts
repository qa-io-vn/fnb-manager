import { addDays, type ThemeRow } from "@fnb/reports";
import { beforeAll, describe, expect, it } from "vitest";
import type { BuiltPack } from "../../src/pack/build.js";
import {
	BAND_WINDOWS,
	KPI_WINDOWS,
	type KpiWindowName,
	kpiWindowsOf,
} from "../../src/pack/calendar.js";
import { trackableMetricIds } from "../../src/pack/kpi-ids.js";
import {
	buildWith,
	demoRequest,
	demoSource,
	GOLDEN_AS_OF,
} from "./support/demo.js";
import { overriddenSource } from "./support/sources.js";

type WindowRow = ThemeRow<"metric_windows">;

const WINDOWS = kpiWindowsOf(GOLDEN_AS_OF);
const BAND: readonly KpiWindowName[] = ["w28", ...BAND_WINDOWS];
const W28 = 0;
const P28 = 1;
const LY28 = 2;
const P28_CHANGE = 3;
const LY28_CHANGE = 4;
const LO = 5;
const HI = 6;
const N = 7;

function withHistoryStart(storeId: string, start: string) {
	return overriddenSource(demoSource(), {
		store_coverage: (rows) =>
			rows.map((row) =>
				row.store_id === storeId ? { ...row, history_start: start } : row,
			),
	});
}

function sqlValue(
	built: BuiltPack,
	scope: string,
	window: KpiWindowName,
	metricId: string,
): number | null {
	const rows = built.calls.find((call) => call.key === `kpi/${scope}`)
		?.rows as readonly WindowRow[];
	return (
		rows.find(
			(row) =>
				row.range_index === KPI_WINDOWS.indexOf(window) + 1 &&
				row.metric_id === metricId,
		)?.value ?? null
	);
}

function kpiRow(built: BuiltPack, key: string) {
	const row = built.pack.tables.kpi?.rows[key];
	if (row === undefined) throw new Error(`no kpi row ${key}`);
	return row;
}

describe("the coverage rule of the KPI windows", () => {
	const newerOpened = addDays(WINDOWS.p28.from, 10);
	let built: BuiltPack;

	beforeAll(async () => {
		built = await buildWith(
			withHistoryStart("MOCK-S2", newerOpened),
			demoRequest(),
		);
	});

	it("opens the newer store inside p28", () => {
		expect(newerOpened > WINDOWS.p28.from).toBe(true);
		expect(newerOpened <= WINDOWS.p28.to).toBe(true);
	});

	it("nulls p28, ly28 and both changes on every ALL row", () => {
		for (const id of trackableMetricIds()) {
			const row = kpiRow(built, `ALL/${id}`);
			expect(row[P28], id).toBeNull();
			expect(row[LY28], id).toBeNull();
			expect(row[P28_CHANGE], id).toBeNull();
			expect(row[LY28_CHANGE], id).toBeNull();
			expect(row[W28], id).toBe(sqlValue(built, "ALL", "w28", id));
		}
	});

	it("takes lo, hi and n of ALL over the windows both stores cover only", () => {
		const covered = BAND.filter(
			(window) => WINDOWS[window].from >= newerOpened,
		);
		expect(covered).toEqual(["w28", "b1", "b2"]);
		for (const id of trackableMetricIds()) {
			const values = covered
				.map((window) => sqlValue(built, "ALL", window, id))
				.filter((value): value is number => value !== null);
			const row = kpiRow(built, `ALL/${id}`);
			expect(row[N], id).toBe(values.length);
			expect(row[LO], id).toBe(
				values.length === 0 ? null : Math.min(...values),
			);
			expect(row[HI], id).toBe(
				values.length === 0 ? null : Math.max(...values),
			);
		}
	});

	it("reports how many windows were nulled in partial_scope_window/ALL", () => {
		const nulled = KPI_WINDOWS.filter(
			(window) => WINDOWS[window].from < newerOpened,
		);
		expect(nulled).toHaveLength(8);
		expect(built.pack.tables.gaps?.rows["partial_scope_window/ALL"]?.[0]).toBe(
			nulled.length,
		);
	});

	it("keeps the older store's own rows complete", () => {
		for (const id of trackableMetricIds()) {
			const row = kpiRow(built, `S1/${id}`);
			expect(row[W28], id).toBe(sqlValue(built, "S1", "w28", id));
			expect(row[P28], id).toBe(sqlValue(built, "S1", "p28", id));
			expect(row[LY28], id).toBe(sqlValue(built, "S1", "ly28", id));
			const band = BAND.map((window) =>
				sqlValue(built, "S1", window, id),
			).filter((value) => value !== null);
			expect(row[N], id).toBe(band.length);
		}
		expect(kpiRow(built, "S1/net_revenue")[P28]).not.toBeNull();
		expect(kpiRow(built, "S1/net_revenue")[LY28]).not.toBeNull();
		expect(kpiRow(built, "S1/net_revenue")[N]).toBe(9);
	});

	it("nulls the newer store's own p28 as well", () => {
		expect(kpiRow(built, "S2/net_revenue")[P28]).toBeNull();
		expect(kpiRow(built, "S2/net_revenue")[W28]).not.toBeNull();
	});
});

describe("a store open for less than 28 days", () => {
	let built: BuiltPack;
	const opened = addDays(GOLDEN_AS_OF, -10);

	beforeAll(async () => {
		built = await buildWith(withHistoryStart("MOCK-S2", opened), demoRequest());
	});

	it("has a null w28 on all its rows, and so has every ALL row", () => {
		for (const id of trackableMetricIds()) {
			for (const scope of ["S2", "ALL"]) {
				const row = kpiRow(built, `${scope}/${id}`);
				expect(row[W28], `${scope}/${id}`).toBeNull();
				expect(row[N], `${scope}/${id}`).toBe(0);
				expect(row[LO], `${scope}/${id}`).toBeNull();
			}
		}
	});

	it("shows as a young store with its days of history, not as unmeasured KPIs", () => {
		const gaps = built.pack.tables.gaps?.rows ?? {};
		expect(gaps["young_store/S2"]?.[0]).toBe(11);
		expect(gaps["partial_scope_window/ALL"]?.[0]).toBe(KPI_WINDOWS.length);
		expect(gaps["unmeasured_kpi/S2"]).toBeUndefined();
		expect(gaps["unmeasured_kpi/ALL"]).toBeUndefined();
		expect(gaps["short_history/S2"]).toBeUndefined();
	});
});
