import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import vi from "../i18n/vi.json";
import {
	drawerLines,
	mayReadReconciliation,
	outsideLines,
	type Shift,
	type ShiftReconciliation,
} from "./api";

// counter:unit/shift-reconciliation (Q02 "Đối chiếu", native-till.md 18.4):
// - decision table of when a screen may ask for a shift's breakdown: whose shift (one's own from staff_my_shift, one's
//   own on the managers' list, another person's) × its status (open, awaiting confirmation, closed). One's own open
//   shift is never asked: the count stays blind, no expected figure is fetched before it;
// - the lines and their signs: the opening cash as an amount, the cash sales in (+), the cash refunds and paid-outs
//   out (−); outside the drawer the card, VietQR and the wallet as amounts and the card refunds out (−); an older
//   answer without a method reads as none (error guessing).

const ME = "44444444-0000-4000-8000-000000000001";
const SOMEONE = "44444444-0000-4000-8000-000000000002";

const VALUE: ShiftReconciliation = {
	from: "2026-11-28T00:00:00Z",
	until: "2026-11-28T08:04:00Z",
	counted: true,
	opening_cash: 1_000_000,
	cash_sales: { count: 24, total: 2_378_000 },
	cash_refunds: { count: 1, total: 45_000 },
	paid_outs: { count: 0, total: 0 },
	expected_cash: 3_333_000,
	counted_cash: 3_283_000,
	cash_difference: -50_000,
	matched: false,
	not_in_drawer: {
		card: { count: 5, total: 312_000 },
		card_refunds: { count: 1, total: 20_000 },
		vietqr: { count: 11, total: 1_640_000 },
		zalo_checkout: { count: 14, total: 2_180_000 },
	},
};

describe("who may ask for the breakdown (decision table)", () => {
	const rows: readonly [
		string,
		Shift["status"],
		string | undefined,
		string | null,
		boolean,
	][] = [
		["own (staff_my_shift), open", "open", undefined, null, false],
		[
			"own (staff_my_shift), awaiting",
			"awaiting_confirmation",
			undefined,
			null,
			true,
		],
		["own (staff_my_shift), closed", "closed", undefined, null, true],
		["own on the managers' list, open", "open", ME, ME, false],
		[
			"own on the managers' list, awaiting",
			"awaiting_confirmation",
			ME,
			ME,
			true,
		],
		["own on the managers' list, closed", "closed", ME, ME, true],
		["another person's, open (figures so far)", "open", SOMEONE, ME, true],
		["another person's, awaiting", "awaiting_confirmation", SOMEONE, ME, true],
		["another person's, closed", "closed", SOMEONE, ME, true],
	];
	it.each(rows)("%s", (_name, status, owner, me, allowed) => {
		expect(
			mayReadReconciliation(
				owner === undefined ? { status } : { status, user_id: owner },
				me,
			),
		).toBe(allowed);
	});
});

describe("the lines and their signs", () => {
	it("lists the drawer as the design does: opening, sales in, refunds and paid-outs out", () => {
		expect(drawerLines(VALUE)).toEqual([
			{ key: "opening", count: null, amount: 1_000_000 },
			{ key: "cashSales", count: 24, amount: 2_378_000 },
			{ key: "cashRefunds", count: 1, amount: -45_000 },
			{ key: "paidOuts", count: 0, amount: 0 },
		]);
	});

	it("adds up to the server's expected cash on this answer (opening + sales − refunds − paid-outs)", () => {
		const sum = drawerLines(VALUE).reduce(
			(total, line) => total + line.amount,
			0,
		);
		expect(sum).toBe(VALUE.expected_cash);
	});

	it("lists what is not in the drawer, a card refund out", () => {
		expect(outsideLines(VALUE)).toEqual([
			{ key: "card", count: 5, amount: 312_000 },
			{ key: "cardRefunds", count: 1, amount: -20_000 },
			{ key: "vietqr", count: 11, amount: 1_640_000 },
			{ key: "zaloCheckout", count: 14, amount: 2_180_000 },
		]);
	});

	it("reads a method missing from an answer as none (error guessing)", () => {
		const partial = {
			...VALUE,
			not_in_drawer: {
				card: VALUE.not_in_drawer.card,
			},
		} as unknown as ShiftReconciliation;
		expect(outsideLines(partial).map((line) => line.count)).toEqual([
			5, 0, 0, 0,
		]);
	});
});

describe("the words", () => {
	it("are in both catalogs with the same placeholders", () => {
		const keys = Object.keys(vi).filter((key) =>
			key.startsWith("shift.recon."),
		);
		expect(keys.length).toBeGreaterThan(20);
		for (const key of keys) {
			const viText = (vi as Record<string, string>)[key] ?? "";
			const enText = (en as Record<string, string>)[key] ?? "";
			expect(enText, key).not.toBe("");
			expect(enText.match(/\{\w+\}/g)?.sort(), key).toEqual(
				viText.match(/\{\w+\}/g)?.sort(),
			);
		}
	});
});
