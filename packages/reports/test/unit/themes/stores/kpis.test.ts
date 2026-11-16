import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/model/keys.js";
import {
	buildKpisCard,
	KPI_METRIC_IDS,
	NOT_CONFIGURED_CELL,
} from "../../../../src/themes/stores/cards/kpis.js";
import { buildSameDayCard } from "../../../../src/themes/stores/cards/same-day.js";
import { buildSinceOpeningCard } from "../../../../src/themes/stores/cards/since-opening.js";
import { storesKeys } from "../../../../src/themes/stores/keys.js";
import { storesCalls } from "../../../../src/themes/stores/support.js";
import { rangeValue } from "../../../../src/themes/support.js";
import { STORE_A, STORE_B } from "../../fixtures.js";
import { likeForLikeRows } from "../revenue/support.js";
import {
	cardInput,
	coverageRow,
	productivityRow,
	sales,
	storesContext,
	totalsRow,
} from "./support.js";

const M = 1_000_000;
const YOUNG = "report.unavailable.store_too_young.previous";

type Sales = ReturnType<typeof sales>;

function kpisInput(
	options: {
		readonly productivity?: ReturnType<typeof productivityRow>[];
		readonly historyA?: string;
		readonly historyB?: string;
		readonly storeA?: Sales;
		readonly storeB?: Sales;
		readonly likeForLike?: boolean;
	} = {},
) {
	const context = storesContext([STORE_A, STORE_B]);
	const storeA = options.storeA ?? sales(100 * M, 1600, 2600);
	const storeB = options.storeB ?? sales(50 * M, 1400, 1900);
	return cardInput(
		context,
		{
			[storesCalls.totals]: [
				totalsRow(context, "current", null, sales(150 * M, 3000, 4500)),
				totalsRow(context, "previous", null, sales(120 * M, 2500, 3750)),
				totalsRow(context, "current", STORE_A, storeA),
				totalsRow(context, "previous", STORE_A, sales(80 * M, 1300, 2000)),
				totalsRow(context, "current", STORE_B, storeB),
				totalsRow(context, "previous", STORE_B, sales(40 * M, 1200, 1750)),
			],
			...(options.likeForLike === true
				? {
						[storesCalls.totalsLikeForLike]: likeForLikeRows(
							context,
							"previous",
							sales(100 * M, 1600, 2600),
							sales(80 * M, 1300, 2000),
						),
					}
				: {}),
			[storesCalls.productivity]: options.productivity ?? [
				productivityRow({ store_id: null }),
				productivityRow({ store_id: STORE_A }),
				productivityRow({ store_id: STORE_B }),
			],
		},
		[
			coverageRow(STORE_A, { history_start: options.historyA ?? "2025-01-01" }),
			coverageRow(STORE_B, { history_start: options.historyB ?? "2025-01-01" }),
		],
	);
}

function cellsOf(card: ReturnType<typeof buildKpisCard>) {
	return Object.fromEntries(
		(card.tables[0]?.rows ?? []).map((row) => [row.id, row.cells]),
	);
}

describe("the So sánh store figures card", () => {
	it("leads with the top store's share of net and lists every store against the eleven metrics, the all-stores row last", () => {
		const card = buildKpisCard(kpisInput());
		expect(card.headline).toEqual({
			value: 0.666667,
			unit: "fraction",
			caption: {
				key: storesKeys.kpis.caption,
				values: { store: { kind: "text", value: "Store 1" } },
			},
		});
		expect(card.metricId).toBe("store_net_share");
		expect(card.relatedMetricIds).toEqual(KPI_METRIC_IDS);
		expect(KPI_METRIC_IDS).toHaveLength(11);
		const [table] = card.tables;
		expect(table?.columns.map((column) => [column.key, column.kind])).toEqual([
			["store", "label"],
			["net", "money"],
			["netChange", "signedPercent"],
			["invoices", "count"],
			["avgTicket", "money"],
			["ticketChange", "signedPercent"],
			["itemsPerTicket", "ratio"],
			["avgItemPrice", "money"],
			["cashShare", "percent"],
			["discountRate", "percent"],
			["voucherShare", "percent"],
			["captureRate", "percent"],
			["salesPerHour", "money"],
			["revpash", "money"],
		]);
		expect(table?.rows.map((row) => row.id)).toEqual([STORE_A, STORE_B, "all"]);
		const storeA = table?.rows[0]?.cells;
		expect(storeA).toMatchObject({
			store: "Store 1",
			net: 100 * M,
			invoices: 1600,
			avgTicket: 62_500,
			itemsPerTicket: 1.625,
			cashShare: 0.2,
			discountRate: 0.034483,
			voucherShare: 0.1,
			captureRate: 0,
			salesPerHour: 416_666.67,
			revpash: 10_416.67,
		});
		expect(Number(storeA?.netChange)).toBeCloseTo(0.25, 10);
		expect(Number(storeA?.ticketChange)).toBeCloseTo(62_500 / 61_538.46 - 1, 8);
		expect(table?.rows[2]?.cells.store).toBe(storesKeys.kpis.allStores);
		expect(card.notice).toBeNull();
		expect(card.csvName).toBe("so-sanh-kpis-2026-10-10_2026-11-06");
	});

	it("takes the all-stores figures from the all-stores block, with its ratios after summing rather than an average of the stores' ratios", () => {
		const all = cellsOf(buildKpisCard(kpisInput())).all;
		const meanOfTickets = (62_500 + 35_714.29) / 2;
		const meanOfItems = (1.625 + 1.3571) / 2;
		expect(all?.net).toBe(150 * M);
		expect(all?.invoices).toBe(3000);
		expect(all?.avgTicket).toBe(50_000);
		expect(all?.avgTicket).not.toBeCloseTo(meanOfTickets, 0);
		expect(all?.itemsPerTicket).toBe(1.5);
		expect(all?.itemsPerTicket).not.toBeCloseTo(meanOfItems, 3);
		expect(Number(all?.netChange)).toBeCloseTo(0.25, 10);
	});

	it("names the widest gaps in average ticket and in items per ticket, one clause each", () => {
		const input = kpisInput();
		const card = buildKpisCard(input);
		expect(card.narrative.map((part) => part.key)).toEqual([
			storesKeys.kpis.main,
			storesKeys.kpis.items,
		]);
		const [ticket, items] = card.narrative;
		expect(ticket?.values.range).toEqual(rangeValue(input.context));
		expect(ticket?.values.high).toEqual({ kind: "text", value: "Store 1" });
		expect(ticket?.values.low).toEqual({ kind: "text", value: "Store 2" });
		expect(ticket?.values.gap?.kind).toBe("percent");
		expect(Number(ticket?.values.gap?.value)).toBeCloseTo(
			62_500 / 35_714.29 - 1,
			8,
		);
		expect(items?.values.high).toEqual({ kind: "text", value: "Store 1" });
		expect(Number(items?.values.gap?.value)).toBeCloseTo(1.625 / 1.3571 - 1, 8);
	});

	it("says the stores are about even when their average tickets and items per ticket match, never that a store is missing", () => {
		const card = buildKpisCard(
			kpisInput({
				storeA: sales(100 * M, 2000, 3000),
				storeB: sales(50 * M, 1000, 1500),
			}),
		);
		expect(card.narrative).toEqual([
			{
				key: storesKeys.kpis.mainEven,
				values: { range: rangeValue(storesContext([STORE_A, STORE_B])) },
			},
			{ key: storesKeys.kpis.itemsEven, values: {} },
		]);
	});

	it("shows chưa thiết lập for revenue per opening hour and RevPASH where a store lacks hours or seats, and links to the store settings", () => {
		const card = buildKpisCard(
			kpisInput({
				productivity: [
					productivityRow({
						store_id: null,
						opening_minutes: null,
						seat_minutes: null,
						sales_per_opening_hour: null,
						revpash: null,
					}),
					productivityRow({
						store_id: STORE_A,
						seat_count: null,
						seat_minutes: null,
						revpash: null,
					}),
					productivityRow({
						store_id: STORE_B,
						opening_minutes: null,
						seat_count: null,
						seat_minutes: null,
						sales_per_opening_hour: null,
						revpash: null,
					}),
				],
			}),
		);
		const cells = cellsOf(card);
		expect(NOT_CONFIGURED_CELL).toBe(
			"report.unavailable.not_configured.previous",
		);
		expect(cells[STORE_A]?.salesPerHour).toBe(416_666.67);
		expect(cells[STORE_A]?.revpash).toBe(NOT_CONFIGURED_CELL);
		expect(cells[STORE_B]?.salesPerHour).toBe(NOT_CONFIGURED_CELL);
		expect(cells[STORE_B]?.revpash).toBe(NOT_CONFIGURED_CELL);
		expect(cells.all?.salesPerHour).toBe(NOT_CONFIGURED_CELL);
		expect(cells.all?.revpash).toBe(NOT_CONFIGURED_CELL);
		expect(card.notice).toEqual({
			tone: "info",
			part: { key: storesKeys.kpis.notConfiguredNotice, values: {} },
			action: "settings_store",
		});
	});

	it("leaves a dash, not chưa thiết lập, for a store without sales in the range", () => {
		const card = buildKpisCard(
			kpisInput({
				productivity: [
					productivityRow({ store_id: null }),
					productivityRow({ store_id: STORE_A }),
					productivityRow({
						store_id: STORE_B,
						days_with_sales: 0,
						opening_minutes: null,
						seat_count: null,
						seat_minutes: null,
						sales_per_opening_hour: null,
						revpash: null,
					}),
				],
			}),
		);
		const storeB = cellsOf(card)[STORE_B];
		expect(storeB?.salesPerHour).toBeNull();
		expect(storeB?.revpash).toBeNull();
		expect(card.notice).toBeNull();
	});

	it("compares all stores like for like over the covered stores, labelled cùng cửa hàng (k/N), when a store is younger than the range before", () => {
		const card = buildKpisCard(
			kpisInput({ historyB: "2026-09-20", likeForLike: true }),
		);
		const cells = cellsOf(card);
		expect(cells[STORE_B]?.netChange).toBe(YOUNG);
		expect(cells[STORE_B]?.ticketChange).toBe(YOUNG);
		expect(Number(cells[STORE_A]?.netChange)).toBeCloseTo(0.25, 10);
		expect(cells.all?.store).toBe(storesKeys.kpis.allStoresLikeForLike);
		expect(Number(cells.all?.netChange)).toBeCloseTo(0.25, 10);
		expect(Number(cells.all?.ticketChange)).toBeCloseTo(
			62_500 / 61_538.46 - 1,
			8,
		);
		expect(card.narrative.at(-1)).toEqual({
			key: storesKeys.kpis.likeForLike,
			values: {
				covered: { kind: "count", value: 1 },
				total: { kind: "count", value: 2 },
			},
		});
	});

	it("says no store has previous figures when none was open at the start of the range before", () => {
		const card = buildKpisCard(
			kpisInput({ historyA: "2026-09-15", historyB: "2026-09-20" }),
		);
		const cells = cellsOf(card);
		expect(cells[STORE_A]?.netChange).toBe(YOUNG);
		expect(cells[STORE_B]?.netChange).toBe(YOUNG);
		expect(cells.all?.store).toBe(storesKeys.kpis.allStores);
		expect(cells.all?.netChange).toBe(YOUNG);
		expect(cells.all?.ticketChange).toBe(YOUNG);
		expect(card.narrative.map((part) => part.key)).not.toContain(
			storesKeys.kpis.likeForLike,
		);
	});

	it("draws net per store as grouped bars of the range before and this one", () => {
		const chart = buildKpisCard(kpisInput()).chart;
		expect(chart?.categories).toEqual([
			{ kind: "text", value: "Store 1" },
			{ kind: "text", value: "Store 2" },
		]);
		expect(
			chart?.series.map((series) => [
				series.label.key,
				series.kind,
				series.tone,
				series.stack,
				series.values,
			]),
		).toEqual([
			[reportKeys.periodRow.previous, "bar", "muted", null, [80 * M, 40 * M]],
			[reportKeys.periodRow.current, "bar", "primary", null, [100 * M, 50 * M]],
		]);
		expect(chart?.leftUnit).toBe("money");
	});

	it("says there were no sales instead of showing zeros", () => {
		const context = storesContext([STORE_A, STORE_B]);
		const empty = { net_amount: null, invoices: null, days_with_data: 0 };
		const card = buildKpisCard(
			cardInput(context, {
				[storesCalls.totals]: [
					totalsRow(context, "current", null, empty),
					totalsRow(context, "current", STORE_A, empty),
					totalsRow(context, "current", STORE_B, empty),
				],
				[storesCalls.productivity]: [],
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.narrative).toEqual([
			{ key: storesKeys.kpis.noData, values: { range: rangeValue(context) } },
		]);
		expect(card.chart).toBeNull();
	});
});

describe("So sánh with one store", () => {
	it("asks for a second store on every card instead of showing figures", () => {
		const context = storesContext([STORE_A]);
		const input = cardInput(context, {}, [coverageRow(STORE_A)]);
		for (const build of [
			buildKpisCard,
			buildSameDayCard,
			buildSinceOpeningCard,
		]) {
			const card = build(input);
			expect(card.narrative, card.id).toEqual([
				{ key: storesKeys.needTwo, values: {} },
			]);
			expect(card.headline.value, card.id).toBeNull();
			expect(card.tables, card.id).toEqual([]);
			expect(card.chart, card.id).toBeNull();
			expect(card.comparisons, card.id).toEqual([]);
		}
	});
});
