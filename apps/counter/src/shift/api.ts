import type { SupabaseClient } from "@supabase/supabase-js";
import { rpc } from "../lib/rpc";

/** The counting person's reason for a cash difference (Q02; staff_clock_out's p_reason). */
export const DIFFERENCE_REASON_CODES = [
	"wrong_change",
	"unrecorded_order",
	"petty_cash",
	"unknown",
] as const;
export type DifferenceReason = (typeof DIFFERENCE_REASON_CODES)[number];

/** The words of each reason (the catalog's shift.reason.* keys, which the manager's confirmation uses as well). */
export const DIFFERENCE_REASON_LABEL: Readonly<
	Record<DifferenceReason, string>
> = {
	wrong_change: "shift.reason.wrongChange",
	unrecorded_order: "shift.reason.forgotOrder",
	petty_cash: "shift.reason.pettyCash",
	unknown: "shift.reason.unknown",
};

/** The most characters of the note that goes with a reason (the database's bound). */
export const REASON_NOTE_MAX = 200;

/** Why a reason's note cannot be sent: empty, longer than 200 characters, or more than one line; null when it can. */
export function reasonNoteProblem(
	note: string,
): "required" | "too_long" | "one_line" | null {
	const trimmed = note.trim();
	if (trimmed === "") return "required";
	// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what the database refuses
	if (/[\u0000-\u001f\u007f]/.test(trimmed)) return "one_line";
	if ([...trimmed].length > REASON_NOTE_MAX) return "too_long";
	return null;
}

export function isDifferenceReason(value: unknown): value is DifferenceReason {
	return (DIFFERENCE_REASON_CODES as readonly unknown[]).includes(value);
}

/** A shift as the database answers it (native-till.md section 12); the expected cash only once counted. */
export interface Shift {
	readonly id: string;
	readonly store_id: string;
	readonly business_date: string;
	readonly clock_in_at: string;
	readonly clock_out_at: string | null;
	readonly hours: number | null;
	readonly opening_cash: number;
	readonly counted_cash: number | null;
	readonly status: "open" | "awaiting_confirmation" | "closed";
	readonly closed_at: string | null;
	readonly close_note: string | null;
	/** the counting person's reason for a difference and its note (Q02), null until given */
	readonly difference_reason?: DifferenceReason | null;
	readonly difference_note?: string | null;
	readonly version: number;
	readonly expected_cash?: number | null;
	readonly cash_difference?: number | null;
	/** manager answers only */
	readonly user_id?: string;
	readonly name?: string | null;
	readonly closed_by?: string | null;
}

export interface WorkedDays {
	readonly month: string;
	readonly standard_days: number;
	readonly standard_day_hours: number;
	readonly people: readonly {
		readonly user_id: string;
		readonly name: string | null;
		readonly hours: number;
		readonly worked_days: number;
		readonly days: readonly {
			readonly date: string;
			readonly hours: number;
			readonly days: number;
		}[];
		readonly open_shifts: number;
	}[];
	readonly store_id?: string;
}

export interface MyShift {
	readonly shift: Shift | null;
	readonly recent: readonly Shift[];
	readonly months: readonly WorkedDays[];
}

export type ClockAnswer =
	| {
			readonly state: "clocked_in" | "closed" | "awaiting_confirmation";
			readonly refusal: null;
			/** clock-out only: the count differs and the person has not given a reason yet */
			readonly reason_required?: boolean;
			readonly shift: Shift;
	  }
	| {
			readonly state: "refused";
			readonly refusal:
				| "counter_qr_invalid"
				| "rate_limited"
				| "already_clocked_in"
				| "not_clocked_in";
			readonly retry_at?: string;
			readonly shift: Shift | null;
	  };

export interface ManagerShifts {
	readonly shifts: readonly Shift[];
	readonly open: number;
	readonly awaiting_confirmation: number;
}

export interface DayReconciliation {
	readonly store_id: string;
	readonly business_date: string;
	readonly revenue: number;
	readonly by_method: Readonly<Record<string, number>>;
	readonly online_confirmed: number;
	readonly card: number;
	readonly cash: {
		readonly invoiced: number;
		readonly expected: number;
		readonly counted: number;
		readonly difference: number;
	};
	readonly shifts_open: number;
	readonly shifts_awaiting_confirmation: number;
	readonly paid_not_completed: number;
	/** Cash still owed back for the day's cancelled paid orders (a refund due, not handed back yet). */
	readonly cash_refund_owed: number;
	/** The net cash of cancelled orders in the day's drawers: taken for them less handed back (ADR-071). */
	readonly cancelled_cash: number;
	readonly difference: number;
	readonly matched: boolean;
}

export const myShift = (client: SupabaseClient, month: string | null = null) =>
	rpc<MyShift>(client, "staff_my_shift", { p_month: month });

export const clockIn = (
	client: SupabaseClient,
	store: string,
	token: string,
	openingCash: number,
) =>
	rpc<ClockAnswer>(client, "staff_clock_in", {
		p_store: store,
		p_counter_token: token,
		p_opening_cash: openingCash,
	});

/** A number of orders and their total in đồng. */
export interface CountTotal {
	readonly count: number;
	readonly total: number;
}

/**
 * Q02 "Đối chiếu" (staff_shift_reconciliation, native-till.md 18.4): what the drawer should hold and why, the count and
 * the difference, and what was taken that is not in the drawer.
 */
export interface ShiftReconciliation {
	readonly from: string;
	readonly until: string;
	/** whether the drawer was counted (false only for another person's open shift, read by a manager) */
	readonly counted: boolean;
	readonly opening_cash: number;
	readonly cash_sales: CountTotal;
	readonly cash_refunds: CountTotal;
	/** none are recorded yet: always 0 */
	readonly paid_outs: CountTotal;
	/** once counted, the figure the count was compared with; for an open shift, the figures so far */
	readonly expected_cash: number;
	readonly counted_cash: number | null;
	readonly cash_difference: number | null;
	/** null while the shift is open */
	readonly matched: boolean | null;
	readonly not_in_drawer: {
		readonly card: CountTotal;
		readonly card_refunds: CountTotal;
		readonly vietqr: CountTotal;
		readonly zalo_checkout: CountTotal;
	};
}

export type ReconciliationAnswer =
	| {
			readonly state: "ok";
			readonly refusal: null;
			readonly shift: Shift;
			readonly reconciliation: ShiftReconciliation;
	  }
	| {
			/** the person's own shift is still open: the count stays blind, no expected figure in the answer */
			readonly state: "refused";
			readonly refusal: "count_required";
			readonly shift: Shift;
			readonly reconciliation: null;
	  };

/**
 * Whether a screen may ask for a shift's reconciliation: the person's own shift only once their count is recorded (it
 * is no longer open), so no expected figure is ever fetched before the count; another person's shift (a manager's
 * screen, the database decides who) at any time. A shift without user_id is the caller's own (staff_my_shift).
 */
export function mayReadReconciliation(
	shift: Pick<Shift, "status" | "user_id">,
	userId: string | null,
): boolean {
	const own = shift.user_id === undefined || shift.user_id === userId;
	return own ? shift.status !== "open" : true;
}

export const shiftReconciliation = (client: SupabaseClient, shift: string) =>
	rpc<ReconciliationAnswer>(client, "staff_shift_reconciliation", {
		p_shift: shift,
	});

/** One line of the breakdown: what it is, how many orders (none for the opening cash) and its signed amount. */
export interface ReconciliationLine {
	readonly key:
		| "opening"
		| "cashSales"
		| "cashRefunds"
		| "paidOuts"
		| "card"
		| "cardRefunds"
		| "vietqr"
		| "zaloCheckout";
	readonly count: number | null;
	readonly amount: number;
}

const NONE: CountTotal = { count: 0, total: 0 };

/** Money going out, as a negative amount (0 stays 0, never −0). */
function out(total: number): number {
	return total === 0 ? 0 : -total;
}

/** The drawer's lines as the design lists them: the opening cash, the cash sales in, the cash refunds and paid-outs out. */
export function drawerLines(value: ShiftReconciliation): ReconciliationLine[] {
	return [
		{ key: "opening", count: null, amount: value.opening_cash },
		{
			key: "cashSales",
			count: value.cash_sales.count,
			amount: value.cash_sales.total,
		},
		{
			key: "cashRefunds",
			count: value.cash_refunds.count,
			amount: out(value.cash_refunds.total),
		},
		{
			key: "paidOuts",
			count: value.paid_outs.count,
			amount: out(value.paid_outs.total),
		},
	];
}

/** What was taken that is not in the drawer: card in and card refunds out, VietQR and the Zalo wallet. */
export function outsideLines(value: ShiftReconciliation): ReconciliationLine[] {
	const outside = value.not_in_drawer;
	const card = outside.card ?? NONE;
	const cardRefunds = outside.card_refunds ?? NONE;
	const vietqr = outside.vietqr ?? NONE;
	const zalo = outside.zalo_checkout ?? NONE;
	return [
		{ key: "card", count: card.count, amount: card.total },
		{
			key: "cardRefunds",
			count: cardRefunds.count,
			amount: out(cardRefunds.total),
		},
		{ key: "vietqr", count: vietqr.count, amount: vietqr.total },
		{ key: "zaloCheckout", count: zalo.count, amount: zalo.total },
	];
}

/**
 * "Ra ca": the blind count, and with a reason and its note when the count differed: the person counts again with them
 * (staff_clock_out(p_counted_cash, p_reason, p_note)); the clock-out time stays the first one.
 */
export const clockOut = (
	client: SupabaseClient,
	counted: number,
	reason: {
		readonly code: DifferenceReason;
		readonly note: string;
	} | null = null,
) =>
	rpc<ClockAnswer>(client, "staff_clock_out", {
		p_counted_cash: counted,
		p_reason: reason === null ? null : reason.code,
		p_note: reason === null ? null : reason.note.trim(),
	});

/** Whether the person may take cash or card at a store: their shift is open there (the database's shift_required). */
export function onShiftAt(shift: Shift | null, storeId: string): boolean {
	return (
		shift !== null && shift.status === "open" && shift.store_id === storeId
	);
}

/** Where the person's shift stands on the Ca làm page (Q02's states). */
export type ShiftStage =
	| "clock_in"
	| "open"
	| "reason_required"
	| "awaiting_manager";

/**
 * The stage of a shift: none or closed → clock in; open → open (the count is blind); awaiting a manager without the
 * person's reason → the reason step; with it → waiting for the manager. A recount that matches closes it.
 */
export function shiftStage(shift: Shift | null): ShiftStage {
	if (shift === null || shift.status === "closed") return "clock_in";
	if (shift.status === "open") return "open";
	return shift.difference_reason === null ||
		shift.difference_reason === undefined
		? "reason_required"
		: "awaiting_manager";
}

/** The stage a clock-out answer leads to (a refusal keeps the stage the screen was in). */
export function stageAfterClockOut(
	answer: ClockAnswer,
	before: ShiftStage,
): ShiftStage {
	if (answer.state === "refused")
		return answer.refusal === "not_clocked_in" ? "clock_in" : before;
	if (answer.state === "closed") return "clock_in";
	if (answer.state === "awaiting_confirmation")
		return answer.reason_required === true
			? "reason_required"
			: shiftStage(answer.shift);
	return shiftStage(answer.shift);
}

export const managerShifts = (
	client: SupabaseClient,
	store: string,
	from: string,
	to: string,
) =>
	rpc<ManagerShifts>(client, "manager_shifts", {
		p_store: store,
		p_from: from,
		p_to: to,
	});

export const confirmShift = (
	client: SupabaseClient,
	shift: string,
	note: string,
) =>
	rpc<{
		state: string;
		refusal: string | null;
		replayed: boolean;
		shift: Shift;
	}>(client, "manager_confirm_shift", {
		p_shift: shift,
		p_note: note,
	});

export const closeForgottenShift = (
	client: SupabaseClient,
	shift: string,
	clockOutAt: string,
	counted: number,
	note: string,
) =>
	rpc<{ state: string; refusal: string | null; shift: Shift }>(
		client,
		"manager_close_shift",
		{
			p_shift: shift,
			p_clock_out_at: clockOutAt,
			p_counted_cash: counted,
			p_note: note,
		},
	);

export const workedDays = (
	client: SupabaseClient,
	store: string,
	month: string,
) =>
	rpc<WorkedDays>(client, "manager_worked_days", {
		p_store: store,
		p_month: month,
	});

export const dayReconciliation = (
	client: SupabaseClient,
	store: string,
	date: string,
) =>
	rpc<DayReconciliation>(client, "manager_day_reconciliation", {
		p_store: store,
		p_date: date,
	});

export const counterQr = (
	client: SupabaseClient,
	store: string,
	rotate: boolean,
) =>
	rpc<{ store_id: string; version: number; token: string; rotated: boolean }>(
		client,
		"manager_counter_qr",
		{
			p_store: store,
			p_rotate: rotate,
		},
	);

/** The counter code inside what a camera read: the code itself, or the app's address carrying it as "ma". */
export function counterCodeOf(scanned: string): string | null {
	const text = scanned.trim();
	if (/^[A-Za-z0-9_-]{22}$/.test(text)) return text;
	const match = /[?&]ma=([A-Za-z0-9_-]{22})(?:&|$)/.exec(text);
	return match?.[1] ?? null;
}

/** The address printed in the counter's QR code: this app's clock-in with the code. */
export function counterQrAddress(origin: string, token: string): string {
	return `${origin}/#/ca?ma=${encodeURIComponent(token)}`;
}
