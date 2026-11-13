import { VIETNAM_HOLIDAYS } from "@fnb/core";
import {
	addDays,
	firstOfMonth,
	type IsoDate,
	maxDate,
	periodBounds,
} from "@fnb/reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sameWeekdayBaseline } from "../../src/index.js";
import { ParityReport } from "./compare.js";
import { parityClock, parityDatasets } from "./datasets.js";
import {
	type OpenParityDatabase,
	openParityDatabase,
	pgArray,
	type SeededDataset,
} from "./harness.js";
import { compareCall, GRAINS, matrixAnchors, STORE_SETS } from "./matrix.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const RANDOM_ANCHORS = 10;

describe("the engine ports of the report functions equal the SQL", () => {
	let database: OpenParityDatabase | null = null;
	const report = new ParityReport();

	beforeAll(async () => {
		database = await openParityDatabase(
			[datasets.D1, datasets.D2, datasets.D3],
			clock,
		);
	});

	afterAll(async () => {
		console.info(`core functions parity: ${report.summary().split("\n")[0]}`);
		await database?.close();
	});

	function active(): OpenParityDatabase {
		if (database === null) throw new Error("the parity database did not open");
		return database;
	}

	function each(
		run: (
			seeded: SeededDataset,
			anchor: IsoDate,
			stores: readonly string[],
		) => Promise<void>,
	): Promise<void> {
		return (async () => {
			for (const seeded of active().datasets) {
				for (const anchor of matrixAnchors(seeded, clock, RANDOM_ANCHORS)) {
					for (const stores of STORE_SETS) {
						await run(seeded, anchor, stores);
					}
				}
			}
		})();
	}

	function startOf(seeded: SeededDataset, date: IsoDate): IsoDate {
		return maxDate(seeded.window.from, date);
	}

	it("period_compare and period_compare_by_store for every grain", async () => {
		await each(async (seeded, anchor, stores) => {
			for (const grain of GRAINS) {
				await compareCall(
					report,
					active(),
					seeded,
					"period_compare",
					{ store_ids: [...stores], grain, anchor },
					{ key: ["period"] },
				);
				await compareCall(
					report,
					active(),
					seeded,
					"period_compare_by_store",
					{ store_ids: [...stores], grain, anchor },
					{ key: ["store_id", "period"] },
				);
			}
		});
		expect(report.mismatches, report.summary()).toBe(0);
	});

	it("period_series for every grain", async () => {
		await each(async (seeded, anchor, stores) => {
			const ranges: [(typeof GRAINS)[number] | "weekday", IsoDate][] = [
				["day", addDays(anchor, -27)],
				["week", addDays(anchor, -83)],
				["month", addDays(anchor, -400)],
				["year", seeded.window.from],
				["weekday", addDays(anchor, -55)],
			];
			for (const [grain, from] of ranges) {
				await compareCall(
					report,
					active(),
					seeded,
					"period_series",
					{
						store_ids: [...stores],
						grain,
						from_date: startOf(seeded, from),
						to_date: anchor,
					},
					{ key: ["store_id", "bucket_start", "weekday"] },
				);
				if (grain === "week" || grain === "weekday") {
					await compareCall(
						report,
						active(),
						seeded,
						"period_series",
						{
							store_ids: [...stores],
							grain,
							from_date: startOf(seeded, from),
							to_date: anchor,
							include_stores: false,
						},
						{ key: ["store_id", "bucket_start", "weekday"] },
					);
				}
			}
		});
		expect(report.mismatches, report.summary()).toBe(0);
	});

	it("daily_baselines, hourly_profile and same_weekday_baseline", async () => {
		await each(async (seeded, anchor, stores) => {
			await compareCall(
				report,
				active(),
				seeded,
				"daily_baselines",
				{
					store_ids: [...stores],
					from_date: addDays(anchor, -13),
					to_date: anchor,
					weeks: 8,
				},
				{ key: ["business_date"] },
			);
			await compareCall(
				report,
				active(),
				seeded,
				"hourly_profile",
				{ store_ids: [...stores], target_date: anchor, weeks: 8 },
				{ key: ["hour_local"] },
			);
			const sqlRows = await active().connection.rows(
				"select * from public.same_weekday_baseline($1::uuid[], $2::date, 8)",
				[pgArray(stores.map((id) => seeded.uuidOf(id as "MOCK-S1"))), anchor],
			);
			const engineRows = sameWeekdayBaseline(
				seeded.engine.aggregates,
				{ store_ids: stores, target_date: anchor, weeks: 8 },
				{ now: clock.now, holidays: VIETNAM_HOLIDAYS },
			);
			report.compareRows(
				`${seeded.dataset.id} same_weekday_baseline(${stores.join(",")}, ${anchor})`,
				sqlRows,
				engineRows as unknown as Record<string, unknown>[],
				{ key: ["weekday"], demoIdOf: seeded.demoIdOf },
			);
		});
		expect(report.mismatches, report.summary()).toBe(0);
	});

	it("item_summary and payment_summary with and without a compare range", async () => {
		await each(async (seeded, anchor, stores) => {
			const previous = periodBounds("month", anchor).find(
				(bound) => bound.period === "previous",
			);
			const monthStart = startOf(seeded, firstOfMonth(anchor));
			for (const name of ["item_summary", "payment_summary"] as const) {
				const key =
					name === "item_summary" ? ["item_external_id"] : ["method_key"];
				await compareCall(
					report,
					active(),
					seeded,
					name,
					{
						store_ids: [...stores],
						from_date: anchor,
						to_date: anchor,
						compare_from: addDays(anchor, -1),
						compare_to: addDays(anchor, -1),
					},
					{ key },
				);
				await compareCall(
					report,
					active(),
					seeded,
					name,
					{ store_ids: [...stores], from_date: monthStart, to_date: anchor },
					{ key },
				);
				if (previous !== undefined) {
					await compareCall(
						report,
						active(),
						seeded,
						name,
						{
							store_ids: [...stores],
							from_date: monthStart,
							to_date: anchor,
							compare_from: startOf(seeded, previous.from),
							compare_to: maxDate(previous.to, startOf(seeded, previous.from)),
						},
						{ key },
					);
				}
			}
		});
		expect(report.mismatches, report.summary()).toBe(0);
	});

	it("promotion_summary, shift_review, store_coverage and store_targets", async () => {
		await each(async (seeded, anchor, stores) => {
			await compareCall(
				report,
				active(),
				seeded,
				"promotion_summary",
				{
					store_ids: [...stores],
					from_date: addDays(anchor, -6),
					to_date: anchor,
				},
				{ key: ["promotion_kind", "promotion_key"] },
			);
			await compareCall(
				report,
				active(),
				seeded,
				"shift_review",
				{
					store_ids: [...stores],
					from_date: addDays(anchor, -6),
					to_date: anchor,
				},
				{
					key: ["store_id", "shift_external_id"],
					ignore: ["shift_id"],
					timestampColumns: ["opened_at", "closed_at"],
				},
			);
			await compareCall(
				report,
				active(),
				seeded,
				"store_coverage",
				{
					store_ids: [...stores],
					from_date: startOf(seeded, addDays(anchor, -30)),
					to_date: anchor,
				},
				{ key: ["store_id"], ignore: ["last_refreshed_at"] },
			);
			await compareCall(
				report,
				active(),
				seeded,
				"store_targets",
				{
					store_ids: [...stores],
					period_kind: "month",
					period_start: firstOfMonth(anchor),
				},
				{ key: ["store_id"] },
			);
		});
		expect(report.mismatches, report.summary()).toBe(0);
	});

	it("argument errors raise the same SQLSTATE", async () => {
		const seeded = active().datasets[0];
		if (seeded === undefined) throw new Error("no dataset");
		const stores = ["MOCK-S1", "MOCK-S2"];
		const anchor = clock.asOf;
		await compareCall(
			report,
			active(),
			seeded,
			"item_summary",
			{ store_ids: stores, from_date: addDays(anchor, -400), to_date: anchor },
			{ key: ["item_external_id"] },
		);
		await compareCall(
			report,
			active(),
			seeded,
			"period_series",
			{
				store_ids: stores,
				grain: "day",
				from_date: addDays(anchor, -400),
				to_date: anchor,
			},
			{ key: ["store_id", "bucket_start", "weekday"] },
		);
		await compareCall(
			report,
			active(),
			seeded,
			"promotion_summary",
			{ store_ids: stores, from_date: addDays(anchor, -92), to_date: anchor },
			{ key: ["promotion_kind", "promotion_key"] },
		);
		await compareCall(
			report,
			active(),
			seeded,
			"daily_baselines",
			{ store_ids: stores, from_date: addDays(anchor, -62), to_date: anchor },
			{ key: ["business_date"] },
		);
		await compareCall(
			report,
			active(),
			seeded,
			"store_coverage",
			{ store_ids: stores, from_date: anchor, to_date: addDays(anchor, -1) },
			{ key: ["store_id"] },
		);
		await compareCall(
			report,
			active(),
			seeded,
			"period_compare_by_store",
			{ store_ids: [], grain: "day", anchor },
			{ key: ["store_id", "period"] },
		);
		expect(report.mismatches, report.summary()).toBe(0);
	});
});
