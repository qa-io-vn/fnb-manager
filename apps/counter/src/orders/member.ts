import type { SupabaseClient } from "@supabase/supabase-js";
import { rpc } from "../lib/rpc";
import type { CounterMenuItem, StampCardSetting } from "../menu/menu-api";
import type { Order } from "./types";

// The stamp card's member code at the counter (Q01 "Quét mã thành viên", C20; native-till.md 16.5): the customer shows a
// QR (fnb-stamp:1:<22 characters>) or reads an 8-digit number whose 8th digit is the Luhn check digit of the first
// seven. The counter checks the number's shape and its check digit before asking (a slip of the finger never reaches
// the server, where it would not count as a guess anyway), then sees only the shortened name and the stamps.
// The code lives in memory only: never in storage, an address, a log or the page's attributes.

export const MEMBER_NUMBER_DIGITS = 8;
const STAMP_QR = /^fnb-stamp:1:[A-Za-z0-9_-]{22}$/;
/** How long after completion the counter may still attach a card (the database's too_late). */
export const ATTACH_AFTER_COMPLETION_MS = 30 * 60_000;

/** The Luhn check digit of a string of digits (the member number's 8th digit is that of its first seven). */
export function luhnCheckDigit(digits: string): number {
	if (!/^\d+$/.test(digits)) throw new RangeError("digits only");
	let sum = 0;
	for (let index = 0; index < digits.length; index += 1) {
		// from the right, every first, third, … digit (those next to the check digit) is doubled
		const digit = Number(digits[digits.length - 1 - index]);
		if (index % 2 === 0) {
			const doubled = digit * 2;
			sum += doubled > 9 ? doubled - 9 : doubled;
		} else {
			sum += digit;
		}
	}
	return (10 - (sum % 10)) % 10;
}

export type MemberCodeProblem =
	| "empty"
	| "not_digits"
	| "too_short"
	| "too_long"
	| "check_digit";

export type MemberCodeRead =
	| {
			readonly ok: true;
			readonly kind: "qr" | "number";
			/** what is sent: the QR as scanned, or the 8 digits alone */
			readonly code: string;
	  }
	| { readonly ok: false; readonly problem: MemberCodeProblem };

/**
 * What the cashier scanned or typed: the QR payload, or the 8 digits with optional spaces, dots or dashes and a right
 * check digit. Anything else is a problem to word, and nothing is sent.
 */
export function readMemberCode(text: string): MemberCodeRead {
	const trimmed = text.trim();
	if (trimmed === "") return { ok: false, problem: "empty" };
	if (STAMP_QR.test(trimmed)) return { ok: true, kind: "qr", code: trimmed };
	const digits = trimmed.replace(/[ .-]/g, "");
	if (!/^\d+$/.test(digits)) return { ok: false, problem: "not_digits" };
	if (digits.length < MEMBER_NUMBER_DIGITS)
		return { ok: false, problem: "too_short" };
	if (digits.length > MEMBER_NUMBER_DIGITS)
		return { ok: false, problem: "too_long" };
	if (luhnCheckDigit(digits.slice(0, 7)) !== Number(digits[7]))
		return { ok: false, problem: "check_digit" };
	return { ok: true, kind: "number", code: digits };
}

/** The digits typed so far, grouped as the customer's screen shows them ("4821 7365"); other characters dropped. */
export function groupedNumber(text: string): string {
	const digits = text.replace(/\D/g, "").slice(0, MEMBER_NUMBER_DIGITS);
	return digits.length > 4
		? `${digits.slice(0, 4)} ${digits.slice(4)}`
		: digits;
}

/** What the counter may see of the code's holder (app.stamp_member_summary): never a phone, an id or a full name. */
export interface MemberSummary {
	readonly name: string | null;
	readonly stamps: number;
	readonly stamps_per_reward: number;
	readonly rewards_available: number;
	readonly code_expires_at: string;
}

/**
 * The name the counter shows: the last word only, at most 20 characters, even if an answer ever carried more (the
 * database already shortens it; the screen does not rely on that alone).
 */
export function shortName(name: string | null | undefined): string | null {
	if (typeof name !== "string") return null;
	const words = name.trim().split(/\s+/);
	const last = words[words.length - 1] ?? "";
	const short = [...last].slice(0, 20).join("");
	return short === "" ? null : short;
}

export type LookupRefusal =
	| "not_native"
	| "code_mistyped"
	| "code_unknown"
	| "rate_limited";

export type LookupAnswer =
	| {
			readonly state: "found";
			readonly refusal: null;
			readonly member: MemberSummary;
	  }
	| {
			readonly state: "refused";
			readonly refusal: LookupRefusal;
			readonly retry_at?: string;
			readonly member: null;
	  };

export type AttachRefusal =
	| LookupRefusal
	| "has_customer"
	| "already_attached"
	| "conflict"
	| "not_attachable"
	| "too_late"
	| "stamps_off";

export interface AttachAnswer {
	readonly state: "attached" | "refused" | "conflict";
	readonly refusal: AttachRefusal | null;
	readonly replayed: boolean;
	readonly retry_at?: string;
	/** the drinks that earn when the order completes, or that earned now */
	readonly stamps?: number;
	readonly stamps_earned_now?: boolean;
	readonly member?: MemberSummary;
	readonly order: Order;
}

export const lookupMember = (
	client: SupabaseClient,
	store: string,
	code: string,
) =>
	rpc<LookupAnswer>(client, "counter_member_lookup", {
		p_store: store,
		p_code: code,
	});

export const attachMember = (
	client: SupabaseClient,
	order: Pick<Order, "id" | "version">,
	code: string,
) =>
	rpc<AttachAnswer>(client, "counter_attach_member", {
		p_order: order.id,
		p_code: code,
		p_expected_version: order.version,
	});

/**
 * Whether "Gắn thẻ thành viên" is offered on an order: a counter order with no card yet, not cancelled or refunded, and
 * not completed more than 30 minutes ago. The database decides again (has_customer, too_late, not_attachable).
 */
export function attachable(order: Order, now: number): boolean {
	if (order.source !== "counter" && order.source !== "native-counter")
		return false;
	if (order.member_attached === true) return false;
	if (order.status === "cancelled") return false;
	if (
		order.payment_status === "refund_pending" ||
		order.payment_status === "refunded" ||
		order.payment_status === "partially_refunded"
	)
		return false;
	if (order.status === "completed") {
		const done = Date.parse(order.completed_at ?? "");
		return Number.isFinite(done) && now - done <= ATTACH_AFTER_COMPLETION_MS;
	}
	return true;
}

/** The drinks of an order that earn a stamp each (what the cashier tells the customer before attaching). */
export function stampUnits(order: Pick<Order, "lines">): number {
	return order.lines.reduce(
		(sum, line) => sum + (line.counts_for_stamps ? line.quantity : 0),
		0,
	);
}

/**
 * The stamps a ticket keyed for a member will earn when its order completes, by the server's rule
 * (app.stamps_on_completion, native-till.md 18.1): one per unit of the lines whose item counts for stamps, at the
 * order's brand, which counter_create_order takes from the first line. Null when the ticket says nothing: no line,
 * the brand's card off or not answered, or no unit that counts. An item the menu no longer lists does not count (the
 * server refuses it anyway).
 */
export function ticketStamps(
	lines: readonly { readonly itemId: string; readonly qty: number }[],
	items: readonly Pick<
		CounterMenuItem,
		"id" | "brand_id" | "counts_for_stamps"
	>[],
	cards: readonly StampCardSetting[],
): number | null {
	const first = lines[0];
	if (first === undefined) return null;
	const byId = new Map(items.map((item) => [item.id, item]));
	const brand = byId.get(first.itemId)?.brand_id;
	if (brand === undefined) return null;
	const card = cards.find((candidate) => candidate.brand_id === brand);
	if (card === undefined || card.enabled !== true) return null;
	const units = lines.reduce((sum, line) => {
		const item = byId.get(line.itemId);
		return item !== undefined &&
			item.brand_id === brand &&
			item.counts_for_stamps === true &&
			Number.isSafeInteger(line.qty) &&
			line.qty > 0
			? sum + line.qty
			: sum;
	}, 0);
	return units > 0 ? units : null;
}
