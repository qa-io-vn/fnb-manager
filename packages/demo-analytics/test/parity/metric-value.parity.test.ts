import { VIETNAM_HOLIDAYS } from "@fnb/core";
import { metricValueIds } from "@fnb/metrics";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { METRIC_VALUE_IDS, metricValue } from "../../src/index.js";
import { ParityReport } from "./compare.js";
import { parityClock, parityDatasets, seededRanges } from "./datasets.js";
import {
	type OpenParityDatabase,
	openParityDatabase,
	pgArray,
} from "./harness.js";
import { compareCall, GRAINS, matrixAnchors, STORE_SETS } from "./matrix.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const RANGES_PER_DATASET = 20;
const MAX_RANGE_DAYS = 120;
const COMPARE_ANCHORS = 3;

describe("metric_value and metric_compare in the engine equal the SQL", () => {
	let database: OpenParityDatabase | null = null;
	const report = new ParityReport();

	beforeAll(async () => {
		database = await openParityDatabase(
			[datasets.D1, datasets.D2, datasets.D3],
			clock,
		);
	});

	afterAll(async () => {
		console.info(`metric value parity: ${report.summary().split("\n")[0]}`);
		await database?.close();
	});

	function active(): OpenParityDatabase {
		if (database === null) throw new Error("the parity database did not open");
		return database;
	}

	it("ports exactly the ids of the registry", () => {
		expect([...METRIC_VALUE_IDS].sort()).toEqual([...metricValueIds()].sort());
	});

	it("metric_value for every id over seeded random ranges", async () => {
		for (const seeded of active().datasets) {
			const ranges = seededRanges(
				seeded.dataset,
				RANGES_PER_DATASET,
				seeded.dataset.id.charCodeAt(1),
				MAX_RANGE_DAYS,
			);
			for (const range of ranges) {
				for (const stores of STORE_SETS) {
					const sqlRows = await active().connection.rows(
						"select m.metric_id, public.metric_value($1::uuid[], m.metric_id, $2::date, $3::date) as value from unnest($4::text[]) with ordinality as m (metric_id, position) order by m.position",
						[
							pgArray(stores.map((id) => seeded.uuidOf(id))),
							range.from,
							range.to,
							pgArray([...METRIC_VALUE_IDS]),
						],
					);
					const engineRows = METRIC_VALUE_IDS.map((metricId) => ({
						metric_id: metricId,
						value:
							metricValue(
								seeded.engine.aggregates,
								{
									store_ids: stores,
									metric_id: metricId,
									from_date: range.from,
									to_date: range.to,
								},
								{ now: clock.now, holidays: VIETNAM_HOLIDAYS },
							)[0]?.value ?? null,
					}));
					report.compareRows(
						`${seeded.dataset.id} metric_value(${stores.join(",")}, ${range.from}..${range.to})`,
						sqlRows,
						engineRows,
						{ key: ["metric_id"], demoIdOf: seeded.demoIdOf },
					);
				}
			}
		}
		expect(report.mismatches, report.summary()).toBe(0);
	});

	it("metric_compare for every grain with all ids", async () => {
		for (const seeded of active().datasets) {
			const anchors = matrixAnchors(seeded, clock, 2).slice(-COMPARE_ANCHORS);
			for (const anchor of anchors) {
				for (const stores of STORE_SETS) {
					for (const grain of GRAINS) {
						await compareCall(
							report,
							active(),
							seeded,
							"metric_compare",
							{
								store_ids: [...stores],
								metric_ids: [...METRIC_VALUE_IDS],
								grain,
								anchor,
							},
							{ key: ["metric_id", "period"] },
						);
					}
				}
			}
		}
		expect(report.mismatches, report.summary()).toBe(0);
	});

	it("an unknown metric id raises the same SQLSTATE", async () => {
		const seeded = active().datasets[0];
		if (seeded === undefined) throw new Error("no dataset");
		await compareCall(
			report,
			active(),
			seeded,
			"metric_compare",
			{
				store_ids: ["MOCK-S1"],
				metric_ids: ["net_revenue", "not_a_metric"],
				grain: "day",
				anchor: clock.asOf,
			},
			{ key: ["metric_id", "period"] },
		);
		expect(report.mismatches, report.summary()).toBe(0);
	});
});
