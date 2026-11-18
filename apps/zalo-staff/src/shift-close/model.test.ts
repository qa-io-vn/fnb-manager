import type { CashCountRecord, CashCountRow } from "@fnb/zalo-mini";
import { describe, expect, it } from "vitest";
import {
	type CountDraft,
	countOutcome,
	countProblem,
	denominationsFor,
	denominationsPayload,
	draftAmount,
	hasControlCharacters,
	nextShifts,
	noteProblem,
	pendingRecount,
	piecesTotal,
	readAmount,
	readPieces,
	signedMoney,
	VND_DENOMINATIONS,
} from "./model";

const receipt = {
	cashCountId: "c-1",
	businessDate: "2026-11-18",
	countedAt: "2026-11-18T15:00:00Z",
	matched: true,
};

function row(overrides: Partial<CashCountRow>): CashCountRow {
	return {
		storeId: "s-1",
		businessDate: "2026-11-18",
		shiftId: "sh-1",
		shiftNumber: 2,
		openedAt: null,
		closedAt: null,
		cashCountId: "c-1",
		countedAmount: 2_450_000,
		countedBy: "m",
		countedAt: "2026-11-18T15:00:00Z",
		recounts: 0,
		expectedCash: 2_500_000,
		variance: -50_000,
		overAbs: false,
		overRel: false,
		overZ: false,
		state: "within",
		...overrides,
	};
}

describe("the cash count", () => {
	it("adds up the notes per value as the running total", () => {
		expect(piecesTotal({})).toBe(0);
		expect(piecesTotal({ "500000": 2, "100000": 15, "500": 3 })).toBe(
			2_501_500,
		);
		expect(denominationsFor("VND")).toBe(VND_DENOMINATIONS);
		expect(denominationsFor("USD")).toEqual([]);
	});

	it("sends only the values counted, or no breakdown at all", () => {
		expect(denominationsPayload({ "500000": 2, "200000": 0 })).toEqual({
			"500000": 2,
		});
		expect(denominationsPayload({ "200000": 0 })).toBeNull();
	});

	it("reads whole note counts and totals typed with separators", () => {
		expect(readPieces("")).toBe(0);
		expect(readPieces("12")).toBe(12);
		expect(readPieces("1a2")).toBe(12);
		expect(readPieces("100001")).toBeNull();
		expect(readAmount("2.350.000")).toBe(2_350_000);
		expect(readAmount("2,350,000")).toBe(2_350_000);
		expect(readAmount(" 0 ")).toBe(0);
		expect(readAmount("")).toBeNull();
		expect(readAmount("-5")).toBeNull();
		expect(readAmount("2tr")).toBeNull();
	});

	it("needs something counted before it goes on", () => {
		const draft: CountDraft = {
			mode: "pieces",
			pieces: {},
			totalText: "",
			note: "",
		};
		expect(countProblem(draft)).toBe("empty");
		expect(countProblem({ ...draft, pieces: { "1000": 1 } })).toBeNull();
		expect(draftAmount({ ...draft, pieces: { "1000": 1 } })).toBe(1000);
		const total = { ...draft, mode: "total" as const };
		expect(countProblem(total)).toBe("empty");
		expect(countProblem({ ...total, totalText: "abc" })).toBe("invalid");
		expect(countProblem({ ...total, totalText: "0" })).toBeNull();
		expect(
			countProblem({ ...total, totalText: "5", note: "x".repeat(501) }),
		).toBe("note");
	});
});

describe("the count's result", () => {
	it("tells staff only that it is recorded, and whether it is matched yet", () => {
		expect(countOutcome(receipt, null, false)).toEqual({
			kind: "recorded",
			matched: true,
		});
		expect(
			countOutcome({ ...receipt, matched: false }, row({}), false),
		).toEqual({
			kind: "recorded",
			matched: false,
		});
	});

	it("shows managers and staff at the all level the difference with its threshold state", () => {
		expect(countOutcome(receipt, row({}), true)).toEqual({
			kind: "difference",
			over: false,
			variance: -50_000,
			shiftNumber: 2,
		});
		expect(
			countOutcome(
				receipt,
				row({ state: "over", variance: -120_000, overAbs: true }),
				true,
			),
		).toMatchObject({ kind: "difference", over: true, variance: -120_000 });
		expect(
			countOutcome(receipt, row({ state: "unmatched", shiftId: null }), true),
		).toEqual({
			kind: "unmatched",
		});
		expect(
			countOutcome(
				receipt,
				row({ state: "no_reference", variance: null }),
				true,
			),
		).toEqual({
			kind: "no-reference",
			shiftNumber: 2,
		});
		expect(countOutcome(receipt, row({ state: "recorded" }), true)).toEqual({
			kind: "recorded",
			matched: true,
		});
	});

	it("finds the reopened count that waits for its recount", () => {
		const record = (
			id: string,
			status: CashCountRecord["status"],
			replacesId: string | null,
		) => ({
			id,
			storeId: "s-1",
			businessDate: "2026-11-18",
			countedAt: "2026-11-18T15:00:00Z",
			status,
			replacesId,
			reopenedAt: status === "reopened" ? "2026-11-18T15:10:00Z" : null,
			createdBy: "m",
		});
		expect(pendingRecount([record("c-1", "active", null)])).toBeNull();
		expect(pendingRecount([record("c-1", "reopened", null)])?.id).toBe("c-1");
		expect(
			pendingRecount([
				record("c-2", "active", "c-1"),
				record("c-1", "reopened", null),
			]),
		).toBeNull();
	});

	it("formats a difference with its sign", () => {
		const money = (value: number) => `${value} ₫`;
		expect(signedMoney(20_000, money)).toBe("+20000 ₫");
		expect(signedMoney(-50_000, money)).toBe("−50000 ₫");
		expect(signedMoney(0, money)).toBe("0 ₫");
	});
});

describe("the handover", () => {
	it("needs a note of 1 to 2,000 characters without control characters other than line breaks and tabs", () => {
		expect(noteProblem("  ", 2000)).toBe("empty");
		expect(
			noteProblem("Máy xay đá kêu to.\nCòn 2 thùng sữa.\t", 2000),
		).toBeNull();
		expect(noteProblem("x".repeat(2001), 2000)).toBe("long");
		expect(noteProblem(`a${String.fromCharCode(7)}b`, 2000)).toBe("control");
		expect(hasControlCharacters("a\nb", false)).toBe(true);
		expect(hasControlCharacters("a\tb", false)).toBe(false);
	});

	it("labels shifts Ca 1 to Ca 12 and hands over to the next one", () => {
		expect(nextShifts(null)).toEqual({ from: 1, to: 2 });
		expect(nextShifts(3)).toEqual({ from: 3, to: 4 });
		expect(nextShifts(12)).toEqual({ from: 12, to: 1 });
		expect(nextShifts(40)).toEqual({ from: 1, to: 2 });
	});
});
