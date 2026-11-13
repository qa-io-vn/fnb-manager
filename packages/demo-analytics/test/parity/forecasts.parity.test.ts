import { VIETNAM_HOLIDAYS } from "@fnb/core";
import {
	addDays,
	addMonths,
	firstOfMonth,
	type IsoDate,
	lastOfMonth,
} from "@fnb/reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	dailyNetSeries,
	seasonalNaiveSeries,
	weekdayProfile,
} from "../../src/functions/forecast-series-helpers.js";
import type { DemoStoreId } from "../../src/index.js";
import { ParityReport } from "./compare.js";
import { inWindow, parityClock, parityDatasets } from "./datasets.js";
import {
	type OpenParityDatabase,
	openParityDatabase,
	pgArray,
	type SeededDataset,
} from "./harness.js";
import { compareCall, matrixAnchors, STORE_SETS } from "./matrix.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const RANDOM_ANCHORS = 6;
const ACCURACY_WINDOWS = [28, 56] as const;
const MID_MONTH_DAY = 14;
const PRE_TET_DAYS = 3;
const NAIVE_HORIZON_DAYS = 40;

interface PaceCase {
	readonly monthStart: IsoDate;
	readonly asOf: IsoDate | null;
}

function tetDays(name: string): IsoDate[] {
	return VIETNAM_HOLIDAYS.filter((holiday) => holiday.name === name).map(
		(holiday) => holiday.holidayDate,
	);
}

function paceCases(seeded: SeededDataset): PaceCase[] {
	const current = firstOfMonth(clock.asOf);
	const previous = addMonths(current, -1);
	const cases: PaceCase[] = [
		{ monthStart: current, asOf: clock.asOf },
		{ monthStart: current, asOf: null },
		{ monthStart: previous, asOf: clock.asOf },
		{ monthStart: previous, asOf: addDays(previous, MID_MONTH_DAY) },
		{ monthStart: addMonths(current, 1), asOf: clock.asOf },
		{
			monthStart: addMonths(current, -2),
			asOf: lastOfMonth(addMonths(current, -2)),
		},
	];
	for (const firstDay of tetDays("Tet, day 1")) {
		if (!inWindow(seeded.dataset, firstDay)) continue;
		const month = firstOfMonth(firstDay);
		const middle = tetDays("Tet, day 4").find((date) => date > firstDay);
		cases.push(
			{ monthStart: month, asOf: addDays(firstDay, -PRE_TET_DAYS) },
			{ monthStart: month, asOf: middle ?? firstDay },
			{ monthStart: month, asOf: lastOfMonth(month) },
			{
				monthStart: addMonths(month, 1),
				asOf: addDays(firstDay, PRE_TET_DAYS),
			},
		);
	}
	for (const anchor of matrixAnchors(seeded, clock, RANDOM_ANCHORS)) {
		cases.push({ monthStart: firstOfMonth(anchor), asOf: anchor });
	}
	const seen = new Set<string>();
	return cases.filter((entry) => {
		const key = `${entry.monthStart}|${entry.asOf ?? ""}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function accuracyAnchors(seeded: SeededDataset): IsoDate[] {
	return [
		...new Set([clock.asOf, ...matrixAnchors(seeded, clock, RANDOM_ANCHORS)]),
	].sort();
}

function storeUuids(seeded: SeededDataset, stores: readonly string[]): string {
	return pgArray(stores.map((id) => seeded.uuidOf(id as DemoStoreId)));
}

describe("month_pace and forecast_accuracy in the engine equal the SQL", () => {
	let database: OpenParityDatabase | null = null;
	const report = new ParityReport();

	beforeAll(async () => {
		database = await openParityDatabase(
			[datasets.D1, datasets.D2, datasets.D3],
			clock,
		);
	});

	afterAll(async () => {
		console.info(`forecasts parity: ${report.summary().split("\n")[0]}`);
		await database?.close();
	});

	function active(): OpenParityDatabase {
		if (database === null) throw new Error("the parity database did not open");
		return database;
	}

	it("month_pace for the current, a past and a future month and the Tết month", async () => {
		for (const seeded of active().datasets) {
			for (const entry of paceCases(seeded)) {
				for (const stores of STORE_SETS) {
					await compareCall(
						report,
						active(),
						seeded,
						"month_pace",
						{
							store_ids: [...stores],
							month_start: entry.monthStart,
							...(entry.asOf === null ? {} : { as_of: entry.asOf }),
						},
						{ key: ["period_start"] },
					);
				}
			}
		}
		expect(report.mismatches, report.summary()).toBe(0);
	});

	it("forecast_accuracy with 28 and 56 days", async () => {
		for (const seeded of active().datasets) {
			for (const anchor of accuracyAnchors(seeded)) {
				for (const stores of STORE_SETS) {
					for (const days of ACCURACY_WINDOWS) {
						await compareCall(
							report,
							active(),
							seeded,
							"forecast_accuracy",
							{ store_ids: [...stores], as_of_date: anchor, days },
							{ key: ["forecast_id"] },
						);
					}
				}
			}
		}
		expect(report.mismatches, report.summary()).toBe(0);
	});

	it("the series helpers equal app.daily_net_series, app.weekday_profile and app.seasonal_naive_series to the last digit", async () => {
		const context = { now: clock.now, holidays: VIETNAM_HOLIDAYS };
		for (const seeded of active().datasets) {
			for (const origin of accuracyAnchors(seeded)) {
				for (const stores of STORE_SETS) {
					const label = `${seeded.dataset.id} (${stores.join(",")}, ${origin})`;
					const uuids = storeUuids(seeded, stores);
					const engine = seeded.engine.aggregates;
					const seriesFrom = addDays(origin, -83);
					report.compareRows(
						`daily_net_series${label}`,
						await active().connection.rows(
							"select business_date, net_amount::text as net_amount, excluded from app.daily_net_series($1::uuid[], $2::date, $3::date) order by business_date",
							[uuids, seriesFrom, origin],
						),
						dailyNetSeries(
							engine,
							stores,
							seriesFrom,
							origin,
							context.holidays,
						).map((point) => ({
							business_date: point.date,
							net_amount: point.net.toString(),
							excluded: point.excluded,
						})),
						{ key: ["business_date"] },
					);
					report.compareRows(
						`weekday_profile${label}`,
						await active().connection.rows(
							"select weekday, level_net_amount::text as level_net_amount, weekday_index::text as weekday_index from app.weekday_profile($1::uuid[], $2::date) order by weekday",
							[uuids, origin],
						),
						weekdayProfile(engine, stores, origin, context.holidays).map(
							(entry) => ({
								weekday: entry.weekday,
								level_net_amount: entry.level?.toString() ?? null,
								weekday_index: entry.index?.toString() ?? null,
							}),
						),
						{ key: ["weekday"] },
					);
					const naiveFrom = addDays(origin, 1);
					const naiveTo = addDays(origin, NAIVE_HORIZON_DAYS);
					report.compareRows(
						`seasonal_naive_series${label}`,
						await active().connection.rows(
							"select target_date, forecast_net_amount::text as forecast_net_amount from app.seasonal_naive_series($1::uuid[], $2::date, $3::date, $4::date) order by target_date",
							[uuids, origin, naiveFrom, naiveTo],
						),
						seasonalNaiveSeries(
							engine,
							stores,
							origin,
							naiveFrom,
							naiveTo,
							context.holidays,
						).map((point) => ({
							target_date: point.targetDate,
							forecast_net_amount: point.forecast?.toString() ?? null,
						})),
						{ key: ["target_date"] },
					);
				}
			}
		}
		expect(report.mismatches, report.summary()).toBe(0);
	});
});
