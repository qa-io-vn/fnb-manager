import { createTranslator } from "@fnb/zalo-mini/i18n/translate";
import { describe, expect, it } from "vitest";
import vi from "../i18n/vi.json";
import { pickupLine, ticketOf } from "../print/ticket";
import {
	applyBoard,
	boardFailed,
	EMPTY_BOARD,
	isScheduled,
	laneOrders,
	scheduledOrders,
	waitingMinutes,
} from "./board-model";
import { pickupWords, timeOn } from "./order-bits";
import type { BoardAnswer, Order, OrderStatus } from "./types";

// counter:unit/scheduled (C17, ADR-072): a takeaway booked for a pick-up time waits as "hẹn HH:MM" until its
// preparation start (the pick-up less the store's preparation time, start_at), then joins Mới and rings once.
// - boundary values of the counter's clock against start_at: one second before (scheduled), at it and after (due);
// - equivalence partitions of orders: a table order, a takeaway "as soon as possible", a booked takeaway accepted, a
//   booked takeaway already started (preparing), one with an unreadable start;
// - state transitions of the queue: first load (no chime), a booking arriving paid (no chime), its start coming
//   between two answers (one chime, then none), started early by staff before its start (no chime), a failed poll
//   across its start (the chime comes with the catch-up);
// - the words: "hẹn 07:30" with "bắt đầu pha 07:15", "lấy 15:30" once due, the date added for another day, nothing for
//   a table or an "as soon as possible" order; the ticket's and the detail's line; waiting minutes counted from the
//   start, not the payment.

const t = createTranslator(vi);

/** 2026-11-28 15:00 in Vietnam (UTC+7) as milliseconds. */
const AT_1500 = Date.parse("2026-11-28T08:00:00Z");
const PICKUP = "2026-11-28T08:30:00Z"; // 15:30
const START = "2026-11-28T08:15:00Z"; // 15:15
const START_MS = Date.parse(START);

function order(
	id: string,
	status: OrderStatus,
	overrides: Partial<Order> = {},
): Order {
	return {
		id,
		order_no: 7,
		display_no: "#007",
		business_date: "2026-11-28",
		source: "app",
		type: "takeaway",
		table: null,
		pickup_at: PICKUP,
		start_at: START,
		status,
		payment_status: "paid",
		payment_method: "vietqr",
		version: 2,
		subtotal: 40_000,
		discount_amount: 0,
		total: 40_000,
		note: null,
		placed_at: "2026-11-28T07:50:00Z",
		accepted_at: "2026-11-28T07:51:00Z",
		preparing_at: null,
		done_at: null,
		completed_at: null,
		paid_at: "2026-11-28T07:51:00Z",
		cancelled_at: null,
		cancel_reason: null,
		lines: [],
		...overrides,
	};
}

const tableOrder = (id: string) =>
	order(id, "accepted", {
		type: "table",
		table: { id: "t", label: "Bàn 2" },
		pickup_at: null,
		start_at: null,
		payment_status: "unpaid",
		payment_method: "counter",
	});
const asap = (id: string) =>
	order(id, "accepted", { pickup_at: null, start_at: null });

function answer(orders: Order[], cursor: number): BoardAnswer {
	return {
		store_id: "s",
		business_date: "2026-11-28",
		ordering: { accepting: true, reason: null },
		cursor,
		counts: {
			accepted: 0,
			scheduled: 0,
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

describe("scheduled or due (BVA of the counter's clock, EP of orders)", () => {
	it("is scheduled one second before its start and due at it and after", () => {
		const booked = order("b", "accepted");
		expect(isScheduled(booked, START_MS - 1_000)).toBe(true);
		expect(isScheduled(booked, START_MS)).toBe(false);
		expect(isScheduled(booked, START_MS + 1_000)).toBe(false);
	});

	it("never holds back a table order, an 'as soon as possible' takeaway, a started booking or an unreadable start", () => {
		expect(isScheduled(tableOrder("t"), AT_1500)).toBe(false);
		expect(isScheduled(asap("a"), AT_1500)).toBe(false);
		expect(isScheduled(order("p", "preparing"), AT_1500)).toBe(false);
		expect(
			isScheduled(order("x", "accepted", { start_at: "not a time" }), AT_1500),
		).toBe(false);
	});

	it("keeps a booking out of Mới and lists it apart until its start, the next to start first", () => {
		const later = order("later", "accepted", {
			pickup_at: "2026-11-28T09:00:00Z",
			start_at: "2026-11-28T08:45:00Z",
		});
		const state = applyBoard(
			EMPTY_BOARD,
			answer([tableOrder("t"), asap("a"), later, order("b", "accepted")], 3),
			AT_1500,
		);
		expect(
			laneOrders(state, "new", AT_1500)
				.map((item) => item.id)
				.sort(),
		).toEqual(["a", "t"]);
		expect(scheduledOrders(state, AT_1500).map((item) => item.id)).toEqual([
			"b",
			"later",
		]);
		expect(
			laneOrders(state, "new", START_MS)
				.map((item) => item.id)
				.sort(),
		).toEqual(["a", "b", "t"]);
		expect(scheduledOrders(state, START_MS).map((item) => item.id)).toEqual([
			"later",
		]);
		// without a clock the lane is as before: every accepted order (regression of the S02 lanes)
		expect(laneOrders(state, "new")).toHaveLength(4);
	});
});

describe("the chime of a booking (state transitions of the queue)", () => {
	const loaded = applyBoard(EMPTY_BOARD, answer([], 1), AT_1500);

	it("does not ring when a paid booking arrives before its start", () => {
		const next = applyBoard(
			loaded,
			answer([order("b", "accepted")], 2),
			AT_1500,
		);
		expect(next.fresh).toEqual([]);
		expect(next.scheduledIds).toEqual(["b"]);
	});

	it("rings once when its start comes between two answers, then no more", () => {
		const held = applyBoard(
			loaded,
			answer([order("b", "accepted")], 2),
			START_MS - 1_000,
		);
		expect(held.fresh).toEqual([]);
		const due = applyBoard(held, answer([], 2), START_MS);
		expect(due.fresh).toEqual(["b"]);
		expect(due.scheduledIds).toEqual([]);
		const after = applyBoard(due, answer([], 2), START_MS + 2_000);
		expect(after.fresh).toEqual([]);
	});

	it("rings for a new table order and an 'as soon as possible' takeaway as before", () => {
		const next = applyBoard(
			loaded,
			answer([tableOrder("t"), asap("a")], 2),
			AT_1500,
		);
		expect(next.fresh).toEqual(["t", "a"]);
	});

	it("does not ring for a booking staff started early", () => {
		const held = applyBoard(
			loaded,
			answer([order("b", "accepted")], 2),
			AT_1500,
		);
		const started = applyBoard(
			held,
			answer([order("b", "preparing", { version: 3 })], 3),
			START_MS,
		);
		expect(started.fresh).toEqual([]);
	});

	it("rings with the catch-up answer when the network was down across the start", () => {
		const held = applyBoard(
			loaded,
			answer([order("b", "accepted")], 2),
			AT_1500,
		);
		const down = boardFailed(held, START_MS - 500);
		expect(down.scheduledIds).toEqual(["b"]);
		const back = applyBoard(down, answer([], 2), START_MS + 60_000);
		expect(back.fresh).toEqual(["b"]);
		expect(back.resynced).toBe(1);
	});

	it("does not ring at the first load, even for a booking already due", () => {
		const first = applyBoard(
			EMPTY_BOARD,
			answer([order("b", "accepted")], 2),
			START_MS + 1,
		);
		expect(first.fresh).toEqual([]);
	});
});

describe("the words of a pick-up", () => {
	it("says 'hẹn 15:30' and 'bắt đầu pha 15:15' before the start, 'lấy 15:30' from it", () => {
		expect(pickupWords(order("b", "accepted"), AT_1500, t)).toEqual({
			label: "hẹn 15:30",
			start: "bắt đầu pha 15:15",
		});
		expect(pickupWords(order("b", "accepted"), START_MS, t)).toEqual({
			label: "lấy 15:30",
			start: null,
		});
		expect(pickupWords(order("b", "ready"), AT_1500, t)).toEqual({
			label: "lấy 15:30",
			start: null,
		});
	});

	it("adds the date to a booking of another day (booked at night for the morning)", () => {
		const night = Date.parse("2026-11-27T16:30:00Z"); // 27/11 23:30
		const morning = order("m", "accepted", {
			pickup_at: "2026-11-28T00:30:00Z", // 28/11 07:30
			start_at: "2026-11-28T00:15:00Z",
		});
		expect(timeOn(morning.pickup_at ?? "", night)).toBe("28/11 07:30");
		expect(pickupWords(morning, night, t)?.label).toBe("hẹn 28/11 07:30");
		expect(pickupLine(morning, night, t)).toBe(
			"Hẹn 28/11 07:30 · bắt đầu pha 28/11 07:15",
		);
	});

	it("says nothing for a table order or an 'as soon as possible' takeaway", () => {
		expect(pickupWords(tableOrder("t"), AT_1500, t)).toBeNull();
		expect(pickupWords(asap("a"), AT_1500, t)).toBeNull();
		expect(pickupLine(tableOrder("t"), AT_1500, t)).toBeNull();
		expect(pickupLine(asap("a"), AT_1500, t)).toBeNull();
	});

	it("prints the line on the ticket: booked before the start, the pick-up after", () => {
		const context = { brand: "Synthetic", store: "Cửa hàng mẫu A" };
		const before = ticketOf(
			order("b", "accepted"),
			{ ...context, printedAt: new Date(AT_1500) },
			t,
		).lines.map((line) => line.text);
		expect(before).toContain("Hẹn 15:30 · bắt đầu pha 15:15");
		const after = ticketOf(
			order("b", "accepted"),
			{ ...context, printedAt: new Date(START_MS) },
			t,
		).lines.map((line) => line.text);
		expect(after).toContain("Mang đi · lấy 15:30");
		const table = ticketOf(
			tableOrder("t"),
			{ ...context, printedAt: new Date(AT_1500) },
			t,
		).lines.map((line) => line.text);
		expect(table.some((text) => text.includes("lấy"))).toBe(false);
	});

	it("counts the waiting minutes of a booking from its start, not from its payment", () => {
		const booked = order("b", "accepted");
		expect(waitingMinutes(booked, START_MS - 60_000)).toBe(0);
		expect(waitingMinutes(booked, START_MS + 5 * 60_000)).toBe(5);
		expect(waitingMinutes(tableOrder("t"), START_MS)).toBe(24);
	});
});
