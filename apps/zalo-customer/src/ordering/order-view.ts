import {
	isOpenStatus,
	ORDERING_REASONS,
	type Order,
	type OrderingState,
	type OrderSummary,
	PLACE_REFUSALS,
} from "@fnb/zalo-mini/ordering";

// How the customer app shows an order (design spec C06, C14; native-till.md 5.1 and 5.2). The lifecycle and the money
// are apart on the server: a table order paid at the counter is accepted at once and unpaid ("Chưa thu tiền"), so the
// screen reads both. Nothing here moves an order: the counter does, and the screen only follows.

/** What the order screen headlines, one per row of its state table. */
export type OrderStage =
	| "awaiting_payment"
	| "pay_at_counter"
	| "accepted"
	| "preparing"
	| "serving"
	| "ready"
	| "completed"
	| "cancelled";

export function orderStage(order: Order): OrderStage {
	switch (order.status) {
		case "awaiting_payment":
			return "awaiting_payment";
		case "accepted":
			return order.paymentStatus === "unpaid" &&
				order.paymentMethod === "counter"
				? "pay_at_counter"
				: "accepted";
		case "preparing":
			return "preparing";
		case "serving":
			return "serving";
		case "ready":
			return "ready";
		case "completed":
			return "completed";
		default:
			return "cancelled";
	}
}

export function isTerminal(order: Pick<Order, "status">): boolean {
	return order.status === "completed" || order.status === "cancelled";
}

export type StepKey =
	| "placed"
	| "paid"
	| "preparing"
	| "serving"
	| "ready"
	| "completed";

export interface TimelineStep {
	readonly key: StepKey;
	readonly at: string | null;
	readonly state: "done" | "current" | "todo";
}

/**
 * The steps of the order's timeline with the time each one happened. A table order: placed, paid at the counter,
 * preparing, on its way to the table, done. A takeaway order: placed, preparing, ready at the counter, done. A step is
 * done when its time is known; the first step not done is the current one, unless the order was cancelled.
 */
export function timelineSteps(order: Order): readonly TimelineStep[] {
	const table = order.type === "table";
	const raw: readonly { key: StepKey; at: string | null }[] = table
		? [
				{ key: "placed", at: order.placedAt },
				{
					key: "paid",
					at:
						order.paymentStatus === "unpaid"
							? null
							: (order.paidAt ?? order.completedAt),
				},
				{ key: "preparing", at: order.preparingAt },
				{ key: "serving", at: order.doneAt },
				{ key: "completed", at: order.completedAt },
			]
		: [
				{ key: "placed", at: order.placedAt },
				{ key: "preparing", at: order.preparingAt },
				{ key: "ready", at: order.doneAt },
				{ key: "completed", at: order.completedAt },
			];
	let currentGiven = order.status === "cancelled";
	return raw.map((step) => {
		if (step.at !== null) return { ...step, state: "done" };
		if (!currentGiven) {
			currentGiven = true;
			return { ...step, state: "current" };
		}
		return { ...step, state: "todo" };
	});
}

/** Minutes from now until the order should be ready, when the server gave an estimate; never below 1. */
export function etaMinutes(order: Order, now: number): number | null {
	if (order.readyEstimateAt === null) return null;
	const left = Date.parse(order.readyEstimateAt) - now;
	return Math.max(1, Math.ceil(left / 60_000));
}

export type ReadyLine =
	| { readonly kind: "at"; readonly at: string }
	| { readonly kind: "soon" };

/**
 * "Dự kiến xong lúc HH:MM" (C06, C14) from the server's ready_estimate_at: shown while the order is accepted or being
 * made; once the estimate has passed it says the order is nearly done (the late line takes over five minutes later);
 * nothing without an estimate or in any other state.
 */
export function readyLine(
	order: Pick<Order, "status" | "readyEstimateAt">,
	now: number,
): ReadyLine | null {
	if (order.status !== "accepted" && order.status !== "preparing") return null;
	if (order.readyEstimateAt === null) return null;
	const at = Date.parse(order.readyEstimateAt);
	if (!Number.isFinite(at)) return null;
	return now < at
		? { kind: "at", at: order.readyEstimateAt }
		: { kind: "soon" };
}

export const LATE_AFTER_MS = 5 * 60_000;

/** An order still being made five minutes after its estimate (the "late" line, no character on it). */
export function isLate(order: Order, now: number): boolean {
	if (order.readyEstimateAt === null) return false;
	if (order.status !== "accepted" && order.status !== "preparing") return false;
	return now >= Date.parse(order.readyEstimateAt) + LATE_AFTER_MS;
}

/** The customer may cancel while the order waits for its online payment, or is accepted and still unpaid. */
export function canCancel(order: Order): boolean {
	return (
		order.status === "awaiting_payment" ||
		(order.status === "accepted" && order.paymentStatus === "unpaid")
	);
}

/** "Gọi nhân viên" waits two minutes after a call before it can be pressed again (design spec C06). */
export const CALL_WAIT_MS = 120_000;

export function callWaiting(calledAt: number | null, now: number): boolean {
	return calledAt !== null && now - calledAt < CALL_WAIT_MS;
}

export function openOrders(
	orders: readonly OrderSummary[],
): readonly OrderSummary[] {
	return orders.filter((order) => isOpenStatus(order.status));
}

/** The i18n key of a refusal of the ordering functions; an unknown one is worded generally. */
export function refusalKey(refusal: string | null): string {
	if (refusal === null) return "order.problem.unknown";
	if ((ORDERING_REASONS as readonly string[]).includes(refusal))
		return `order.reason.${refusal}`;
	if ((PLACE_REFUSALS as readonly string[]).includes(refusal))
		return `order.problem.${refusal}`;
	return "order.problem.unknown";
}

/** Whether a refusal sends the customer back to the basket (the basket changed under them). */
export function refusalBacksToCart(refusal: string | null): boolean {
	return (
		refusal === "item_unavailable" ||
		refusal === "option_invalid" ||
		refusal === "price_changed"
	);
}

/** Why the store takes no order now, or null when it does: the C15 state for closed reasons, a notice otherwise. */
export function closedKind(
	ordering: OrderingState,
): "closed" | "paused" | "unavailable" | null {
	if (ordering.accepting) return null;
	switch (ordering.reason) {
		case "closed_now":
		case "closed_today":
		case "last_orders_passed":
		case "hours_unknown":
			return "closed";
		case "paused":
			return "paused";
		default:
			return "unavailable";
	}
}
