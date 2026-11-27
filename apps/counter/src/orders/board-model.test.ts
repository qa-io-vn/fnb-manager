import { describe, expect, it } from "vitest";
import { ticketOf } from "../print/ticket";
import { cancelReasonCode, refundable } from "./api";
import {
	applyBoard,
	boardFailed,
	boardOrder,
	cancellable,
	closedOrders,
	EMPTY_BOARD,
	laneOf,
	laneOrders,
	nextAction,
	payable,
	waitingMinutes,
} from "./board-model";
import { auditLine } from "./order-detail";
import type { BoardAnswer, Order, OrderStatus } from "./types";

// counter:unit/board (ADR-061, S02, Q03-U1): the queue's merge of board answers (state transitions of the queue: first
// load, new order, newer and older versions, a failed poll, the catch-up after it), the lanes and their order, the
// actions allowed by state and payment (decision table), the cancel reason boundary and the audit line.

function order(
	id: string,
	status: OrderStatus,
	overrides: Partial<Order> = {},
): Order {
	return {
		id,
		order_no: 1,
		display_no: "#001",
		business_date: "2026-11-28",
		source: "native-app",
		type: "table",
		table: { id: "t", label: "Bàn 1" },
		pickup_at: null,
		status,
		payment_status: "unpaid",
		payment_method: "counter",
		version: 1,
		subtotal: 29_000,
		discount_amount: 0,
		total: 29_000,
		note: null,
		placed_at: "2026-11-28T03:00:00Z",
		accepted_at: "2026-11-28T03:00:00Z",
		preparing_at: null,
		done_at: null,
		completed_at: null,
		paid_at: null,
		cancelled_at: null,
		cancel_reason: null,
		lines: [],
		...overrides,
	};
}

function answer(orders: Order[], cursor: number): BoardAnswer {
	return {
		store_id: "s",
		business_date: "2026-11-28",
		ordering: { accepting: true, reason: null },
		cursor,
		counts: {
			accepted: 0,
			preparing: 0,
			ready: 0,
			serving: 0,
			unpaid: 0,
			completed_today: 0,
			cancelled_today: 0,
		},
		orders,
		calls: [],
	};
}

describe("merging the board", () => {
	it("rings for nothing at the first load, then for an order it had not seen", () => {
		const first = applyBoard(
			EMPTY_BOARD,
			answer([order("a", "accepted")], 5),
			1,
		);
		expect(first.fresh).toEqual([]);
		expect(first.cursor).toBe(5);
		const second = applyBoard(first, answer([order("b", "accepted")], 7), 2);
		expect(second.fresh).toEqual(["b"]);
		expect([...second.orders.keys()]).toEqual(["a", "b"]);
	});

	it("does not ring for a change of an order it already shows, nor for a closed one", () => {
		const first = applyBoard(
			EMPTY_BOARD,
			answer([order("a", "accepted")], 5),
			1,
		);
		const moved = applyBoard(
			first,
			answer(
				[order("a", "preparing", { version: 2 }), order("c", "completed")],
				6,
			),
			2,
		);
		expect(moved.fresh).toEqual([]);
		expect(moved.orders.get("a")?.status).toBe("preparing");
	});

	it("keeps a newer version it changed itself over an older answer", () => {
		const first = applyBoard(
			EMPTY_BOARD,
			answer([order("a", "accepted")], 5),
			1,
		);
		const mine = boardOrder(first, order("a", "preparing", { version: 2 }));
		const late = applyBoard(
			mine,
			answer([order("a", "accepted", { version: 1 })], 5),
			2,
		);
		expect(late.orders.get("a")?.status).toBe("preparing");
		expect(
			boardOrder(mine, order("a", "accepted", { version: 1 })).orders.get("a")
				?.status,
		).toBe("preparing");
	});

	it("keeps every order through a failed poll and counts the new ones of the catch-up", () => {
		const first = applyBoard(
			EMPTY_BOARD,
			answer([order("a", "accepted")], 5),
			1,
		);
		const down = boardFailed(boardFailed(first, 10), 12);
		expect(down.offline).toBe(true);
		expect(down.offlineSince).toBe(10);
		expect(down.orders.size).toBe(1);
		const back = applyBoard(
			down,
			answer([order("b", "accepted"), order("c", "accepted")], 9),
			20,
		);
		expect(back.offline).toBe(false);
		expect(back.resynced).toBe(2);
		expect(back.fresh).toEqual(["b", "c"]);
		expect(back.orders.size).toBe(3);
	});

	it("never moves the cursor backwards", () => {
		const first = applyBoard(EMPTY_BOARD, answer([], 9), 1);
		expect(applyBoard(first, answer([], 3), 2).cursor).toBe(9);
	});
});

describe("lanes and actions", () => {
	it.each([
		["accepted", "new", "start", true],
		["preparing", "making", "done", false],
		["ready", "done", "complete", false],
		["serving", "done", "complete", false],
		["completed", null, null, false],
		["cancelled", null, null, false],
		["awaiting_payment", null, null, true],
	] as const)(
		"%s: lane %s, next %s, cancellable %s",
		(status, lane, next, cancel) => {
			const value = order("x", status);
			expect(laneOf(value)).toBe(lane);
			expect(nextAction(value)).toBe(next);
			expect(cancellable(value)).toBe(cancel);
		},
	);

	it("takes payment only while unpaid and open", () => {
		expect(payable(order("x", "serving"))).toBe(true);
		expect(payable(order("x", "serving", { payment_status: "paid" }))).toBe(
			false,
		);
		expect(payable(order("x", "cancelled"))).toBe(false);
		expect(payable(order("x", "completed"))).toBe(false);
	});

	it("puts the newest on top of a lane and the latest closed first", () => {
		const state = applyBoard(
			EMPTY_BOARD,
			answer(
				[
					order("old", "accepted", { accepted_at: "2026-11-28T03:00:00Z" }),
					order("new", "accepted", { accepted_at: "2026-11-28T03:05:00Z" }),
					order("c1", "completed", { completed_at: "2026-11-28T02:00:00Z" }),
					order("c2", "cancelled", { cancelled_at: "2026-11-28T02:30:00Z" }),
				],
				1,
			),
			0,
		);
		expect(laneOrders(state, "new").map((value) => value.id)).toEqual([
			"new",
			"old",
		]);
		expect(closedOrders(state).map((value) => value.id)).toEqual(["c2", "c1"]);
	});

	it("counts whole minutes of waiting (boundary at 60 seconds)", () => {
		const start = Date.parse("2026-11-28T03:00:00Z");
		expect(waitingMinutes(order("x", "accepted"), start + 59_999)).toBe(0);
		expect(waitingMinutes(order("x", "accepted"), start + 60_000)).toBe(1);
	});
});

describe("cancelling and refunding", () => {
	it("needs five characters for another reason (boundary 4 and 5)", () => {
		expect(cancelReasonCode("customer_request", "")).toBe("customer_request");
		expect(cancelReasonCode("other", "abcd")).toBeNull();
		expect(cancelReasonCode("other", " abcde ")).toBe("other:abcde");
		expect(cancelReasonCode("other", "a\nb\ncde")).toBe("other:a b cde");
	});

	it("refunds at most what was paid less what went back", () => {
		expect(refundable(order("x", "completed"))).toBe(0);
		expect(
			refundable(
				order("x", "completed", {
					money: {
						paid: 50_000,
						refunded: 20_000,
						refund_open: 0,
						payments: [],
						refunds: [],
					},
				}),
			),
		).toBe(30_000);
	});

	it("writes the audit line with the time, the person, the action, the reason and the amount", () => {
		const t = (key: string) =>
			({
				"audit.action.cancel": "hủy đơn",
				"audit.staff": "Nhân viên",
				"cancel.reason.customer_request": "Khách đổi ý",
			})[key] ?? key;
		const names = new Map([["u1", "Minh"]]);
		expect(
			auditLine(
				{
					kind: "status",
					action: "cancel",
					from: "accepted",
					to: "cancelled",
					actor: "staff",
					actor_user_id: "u1",
					reason_code: "customer_request",
					amount: null,
					at: "2026-11-27T07:36:00Z",
				},
				names,
				t,
			),
		).toBe("27/11 14:36 · Minh · hủy đơn · Khách đổi ý");
		expect(
			auditLine(
				{
					kind: "payment",
					action: "cancel",
					from: null,
					to: null,
					actor: "staff",
					actor_user_id: "u2",
					reason_code: "other",
					reason_text: "Pha sai",
					amount: -50_000,
					at: "2026-11-27T07:36:00Z",
				},
				names,
				t,
			),
		).toBe("27/11 14:36 · Nhân viên · hủy đơn · Pha sai · 50.000đ");
	});
});

describe("the printed ticket", () => {
	it("prints the place, the lines with their details, the total and the payment as plain text", () => {
		const t = (key: string, params?: Record<string, string | number>) =>
			key === "print.printedAt"
				? `In lúc ${params?.time}`
				: key === "order.total"
					? "Tổng cộng"
					: key;
		const ticket = ticketOf(
			order("x", "accepted", {
				note: "<b>ít ngọt</b>",
				lines: [
					{
						line_no: 1,
						item_id: "i",
						size_id: "s",
						item_name: "Trà đào",
						size_label: "Lớn",
						quantity: 2,
						unit_price: 39_000,
						options: [
							{
								group_id: "g",
								group: "Đá",
								option_id: "o",
								name: "Ít đá",
								price: 0,
							},
						],
						options_amount: 0,
						line_total: 78_000,
						counts_for_stamps: true,
						note: null,
					},
				],
				total: 78_000,
			}),
			{
				brand: "Quán mẫu",
				store: "Cửa hàng A",
				printedAt: new Date("2026-11-28T03:10:00Z"),
			},
			t,
		);
		const text = ticket.lines.map((line) => line.text);
		expect(text).toContain("Bàn 1 #001");
		expect(text).toContain("2× Trà đào");
		expect(text).toContain("   Lớn · Ít đá");
		expect(text).toContain("Tổng cộng: 78.000đ");
		expect(text.some((line) => line.includes("<b>ít ngọt</b>"))).toBe(true);
	});
});
