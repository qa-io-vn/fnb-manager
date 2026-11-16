import { VIETNAM_HOLIDAYS } from "@fnb/core";
import { addDays, type IsoDate } from "@fnb/reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DemoReportSource } from "../../src/index.js";
import { ParityReport } from "./compare.js";
import {
	COMPLIANCE_STORE,
	complianceDay,
	FULL_VOUCHER,
	GIFT_PROMOTION,
	ITEM_PROMOTION_ID,
} from "./compliance-cases.js";
import {
	inWindow,
	monthEnds,
	parityClock,
	parityDatasets,
	seededRanges,
} from "./datasets.js";
import {
	type OpenParityDatabase,
	openParityDatabase,
	type SeededDataset,
} from "./harness.js";
import { STORE_SETS } from "./matrix.js";
import { compareThemeCall, themeEngine } from "./theme-harness.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const MAX_DAYS = 400;
const PRESET_DAYS = [7, 28, 92, MAX_DAYS] as const;
const RANDOM_RANGES = 10;
const CAP_RATES = [undefined, 0.3, 0.05, 1] as const;
const TET_DAY = "Tet, day 4";

interface Range {
	readonly from: IsoDate;
	readonly to: IsoDate;
}

describe("promotion_compliance in the engine equals the SQL", () => {
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
		console.info(
			`promotion_compliance parity: ${report.summary().split("\n")[0]}`,
		);
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

	function rangesOf(seeded: SeededDataset): Range[] {
		const clip = (from: IsoDate, to: IsoDate): Range => ({
			from: from < seeded.window.from ? seeded.window.from : from,
			to: to > seeded.window.to ? seeded.window.to : to,
		});
		const young = seeded.stores["MOCK-S2"].definition.openedOn;
		const ranges = PRESET_DAYS.map((days) =>
			clip(addDays(clock.asOf, -(days - 1)), clock.asOf),
		);
		if (inWindow(seeded.dataset, young)) {
			ranges.push(clip(young, addDays(young, 27)));
		}
		for (const monthEnd of monthEnds(clock, 1)) {
			ranges.push(clip(addDays(monthEnd, -6), addDays(monthEnd, 7)));
		}
		for (const holiday of VIETNAM_HOLIDAYS) {
			if (
				holiday.name === TET_DAY &&
				inWindow(seeded.dataset, holiday.holidayDate)
			) {
				ranges.push(
					clip(
						addDays(holiday.holidayDate, -14),
						addDays(holiday.holidayDate, 14),
					),
				);
			}
		}
		ranges.push(...seededRanges(seeded.dataset, RANDOM_RANGES, 89, MAX_DAYS));
		return ranges.filter((range) => range.from <= range.to);
	}

	it("matches every store set over the presets, the young store's first weeks, a month end, Tết and seeded ranges, the cap rotating through the default, 0.3, 0.05 and 1", async () => {
		const context = active();
		for (const seeded of context.datasets) {
			for (const [index, range] of rangesOf(seeded).entries()) {
				for (const stores of STORE_SETS) {
					const cap = CAP_RATES[index % CAP_RATES.length];
					await compareThemeCall(
						report,
						context,
						seeded,
						engineOf(seeded),
						"promotion_compliance",
						{
							store_ids: [...stores],
							from_date: range.from,
							to_date: range.to,
							...(cap === undefined ? {} : { cap_rate: cap }),
						},
						{ key: ["promotion_kind", "promotion_key"], checkOrder: true },
					);
				}
			}
		}
		expect(report.rows).toBeGreaterThan(200);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);

	it("shows the 60 % line and the 60 % bill over the cap, the gifts with full rows only and the fully discounted invoices as full, in both engines, under caps finer than the rates", async () => {
		const context = active();
		const seeded = context.datasets.find(
			(candidate) => candidate.dataset.id === "D3",
		);
		if (seeded === undefined) throw new Error("no D3 dataset");
		const day = complianceDay(clock.asOf);
		const args = {
			store_ids: [COMPLIANCE_STORE],
			from_date: day,
			to_date: day,
		};
		await compareThemeCall(
			report,
			context,
			seeded,
			engineOf(seeded),
			"promotion_compliance",
			args,
			{ key: ["promotion_kind", "promotion_key"], checkOrder: true },
			" cases",
		);
		const rows = await engineOf(seeded).callTheme("promotion_compliance", args);
		const find = (kind: string, key?: string) =>
			rows.find(
				(row) =>
					row.promotion_kind === kind &&
					(key === undefined || row.promotion_key === key),
			);
		expect(find("item", ITEM_PROMOTION_ID)).toMatchObject({
			over_cap_rows: 1,
			max_partial_rate: 0.6,
		});
		expect(find("bill")).toMatchObject({ over_cap_rows: 1 });
		expect(find("bill")?.max_partial_rate).toBe(0.6);
		expect(find("item", GIFT_PROMOTION.id)).toMatchObject({
			over_cap_rows: 0,
			max_partial_rate: null,
		});
		expect(find("item", GIFT_PROMOTION.id)?.full_discount_rows).toBeGreaterThan(
			1,
		);
		expect(find("bill")?.full_discount_rows).toBeGreaterThan(0);
		expect(find("voucher", FULL_VOUCHER.name)).toMatchObject({
			full_discount_rows: 1,
			over_cap_rows: 0,
		});
		expect(find("invoice_total")?.over_cap_rows).toBeGreaterThan(0);
		expect(find("invoice_total")?.full_discount_rows).toBeGreaterThan(1);
		for (const cap_rate of [0.5999996, 0.6000004]) {
			await compareThemeCall(
				report,
				context,
				seeded,
				engineOf(seeded),
				"promotion_compliance",
				{ ...args, cap_rate },
				{ key: ["promotion_kind", "promotion_key"], checkOrder: true },
				" fine cap",
			);
			const fine = await engineOf(seeded).callTheme("promotion_compliance", {
				...args,
				cap_rate,
			});
			expect(
				fine.find((row) => row.promotion_key === ITEM_PROMOTION_ID)
					?.over_cap_rows,
			).toBe(cap_rate < 0.6 ? 1 : 0);
		}
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);

	it("answers nothing for an empty store list and refuses the same calls", async () => {
		const context = active();
		const seeded = context.datasets[0];
		if (seeded === undefined) throw new Error("no dataset");
		for (const args of [
			{ store_ids: [], from_date: clock.asOf, to_date: clock.asOf },
			{
				store_ids: ["MOCK-S1"],
				from_date: addDays(clock.asOf, -MAX_DAYS),
				to_date: clock.asOf,
			},
			{
				store_ids: ["MOCK-S1"],
				from_date: clock.asOf,
				to_date: addDays(clock.asOf, -1),
			},
		]) {
			await compareThemeCall(
				report,
				context,
				seeded,
				engineOf(seeded),
				"promotion_compliance",
				args,
				{ key: ["promotion_kind", "promotion_key"] },
				" edges",
			);
		}
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);
});
