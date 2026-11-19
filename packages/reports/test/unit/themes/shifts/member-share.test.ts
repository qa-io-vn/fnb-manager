import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/model/keys.js";
import { themeFunctions } from "../../../../src/themes/contract.js";
import {
	buildMemberShareCard,
	lowestShift,
	MEMBER_SHARE_ID,
	memberSlots,
	memberTotals,
} from "../../../../src/themes/shifts/cards/member-share.js";
import { shiftsKeys } from "../../../../src/themes/shifts/keys.js";
import {
	type MemberShareRow,
	shiftsCalls,
} from "../../../../src/themes/shifts/support.js";
import { STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, EMAIL_LIKE } from "./support.js";

function memberRow(overrides: Partial<MemberShareRow>): MemberShareRow {
	const invoices = overrides.invoices ?? 40;
	const members = overrides.member_invoices ?? 10;
	return {
		store_id: STORE_A,
		business_date: "2026-10-20",
		shift_ordinal: 1,
		opened_at: "2026-10-20T00:00:00Z",
		closed_at: "2026-10-20T07:00:00Z",
		invoices,
		member_invoices: members,
		identified_invoices: members,
		member_share: invoices === 0 ? null : members / invoices,
		identified_share: invoices === 0 ? null : members / invoices,
		...overrides,
	};
}

const DAY = [
	memberRow({ shift_ordinal: 1, invoices: 40, member_invoices: 20 }),
	memberRow({
		shift_ordinal: 2,
		opened_at: "2026-10-20T07:00:00Z",
		closed_at: "2026-10-20T15:00:00Z",
		invoices: 50,
		member_invoices: 5,
	}),
	memberRow({
		shift_ordinal: null,
		opened_at: null,
		closed_at: null,
		invoices: 10,
		member_invoices: 5,
	}),
	memberRow({
		business_date: "2026-10-21",
		shift_ordinal: 1,
		opened_at: "2026-10-21T00:00:00Z",
		invoices: 40,
		member_invoices: 20,
	}),
	memberRow({
		business_date: "2026-10-21",
		shift_ordinal: 2,
		opened_at: "2026-10-21T07:00:00Z",
		invoices: 30,
		member_invoices: 3,
	}),
];

const PREVIOUS = [
	memberRow({
		business_date: "2026-09-20",
		invoices: 100,
		member_invoices: 10,
	}),
];

describe("the member share card of Ca & két tiền", () => {
	it("parses the function's rows from PostgREST, numeric strings and null ordinals included", () => {
		const parsed = themeFunctions.member_share_by_shift.row.parse({
			store_id: STORE_A,
			business_date: "2026-10-20",
			shift_ordinal: null,
			opened_at: null,
			closed_at: null,
			invoices: 3,
			member_invoices: 1,
			identified_invoices: 2,
			member_share: "0.333333",
			identified_share: "0.666667",
		});
		expect(parsed).toMatchObject({
			shift_ordinal: null,
			member_share: 0.333333,
			identified_share: 0.666667,
		});
		expect(
			themeFunctions.member_share_by_shift.args.safeParse({
				store_ids: [STORE_A],
				from_date: "2026-10-01",
				to_date: "2026-10-31",
			}).success,
		).toBe(true);
	});

	it("heads with the range's member share, compares it with the range before in points and names the lowest shift by its number", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildMemberShareCard(
			cardInput(context, {
				[shiftsCalls.memberShare]: DAY,
				[shiftsCalls.memberSharePrevious]: PREVIOUS,
			}),
		);
		expect(card.id).toBe(MEMBER_SHARE_ID);
		expect(card.metricId).toBe("member_invoice_share");
		expect(card.titleKey).toBe(shiftsKeys.memberShare.title);
		expect(card.headline).toMatchObject({ value: 0.311765, unit: "fraction" });
		expect(card.headline.caption?.values).toEqual({
			members: { kind: "count", value: 53 },
			invoices: { kind: "count", value: 170 },
		});
		const [chip] = card.comparisons;
		expect(chip).toMatchObject({
			kind: "previous",
			reference: 0.1,
			unit: "fraction",
			range: context.range.previous,
		});
		expect(chip?.difference).toBeCloseTo(0.211765, 6);
		const [main, lowest, unknown] = card.narrative;
		expect(main?.key).toBe(shiftsKeys.memberShare.main);
		expect(main?.values.share).toEqual({ kind: "percent", value: 0.311765 });
		expect(lowest?.key).toBe(shiftsKeys.memberShare.lowest);
		expect(lowest?.values.shift).toMatchObject({
			kind: "part",
			value: {
				key: reportKeys.label.shiftNumber,
				values: { number: { kind: "count", value: 2 } },
			},
		});
		expect(lowest?.values.share).toEqual({ kind: "percent", value: 0.1 });
		expect(lowest?.values.members).toEqual({ kind: "count", value: 8 });
		expect(lowest?.values.invoices).toEqual({ kind: "count", value: 80 });
		expect(unknown?.key).toBe(shiftsKeys.memberShare.unknown);
		expect(unknown?.values.count).toEqual({ kind: "count", value: 10 });
	});

	it("draws a bar per shift number and lists every shift newest first with Ca n, Không rõ ca last within a day", () => {
		const card = buildMemberShareCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[shiftsCalls.memberShare]: DAY,
				[shiftsCalls.memberSharePrevious]: [],
			}),
		);
		expect(card.chart?.leftUnit).toBe("fraction");
		expect(card.chart?.categories).toHaveLength(3);
		expect(card.chart?.series[0]?.values).toEqual([0.5, 0.1, 0.5]);
		expect(card.chart?.categories[2]).toEqual({
			kind: "message",
			value: shiftsKeys.memberShare.unknownShift,
		});
		const table = card.tables[0];
		expect(table?.columns.map((entry) => [entry.key, entry.kind])).toEqual([
			["date", "date"],
			["shift", "shift"],
			["invoices", "count"],
			["memberInvoices", "count"],
			["share", "percent"],
		]);
		expect(table?.rows.map((row) => [row.cells.date, row.cells.shift])).toEqual(
			[
				["2026-10-21", 1],
				["2026-10-21", 2],
				["2026-10-20", 1],
				["2026-10-20", 2],
				["2026-10-20", shiftsKeys.memberShare.unknownShift],
			],
		);
		expect(card.csvName).toContain(MEMBER_SHARE_ID);
		expect(card.comparisons[0]?.unavailable).toBe("no_data");
	});

	it("names the lowest shift with its store when several stores are shown, and says the shifts are even when they are", () => {
		const both = [
			...DAY,
			memberRow({
				store_id: STORE_B,
				shift_ordinal: 1,
				invoices: 20,
				member_invoices: 1,
			}),
		];
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const slots = memberSlots(context, both);
		expect(slots.map((slot) => [slot.storeId, slot.ordinal])).toEqual([
			[STORE_A, 1],
			[STORE_A, 2],
			[STORE_A, null],
			[STORE_B, 1],
		]);
		expect(lowestShift(slots)).toMatchObject({ storeId: STORE_B, ordinal: 1 });
		const card = buildMemberShareCard(
			cardInput(context, { [shiftsCalls.memberShare]: both }),
		);
		expect(card.narrative[1]?.values.shift).toMatchObject({
			kind: "part",
			value: {
				key: reportKeys.label.storeAndLabel,
				values: { store: { kind: "text", value: "Store 2" } },
			},
		});
		expect(card.tables[0]?.columns[0]?.key).toBe("store");
		const even = buildMemberShareCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[shiftsCalls.memberShare]: [
					memberRow({ shift_ordinal: 1, invoices: 10, member_invoices: 5 }),
					memberRow({ shift_ordinal: 2, invoices: 20, member_invoices: 10 }),
				],
			}),
		);
		expect(even.narrative.map((sentence) => sentence.key)).toEqual([
			shiftsKeys.memberShare.main,
			shiftsKeys.memberShare.even,
		]);
	});

	it("says plainly that no invoice carries a phone yet, without a chart, and that the range has no invoice when it has none", () => {
		const none = buildMemberShareCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[shiftsCalls.memberShare]: [
					memberRow({ shift_ordinal: 1, member_invoices: 0 }),
					memberRow({ shift_ordinal: 2, member_invoices: 0 }),
				],
				[shiftsCalls.memberSharePrevious]: [],
			}),
		);
		expect(none.headline.value).toBe(0);
		expect(none.narrative.map((sentence) => sentence.key)).toEqual([
			shiftsKeys.memberShare.none,
		]);
		expect(none.narrative[0]?.values.invoices).toEqual({
			kind: "count",
			value: 80,
		});
		expect(none.chart).toBeNull();
		expect(none.tables).toHaveLength(1);
		const empty = buildMemberShareCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[shiftsCalls.memberShare]: [],
			}),
		);
		expect(empty.headline.value).toBeNull();
		expect(empty.comparisons).toEqual([]);
		expect(empty.narrative.map((sentence) => sentence.key)).toEqual([
			shiftsKeys.memberShare.noInvoices,
		]);
		expect(empty.tables).toEqual([]);
		expect(memberTotals([])).toEqual({ invoices: 0, members: 0, share: null });
	});

	it("never carries a name, an e-mail or a phone, only store names and shift numbers", () => {
		const card = buildMemberShareCard(
			cardInput(themeContext("28d", [STORE_A, STORE_B]), {
				[shiftsCalls.memberShare]: DAY,
			}),
		);
		const text = JSON.stringify(card);
		expect(text).not.toMatch(EMAIL_LIKE);
		expect(text).not.toMatch(/0\d{9}/);
		expect(Object.keys(card.tables[0]?.rows[0]?.cells ?? {})).toEqual([
			"store",
			"date",
			"shift",
			"invoices",
			"memberInvoices",
			"share",
		]);
	});
});
