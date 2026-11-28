import type { Order, OrderingState } from "@fnb/zalo-mini/ordering";
import { describe, expect, it } from "vitest";
import {
	CALL_WAIT_MS,
	callWaiting,
	canCancel,
	closedKind,
	etaMinutes,
	isLate,
	isTerminal,
	orderStage,
	refusalBacksToCart,
	refusalKey,
	timelineSteps,
} from "./order-view";
import { fold, matchesQuery } from "./search";
import { tableLinkFrom, tableLinkFromEvent } from "./table-link";

// Test design (ISTQB) for the order view, the search and the table link:
// - state transitions of an order (awaiting_payment, accepted unpaid at the counter, accepted paid, preparing,
//   serving, ready, completed, cancelled) against its headline stage, its timeline and whether it may be cancelled;
// - boundary values of the estimate: 5 minutes after it is not yet late, at 5 minutes it is; the call wait at 119.999
//   and 120 seconds;
// - equivalence partitions of the refusals: an ordering reason, a placement refusal, an unknown code, none;
// - the search with and without Vietnamese marks, words in any order, a query that matches nothing;
// - the table link: a valid link, each missing or malformed part, and the shapes OpenApp hands over.

const T0 = "2026-11-27T03:00:00.000Z";

function order(overrides: Partial<Order> = {}): Order {
	return {
		id: "66666666-6666-4666-8666-666666666601",
		orderNo: 7,
		displayNo: "#007",
		businessDate: "2026-11-27",
		source: "app",
		type: "table",
		tableLabel: "Bàn 12",
		pickupAt: null,
		startAt: null,
		scheduled: false,
		status: "accepted",
		paymentStatus: "unpaid",
		paymentMethod: "counter",
		version: 1,
		subtotal: 35000,
		discountAmount: 0,
		total: 35000,
		note: null,
		placedAt: T0,
		paymentDueAt: null,
		acceptedAt: T0,
		preparingAt: null,
		doneAt: null,
		completedAt: null,
		paidAt: null,
		cancelledAt: null,
		cancelReason: null,
		lines: [],
		timeline: [],
		money: null,
		readyEstimateAt: null,
		...overrides,
	};
}

describe("the stage of an order", () => {
	it.each([
		[
			{ status: "awaiting_payment", paymentMethod: "vietqr" },
			"awaiting_payment",
		],
		[{}, "pay_at_counter"],
		[{ paymentStatus: "paid" }, "accepted"],
		[{ status: "preparing" }, "preparing"],
		[{ status: "serving", paymentStatus: "paid" }, "serving"],
		[{ status: "ready", type: "takeaway" }, "ready"],
		[{ status: "completed", paymentStatus: "paid" }, "completed"],
		[{ status: "cancelled" }, "cancelled"],
	] as const)("%o is %s", (overrides, stage) => {
		expect(orderStage(order(overrides as Partial<Order>))).toBe(stage);
	});

	it("is finished only when completed or cancelled", () => {
		expect(isTerminal(order({ status: "completed" }))).toBe(true);
		expect(isTerminal(order({ status: "cancelled" }))).toBe(true);
		expect(isTerminal(order({ status: "serving" }))).toBe(false);
	});

	it("may be cancelled by the customer only while unpaid and not started", () => {
		expect(canCancel(order())).toBe(true);
		expect(canCancel(order({ status: "awaiting_payment" }))).toBe(true);
		expect(canCancel(order({ paymentStatus: "paid" }))).toBe(false);
		expect(canCancel(order({ status: "preparing" }))).toBe(false);
	});
});

describe("the timeline", () => {
	it("of a table order runs placed, paid, preparing, serving, done with the times", () => {
		const steps = timelineSteps(
			order({
				status: "preparing",
				paymentStatus: "paid",
				paidAt: "2026-11-27T03:02:00.000Z",
				preparingAt: "2026-11-27T03:03:00.000Z",
			}),
		);
		expect(steps.map((step) => [step.key, step.state])).toEqual([
			["placed", "done"],
			["paid", "done"],
			["preparing", "done"],
			["serving", "current"],
			["completed", "todo"],
		]);
		expect(steps[1]?.at).toBe("2026-11-27T03:02:00.000Z");
	});

	it("of an unpaid table order waits at the counter step", () => {
		expect(timelineSteps(order()).map((step) => step.state)).toEqual([
			"done",
			"current",
			"todo",
			"todo",
			"todo",
		]);
	});

	it("of a takeaway order runs placed, preparing, ready, done", () => {
		expect(
			timelineSteps(order({ type: "takeaway", tableLabel: null })).map(
				(step) => step.key,
			),
		).toEqual(["placed", "preparing", "ready", "completed"]);
	});

	it("of a cancelled order has no current step", () => {
		expect(
			timelineSteps(order({ status: "cancelled" })).some(
				(step) => step.state === "current",
			),
		).toBe(false);
	});
});

describe("the estimate and the late line", () => {
	const estimate = "2026-11-27T03:10:00.000Z";
	const at = (iso: string) => Date.parse(iso);

	it("counts whole minutes up, never below 1, and only with the server's estimate", () => {
		const withEstimate = order({ readyEstimateAt: estimate });
		expect(etaMinutes(withEstimate, at("2026-11-27T03:00:00.000Z"))).toBe(10);
		expect(etaMinutes(withEstimate, at("2026-11-27T03:09:30.000Z"))).toBe(1);
		expect(etaMinutes(withEstimate, at("2026-11-27T03:20:00.000Z"))).toBe(1);
		expect(etaMinutes(order(), at(T0))).toBeNull();
	});

	it("is late from five minutes after the estimate, while being made", () => {
		const making = order({ status: "preparing", readyEstimateAt: estimate });
		expect(isLate(making, at("2026-11-27T03:14:59.999Z"))).toBe(false);
		expect(isLate(making, at("2026-11-27T03:15:00.000Z"))).toBe(true);
		expect(
			isLate({ ...making, status: "serving" }, at("2026-11-27T03:30:00.000Z")),
		).toBe(false);
		expect(isLate(order(), at("2026-11-27T05:00:00.000Z"))).toBe(false);
	});

	it("lets the staff call be pressed again after two minutes", () => {
		expect(callWaiting(null, 0)).toBe(false);
		expect(callWaiting(1000, 1000 + CALL_WAIT_MS - 1)).toBe(true);
		expect(callWaiting(1000, 1000 + CALL_WAIT_MS)).toBe(false);
	});
});

describe("refusals and the closed states", () => {
	it("are worded per reason, an unknown one generally", () => {
		expect(refusalKey("closed_now")).toBe("order.reason.closed_now");
		expect(refusalKey("price_changed")).toBe("order.problem.price_changed");
		expect(refusalKey("something_new")).toBe("order.problem.unknown");
		expect(refusalKey(null)).toBe("order.problem.unknown");
		expect(refusalBacksToCart("item_unavailable")).toBe(true);
		expect(refusalBacksToCart("rate_limited")).toBe(false);
	});

	it("tell the closed screen from a pause and other holds", () => {
		const state = (
			accepting: boolean,
			reason: string | null,
		): OrderingState => ({
			accepting,
			reason,
			tillMode: "native",
			orderTypes: ["table"],
			paymentMethods: ["counter"],
			opensAt: null,
			closesAt: null,
			lastOrderAt: null,
			pausedUntil: null,
			closureReason: null,
			closureEndsOn: null,
		});
		expect(closedKind(state(true, null))).toBeNull();
		expect(closedKind(state(false, "closed_now"))).toBe("closed");
		expect(closedKind(state(false, "closed_today"))).toBe("closed");
		expect(closedKind(state(false, "paused"))).toBe("paused");
		expect(closedKind(state(false, "no_staff_online"))).toBe("unavailable");
	});
});

describe("the menu search", () => {
	const item = {
		id: "22222222-2222-4222-8222-222222222201",
		categoryId: "33333333-3333-4333-8333-333333333301",
		name: "Cà phê sữa đá",
		description: "Phin đậm",
		photoPath: null,
		labels: [],
		orderTypes: ["table" as const],
		countsForStamps: true,
		sizes: [],
		optionGroupIds: [],
	};

	it("finds an item with or without marks, words in any order", () => {
		expect(fold("Cà Phê  SỮA Đá")).toBe("ca phe sua da");
		expect(matchesQuery(item, "cà phê")).toBe(true);
		expect(matchesQuery(item, "ca phe sua")).toBe(true);
		expect(matchesQuery(item, "SUA CA")).toBe(true);
		expect(matchesQuery(item, "dam")).toBe(true);
		expect(matchesQuery(item, "trà")).toBe(false);
		expect(matchesQuery(item, "   ")).toBe(true);
	});
});

describe("a table link", () => {
	it("needs the table source, a store link key and a token", () => {
		expect(
			tableLinkFrom({ store: "mau-1", src: "table", t: "AbC_d-12" }),
		).toEqual({ store: "mau-1", token: "AbC_d-12" });
		expect(tableLinkFrom({ store: "mau-1", src: "qr", t: "AbC" })).toBeNull();
		expect(tableLinkFrom({ store: "mau-1", src: "table" })).toBeNull();
		expect(
			tableLinkFrom({ store: "mau-1", src: "table", t: "a b" }),
		).toBeNull();
		expect(
			tableLinkFrom({ store: "mau-1", src: "table", t: "x".repeat(65) }),
		).toBeNull();
		expect(tableLinkFrom({ store: "../x", src: "table", t: "abc" })).toBeNull();
	});

	it("is read from what OpenApp hands over", () => {
		expect(
			tableLinkFromEvent({
				params: { store: "mau-1", src: "table", t: "tok" },
			}),
		).toEqual({ store: "mau-1", token: "tok" });
		expect(
			tableLinkFromEvent({ path: "/?store=mau-1&src=table&t=tok" }),
		).toEqual({ store: "mau-1", token: "tok" });
		expect(tableLinkFromEvent({ path: "/" })).toBeNull();
		expect(tableLinkFromEvent(null)).toBeNull();
	});
});
