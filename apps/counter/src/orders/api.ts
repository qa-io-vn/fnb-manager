import type { SupabaseClient } from "@supabase/supabase-js";
import { query, rpc } from "../lib/rpc";
import type { ActAnswer, Order, PayAnswer, RefundAnswer } from "./types";

export type CounterAction = "start" | "done" | "complete" | "cancel";

/** The cancel reasons the database takes (counter_order_act); "other" carries the words typed. */
export const CANCEL_REASONS = [
	"customer_request",
	"item_unavailable",
	"store_busy",
	"closing_soon",
	"payment_not_received",
	"suspected_prank",
	"other",
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

/** The reason code sent: the code itself, or "other:<text>" with at least five characters of text. */
export function cancelReasonCode(
	reason: CancelReason,
	text: string,
): string | null {
	if (reason !== "other") return reason;
	const words = text.trim().replace(/[\r\n]+/g, " ");
	return words.length >= 5
		? `other:${[...words].slice(0, 120).join("")}`
		: null;
}

export const orderDetail = (client: SupabaseClient, order: string) =>
	rpc<Order>(client, "counter_order", { p_order: order });

export const act = (
	client: SupabaseClient,
	order: Order,
	action: CounterAction,
	reason: string | null = null,
) =>
	rpc<ActAnswer>(client, "counter_order_act", {
		p_order: order.id,
		p_action: action,
		p_expected_version: order.version,
		p_reason: reason,
	});

export const recordPayment = (
	client: SupabaseClient,
	order: Order,
	method: "cash" | "card",
) =>
	rpc<PayAnswer>(client, "counter_record_payment", {
		p_order: order.id,
		p_method: method,
		p_amount: order.total,
		p_expected_version: order.version,
	});

export const voidPayment = (
	client: SupabaseClient,
	payment: string,
	reason: string,
) =>
	rpc<{ state: string; refusal: string | null; order?: Order }>(
		client,
		"counter_void_payment",
		{
			p_payment: payment,
			p_reason: reason,
		},
	);

export const refund = (
	client: SupabaseClient,
	order: string,
	amount: number,
	reason: string,
) =>
	rpc<RefundAnswer>(client, "counter_refund", {
		p_order: order,
		p_amount: amount,
		p_reason: reason,
	});

/** Names of the store's people for the order's log (managers read the roster; staff see only their own name). */
export async function rosterNames(
	client: SupabaseClient,
): Promise<ReadonlyMap<string, string>> {
	try {
		const rows = await query<
			{ user_id: string | null; display_name: string }[]
		>(
			client
				.from("staff_roster")
				.select("user_id, display_name")
				.not("user_id", "is", null),
		);
		return new Map(
			rows
				.filter((row) => row.user_id !== null)
				.map((row) => [row.user_id as string, row.display_name]),
		);
	} catch {
		return new Map();
	}
}

/** What may be handed back: what was paid less what was refunded. */
export function refundable(order: Order): number {
	const money = order.money;
	if (money === undefined) return 0;
	return Math.max(0, money.paid - money.refunded);
}
