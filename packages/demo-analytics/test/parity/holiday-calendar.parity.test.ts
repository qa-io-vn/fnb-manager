import { VIETNAM_HOLIDAYS } from "@fnb/core";
import {
	addDays,
	type DateRange,
	HOLIDAY_CALENDAR_MAX_DAYS,
	type ThemeArgs,
} from "@fnb/reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
	DemoHoliday,
	DemoReportSource,
	DemoStoreId,
} from "../../src/index.js";
import { ParityReport } from "./compare.js";
import { parityClock, parityDatasets } from "./datasets.js";
import {
	type OpenParityDatabase,
	openParityDatabase,
	type SeededDataset,
} from "./harness.js";
import { STORE_SETS } from "./matrix.js";
import { compareThemeCall, themeEngine } from "./theme-harness.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const OPTIONS = { key: ["holiday_date", "name", "kind"], checkOrder: true };
const HORIZON_DAYS = 365;
const TRAILING_DAYS = 365;

function namedRanges(): (DateRange & { name: string })[] {
	const tet = VIETNAM_HOLIDAYS.find(
		(holiday) => holiday.kind === "tet" && holiday.holidayDate > clock.asOf,
	);
	return [
		{
			name: "horizon",
			from: addDays(clock.asOf, 1),
			to: addDays(clock.asOf, HORIZON_DAYS),
		},
		{
			name: "trailing year",
			from: addDays(clock.asOf, -(TRAILING_DAYS - 1)),
			to: clock.asOf,
		},
		{
			name: "longest",
			from: addDays(clock.asOf, -(HOLIDAY_CALENDAR_MAX_DAYS - 1)),
			to: clock.asOf,
		},
		...(tet === undefined
			? []
			: [
					{
						name: "tet",
						from: addDays(tet.holidayDate, -3),
						to: addDays(tet.holidayDate, 10),
					},
				]),
	];
}

function customHolidays(): DemoHoliday[] {
	const global = VIETNAM_HOLIDAYS.find(
		(holiday) => holiday.holidayDate > clock.asOf,
	);
	return [
		{
			countryCode: "VN",
			holidayDate: addDays(clock.asOf, 10),
			name: "Ngày hội cửa hàng",
			kind: "custom",
		},
		{
			countryCode: "VN",
			holidayDate: addDays(clock.asOf, 10),
			name: "Anniversary",
			kind: "custom",
		},
		...(global === undefined
			? []
			: [
					{
						countryCode: "VN",
						holidayDate: global.holidayDate,
						name: global.name,
						kind: "custom" as const,
					},
				]),
	];
}

const STORE_LISTS: readonly (readonly DemoStoreId[])[] = [...STORE_SETS, []];

describe("holiday_calendar in the engine equals the SQL", () => {
	let database: OpenParityDatabase | null = null;
	const report = new ParityReport();
	const engines = new Map<string, DemoReportSource>();

	beforeAll(async () => {
		database = await openParityDatabase(
			[datasets.D1, datasets.D2, datasets.D3],
			clock,
		);
		for (const seeded of database.datasets) {
			engines.set(seeded.dataset.id, themeEngine(seeded, clock));
		}
	});

	afterAll(async () => {
		console.info(`holiday_calendar parity: ${report.summary().split("\n")[0]}`);
		await database?.close();
	});

	function active(): OpenParityDatabase {
		if (database === null) throw new Error("the parity database did not open");
		return database;
	}

	function engineOf(seeded: SeededDataset): DemoReportSource {
		const engine = engines.get(seeded.dataset.id);
		if (engine === undefined) throw new Error("no theme engine");
		return engine;
	}

	async function compareAll(label: string): Promise<void> {
		for (const seeded of active().datasets) {
			for (const range of namedRanges()) {
				for (const stores of STORE_LISTS) {
					const args: ThemeArgs<"holiday_calendar"> = {
						store_ids: [...stores],
						from_date: range.from,
						to_date: range.to,
					};
					await compareThemeCall(
						report,
						active(),
						seeded,
						engineOf(seeded),
						"holiday_calendar",
						args,
						OPTIONS,
						`${label} ${range.name}`,
					);
				}
			}
		}
	}

	it("matches the global calendar over the horizon, a trailing year, the longest range and a Tết window", async () => {
		await compareAll(" global");
		expect(report.rows).toBeGreaterThan(0);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	});

	it("matches again with the tenant's own days, one of them on a global day's date and name", async () => {
		const custom = customHolidays();
		for (const seeded of active().datasets) {
			engineOf(seeded).settings.saveHolidays(custom);
			for (const holiday of custom) {
				await active().connection.rows(
					"insert into public.holidays (tenant_id, country_code, holiday_date, name, kind) values ($1::uuid, $2, $3::date, $4, 'custom')",
					[
						seeded.tenantId,
						holiday.countryCode,
						holiday.holidayDate,
						holiday.name,
					],
				);
			}
		}
		await compareAll(" custom");
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	});

	it("refuses 401 days with the same SQLSTATE", async () => {
		const seeded = active().datasets[0];
		if (seeded === undefined) throw new Error("no dataset");
		await compareThemeCall(
			report,
			active(),
			seeded,
			engineOf(seeded),
			"holiday_calendar",
			{
				store_ids: ["MOCK-S1"],
				from_date: addDays(clock.asOf, -HOLIDAY_CALENDAR_MAX_DAYS),
				to_date: clock.asOf,
			},
			OPTIONS,
			" 401 days",
		);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	});
});
