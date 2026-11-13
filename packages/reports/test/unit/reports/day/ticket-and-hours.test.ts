import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/index.js";
import {
	buildAvgTicketCard,
	buildHourlyCard,
	buildTotalsCard,
	dayKeys,
	netRevenueSpec,
	trimmedHours,
} from "../../../../src/reports/day/index.js";
import {
	BASELINE_ONLY,
	block,
	dayInput,
	EMPTY_TOTALS,
	hourProfile,
	metricRow,
	STORE_A,
	STORE_B,
	seeded,
} from "./fixtures.js";

describe("Ngày average ticket", () => {
	it("has no ticket on a voided-only day", () => {
		const voidedOnly = {
			...EMPTY_TOTALS,
			days_with_data: 1,
			invoices: 0,
			net_amount: 0,
			items_sold: 0,
			voided_invoices: 3,
		};
		const card = buildAvgTicketCard(
			dayInput({
				stores: [STORE_A],
				compare: [
					...block(null, { current: voidedOnly }),
					...block(STORE_A, { current: voidedOnly }),
				],
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.decomposition).toBeNull();
		expect(card.narrative[0]?.key).toBe(dayKeys.avgTicket.noData);
	});

	it("explains the change by the larger of items per ticket and item price", () => {
		const card = buildAvgTicketCard(
			dayInput({
				compare: [
					...block(null, {
						current: {
							net_amount: 6_000_000,
							invoices: 100,
							items_sold: 200,
							avg_ticket: 60_000,
						},
						previous: {
							net_amount: 5_000_000,
							invoices: 100,
							items_sold: 150,
							avg_ticket: 50_000,
						},
					}),
					...block(STORE_A),
					...block(STORE_B),
				],
			}),
		);
		expect(card.decomposition?.metric).toBe("avg_ticket");
		expect(card.decomposition?.total).toBe(10_000);
		const clause = card.narrative.at(-1);
		expect(clause?.key).toBe(
			reportKeys.clause.decompositionReference.items_per_ticket,
		);
		expect(clause?.values.against).toEqual({
			kind: "part",
			value: { key: reportKeys.compare.previous.day, values: {} },
		});
		expect(clause?.values.total).toEqual({
			kind: "moneySigned",
			value: 10_000,
		});
	});

	it("names the store with the highest ticket when the ticket is flat across stores", () => {
		const card = buildAvgTicketCard(
			dayInput({
				compare: [
					...block(null, {
						current: { avg_ticket: 50_500 },
						baseline: { ...BASELINE_ONLY, avg_ticket: 50_500 },
					}),
					...block(STORE_A, { current: { avg_ticket: 48_000 } }),
					...block(STORE_B, { current: { avg_ticket: 53_000 } }),
				],
			}),
		);
		expect(card.narrative[0]?.key).toBe(dayKeys.avgTicket.flat);
		const highest = card.narrative.at(-1);
		expect(highest?.key).toBe(reportKeys.clause.driver.storeHighestTicket);
		expect(highest?.values.store).toEqual({ kind: "text", value: "Store 2" });
	});
});

describe("Ngày decomposition", () => {
	it("adds up exactly to the total for 200 seeded random days", () => {
		const random = seeded(20_261_108);
		for (let round = 0; round < 200; round += 1) {
			const sums = () => {
				const invoices = 1 + Math.floor(random() * 300);
				const items = invoices + Math.floor(random() * invoices * 2);
				const net =
					Math.round(invoices * (25_000 + random() * 90_000) * 100) / 100;
				return { invoices, items_sold: items, net_amount: net };
			};
			const current = sums();
			const previous = sums();
			const input = dayInput({
				stores: [STORE_A],
				compare: [
					...block(null, {
						current: {
							...current,
							avg_ticket: current.net_amount / current.invoices,
						},
						previous: {
							...previous,
							avg_ticket: previous.net_amount / previous.invoices,
						},
					}),
					...block(STORE_A),
				],
			});
			for (const card of [
				buildTotalsCard(netRevenueSpec, input),
				buildAvgTicketCard(input),
			]) {
				const split = card.decomposition;
				expect(split, card.id).not.toBeNull();
				const total = split?.parts.reduce(
					(sum, entry) => Math.round((sum + entry.effect) * 100) / 100,
					0,
				);
				expect(total, `${card.id} round ${round}`).toBe(split?.total);
			}
		}
	});
});

describe("Ngày hourly profile", () => {
	it("starts the axis at a 05:00 day start and trims quiet hours at both ends", () => {
		const rows = hourProfile({
			3: [100_000, 80_000],
			6: [400_000, 300_000],
			22: [200_000, 0],
		});
		const hours = trimmedHours(rows, 5 * 60, true).map((row) => row.hour_local);
		expect(hours[0]).toBe(6);
		expect(hours.at(-1)).toBe(3);
		expect(hours).toEqual([
			6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1,
			2, 3,
		]);
	});

	it("puts the peak hour in the headline and the largest deviation in the narrative", () => {
		const card = buildHourlyCard(
			dayInput({
				hourly: hourProfile({
					8: [1_200_000, 700_000],
					20: [3_000_000, 2_900_000],
				}),
				metrics: [
					metricRow("peak_share_20_21", "current", 0.35),
					metricRow("peak_share_20_21", "previous", 0.3),
				],
			}),
		);
		expect(card.headline.value).toBe(3_000_000);
		expect(card.headline.caption?.values.hour).toEqual({
			kind: "hour",
			value: 20,
		});
		expect(card.comparisons).toHaveLength(1);
		expect(card.comparisons[0]?.unit).toBe("fraction");
		expect(card.comparisons[0]?.difference).toBeCloseTo(0.05, 10);
		expect(card.narrative[0]?.key).toBe(dayKeys.hourly.peak);
		expect(card.narrative[1]?.values.hour).toEqual({ kind: "hour", value: 8 });
		expect(card.chart?.series).toHaveLength(2);
	});

	it("omits the baseline line and says why while the baseline is being built", () => {
		const card = buildHourlyCard(
			dayInput({
				hourly: hourProfile({ 10: [500_000, null], 11: [700_000, null] }, 0),
			}),
		);
		expect(card.chart?.series).toHaveLength(1);
		expect(card.notice?.part.key).toBe(dayKeys.hourly.noBaseline);
		expect(card.narrative).toHaveLength(1);
		expect(
			card.tables[0]?.rows.every((row) => row.cells.baseline === null),
		).toBe(true);
	});

	it("has no headline without any sale", () => {
		const card = buildHourlyCard(
			dayInput({
				hourly: Array.from({ length: 24 }, (_, hour) => ({
					hour_local: hour,
					current_invoices: null,
					current_net_amount: null,
					current_items_sold: null,
					sample_days: 0,
					baseline_invoices: null,
					baseline_net_amount: null,
				})),
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.chart).toBeNull();
		expect(card.narrative[0]?.key).toBe(dayKeys.hourly.noData);
	});
});
