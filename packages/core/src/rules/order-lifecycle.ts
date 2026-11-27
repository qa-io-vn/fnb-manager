// The native order lifecycle (ADR-061, docs/deep-dives/native-till.md section 5). The database owns every transition
// (app.counter_order_act, app.customer_cancel_order, app.order_payment_succeeded); this module is the same table in
// TypeScript, the oracle its tests compare against and what the counter and customer apps use to offer only the
// actions the server will accept. It holds no brand, store or tenant data.

export const ORDER_STATUSES = [
	"awaiting_payment",
	"accepted",
	"preparing",
	"ready",
	"serving",
	"completed",
	"cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
	"unpaid",
	"paid",
	"refund_pending",
	"refunded",
	"partially_refunded",
] as const;
export type OrderPaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type NativeOrderType = "table" | "takeaway";

export const COUNTER_ACTIONS = ["start", "done", "complete", "cancel"] as const;
export type CounterAction = (typeof COUNTER_ACTIONS)[number];

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

export interface OrderSnapshot {
	readonly status: OrderStatus;
	readonly type: NativeOrderType;
	readonly paymentStatus: OrderPaymentStatus;
}

export type ActionOutcome =
	| { readonly kind: "move"; readonly to: OrderStatus }
	| { readonly kind: "replay" }
	| {
			readonly kind: "refused";
			readonly refusal:
				| "not_allowed"
				| "already_cancelled"
				| "already_completed"
				| "payment_required";
	  };

export function isTerminal(status: OrderStatus): boolean {
	return status === "completed" || status === "cancelled";
}

/** The state a counter action leads to: done means ready for takeaway and serving for a table. */
export function actionTarget(
	action: CounterAction,
	type: NativeOrderType,
): OrderStatus {
	switch (action) {
		case "start":
			return "preparing";
		case "done":
			return type === "takeaway" ? "ready" : "serving";
		case "complete":
			return "completed";
		case "cancel":
			return "cancelled";
	}
}

const ALLOWED_FROM: Readonly<Record<CounterAction, readonly OrderStatus[]>> = {
	start: ["accepted"],
	done: ["preparing"],
	complete: ["ready", "serving"],
	cancel: ["awaiting_payment", "accepted"],
};

/**
 * What the server answers to a counter action (the version check aside): the same target again is a replay; an
 * action outside the lifecycle is refused; completing, or starting a takeaway order, needs the payment.
 */
export function counterAction(
	order: OrderSnapshot,
	action: CounterAction,
): ActionOutcome {
	const to = actionTarget(action, order.type);
	if (order.status === to) {
		return { kind: "replay" };
	}
	if (!ALLOWED_FROM[action].includes(order.status)) {
		const refusal =
			order.status === "cancelled"
				? "already_cancelled"
				: order.status === "completed"
					? "already_completed"
					: "not_allowed";
		return { kind: "refused", refusal };
	}
	const paid = order.paymentStatus === "paid";
	if (
		(action === "complete" && !paid) ||
		(action === "start" && order.type === "takeaway" && !paid)
	) {
		return { kind: "refused", refusal: "payment_required" };
	}
	return { kind: "move", to };
}

export type CustomerCancelOutcome =
	| { readonly kind: "move" }
	| { readonly kind: "replay" }
	| {
			readonly kind: "refused";
			readonly refusal: "contact_store" | "not_allowed";
	  };

/** The customer cancels only while awaiting payment, or accepted and still unpaid; a paid accepted order goes to the counter. */
export function customerCancel(order: OrderSnapshot): CustomerCancelOutcome {
	if (order.status === "cancelled") {
		return { kind: "replay" };
	}
	if (
		order.status === "awaiting_payment" ||
		(order.status === "accepted" && order.paymentStatus === "unpaid")
	) {
		return { kind: "move" };
	}
	return {
		kind: "refused",
		refusal: order.status === "accepted" ? "contact_store" : "not_allowed",
	};
}

/** The counter buttons to offer for an order: only the actions the server would carry out. */
export function availableCounterActions(
	order: OrderSnapshot,
): readonly CounterAction[] {
	return COUNTER_ACTIONS.filter(
		(action) => counterAction(order, action).kind === "move",
	);
}

/** An order number as the counter calls it out: # and three digits, more from 1,000 (app.order_display_no). */
export function orderDisplayNumber(orderNo: number): string {
	if (!Number.isInteger(orderNo) || orderNo < 1) {
		throw new RangeError("an order number is a whole number from 1");
	}
	return `#${orderNo < 1000 ? String(orderNo).padStart(3, "0") : String(orderNo)}`;
}
