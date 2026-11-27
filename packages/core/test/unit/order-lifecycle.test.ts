// core:unit/order-lifecycle (ADR-061): the state-transition table of native orders, as pgtap:266 tests it in SQL.
// Techniques: state-transition testing (every state x every counter action: 0-switch coverage of the valid moves and
// every invalid pair), a decision table of the payment rules (type x payment status for start and complete), the
// customer's cancellation by state and payment, and boundary values of the order number format (1, 999, 1000).
import { describe, expect, it } from "vitest";
import {
	type ActionOutcome,
	availableCounterActions,
	COUNTER_ACTIONS,
	type CounterAction,
	counterAction,
	customerCancel,
	isTerminal,
	type NativeOrderType,
	ORDER_STATUSES,
	type OrderPaymentStatus,
	type OrderStatus,
	orderDisplayNumber,
} from "../../src/index.js";

function order(
	status: OrderStatus,
	type: NativeOrderType = "table",
	paymentStatus: OrderPaymentStatus = "paid",
) {
	return { status, type, paymentStatus };
}

// The full table for a paid table order and a paid takeaway order: state x action -> outcome.
const PAID_TABLE: Record<OrderStatus, Record<CounterAction, string>> = {
	awaiting_payment: {
		start: "not_allowed",
		done: "not_allowed",
		complete: "not_allowed",
		cancel: "move:cancelled",
	},
	accepted: {
		start: "move:preparing",
		done: "not_allowed",
		complete: "not_allowed",
		cancel: "move:cancelled",
	},
	preparing: {
		start: "replay",
		done: "move:serving",
		complete: "not_allowed",
		cancel: "not_allowed",
	},
	ready: {
		start: "not_allowed",
		done: "not_allowed",
		complete: "move:completed",
		cancel: "not_allowed",
	},
	serving: {
		start: "not_allowed",
		done: "replay",
		complete: "move:completed",
		cancel: "not_allowed",
	},
	completed: {
		start: "already_completed",
		done: "already_completed",
		complete: "replay",
		cancel: "already_completed",
	},
	cancelled: {
		start: "already_cancelled",
		done: "already_cancelled",
		complete: "already_cancelled",
		cancel: "replay",
	},
};

function label(outcome: ActionOutcome): string {
	switch (outcome.kind) {
		case "move":
			return `move:${outcome.to}`;
		case "replay":
			return "replay";
		case "refused":
			return outcome.refusal;
	}
}

describe("counterAction: every state x every action of a paid table order", () => {
	for (const status of ORDER_STATUSES) {
		for (const action of COUNTER_ACTIONS) {
			const expected = PAID_TABLE[status][action];
			it(`${action} on ${status} -> ${expected}`, () => {
				expect(label(counterAction(order(status), action))).toBe(expected);
			});
		}
	}
});

describe("counterAction: the takeaway differences", () => {
	it("done on a preparing takeaway order means ready", () => {
		expect(label(counterAction(order("preparing", "takeaway"), "done"))).toBe(
			"move:ready",
		);
	});
	it("done on a ready takeaway order is a replay", () => {
		expect(label(counterAction(order("ready", "takeaway"), "done"))).toBe(
			"replay",
		);
	});
});

describe("counterAction: the payment rules", () => {
	it.each([
		["table", "unpaid", "start", "move:preparing"],
		["takeaway", "unpaid", "start", "payment_required"],
		["takeaway", "paid", "start", "move:preparing"],
		["table", "unpaid", "complete", "payment_required"],
		["table", "refund_pending", "complete", "payment_required"],
		["table", "paid", "complete", "move:completed"],
	] as const)("%s %s %s -> %s", (type, payment, action, expected) => {
		const status: OrderStatus = action === "start" ? "accepted" : "serving";
		expect(label(counterAction(order(status, type, payment), action))).toBe(
			expected,
		);
	});
});

describe("customerCancel", () => {
	it.each([
		["awaiting_payment", "unpaid", "move"],
		["accepted", "unpaid", "move"],
		["accepted", "paid", "contact_store"],
		["preparing", "unpaid", "not_allowed"],
		["ready", "paid", "not_allowed"],
		["completed", "paid", "not_allowed"],
		["cancelled", "unpaid", "replay"],
	] as const)("%s and %s -> %s", (status, payment, expected) => {
		const outcome = customerCancel(order(status, "table", payment));
		expect(outcome.kind === "refused" ? outcome.refusal : outcome.kind).toBe(
			expected,
		);
	});
});

describe("availableCounterActions", () => {
	it("an unpaid accepted table order can be started or cancelled", () => {
		expect(
			availableCounterActions(order("accepted", "table", "unpaid")),
		).toEqual(["start", "cancel"]);
	});
	it("an unpaid accepted takeaway order can only be cancelled", () => {
		expect(
			availableCounterActions(order("accepted", "takeaway", "unpaid")),
		).toEqual(["cancel"]);
	});
	it("an unpaid serving order offers nothing until it is paid", () => {
		expect(
			availableCounterActions(order("serving", "table", "unpaid")),
		).toEqual([]);
	});
	it("terminal states offer nothing", () => {
		for (const status of ORDER_STATUSES.filter(isTerminal)) {
			expect(availableCounterActions(order(status))).toEqual([]);
		}
	});
});

describe("orderDisplayNumber", () => {
	it.each([
		[1, "#001"],
		[7, "#007"],
		[999, "#999"],
		[1000, "#1000"],
		[12345, "#12345"],
	])("%i -> %s", (orderNo, expected) => {
		expect(orderDisplayNumber(orderNo)).toBe(expected);
	});
	it.each([0, -1, 1.5])("refuses %s", (orderNo) => {
		expect(() => orderDisplayNumber(orderNo)).toThrow(RangeError);
	});
});
