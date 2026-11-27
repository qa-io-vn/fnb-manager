import type { SupabaseClient } from "@supabase/supabase-js";
import { rpc } from "../lib/rpc";

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

export const clockOut = (client: SupabaseClient, counted: number) =>
	rpc<ClockAnswer>(client, "staff_clock_out", { p_counted_cash: counted });

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
