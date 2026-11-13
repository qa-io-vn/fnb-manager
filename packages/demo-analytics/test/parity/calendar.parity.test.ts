import { isExcludedDay, VIETNAM_HOLIDAYS } from "@fnb/core";
import { addDays, periodBounds } from "@fnb/reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	ESTABLISHED_STORE_OPENED_ON,
	holidayKindOn,
	isExcludedDemoDay,
	isTetWindowDay,
} from "../../src/index.js";
import { ParityReport } from "./compare.js";
import { calendarDataset, parityClock } from "./datasets.js";
import {
	type OpenParityDatabase,
	openParityDatabase,
	pgArray,
} from "./harness.js";
import { GRAINS } from "./matrix.js";

const clock = parityClock();
const BOUND_ANCHORS_FROM = "2023-12-25";
const BOUND_ANCHORS_TO = "2028-12-31";
const SPEC_ANCHORS = [
	"2026-01-01",
	"2026-02-28",
	"2028-02-29",
	"2026-03-31",
	"2026-12-31",
	"2026-12-28",
	"2027-01-03",
];

describe("the demo calendar equals the SQL calendar", () => {
	let database: OpenParityDatabase | null = null;
	const report = new ParityReport();

	beforeAll(async () => {
		database = await openParityDatabase([calendarDataset(clock)], clock);
	});

	afterAll(async () => {
		console.info(`calendar parity: ${report.summary().split("\n")[0]}`);
		await database?.close();
	});

	function active(): OpenParityDatabase {
		if (database === null) throw new Error("the parity database did not open");
		return database;
	}

	it("VIETNAM_HOLIDAYS equals the global holiday rows", async () => {
		const sqlRows = await active().connection.rows(
			"select holiday_date, name, kind::text as kind from public.holidays where tenant_id is null and country_code = 'VN' order by holiday_date, name",
		);
		const engineRows = [...VIETNAM_HOLIDAYS]
			.sort(
				(left, right) =>
					left.holidayDate.localeCompare(right.holidayDate) ||
					(left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
			)
			.map((holiday) => ({
				holiday_date: holiday.holidayDate,
				name: holiday.name,
				kind: holiday.kind,
			}));
		report.compareRows("holidays", sqlRows, engineRows, {
			key: ["holiday_date", "name"],
		});
		expect(sqlRows.length).toBe(VIETNAM_HOLIDAYS.length);
		expect(report.mismatches, report.summary()).toBe(0);
	});

	it("isExcludedDay and the Tết window equal the SQL rules for every date of D2", async () => {
		const seeded = active().datasets[0];
		if (seeded === undefined) throw new Error("no dataset");
		const stores = pgArray([
			seeded.uuidOf("MOCK-S1"),
			seeded.uuidOf("MOCK-S2"),
		]);
		const sqlRows = await active().connection.rows(
			"select d::date::text as day, app.is_excluded_day($1::uuid[], d::date) as excluded, app.tet_window(null, 'VN', d::date) as tet from generate_series($2::date, $3::date, interval '1 day') as d order by d",
			[stores, ESTABLISHED_STORE_OPENED_ON, clock.today],
		);
		const engineRows = sqlRows.map((row) => {
			const day = String(row.day);
			return {
				day,
				excluded: isExcludedDay(VIETNAM_HOLIDAYS, day),
				tet: isTetWindowDay(VIETNAM_HOLIDAYS, day),
			};
		});
		report.compareRows("excluded days", sqlRows, engineRows, { key: ["day"] });
		const demoRows = sqlRows.map((row) => ({
			day: String(row.day),
			excluded: isExcludedDemoDay(VIETNAM_HOLIDAYS, String(row.day)),
			tet: holidayKindOn(VIETNAM_HOLIDAYS, String(row.day)) === "tet",
		}));
		report.compareRows("demo excluded days", sqlRows, demoRows, {
			key: ["day"],
		});
		expect(sqlRows.length).toBeGreaterThan(300);
		expect(report.mismatches, report.summary()).toBe(0);
	});

	it("periodBounds equals app.period_bounds for every anchor from 2024 to 2028", async () => {
		for (const grain of GRAINS) {
			const sqlRows = await active().connection.rows(
				"select a::date::text as anchor, b.period, b.from_date, b.to_date from generate_series($2::date, $3::date, interval '1 day') as a cross join lateral app.period_bounds($1, a::date) as b",
				[grain, BOUND_ANCHORS_FROM, BOUND_ANCHORS_TO],
			);
			const engineRows = sqlRows
				.map((row) => String(row.anchor))
				.filter((anchor, index, all) => all.indexOf(anchor) === index)
				.flatMap((anchor) =>
					periodBounds(grain, anchor).map((bound) => ({
						anchor,
						period: bound.period,
						from_date: bound.from,
						to_date: bound.to,
					})),
				);
			report.compareRows(`app.period_bounds ${grain}`, sqlRows, engineRows, {
				key: ["anchor", "period"],
			});
		}
		expect(report.mismatches, report.summary()).toBe(0);
	});

	it("periodBounds equals the ranges of public.period_compare", async () => {
		const anchors = [
			...SPEC_ANCHORS,
			clock.asOf,
			addDays(clock.asOf, -1),
			clock.today,
		];
		for (const grain of GRAINS) {
			for (const anchor of anchors) {
				const sqlRows = await active().connection.rows(
					"select period, from_date, to_date from public.period_compare('{}'::uuid[], $1, $2::date)",
					[grain, anchor],
				);
				const engineRows = periodBounds(grain, anchor).map((bound) => ({
					period: bound.period,
					from_date: bound.from,
					to_date: bound.to,
				}));
				report.compareRows(
					`period_compare ${grain} ${anchor}`,
					sqlRows,
					engineRows,
					{ key: ["period"] },
				);
			}
		}
		expect(report.mismatches, report.summary()).toBe(0);
	});
});
