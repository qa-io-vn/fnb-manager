import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/model/keys.js";
import { shownCashier } from "../../../../src/model/shifts.js";
import { buildCashiersCard } from "../../../../src/themes/shifts/cards/cashiers.js";
import { shiftsKeys } from "../../../../src/themes/shifts/keys.js";
import { shiftsCalls } from "../../../../src/themes/shifts/support.js";
import { STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import {
	type AdjustmentRow,
	adjustmentRow,
	cardInput,
	EMAIL_LIKE,
	LOGIN,
	shiftRow,
} from "./support.js";

type ShiftRow = ReturnType<typeof shiftRow>;

interface ShiftFixture {
	readonly id: string;
	readonly date: string;
	readonly opened: string;
	readonly cashier: string | null;
	readonly net: number;
	readonly variance: number | null;
	readonly flagged: boolean;
	readonly voids: number;
	readonly removed: number;
	readonly afterClose: number;
}

const FIXTURES: readonly ShiftFixture[] = [
	{
		id: "a1",
		date: "2026-10-20",
		opened: "2026-10-20T01:00:00Z",
		cashier: "Minh",
		net: 4_000_000,
		variance: -30_000,
		flagged: true,
		voids: 1,
		removed: 0,
		afterClose: 0,
	},
	{
		id: "a2",
		date: "2026-10-20",
		opened: "2026-10-20T08:00:00Z",
		cashier: LOGIN,
		net: 5_000_000,
		variance: -120_000,
		flagged: true,
		voids: 3,
		removed: 2,
		afterClose: 1,
	},
	{
		id: "b1",
		date: "2026-10-21",
		opened: "2026-10-21T01:00:00Z",
		cashier: "Minh",
		net: 6_000_000,
		variance: 80_000,
		flagged: true,
		voids: 0,
		removed: 4,
		afterClose: 0,
	},
	{
		id: "b2",
		date: "2026-10-21",
		opened: "2026-10-21T08:00:00Z",
		cashier: null,
		net: 3_000_000,
		variance: 5_000,
		flagged: false,
		voids: 2,
		removed: 0,
		afterClose: 2,
	},
	{
		id: "c1",
		date: "2026-10-22",
		opened: "2026-10-22T01:00:00Z",
		cashier: "Lan",
		net: 2_500_000,
		variance: null,
		flagged: false,
		voids: 0,
		removed: 1,
		afterClose: 0,
	},
	{
		id: "c2",
		date: "2026-10-22",
		opened: "2026-10-22T08:00:00Z",
		cashier: " Lan ",
		net: 3_500_000,
		variance: -60_000,
		flagged: true,
		voids: 5,
		removed: 0,
		afterClose: 1,
	},
];

function reviewOf(
	fixture: ShiftFixture,
	overrides: Partial<ShiftRow> = {},
): ShiftRow {
	return shiftRow({
		store_id: STORE_A,
		shift_id: fixture.id,
		shift_external_id: fixture.id.toUpperCase(),
		shift_name: LOGIN,
		business_date: fixture.date,
		opened_at: fixture.opened,
		cashier_name: fixture.cashier,
		sales_amount: fixture.net,
		variance_amount: fixture.variance,
		flagged: fixture.flagged,
		reasons: fixture.flagged ? ["absolute"] : [],
		...overrides,
	});
}

function adjustmentOf(
	fixture: ShiftFixture,
	overrides: Partial<AdjustmentRow> = {},
): AdjustmentRow {
	return adjustmentRow({
		store_id: STORE_A,
		shift_id: fixture.id,
		shift_external_id: fixture.id.toUpperCase(),
		shift_name: LOGIN,
		business_date: fixture.date,
		opened_at: fixture.opened,
		cashier_name: fixture.cashier,
		voids: fixture.voids,
		removed_lines: fixture.removed,
		edits_after_close: fixture.afterClose,
		flagged: fixture.afterClose > 0,
		reasons: fixture.afterClose > 0 ? ["after_close"] : [],
		...overrides,
	});
}

function cardOf(
	reviews: readonly ShiftRow[],
	adjustments: readonly AdjustmentRow[],
	stores: readonly string[] = [STORE_A],
) {
	return buildCashiersCard(
		cardInput(themeContext("28d", stores), {
			[shiftsCalls.shifts]: reviews,
			[shiftsCalls.adjustments]: adjustments,
		}),
	);
}

const reviews = FIXTURES.map((fixture) => reviewOf(fixture));
const adjustments = FIXTURES.map((fixture) => adjustmentOf(fixture));

function sumOf(
	fixtures: readonly ShiftFixture[],
	value: (fixture: ShiftFixture) => number,
): number {
	return fixtures.reduce((total, fixture) => total + value(fixture), 0);
}

function expectedCells(fixtures: readonly ShiftFixture[]) {
	return {
		shifts: fixtures.length,
		net: sumOf(fixtures, (fixture) => fixture.net),
		flagged: fixtures.filter((fixture) => fixture.flagged).length,
		totalVariance: sumOf(fixtures, (fixture) =>
			Math.abs(fixture.variance ?? 0),
		),
		voids: sumOf(fixtures, (fixture) => fixture.voids),
		removedLines: sumOf(fixtures, (fixture) => fixture.removed),
		editsAfterClose: sumOf(fixtures, (fixture) => fixture.afterClose),
	};
}

function storeShift(
	store: string,
	id: string,
	cashier: string | null,
	flagged = false,
): ShiftRow {
	return shiftRow({
		store_id: store,
		shift_id: id,
		shift_external_id: id.toUpperCase(),
		shift_name: LOGIN,
		cashier_name: cashier,
		variance_amount: flagged ? -90_000 : 0,
		flagged,
		reasons: flagged ? ["absolute"] : [],
	});
}

function expectNoAddress(value: unknown): void {
	const rendered = JSON.stringify(value);
	expect(rendered).not.toMatch(EMAIL_LIKE);
	expect(rendered).not.toContain("@");
	expect(rendered).not.toContain("example.com");
}

function expectNoRanking(card: ReturnType<typeof cardOf>): void {
	expect(card.headline).toEqual({ value: null, unit: "count", caption: null });
	expect(card.tables[0]?.rows).toEqual([]);
	expect(card.narrative).toHaveLength(1);
}

describe("the Ca & két tiền cashier card", () => {
	it("groups the shifts per cashier, each row's figures the sums of the shift rows it groups", () => {
		const card = cardOf(reviews, adjustments);
		const table = card.tables[0];
		expect(card.tables).toHaveLength(1);
		expect(table?.captionKey).toBe(shiftsKeys.cashiers.table);
		expect(
			table?.columns.map((column) => [column.key, column.labelKey]),
		).toEqual([
			["cashier", reportKeys.table.cashier],
			["shifts", shiftsKeys.table.shifts],
			["net", reportKeys.table.netAmount],
			["flagged", shiftsKeys.table.flagged],
			["totalVariance", shiftsKeys.table.totalVariance],
			["voids", shiftsKeys.table.voids],
			["removedLines", shiftsKeys.table.removedLines],
			["editsAfterClose", shiftsKeys.table.editsAfterClose],
		]);
		expect(table?.initialSort).toEqual({
			key: "flagged",
			direction: "descending",
		});
		const byCashier = (name: string | null) =>
			FIXTURES.filter((fixture) => shownCashier(fixture.cashier) === name);
		expect(table?.rows.map((row) => row.cells)).toEqual([
			{ store: null, cashier: "Minh", ...expectedCells(byCashier("Minh")) },
			{
				store: null,
				cashier: reportKeys.label.unknownCashier,
				...expectedCells(byCashier(null)),
			},
			{ store: null, cashier: "Lan", ...expectedCells(byCashier("Lan")) },
		]);
		expect(table?.rows[0]?.cells).toMatchObject({
			shifts: 2,
			net: 10_000_000,
			flagged: 2,
			totalVariance: 110_000,
			voids: 1,
			removedLines: 4,
			editsAfterClose: 0,
		});
		for (const key of [
			"shifts",
			"net",
			"flagged",
			"totalVariance",
			"voids",
			"removedLines",
			"editsAfterClose",
		] as const) {
			const total = (table?.rows ?? []).reduce(
				(sum, row) => sum + Number(row.cells[key]),
				0,
			);
			expect(total, key).toBe(expectedCells(FIXTURES)[key]);
		}
	});

	it("heads with the named cashier who has the most flagged drawer shifts, notes the unranked shifts and adds the caution", () => {
		const card = cardOf(reviews, adjustments);
		expect(card.id).toBe("cashiers");
		expect(card.titleKey).toBe(shiftsKeys.cashiers.title);
		expect(card.metricId).toBe("flagged_shifts");
		expect(card.relatedMetricIds).toEqual([
			"shift_net",
			"cash_variance",
			"cash_variance_zscore",
			"shift_void_rate",
			"removed_line_rate",
			"edits_after_close",
		]);
		expect(card.headline).toEqual({
			value: 2,
			unit: "count",
			caption: {
				key: shiftsKeys.cashiers.caption,
				values: { count: { kind: "count", value: 2 } },
			},
		});
		expect(card.narrative).toEqual([
			{
				key: shiftsKeys.cashiers.main,
				values: {
					cashier: { kind: "text", value: "Minh" },
					flagged: { kind: "count", value: 2 },
					shifts: { kind: "count", value: 2 },
				},
			},
			{
				key: shiftsKeys.cashiers.unnamed,
				values: { count: { kind: "count", value: 2 } },
			},
			{ key: shiftsKeys.cashiers.caution, values: {} },
		]);
		expect(card.notice).toBeNull();
		expect(card.chart).toBeNull();
		expect(card.csvName).toMatch(/^ca-ket-tien-cashiers-/);
	});

	it("keeps an e-mail login, an empty and a missing cashier in one unknown row, but ranks and counts only the named cashiers", () => {
		const masked = [
			reviewOf(FIXTURES[0] as ShiftFixture, { cashier_name: "Minh" }),
			reviewOf(FIXTURES[1] as ShiftFixture, { cashier_name: ` ${LOGIN} ` }),
			reviewOf(FIXTURES[2] as ShiftFixture, { cashier_name: "" }),
			reviewOf(FIXTURES[3] as ShiftFixture, {
				cashier_name: null,
				flagged: true,
			}),
		];
		const card = cardOf(masked, []);
		expect(
			card.tables[0]?.rows.map((row) => [
				row.cells.cashier,
				row.cells.shifts,
				row.cells.flagged,
			]),
		).toEqual([
			[reportKeys.label.unknownCashier, 3, 3],
			["Minh", 1, 1],
		]);
		expect(card.headline.value).toBe(1);
		expect(card.headline.caption?.values.count).toEqual({
			kind: "count",
			value: 1,
		});
		expect(card.narrative.map((part) => part.key)).toEqual([
			shiftsKeys.cashiers.main,
			shiftsKeys.cashiers.unnamed,
			shiftsKeys.cashiers.caution,
		]);
		expect(card.narrative[0]?.values.cashier).toEqual({
			kind: "text",
			value: "Minh",
		});
		expect(card.narrative[1]?.values.count).toEqual({
			kind: "count",
			value: 3,
		});
		expectNoAddress([card.headline, card.narrative, card.tables, card.notice]);
	});

	it("names nobody and counts nobody when several named cashiers share the most flags", () => {
		const card = cardOf(
			reviews.map((row) =>
				row.shift_id === "a1" ? { ...row, flagged: false } : row,
			),
			adjustments,
		);
		expect(card.headline.value).toBe(1);
		expect(card.narrative[0]).toEqual({
			key: shiftsKeys.cashiers.tied,
			values: { flagged: { kind: "count", value: 1 } },
		});
		expect(card.narrative.map((part) => part.key)).toEqual([
			shiftsKeys.cashiers.tied,
			shiftsKeys.cashiers.unnamed,
			shiftsKeys.cashiers.caution,
		]);
	});

	it("says none of the named cashiers' shifts went over the drawer thresholds when none did", () => {
		const card = cardOf(
			reviews.map((row) => ({ ...row, flagged: false, reasons: [] })),
			adjustments,
		);
		expect(card.headline.value).toBe(0);
		expect(card.narrative.map((part) => part.key)).toEqual([
			shiftsKeys.cashiers.none,
			shiftsKeys.cashiers.unnamed,
			shiftsKeys.cashiers.caution,
		]);
		expect(card.narrative[0]?.values.count).toEqual({
			kind: "count",
			value: 2,
		});
		expect(card.tables[0]?.rows).toHaveLength(3);
	});

	it("shows the individual-logins notice instead of a one-row ranking when every shift carries the same login, however it is spaced or cased", () => {
		const spellings = ["Lan", " lan ", "LAN"];
		const one = cardOf(
			reviews.map((row, index) => ({
				...row,
				cashier_name: spellings[index % spellings.length] ?? "Lan",
			})),
			adjustments.map((row) => ({ ...row, cashier_name: "Lan" })),
		);
		expect(one.notice).toEqual({
			tone: "info",
			part: { key: shiftsKeys.cashiers.logins, values: {} },
			action: null,
		});
		expectNoRanking(one);
		expect(one.narrative[0]).toEqual({
			key: shiftsKeys.cashiers.single,
			values: {
				range: expect.anything(),
				count: { kind: "count", value: FIXTURES.length },
			},
		});
	});

	it("needs at least two shifts for the individual-logins notice", () => {
		const card = cardOf([reviewOf(FIXTURES[2] as ShiftFixture)], []);
		expect(card.notice).toBeNull();
		expect(card.tables[0]?.rows).toHaveLength(1);
		expect(card.narrative[0]?.key).toBe(shiftsKeys.cashiers.main);
	});

	it("tells two e-mail logins in one store apart only as a yes or no, and asks for display names instead of ranking them", () => {
		const twoLogins = Array.from({ length: 8 }, (_, index) =>
			storeShift(
				STORE_A,
				`s${index}`,
				index % 2 === 0 ? LOGIN : "thu.ngan.2@example.com",
				index % 3 === 0,
			),
		);
		const card = cardOf(twoLogins, []);
		expect(card.notice).toEqual({
			tone: "info",
			part: { key: shiftsKeys.cashiers.displayNames, values: {} },
			action: null,
		});
		expectNoRanking(card);
		expect(card.narrative[0]).toEqual({
			key: shiftsKeys.cashiers.unnamedAll,
			values: {
				range: expect.anything(),
				count: { kind: "count", value: 8 },
			},
		});
		expectNoAddress(card);

		const loginAndEmpty = cardOf(
			[storeShift(STORE_A, "x1", LOGIN), storeShift(STORE_A, "x2", null)],
			[],
		);
		expect(loginAndEmpty.notice?.part.key).toBe(
			shiftsKeys.cashiers.displayNames,
		);
	});

	it("treats each store on its own single login as shared logins, not a store-against-store ranking", () => {
		const perStore = cardOf(
			[
				storeShift(STORE_A, "a1", "Lan", true),
				storeShift(STORE_A, "a2", "lan"),
				storeShift(STORE_B, "b1", "Minh", true),
				storeShift(STORE_B, "b2", "Minh", true),
			],
			[],
			[STORE_A, STORE_B],
		);
		expect(perStore.notice?.part.key).toBe(shiftsKeys.cashiers.logins);
		expectNoRanking(perStore);
		expect(perStore.narrative[0]?.key).toBe(shiftsKeys.cashiers.singlePerStore);
		expect(perStore.narrative[0]?.values.count).toEqual({
			kind: "count",
			value: 4,
		});

		const emailPerStore = cardOf(
			[
				storeShift(STORE_A, "a1", LOGIN),
				storeShift(STORE_A, "a2", LOGIN),
				storeShift(STORE_B, "b1", "thu.ngan.2@example.com"),
			],
			[],
			[STORE_A, STORE_B],
		);
		expect(emailPerStore.notice?.part.key).toBe(shiftsKeys.cashiers.logins);
		expect(emailPerStore.narrative[0]?.key).toBe(
			shiftsKeys.cashiers.singlePerStore,
		);
		expectNoAddress(emailPerStore);

		const sameEverywhere = cardOf(
			[storeShift(STORE_A, "a1", "Lan"), storeShift(STORE_B, "b1", "Lan")],
			[],
			[STORE_A, STORE_B],
		);
		expect(sameEverywhere.narrative[0]?.key).toBe(shiftsKeys.cashiers.single);
	});

	it("splits the cashiers by store when several stores are chosen and names the store with the leading cashier", () => {
		const card = cardOf(
			[
				...reviews,
				reviewOf(FIXTURES[0] as ShiftFixture, {
					store_id: STORE_B,
					shift_id: "s2-1",
					flagged: true,
				}),
				reviewOf(FIXTURES[2] as ShiftFixture, {
					store_id: STORE_B,
					shift_id: "s2-2",
					flagged: true,
				}),
				reviewOf(FIXTURES[4] as ShiftFixture, {
					store_id: STORE_B,
					shift_id: "s2-3",
					cashier_name: "Minh",
					flagged: true,
				}),
				reviewOf(FIXTURES[4] as ShiftFixture, {
					store_id: STORE_B,
					shift_id: "s2-4",
				}),
			],
			adjustments,
			[STORE_A, STORE_B],
		);
		const table = card.tables[0];
		expect(table?.columns[0]?.key).toBe("store");
		expect(
			table?.rows.map((row) => [
				row.cells.store,
				row.cells.cashier,
				row.cells.flagged,
			]),
		).toEqual([
			["Store 2", "Minh", 3],
			["Store 1", "Minh", 2],
			["Store 1", reportKeys.label.unknownCashier, 1],
			["Store 1", "Lan", 1],
			["Store 2", "Lan", 0],
		]);
		expect(card.headline.caption?.values.count).toEqual({
			kind: "count",
			value: 2,
		});
		const cashier = card.narrative[0]?.values.cashier;
		expect(cashier?.kind).toBe("part");
		expect(cashier?.kind === "part" ? cashier.value : null).toEqual({
			key: reportKeys.label.storeAndLabel,
			values: {
				store: { kind: "text", value: "Store 2" },
				label: { kind: "text", value: "Minh" },
			},
		});
	});

	it("calls a tie across stores a tie and counts a name working at two stores once", () => {
		const card = cardOf(
			[
				storeShift(STORE_A, "a1", "Minh", true),
				storeShift(STORE_A, "a2", "Minh", true),
				storeShift(STORE_A, "a3", "Lan"),
				storeShift(STORE_B, "b1", "Minh", true),
				storeShift(STORE_B, "b2", "Minh", true),
				storeShift(STORE_B, "b3", "Hà", true),
			],
			[],
			[STORE_A, STORE_B],
		);
		expect(card.tables[0]?.rows).toHaveLength(4);
		expect(card.headline.value).toBe(2);
		expect(card.headline.caption?.values.count).toEqual({
			kind: "count",
			value: 3,
		});
		expect(card.narrative).toEqual([
			{
				key: shiftsKeys.cashiers.tied,
				values: { flagged: { kind: "count", value: 2 } },
			},
			{ key: shiftsKeys.cashiers.caution, values: {} },
		]);
	});

	it("joins the two calls by shift, so a shift only shift_adjustments returns counts once", () => {
		const extra = adjustmentOf({
			...(FIXTURES[4] as ShiftFixture),
			id: "c3",
			voids: 2,
		});
		const card = cardOf(reviews, [...adjustments, extra]);
		const lan = card.tables[0]?.rows.find((row) => row.cells.cashier === "Lan");
		expect(lan?.cells).toMatchObject({
			shifts: 3,
			net: 6_000_000,
			voids: 7,
		});
	});

	it("says there was no shift in the range, with a dash and the notice", () => {
		const card = cardOf([], []);
		expect(card.headline.value).toBeNull();
		expect(card.narrative).toEqual([
			{
				key: shiftsKeys.noData,
				values: { range: expect.anything() },
			},
		]);
		expect(card.notice?.part.key).toBe(shiftsKeys.noShifts);
		expect(card.tables[0]?.rows).toEqual([]);
	});
});
