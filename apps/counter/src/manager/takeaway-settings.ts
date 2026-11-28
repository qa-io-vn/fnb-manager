import type { SupabaseClient } from "@supabase/supabase-js";
import { query, RpcError } from "../lib/rpc";

/**
 * Quản lý → "Mang đi hẹn giờ" (C17, ADR-072): the store's preparation time, the length of a pick-up slot and how many
 * takeaway orders a slot takes, the three numbers the server's slots are made of. They are columns of
 * store_ordering_settings that owners and managers of the store write directly under RLS (the house pattern of the
 * settings tables); the bounds below are the table's CHECK constraints, so the form refuses what the server would.
 */

/** A slot length divides an hour, so slots start on the clock (store_ordering_settings.takeaway_slot_minutes). */
export const SLOT_MINUTES = [5, 10, 15, 20, 30, 60] as const;
export const PREP_MIN = 0;
export const PREP_MAX = 120;
export const LIMIT_MIN = 1;
export const LIMIT_MAX = 100;

export interface TakeawaySettings {
	readonly prep_minutes: number;
	readonly takeaway_slot_minutes: number;
	readonly takeaway_slot_limit: number;
}

/** The form as typed: text, so "abc" or "1.5" can be refused in words rather than lost. */
export interface TakeawayForm {
	readonly prep: string;
	readonly slot: string;
	readonly limit: string;
}

export type TakeawayField = keyof TakeawayForm;

export type TakeawayCheck =
	| { readonly ok: true; readonly value: TakeawaySettings }
	| {
			readonly ok: false;
			/** the catalog key of each refused field's message */
			readonly errors: Readonly<Partial<Record<TakeawayField, string>>>;
	  };

export function formOf(settings: TakeawaySettings): TakeawayForm {
	return {
		prep: String(settings.prep_minutes),
		slot: String(settings.takeaway_slot_minutes),
		limit: String(settings.takeaway_slot_limit),
	};
}

function whole(text: string): number | null {
	const trimmed = text.trim();
	return /^\d{1,4}$/.test(trimmed) ? Number(trimmed) : null;
}

/** The form's values as the table takes them, or the message of each field that the table would refuse. */
export function checkTakeaway(form: TakeawayForm): TakeawayCheck {
	const errors: Partial<Record<TakeawayField, string>> = {};
	const prep = whole(form.prep);
	if (prep === null || prep < PREP_MIN || prep > PREP_MAX)
		errors.prep = "takeaway.error.prep";
	const slot = whole(form.slot);
	if (slot === null || !(SLOT_MINUTES as readonly number[]).includes(slot))
		errors.slot = "takeaway.error.slot";
	const limit = whole(form.limit);
	if (limit === null || limit < LIMIT_MIN || limit > LIMIT_MAX)
		errors.limit = "takeaway.error.limit";
	if (prep === null || slot === null || limit === null)
		return { ok: false, errors };
	if (Object.keys(errors).length > 0) return { ok: false, errors };
	return {
		ok: true,
		value: {
			prep_minutes: prep,
			takeaway_slot_minutes: slot,
			takeaway_slot_limit: limit,
		},
	};
}

/** The store's three numbers, or null for a store without ordering settings (an iPOS store). */
export async function loadTakeawaySettings(
	client: SupabaseClient,
	storeId: string,
): Promise<TakeawaySettings | null> {
	return await query<TakeawaySettings | null>(
		client
			.from("store_ordering_settings")
			.select("prep_minutes, takeaway_slot_minutes, takeaway_slot_limit")
			.eq("store_id", storeId)
			.maybeSingle(),
	);
}

/**
 * Writes the three numbers. RLS lets an update that is not allowed touch no row without an error (staff, a manager of
 * another store), so a write that changed nothing is refused as 42501; a value out of bounds is the server's 23514.
 */
export async function saveTakeawaySettings(
	client: SupabaseClient,
	storeId: string,
	value: TakeawaySettings,
): Promise<TakeawaySettings> {
	const rows = await query<TakeawaySettings[]>(
		client
			.from("store_ordering_settings")
			.update(value)
			.eq("store_id", storeId)
			.select("prep_minutes, takeaway_slot_minutes, takeaway_slot_limit"),
	);
	const saved = rows[0];
	if (saved === undefined) throw new RpcError("42501", "no row written");
	return saved;
}

/** The words of a refused write. */
export function takeawayWriteError(error: unknown): string {
	if (
		error instanceof RpcError &&
		(error.code === "42501" || /row-level security/i.test(error.message))
	)
		return "takeaway.error.scope";
	if (error instanceof RpcError && error.code === "23514")
		return "takeaway.error.invalid";
	if (error instanceof RpcError && error.network) return "common.network";
	return "common.failed";
}
