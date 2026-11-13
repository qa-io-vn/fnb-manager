import { describe, expect, it } from "vitest";
import {
	type Comparison,
	decomposeNet,
	decomposeTicket,
	decomposition,
	FLAT_THRESHOLD,
	narrate,
	part,
	reportKeys,
	strongestDriver,
} from "../../src/index.js";

function seeded(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state / 4_294_967_296;
	};
}

function cents(value: number): number {
	return Math.round(value * 100);
}

describe("decomposeNet and decomposeTicket", () => {
	it("splits revenue into invoices, items per ticket and item price", () => {
		const result = decomposeNet(
			{ net: 6_600_000, invoices: 120, items: 180 },
			{ net: 5_000_000, invoices: 100, items: 140 },
		);
		expect(result?.total).toBe(1_600_000);
		const [traffic, items, price] = result?.parts ?? [];
		expect(traffic).toMatchObject({ factor: "invoices", from: 100, to: 120 });
		expect(items).toMatchObject({
			factor: "items_per_ticket",
			from: 1.4,
			to: 1.5,
		});
		expect(price).toMatchObject({
			factor: "avg_item_price",
			from: 35_714.29,
			to: 36_666.67,
		});
		expect(
			(traffic?.effect ?? 0) + (items?.effect ?? 0) + (price?.effect ?? 0),
		).toBe(1_600_000);
	});

	it("returns null without invoices or items on either side", () => {
		expect(
			decomposeNet(
				{ net: 0, invoices: 0, items: 0 },
				{ net: 5, invoices: 1, items: 1 },
			),
		).toBeNull();
		expect(
			decomposeTicket(
				{ net: 5, invoices: 1, items: null },
				{ net: 5, invoices: 1, items: 1 },
			),
		).toBeNull();
		expect(
			decomposition("net_revenue", "previous", "all_stores", null),
		).toBeNull();
	});

	it("adds up exactly to the total over 200 seeded random sums", () => {
		const random = seeded(20_261_108);
		for (let index = 0; index < 200; index += 1) {
			const sums = () => {
				const invoices = 1 + Math.floor(random() * 400);
				const items =
					invoices + Math.floor(random() * invoices * 2) + random() * 3;
				const net =
					Math.round(invoices * (20_000 + random() * 80_000) * 100) / 100;
				return { net, invoices, items: Math.round(items * 1000) / 1000 };
			};
			const current = sums();
			const reference = sums();
			const net = decomposeNet(current, reference);
			const ticket = decomposeTicket(current, reference);
			if (net === null || ticket === null)
				throw new Error("expected a decomposition");
			expect(net.parts.reduce((total, item) => total + item.effect, 0)).toBe(
				net.total,
			);
			expect(Number.isInteger(net.total)).toBe(true);
			expect(
				ticket.parts.reduce((total, item) => total + cents(item.effect), 0),
			).toBe(cents(ticket.total));
		}
	});
});

function comparisonOf(
	change: number | null,
	basis: Comparison["basis"] = "all_stores",
): Comparison {
	return {
		kind: "previous",
		label: part(reportKeys.compare.previous.day),
		range: { from: "2026-11-02", to: "2026-11-02" },
		current: 110,
		reference: change === null ? null : 100,
		change,
		difference: change === null ? null : change * 100,
		basis,
		coveredStores: 1,
		totalStores: 2,
		sampleDays: null,
		unavailable: change === null ? "no_data" : null,
	};
}

const main = {
	up: "report.day.net.up",
	down: "report.day.net.down",
	flat: "report.day.net.flat",
	noReference: "report.day.net.noReference",
	noData: "report.day.net.noData",
};

describe("narrate", () => {
	it("chooses the main clause from the value and the change", () => {
		const base = {
			main,
			values: {},
			notes: [],
			drivers: [],
			decomposition: null,
		};
		expect(
			narrate({ ...base, current: null, comparison: comparisonOf(0.1) })[0]
				?.key,
		).toBe(main.noData);
		expect(narrate({ ...base, current: 110, comparison: null })[0]?.key).toBe(
			main.noReference,
		);
		expect(
			narrate({ ...base, current: 110, comparison: comparisonOf(null) })[0]
				?.key,
		).toBe(main.noReference);
		expect(
			narrate({
				...base,
				current: 110,
				comparison: comparisonOf(FLAT_THRESHOLD / 2),
			})[0]?.key,
		).toBe(main.flat);
		const up = narrate({
			...base,
			current: 110,
			comparison: comparisonOf(0.1),
		})[0];
		expect(up?.key).toBe(main.up);
		expect(up?.values.delta).toEqual({ kind: "percent", value: 0.1 });
		expect(
			narrate({ ...base, current: 90, comparison: comparisonOf(-0.1) })[0]?.key,
		).toBe(main.down);
	});

	it("states the like-for-like figures right after the main clause", () => {
		const parts = narrate({
			main,
			values: {
				day: { kind: "date", value: "2026-11-03" },
				value: { kind: "money", value: 250 },
				total: { kind: "count", value: 80 },
			},
			current: 250,
			comparison: comparisonOf(0.1, "like_for_like"),
			notes: [part("report.clause.coverage.youngStore"), part("report.other")],
			drivers: [],
			decomposition: null,
		});
		expect(parts[0]?.values).toEqual({
			day: { kind: "date", value: "2026-11-03" },
			value: { kind: "money", value: 250 },
			total: { kind: "count", value: 80 },
			delta: { kind: "percent", value: 0.1 },
		});
		expect(parts[1]).toEqual({
			key: reportKeys.clause.coverage.likeForLikeValues,
			values: {
				covered: { kind: "count", value: 1 },
				total: { kind: "count", value: 2 },
				current: { kind: "money", value: 110 },
				reference: { kind: "money", value: 100 },
			},
		});
		expect(parts).toHaveLength(2);
	});

	it("keeps the card's own note when the comparison covers every store", () => {
		const parts = narrate({
			main,
			values: {},
			current: 110,
			comparison: comparisonOf(0.1),
			notes: [part("report.clause.coverage.youngStore")],
			drivers: [],
			decomposition: null,
		});
		expect(parts[1]?.key).toBe("report.clause.coverage.youngStore");
	});

	it("names no driver measured against a reference that is missing", () => {
		const drivers = [
			{
				dimension: "weekday" as const,
				label: { kind: "weekday" as const, value: "7" },
				contribution: 7_600_000,
				unit: "money" as const,
			},
		];
		const missing = narrate({
			main,
			values: {},
			current: 110,
			comparison: comparisonOf(null),
			notes: [],
			drivers,
			decomposition: null,
		});
		expect(missing.map((entry) => entry.key)).toEqual([main.noReference]);
		const independent = narrate({
			main,
			values: {},
			current: 110,
			comparison: null,
			notes: [],
			drivers,
			decomposition: null,
		});
		expect(independent[1]?.key).toBe(reportKeys.clause.driver.weekday);
	});

	it("never calls a driver against the trend after a flat clause", () => {
		const parts = narrate({
			main,
			values: {},
			current: 100.2,
			comparison: { ...comparisonOf(0.002), difference: 0.2 },
			notes: [],
			drivers: [
				{
					dimension: "store",
					label: { kind: "text", value: "B" },
					contribution: -400,
					unit: "money",
				},
			],
			decomposition: null,
		});
		expect(parts.map((entry) => entry.key)).toEqual([
			main.flat,
			reportKeys.clause.driver.store,
		]);
	});

	it("names the reference of a decomposition the main clause does not use", () => {
		const previous = comparisonOf(-0.025);
		const split = {
			metric: "avg_ticket" as const,
			against: "previous" as const,
			basis: "all_stores" as const,
			total: -12_000,
			parts: [
				{
					factor: "items_per_ticket" as const,
					from: 1.6,
					to: 1.5,
					effect: -9_992,
				},
				{ factor: "avg_item_price" as const, from: 1, to: 1, effect: -2_008 },
			],
		};
		const baseline = { ...comparisonOf(0.03), kind: "baseline" as const };
		const parts = narrate({
			main,
			values: {},
			current: 103,
			comparison: baseline,
			notes: [],
			drivers: [],
			decomposition: split,
			references: [baseline, previous],
		});
		expect(parts[1]).toEqual({
			key: reportKeys.clause.decompositionReference.items_per_ticket,
			values: {
				against: { kind: "part", value: previous.label },
				total: { kind: "moneySigned", value: -12_000 },
				effect: { kind: "moneySigned", value: -9_992 },
			},
		});
		const withoutReference = narrate({
			main,
			values: {},
			current: 103,
			comparison: baseline,
			notes: [],
			drivers: [],
			decomposition: split,
		});
		expect(withoutReference).toHaveLength(1);
		const flatSameReference = narrate({
			main,
			values: {},
			current: 100.1,
			comparison: comparisonOf(0.001),
			notes: [],
			drivers: [],
			decomposition: split,
		});
		expect(flatSameReference.map((entry) => entry.key)).toEqual([main.flat]);
	});

	it("names the strongest store driver before any other dimension", () => {
		const parts = narrate({
			main,
			values: {},
			current: 110,
			comparison: comparisonOf(0.1),
			notes: [],
			drivers: [
				{
					dimension: "hour",
					label: { kind: "hour", value: 20 },
					contribution: 900,
					unit: "money",
				},
				{
					dimension: "store",
					label: { kind: "text", value: "A" },
					contribution: 300,
					unit: "money",
				},
				{
					dimension: "store",
					label: { kind: "text", value: "B" },
					contribution: -400,
					unit: "money",
				},
			],
			decomposition: null,
		});
		expect(parts[1]).toEqual({
			key: "report.clause.driver.storeAgainst",
			values: {
				store: { kind: "text", value: "B" },
				delta: { kind: "moneySigned", value: -400 },
			},
		});
	});

	it("falls back to the largest decomposition part", () => {
		const parts = narrate({
			main,
			values: {},
			current: 110,
			comparison: comparisonOf(0.1),
			notes: [],
			drivers: [
				{
					dimension: "store",
					label: { kind: "text", value: "A" },
					contribution: 0,
					unit: "money",
				},
			],
			decomposition: {
				metric: "net_revenue",
				against: "previous",
				basis: "all_stores",
				total: 10,
				parts: [
					{ factor: "invoices", from: 1, to: 2, effect: 3 },
					{ factor: "items_per_ticket", from: 1, to: 1, effect: -8 },
					{ factor: "avg_item_price", from: 1, to: 2, effect: 15 },
				],
			},
		});
		expect(parts[1]).toEqual({
			key: reportKeys.clause.decomposition.avg_item_price,
			values: { effect: { kind: "moneySigned", value: 15 } },
		});
	});

	it("breaks driver ties to the first candidate", () => {
		const first = {
			dimension: "item" as const,
			label: { kind: "text" as const, value: "x" },
			contribution: 5,
			unit: "money" as const,
		};
		const second = {
			...first,
			label: { kind: "text" as const, value: "y" },
			contribution: -5,
		};
		expect(strongestDriver([first, second], 5)?.candidate).toBe(first);
		expect(strongestDriver([second], 5)?.against).toBe(true);
		expect(strongestDriver([], 5)).toBeNull();
	});
});
