import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import vi from "../i18n/vi.json";
import { confirmationNote, managerReasonOf } from "../manager/shifts-page";
import {
	type ClockAnswer,
	DIFFERENCE_REASON_CODES,
	DIFFERENCE_REASON_LABEL,
	isDifferenceReason,
	onShiftAt,
	REASON_NOTE_MAX,
	reasonNoteProblem,
	type Shift,
	type ShiftStage,
	shiftStage,
	stageAfterClockOut,
} from "./api";

// counter:unit/shift-reason (Q02 "Báo lệch", native-till.md 16.3): the cashier's reason for a cash difference.
// - EP of the reason codes (the four the database takes, and what it refuses);
// - BVA of the note: empty, blank, 1, 200 and 201 characters, a second line or a control character;
// - state transitions of the clock-out flow: clock in → open → (count differs) reason required → (reason sent)
//   awaiting the manager → (recount matches or the manager confirms) closed; refusals keep the stage;
// - EP of "on shift at this store" (the payment dialog's shift_required rule): none, open here, open at another store,
//   awaiting, closed.

const STORE = "11111111-0000-4000-8000-00000000000a";
const OTHER = "11111111-0000-4000-8000-00000000000b";

function shift(overrides: Partial<Shift> = {}): Shift {
	return {
		id: "22222222-0000-4000-8000-000000000001",
		store_id: STORE,
		business_date: "2026-11-28",
		clock_in_at: "2026-11-28T00:00:00Z",
		clock_out_at: null,
		hours: null,
		opening_cash: 1_000_000,
		counted_cash: null,
		status: "open",
		closed_at: null,
		close_note: null,
		difference_reason: null,
		difference_note: null,
		version: 1,
		...overrides,
	};
}

describe("the reason codes (EP)", () => {
	it("are exactly the four the database takes, each with words in both catalogs", () => {
		expect(DIFFERENCE_REASON_CODES).toEqual([
			"wrong_change",
			"unrecorded_order",
			"petty_cash",
			"unknown",
		]);
		for (const code of DIFFERENCE_REASON_CODES) {
			const key = DIFFERENCE_REASON_LABEL[code];
			expect((vi as Record<string, string>)[key], key).toBeTruthy();
			expect((en as Record<string, string>)[key], key).toBeTruthy();
		}
		expect(vi["shift.reason.wrongChange"]).toBe("Trả nhầm tiền thừa");
		expect(vi["shift.reason.forgotOrder"]).toBe("Quên ghi đơn");
		expect(vi["shift.reason.pettyCash"]).toBe("Chi tiền lặt vặt");
		expect(vi["shift.reason.unknown"]).toBe("Chưa rõ nguyên nhân");
	});

	it("accept only those four (invalid classes: another word, another case, empty, not a string)", () => {
		for (const code of DIFFERENCE_REASON_CODES)
			expect(isDifferenceReason(code)).toBe(true);
		for (const value of [
			"WRONG_CHANGE",
			"wrongChange",
			"other",
			"",
			null,
			undefined,
			3,
		])
			expect(isDifferenceReason(value)).toBe(false);
	});

	it("start the manager's confirmation from the cashier's reason, and from nothing without one", () => {
		expect(managerReasonOf({ difference_reason: "wrong_change" })).toBe(
			"wrongChange",
		);
		expect(managerReasonOf({ difference_reason: "unrecorded_order" })).toBe(
			"forgotOrder",
		);
		expect(managerReasonOf({ difference_reason: "petty_cash" })).toBe(
			"pettyCash",
		);
		expect(managerReasonOf({ difference_reason: "unknown" })).toBe("unknown");
		expect(managerReasonOf({ difference_reason: null })).toBe("");
		expect(managerReasonOf({})).toBe("");
		expect(confirmationNote("Trả nhầm tiền thừa", "  ")).toBe(
			"Trả nhầm tiền thừa",
		);
	});
});

describe("the reason's note (BVA)", () => {
	it("is required: empty and blank are refused, one character is enough", () => {
		expect(reasonNoteProblem("")).toBe("required");
		expect(reasonNoteProblem("   ")).toBe("required");
		expect(reasonNoteProblem("a")).toBeNull();
	});

	it("takes 200 characters and refuses 201 (counted as characters, diacritics included)", () => {
		expect(REASON_NOTE_MAX).toBe(200);
		expect(reasonNoteProblem("ấ".repeat(200))).toBeNull();
		expect(reasonNoteProblem("ấ".repeat(201))).toBe("too_long");
		expect(reasonNoteProblem(` ${"a".repeat(200)} `)).toBeNull();
	});

	it("is one line without control characters", () => {
		expect(reasonNoteProblem("dòng một\ndòng hai")).toBe("one_line");
		expect(reasonNoteProblem("tab\there")).toBe("one_line");
		expect(reasonNoteProblem("bell\u0007")).toBe("one_line");
		expect(reasonNoteProblem("Đơn #A19 trả thừa, khách đã đi.")).toBeNull();
	});
});

describe("the clock-out flow (ST)", () => {
	it("derives the stage of a shift", () => {
		expect(shiftStage(null)).toBe("clock_in");
		expect(shiftStage(shift())).toBe("open");
		expect(
			shiftStage(
				shift({ status: "awaiting_confirmation", cash_difference: -50_000 }),
			),
		).toBe("reason_required");
		expect(
			shiftStage(
				shift({
					status: "awaiting_confirmation",
					difference_reason: "petty_cash",
					difference_note: "Mua đá",
				}),
			),
		).toBe("awaiting_manager");
		expect(shiftStage(shift({ status: "closed" }))).toBe("clock_in");
	});

	const answer = (
		state: ClockAnswer["state"],
		extra: Partial<Shift> = {},
		reasonRequired?: boolean,
	): ClockAnswer =>
		state === "refused"
			? { state, refusal: "not_clocked_in", shift: null }
			: {
					state,
					refusal: null,
					...(reasonRequired === undefined
						? {}
						: { reason_required: reasonRequired }),
					shift: shift({
						status:
							state === "closed"
								? "closed"
								: state === "awaiting_confirmation"
									? "awaiting_confirmation"
									: "open",
						...extra,
					}),
				};

	const transitions: readonly [ShiftStage, ClockAnswer, ShiftStage, string][] =
		[
			["open", answer("closed"), "clock_in", "a matching count closes"],
			[
				"open",
				answer("awaiting_confirmation", {}, true),
				"reason_required",
				"a difference asks for a reason",
			],
			[
				"reason_required",
				answer(
					"awaiting_confirmation",
					{ difference_reason: "wrong_change", difference_note: "Trả thừa" },
					false,
				),
				"awaiting_manager",
				"the reason sent waits for the manager",
			],
			[
				"awaiting_manager",
				answer("closed"),
				"clock_in",
				"a recount that matches closes and clears the reason",
			],
			[
				"awaiting_manager",
				answer(
					"awaiting_confirmation",
					{ difference_reason: "unknown", difference_note: "Chưa rõ" },
					false,
				),
				"awaiting_manager",
				"a recount without a new reason keeps the one given",
			],
			[
				"reason_required",
				answer("refused"),
				"clock_in",
				"the shift was closed elsewhere (a manager closed it)",
			],
		];
	it.each(transitions)("%s → %s", (before, given, after) => {
		expect(stageAfterClockOut(given, before)).toBe(after);
	});

	it("keeps the stage on a refusal other than not_clocked_in", () => {
		expect(
			stageAfterClockOut(
				{ state: "refused", refusal: "rate_limited", shift: null },
				"reason_required",
			),
		).toBe("reason_required");
	});
});

describe("on shift at this store (EP, the payment's shift_required)", () => {
	it("is true only for an open shift at the same store", () => {
		expect(onShiftAt(null, STORE)).toBe(false);
		expect(onShiftAt(shift(), STORE)).toBe(true);
		expect(onShiftAt(shift({ store_id: OTHER }), STORE)).toBe(false);
		expect(onShiftAt(shift({ status: "awaiting_confirmation" }), STORE)).toBe(
			false,
		);
		expect(onShiftAt(shift({ status: "closed" }), STORE)).toBe(false);
	});
});
