import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/model/keys.js";
import { buildProductivityCard } from "../../../../src/themes/hours/cards/productivity.js";
import { hoursKeys } from "../../../../src/themes/hours/keys.js";
import { hoursCalls } from "../../../../src/themes/hours/support.js";
import { themeKeys } from "../../../../src/themes/keys.js";
import { rangeValue } from "../../../../src/themes/support.js";
import { coverageRow, STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, productivityRow, settingsRow } from "./support.js";

const previousLabel = {
	key: themeKeys.compare.previousWeeks,
	values: { weeks: { kind: "count", value: 4 } },
};

const bothStores = productivityRow({
	invoices: 4200,
	net_amount: 210_000_000,
	opening_minutes: 40_320,
	seat_count: null,
	seat_minutes: null,
	sales_per_opening_hour: 312_500,
	invoices_per_opening_hour: 6.25,
	revpash: null,
});
const withSeats = productivityRow({ store_id: STORE_A });
const withoutSeats = productivityRow({
	store_id: STORE_B,
	invoices: 1400,
	net_amount: 70_000_000,
	seat_count: null,
	seat_minutes: null,
	sales_per_opening_hour: 208_333.33,
	invoices_per_opening_hour: 4.1667,
	revpash: null,
});

describe("the Giờ & ngày productivity card", () => {
	it("reads sales per opening hour, shows RevPASH for the store with seats and 'no seats' for the other, and marks the card provisional", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = buildProductivityCard(
			cardInput(
				context,
				{
					[hoursCalls.productivity]: [bothStores, withSeats, withoutSeats],
					[hoursCalls.productivityPrevious]: [
						productivityRow({ sales_per_opening_hour: 250_000 }),
					],
					[hoursCalls.settings]: [
						settingsRow({ store_id: STORE_A, seat_count: 40 }),
						settingsRow({ store_id: STORE_B, seat_count: null }),
					],
				},
				[coverageRow(STORE_A), coverageRow(STORE_B)],
			),
		);
		expect(card.headline).toEqual({
			value: 312_500,
			unit: "money",
			caption: null,
		});
		expect(card.comparisons).toEqual([
			{
				kind: "previous",
				label: previousLabel,
				range: { from: "2026-09-12", to: "2026-10-09" },
				current: 312_500,
				reference: 250_000,
				change: 0.25,
				difference: 62_500,
				basis: "all_stores",
				coveredStores: 2,
				totalStores: 2,
				sampleDays: null,
				unavailable: null,
			},
		]);
		expect(card.narrative).toEqual([
			{
				key: hoursKeys.productivity.up,
				values: {
					range: rangeValue(context),
					value: { kind: "money", value: 312_500 },
					reference: { kind: "part", value: previousLabel },
					delta: { kind: "percent", value: 0.25 },
				},
			},
		]);
		const table = card.tables[0];
		expect(card.tables).toHaveLength(1);
		expect(table?.captionKey).toBe(hoursKeys.productivity.storeTable);
		expect(table?.columns).toEqual([
			{ key: "store", labelKey: reportKeys.table.store, kind: "text" },
			{
				key: "openHours",
				labelKey: hoursKeys.table.openHours,
				kind: "decimal",
			},
			{
				key: "netPerHour",
				labelKey: hoursKeys.table.netPerHour,
				kind: "money",
			},
			{
				key: "invoicesPerHour",
				labelKey: hoursKeys.table.invoicesPerHour,
				kind: "decimal",
			},
			{ key: "seats", labelKey: hoursKeys.table.seats, kind: "count" },
			{ key: "revpash", labelKey: hoursKeys.table.revpash, kind: "money" },
			{ key: "state", labelKey: reportKeys.table.state, kind: "message" },
		]);
		expect(table?.rows).toEqual([
			{
				id: STORE_A,
				cells: {
					store: "Store 1",
					openHours: 336,
					netPerHour: 416_666.67,
					invoicesPerHour: 8.3333,
					seats: 40,
					revpash: 10_416.67,
					state: null,
				},
			},
			{
				id: STORE_B,
				cells: {
					store: "Store 2",
					openHours: 336,
					netPerHour: 208_333.33,
					invoicesPerHour: 4.1667,
					seats: null,
					revpash: null,
					state: hoursKeys.productivity.noSeats,
				},
			},
		]);
		expect(card.notice).toBeNull();
		expect(card.chart).toBeNull();
		expect(card.markers).toEqual({
			provisional: true,
			stale: false,
			verification: "verified",
		});
		expect(card.csvName).toBe("gio-ngay-productivity-2026-10-10_2026-11-06");
	});

	it("adds the RevPASH clause and a period table for one store with seats, without the provisional marker", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildProductivityCard(
			cardInput(context, {
				[hoursCalls.productivity]: [productivityRow({}), withSeats],
				[hoursCalls.productivityPrevious]: [
					productivityRow({
						sales_per_opening_hour: 400_000,
						invoices_per_opening_hour: 8,
						revpash: 10_000,
					}),
				],
				[hoursCalls.settings]: [settingsRow({ seat_count: 40 })],
			}),
		);
		expect(card.headline.value).toBe(416_666.67);
		expect(card.narrative.map((part) => part.key)).toEqual([
			hoursKeys.productivity.up,
			hoursKeys.productivity.revpash,
		]);
		expect(card.narrative[1]?.values).toEqual({
			value: { kind: "money", value: 10_416.67 },
			seats: { kind: "count", value: 40 },
		});
		const table = card.tables[0];
		expect(table?.captionKey).toBe(hoursKeys.productivity.periodTable);
		expect(table?.rows).toEqual([
			{
				id: "current",
				cells: {
					period: hoursKeys.productivity.current,
					openHours: 336,
					netPerHour: 416_666.67,
					invoicesPerHour: 8.3333,
					seats: 40,
					revpash: 10_416.67,
				},
			},
			{
				id: "previous",
				cells: {
					period: hoursKeys.productivity.previous,
					openHours: 336,
					netPerHour: 400_000,
					invoicesPerHour: 8,
					seats: 40,
					revpash: 10_000,
				},
			},
		]);
		expect(card.markers.provisional).toBe(false);
	});

	it("asks for opening hours with the store-settings action when a store with sales has none", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = buildProductivityCard(
			cardInput(context, {
				[hoursCalls.productivity]: [
					productivityRow({}),
					withSeats,
					productivityRow({
						store_id: STORE_B,
						days_with_sales: 10,
						opening_minutes: null,
						seat_count: null,
						seat_minutes: null,
						sales_per_opening_hour: null,
						invoices_per_opening_hour: null,
						revpash: null,
					}),
				],
				[hoursCalls.productivityPrevious]: [
					productivityRow({ sales_per_opening_hour: 400_000 }),
				],
				[hoursCalls.settings]: [
					settingsRow({ store_id: STORE_A }),
					settingsRow({
						store_id: STORE_B,
						seat_count: null,
						opening_hours_known: false,
					}),
				],
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.comparisons).toEqual([]);
		expect(card.narrative).toEqual([
			{
				key: hoursKeys.productivity.missingHours,
				values: { range: rangeValue(context) },
			},
		]);
		expect(card.notice).toEqual({
			tone: "info",
			part: { key: hoursKeys.productivity.noHours, values: {} },
			action: "settings_store",
		});
		expect(card.markers.provisional).toBe(false);
		expect(card.tables[0]?.rows[1]?.cells).toMatchObject({
			openHours: null,
			netPerHour: null,
			state: hoursKeys.productivity.noSeats,
		});
	});

	it("does not ask for opening hours of a store that sold nothing, but stays provisional while it has no seats", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = buildProductivityCard(
			cardInput(context, {
				[hoursCalls.productivity]: [
					productivityRow({}),
					withSeats,
					productivityRow({
						store_id: STORE_B,
						days_with_sales: 0,
						invoices: 0,
						net_amount: 0,
						opening_minutes: null,
						seat_count: null,
						seat_minutes: null,
						sales_per_opening_hour: null,
						invoices_per_opening_hour: null,
						revpash: null,
					}),
				],
				[hoursCalls.settings]: [
					settingsRow({ store_id: STORE_A }),
					settingsRow({ store_id: STORE_B, seat_count: null }),
				],
			}),
		);
		expect(card.notice).toBeNull();
		expect(card.headline.value).toBe(416_666.67);
		expect(card.tables[0]?.rows.map((row) => row.cells.state)).toEqual([
			null,
			null,
		]);
		expect(card.markers.provisional).toBe(true);
	});

	it("keeps a measured zero per opening hour as zero and falls by the whole previous value", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildProductivityCard(
			cardInput(context, {
				[hoursCalls.productivity]: [
					productivityRow({
						days_with_sales: 0,
						invoices: 0,
						net_amount: 0,
						sales_per_opening_hour: 0,
						invoices_per_opening_hour: 0,
						revpash: 0,
					}),
				],
				[hoursCalls.productivityPrevious]: [
					productivityRow({ sales_per_opening_hour: 400_000 }),
				],
				[hoursCalls.settings]: [settingsRow({})],
			}),
		);
		expect(card.headline.value).toBe(0);
		expect(card.comparisons[0]?.change).toBe(-1);
		expect(card.comparisons[0]?.difference).toBe(-400_000);
		expect(card.narrative).toEqual([
			{
				key: hoursKeys.productivity.down,
				values: {
					range: rangeValue(context),
					value: { kind: "money", value: 0 },
					reference: { kind: "part", value: previousLabel },
					delta: { kind: "percent", value: 1 },
				},
			},
			{
				key: hoursKeys.productivity.revpash,
				values: {
					value: { kind: "money", value: 0 },
					seats: { kind: "count", value: 40 },
				},
			},
		]);
		expect(card.notice).toBeNull();
	});

	it("says there is no data without rows and keeps an empty period table", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildProductivityCard(cardInput(context, {}));
		expect(card.headline.value).toBeNull();
		expect(card.comparisons).toEqual([]);
		expect(card.narrative).toEqual([
			{
				key: hoursKeys.productivity.noData,
				values: { range: rangeValue(context) },
			},
		]);
		expect(card.tables[0]?.rows.map((row) => row.cells.netPerHour)).toEqual([
			null,
			null,
		]);
		expect(card.notice).toBeNull();
		expect(card.markers).toEqual({
			provisional: false,
			stale: false,
			verification: "unverified",
		});
	});

	it("reads the same rows with a young store and marks sample data as such", () => {
		const partial = buildProductivityCard(
			cardInput(
				themeContext("28d", [STORE_A, STORE_B]),
				{
					[hoursCalls.productivity]: [bothStores, withSeats, withoutSeats],
					[hoursCalls.productivityPrevious]: [
						productivityRow({ sales_per_opening_hour: 250_000 }),
					],
				},
				[
					coverageRow(STORE_A),
					coverageRow(STORE_B, { history_start: "2026-10-10" }),
				],
			),
		);
		expect(partial.headline.value).toBe(312_500);
		expect(partial.comparisons[0]?.reference).toBe(250_000);
		expect(partial.markers.verification).toBe("verified");
		const sample = buildProductivityCard(
			cardInput(themeContext("28d", [STORE_A], { sample: true }), {
				[hoursCalls.productivity]: [productivityRow({})],
			}),
		);
		expect(sample.markers.verification).toBe("sample");
	});
});
