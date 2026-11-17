import { beforeAll, describe, expect, it } from "vitest";
import type { BuiltPack } from "../../../src/pack/build.js";
import {
	hourColumnName,
	orderedHours,
} from "../../../src/pack/tables/hours.js";
import { buildWith, demoRequest, demoSource } from "../support/demo.js";
import { overriddenSource } from "../support/sources.js";

function hoursOf(built: BuiltPack, tableId: string): string[] {
	return (built.pack.tables[tableId]?.columns ?? [])
		.map((column) => column.name)
		.filter((name) => /^h\d{2}$/.test(name));
}

describe("the hour columns", () => {
	let midnight: BuiltPack;
	let five: BuiltPack;

	beforeAll(async () => {
		const base = demoSource();
		midnight = await buildWith(base, demoRequest());
		five = await buildWith(
			overriddenSource(base, {
				store_profiles: (rows) =>
					rows.map((row) => ({ ...row, business_day_start_minutes: 300 })),
			}),
			demoRequest(),
		);
	});

	it("orders hours from the start of the business day", () => {
		expect(orderedHours([3, 23, 5, 0, 12, 4], 5)).toEqual([5, 12, 23, 0, 3, 4]);
		expect(orderedHours([3, 23, 5, 0, 12, 4], 0)).toEqual([0, 3, 4, 5, 12, 23]);
		expect(orderedHours([7, 7, 24, -1, 1.5], 0)).toEqual([7]);
		expect(hourColumnName(5)).toBe("h05");
	});

	it("orders the heatmap and level columns from 05:00 when the day starts at 05:00", () => {
		const columns = hoursOf(five, "heatmap_net");
		expect(columns[0]).toBe("h07");
		expect(columns.at(-1)).toBe("h00");
		expect(columns.indexOf("h23")).toBeLessThan(columns.indexOf("h00"));
		expect(hoursOf(midnight, "heatmap_net")[0]).toBe("h00");
		expect(hoursOf(five, "heatmap_invoices")).toEqual(columns);
		const levels = hoursOf(five, "hour_levels");
		expect(levels[0]).toBe("h05");
		expect(levels.slice(-5)).toEqual(["h00", "h01", "h02", "h03", "h04"]);
	});

	it("keeps only the hours with sales and writes 0 for an hour without sales on a weekday with sales", () => {
		const table = midnight.pack.tables.heatmap_net;
		const columns = hoursOf(midnight, "heatmap_net");
		expect(columns).not.toContain("h03");
		expect(columns).toContain("h07");
		for (const row of Object.values(table?.rows ?? {})) {
			expect(row).toHaveLength(columns.length);
			expect(row.every((cell) => typeof cell === "number")).toBe(true);
		}
		expect(
			Object.keys(table?.rows ?? {}).filter((key) => key.startsWith("ALL/")),
		).toHaveLength(7);
	});

	it("moves the same values under the reordered columns", () => {
		const before = midnight.pack.tables.heatmap_net;
		const after = five.pack.tables.heatmap_net;
		const value = (table: typeof before, key: string, hour: string) =>
			table?.rows[key]?.[
				table.columns.findIndex((column) => column.name === hour)
			];
		for (const hour of hoursOf(midnight, "heatmap_net")) {
			expect(value(after, "ALL/mon", hour), hour).toBe(
				value(before, "ALL/mon", hour),
			);
		}
	});
});
