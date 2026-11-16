import { describe, expect, it } from "vitest";
import { ARGUMENT_SQL_TYPES } from "../../../src/themes/argument-types.js";
import {
	type ThemeFunctionName,
	themeArgumentNames,
	themeFunctions,
	themeRowColumns,
} from "../../../src/themes/contract.js";
import { STORE_A, STORE_B } from "../fixtures.js";

const PACK_FUNCTIONS = [
	"store_profiles",
	"metric_windows",
	"holiday_calendar",
	"plan_kpi_review",
] as const satisfies readonly ThemeFunctionName[];

type PackFunction = (typeof PACK_FUNCTIONS)[number];

const sqlArguments: Record<PackFunction, readonly string[]> = {
	store_profiles: ["store_ids"],
	metric_windows: ["store_ids", "metric_ids", "from_dates", "to_dates"],
	holiday_calendar: ["store_ids", "from_date", "to_date"],
	plan_kpi_review: ["store_ids", "as_of_date"],
};

const databaseRows: Record<PackFunction, Record<string, unknown>> = {
	store_profiles: {
		store_id: STORE_A,
		tenant_id: "11111111-1111-4111-8111-111111111111",
		label: "S1",
		name: "Cửa hàng 1",
		timezone: "Asia/Ho_Chi_Minh",
		business_day_start_minutes: 300,
		opened_on: "2025-03-01",
		opening_hours: { mon: [["07:00", "22:30"]], sat: [["07:00", "12:00"]] },
		seat_count: 40,
		e_invoice_status: "configured",
		currency_code: "VND",
		country_code: "VN",
	},
	metric_windows: {
		range_index: 2,
		from_date: "2026-09-17",
		to_date: "2026-10-14",
		metric_id: "avg_ticket",
		value: "52314.27",
	},
	holiday_calendar: {
		holiday_date: "2027-02-06",
		name: "Tết Nguyên đán",
		kind: "tet",
	},
	plan_kpi_review: {
		plan_rank: 1,
		plan_as_of: "2026-10-31",
		horizon: "90d",
		metric_id: "avg_ticket",
		scope: "ALL",
		baseline: "52314.27",
		target: "55000",
		due_on: "2027-01-29",
		current_value: null,
	},
};

const sqlColumns: Record<PackFunction, readonly string[]> = {
	store_profiles: [
		"store_id",
		"tenant_id",
		"label",
		"name",
		"timezone",
		"business_day_start_minutes",
		"opened_on",
		"opening_hours",
		"seat_count",
		"e_invoice_status",
		"currency_code",
		"country_code",
	],
	metric_windows: ["range_index", "from_date", "to_date", "metric_id", "value"],
	holiday_calendar: ["holiday_date", "name", "kind"],
	plan_kpi_review: [
		"plan_rank",
		"plan_as_of",
		"horizon",
		"metric_id",
		"scope",
		"baseline",
		"target",
		"due_on",
		"current_value",
	],
};

function parseRow(name: PackFunction, row: Record<string, unknown>) {
	return themeFunctions[name].row.safeParse(row);
}

const windows = {
	store_ids: [STORE_A, STORE_B],
	metric_ids: ["net_revenue", "avg_ticket"],
	from_dates: ["2026-10-15", "2026-09-17"],
	to_dates: ["2026-11-11", "2026-10-14"],
};

describe("the contracts of the data pack functions", () => {
	it("name every argument and column of the SQL signatures in order", () => {
		for (const name of PACK_FUNCTIONS) {
			expect(themeArgumentNames(name), name).toEqual(sqlArguments[name]);
			expect(themeRowColumns(name), name).toEqual(sqlColumns[name]);
			expect(Object.keys(databaseRows[name]), name).toEqual(sqlColumns[name]);
		}
	});

	it("type every argument with a name phase 10 already typed", () => {
		for (const name of PACK_FUNCTIONS) {
			for (const argument of themeArgumentNames(name)) {
				expect(
					ARGUMENT_SQL_TYPES[argument],
					`${name}.${argument}`,
				).toBeDefined();
			}
		}
		expect(ARGUMENT_SQL_TYPES.metric_ids).toBe("text[]");
		expect(ARGUMENT_SQL_TYPES.from_dates).toBe("date[]");
	});

	it("parse rows shaped like the database's, numeric strings turned into numbers", () => {
		for (const name of PACK_FUNCTIONS) {
			expect(parseRow(name, databaseRows[name]).success, name).toBe(true);
		}
		expect(
			themeFunctions.metric_windows.row.parse(databaseRows.metric_windows),
		).toEqual({
			range_index: 2,
			from_date: "2026-09-17",
			to_date: "2026-10-14",
			metric_id: "avg_ticket",
			value: 52314.27,
		});
		expect(
			themeFunctions.plan_kpi_review.row.parse(databaseRows.plan_kpi_review),
		).toMatchObject({ baseline: 52314.27, target: 55000, current_value: null });
		expect(
			themeFunctions.store_profiles.row.parse(databaseRows.store_profiles),
		).toMatchObject({
			label: "S1",
			business_day_start_minutes: 300,
			opening_hours: { mon: [["07:00", "22:30"]] },
		});
	});

	it("take null where the database may return null", () => {
		expect(
			parseRow("store_profiles", {
				...databaseRows.store_profiles,
				opened_on: null,
				opening_hours: null,
				seat_count: null,
			}).success,
		).toBe(true);
		expect(
			parseRow("metric_windows", {
				...databaseRows.metric_windows,
				value: null,
			}).success,
		).toBe(true);
	});

	it("refuse an unknown enum value, a malformed label and malformed opening hours", () => {
		expect(
			parseRow("store_profiles", {
				...databaseRows.store_profiles,
				e_invoice_status: "pending",
			}).success,
		).toBe(false);
		expect(
			parseRow("store_profiles", {
				...databaseRows.store_profiles,
				label: "A1",
			}).success,
		).toBe(false);
		expect(
			parseRow("store_profiles", {
				...databaseRows.store_profiles,
				opening_hours: { mon: ["07:00"] },
			}).success,
		).toBe(false);
		expect(
			parseRow("holiday_calendar", {
				...databaseRows.holiday_calendar,
				kind: "regional",
			}).success,
		).toBe(false);
	});

	it("check the metric_windows arguments against the database's limits", () => {
		const args = themeFunctions.metric_windows.args;
		expect(args.safeParse(windows).success).toBe(true);
		expect(
			args.safeParse({
				...windows,
				metric_ids: Array.from({ length: 25 }, () => "net_revenue"),
			}).success,
		).toBe(true);
		expect(
			args.safeParse({
				...windows,
				metric_ids: Array.from({ length: 26 }, () => "net_revenue"),
			}).success,
		).toBe(false);
		expect(args.safeParse({ ...windows, metric_ids: [] }).success).toBe(false);
		expect(args.safeParse({ ...windows, metric_ids: [""] }).success).toBe(
			false,
		);
		const thirteen = Array.from({ length: 13 }, () => "2026-10-15");
		expect(
			args.safeParse({ ...windows, from_dates: thirteen, to_dates: thirteen })
				.success,
		).toBe(false);
		expect(
			args.safeParse({ ...windows, from_dates: ["15/10/2026", "2026-09-17"] })
				.success,
		).toBe(false);
		expect(
			args.safeParse({ ...windows, from_dates: ["2026-10-15"] }).success,
		).toBe(true);
	});

	it("check the other arguments", () => {
		expect(
			themeFunctions.store_profiles.args.safeParse({ store_ids: [] }).success,
		).toBe(true);
		expect(
			themeFunctions.holiday_calendar.args.safeParse({
				store_ids: [STORE_A],
				from_date: "2026-11-12",
				to_date: "2027-02-09",
			}).success,
		).toBe(true);
		expect(
			themeFunctions.plan_kpi_review.args.safeParse({ store_ids: [STORE_A] })
				.success,
		).toBe(false);
	});
});
