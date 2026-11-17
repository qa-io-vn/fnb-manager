import { beforeAll, describe, expect, it } from "vitest";
import type { BuiltPack } from "../../../src/pack/build.js";
import { instantMilliseconds, localHourOf } from "../../../src/pack/clock.js";
import { SHIFT_BANDS, shiftBandOf } from "../../../src/pack/tables/shifts.js";
import { buildWith, demoRequest, demoSource } from "../support/demo.js";
import { overriddenSource } from "../support/sources.js";

describe("the opening bands of shifts", () => {
	it("cover the day once, the night band across midnight", () => {
		const bands = Array.from({ length: 24 }, (_, hour) => shiftBandOf(hour));
		expect(bands.slice(5, 11).every((band) => band === "morning")).toBe(true);
		expect(bands.slice(11, 17).every((band) => band === "midday")).toBe(true);
		expect(bands.slice(17, 23).every((band) => band === "evening")).toBe(true);
		expect([23, 0, 1, 2, 3, 4].map(shiftBandOf)).toEqual(
			Array.from({ length: 6 }, () => "night"),
		);
		expect(SHIFT_BANDS.map((band) => band.id)).toEqual([
			"morning",
			"midday",
			"evening",
			"night",
		]);
	});

	it("reads instants written with Z, an offset or microseconds the same way", () => {
		const instant = Date.UTC(2026, 9, 14, 23, 30, 0, 123);
		expect(instantMilliseconds("2026-10-14T23:30:00.123Z")).toBe(instant);
		expect(instantMilliseconds("2026-10-14T23:30:00.123456+00:00")).toBe(
			instant,
		);
		expect(instantMilliseconds("2026-10-15 06:30:00.123+07")).toBe(instant);
		expect(instantMilliseconds("2026-10-14T19:30:00.123-04:00")).toBe(instant);
		expect(instantMilliseconds("2026-10-14T23:30:00")).toBeNull();
		expect(instantMilliseconds(null)).toBeNull();
		expect(localHourOf("2026-10-14T23:30:00Z", "Asia/Ho_Chi_Minh")).toBe(6);
		expect(localHourOf("2026-10-14T16:30:00Z", "Asia/Ho_Chi_Minh")).toBe(23);
		expect(localHourOf("2026-10-14T19:00:00Z", "Asia/Ho_Chi_Minh")).toBe(2);
	});
});

describe("the shifts table", () => {
	let built: BuiltPack;

	beforeAll(async () => {
		built = await buildWith(
			overriddenSource(demoSource(), {
				shift_review: (rows) =>
					rows.map((row, index) => {
						if (row.store_id !== "MOCK-S2" || index % 7 !== 0) return row;
						return {
							...row,
							opened_at: "2026-10-20T16:30:00+00:00",
							closed_at: "2026-10-20T19:30:00+00:00",
						};
					}),
			}),
			demoRequest(),
		);
	});

	it("groups shifts by opening band, a band across midnight included", () => {
		const rows = built.pack.tables.shifts?.rows ?? {};
		expect(Object.keys(rows).sort()).toEqual(
			[
				"ALL/evening",
				"ALL/midday",
				"ALL/morning",
				"ALL/night",
				"S1/evening",
				"S1/midday",
				"S1/morning",
				"S2/evening",
				"S2/midday",
				"S2/morning",
				"S2/night",
			].sort(),
		);
		const night = rows["S2/night"];
		expect(night?.[0]).toBeGreaterThan(0);
		expect(night?.[3]).toBe(3);
		expect(rows["ALL/night"]?.[0]).toBe(night?.[0]);
		const total = (scope: string) =>
			Object.entries(rows)
				.filter(([key]) => key.startsWith(`${scope}/`))
				.reduce((sum, [, row]) => sum + Number(row[0]), 0);
		expect(total("ALL")).toBe(total("S1") + total("S2"));
	});

	it("never carries a shift or cashier name", () => {
		const shiftRows = built.calls.find((call) => call.key === "shifts")
			?.rows as {
			shift_name: string | null;
			cashier_name: string | null;
		}[];
		const names = new Set(
			shiftRows.flatMap((row) => [row.shift_name, row.cashier_name]),
		);
		names.delete(null);
		expect(names.size).toBeGreaterThan(0);
		const text = JSON.stringify(built.pack.tables);
		for (const name of names) expect(text).not.toContain(`"${name}"`);
		expect(
			built.pack.tables.shifts?.columns.map((column) => column.name),
		).toEqual([
			"shifts",
			"avg_orders",
			"avg_sales",
			"avg_hours",
			"flagged",
			"avg_abs_variance",
		]);
	});
});
