import {
	currentMetricIds,
	metricValueIds,
	supersedingMetricOf,
} from "@fnb/metrics";
import { beforeAll, describe, expect, it } from "vitest";
import type { BuiltPack } from "../../src/pack/build.js";
import {
	KPI_EXCLUDED_METRIC_IDS,
	trackableMetricIds,
} from "../../src/pack/kpi-ids.js";
import { rowScope } from "../../src/pack/schema.js";
import { buildWith, demoRequest, demoSource } from "./support/demo.js";

const NOT_TRACKABLE = [
	"void_rate",
	"peak_share_20_21",
	"dead_hour_share_17_18",
];

describe("the trackable KPI ids", () => {
	it("are the ids metric_value computes that are current, without void_rate", () => {
		const current = new Set<string>(currentMetricIds());
		const excluded = new Set(KPI_EXCLUDED_METRIC_IDS);
		expect(KPI_EXCLUDED_METRIC_IDS).toEqual(["void_rate"]);
		expect(trackableMetricIds()).toEqual(
			metricValueIds().filter((id) => current.has(id) && !excluded.has(id)),
		);
		expect(trackableMetricIds()).toHaveLength(18);
		for (const id of NOT_TRACKABLE) {
			expect(trackableMetricIds()).not.toContain(id);
			expect(metricValueIds()).toContain(id);
		}
	});
});

describe("the ids in a pack", () => {
	let built: BuiltPack;

	beforeAll(async () => {
		built = await buildWith(demoSource(), demoRequest());
	});

	it("gives the kpi table one row per scope and trackable id, and no other", () => {
		const keys = Object.keys(built.pack.tables.kpi?.rows ?? {}).sort();
		const expected = ["ALL", "S1", "S2"]
			.flatMap((scope) => trackableMetricIds().map((id) => `${scope}/${id}`))
			.sort();
		expect(keys).toEqual(expected);
	});

	it("marks exactly the trackable ids as trackable in the metrics table", () => {
		const metrics = built.pack.tables.metrics;
		if (metrics === undefined) throw new Error("no metrics table");
		const trackable = metrics.columns.findIndex(
			(column) => column.name === "trackable",
		);
		const supersededBy = metrics.columns.findIndex(
			(column) => column.name === "superseded_by",
		);
		expect(Object.keys(metrics.rows).sort()).toEqual(
			[...metricValueIds()].sort(),
		);
		for (const [id, row] of Object.entries(metrics.rows)) {
			expect(row[trackable], id).toBe(trackableMetricIds().includes(id));
			expect(row[supersededBy], id).toBe(supersedingMetricOf(id as never));
		}
		expect(metrics.rows.void_rate?.[trackable]).toBe(false);
		expect(metrics.rows.peak_share_20_21?.[supersededBy]).toBe(
			"peak_share_top_hours",
		);
	});

	it("names superseded ids and void_rate only as non-trackable context", () => {
		for (const [tableId, table] of Object.entries(built.pack.tables)) {
			if (tableId === "metrics") continue;
			for (const key of Object.keys(table.rows)) {
				for (const id of NOT_TRACKABLE) {
					expect(key.split("/"), `${tableId}:${key}`).not.toContain(id);
				}
				expect(NOT_TRACKABLE).not.toContain(rowScope(key));
			}
		}
	});
});
