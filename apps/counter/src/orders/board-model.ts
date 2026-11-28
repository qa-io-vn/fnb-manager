import type {
	BoardAnswer,
	BoardCall,
	Order,
	Ordering,
	OrderStatus,
} from "./types";

/**
 * The counter's queue between two polls of counter_board (ADR-066). The board answers only what changed since the
 * cursor, so the queue merges each answer into what it holds; a poll that fails keeps every order shown (the plan's
 * "keep shown orders" when the network drops), and the first answer after a failure says how many orders arrived
 * meanwhile. An order the queue had not seen in an active state is "fresh" (the chime), except at the first load.
 *
 * A takeaway booked for a pick-up time (C17, ADR-072) is paid and accepted long before it should be made: until its
 * start_at (the pick-up less the store's preparation time) it is "scheduled", shown apart as "hẹn HH:MM" and not
 * fresh. The board does not resend an order that did not change, so the queue decides on its own clock: at each answer
 * an order it held as scheduled whose start has come is fresh then (the chime), and it joins the Mới lane.
 */

export interface BoardState {
	readonly cursor: number;
	readonly orders: ReadonlyMap<string, Order>;
	readonly calls: readonly BoardCall[];
	readonly ordering: Ordering | null;
	readonly counts: BoardAnswer["counts"] | null;
	readonly businessDate: string | null;
	readonly loaded: boolean;
	/** when the last poll answered, or null before the first */
	readonly lastOkAt: number | null;
	/** the poll is failing (no network or the server did not answer) */
	readonly offline: boolean;
	readonly offlineSince: number | null;
	/** orders new to this device since the last answer: the chime rings for these */
	readonly fresh: readonly string[];
	/** staff calls new to this device since the last answer: the chime rings for these too */
	readonly freshCalls: readonly string[];
	/** after a failure, how many new orders the catch-up answer brought (shown once) */
	readonly resynced: number | null;
	/** the orders that were scheduled at the last answer: one whose start has come since is fresh */
	readonly scheduledIds: readonly string[];
}

export const EMPTY_BOARD: BoardState = {
	cursor: 0,
	orders: new Map(),
	calls: [],
	ordering: null,
	counts: null,
	businessDate: null,
	loaded: false,
	lastOkAt: null,
	offline: false,
	offlineSince: null,
	fresh: [],
	freshCalls: [],
	resynced: null,
	scheduledIds: [],
};

const ACTIVE: readonly OrderStatus[] = [
	"accepted",
	"preparing",
	"ready",
	"serving",
];

export function isActive(order: Order): boolean {
	return ACTIVE.includes(order.status);
}

/** When a booked takeaway should start being made, as milliseconds, or null for any other order. */
export function startOf(order: Order): number | null {
	if (order.start_at === null || order.start_at === undefined) return null;
	const at = Date.parse(order.start_at);
	return Number.isFinite(at) ? at : null;
}

/** Accepted, and its preparation start still ahead at `now` (the counter's clock): shown as "hẹn HH:MM", not as new. */
export function isScheduled(order: Order, now: number): boolean {
	const start = startOf(order);
	return order.status === "accepted" && start !== null && start > now;
}

/** Merges one answer of the board. An order is replaced by the answer's copy unless the queue holds a newer version. */
export function applyBoard(
	state: BoardState,
	answer: BoardAnswer,
	now: number,
): BoardState {
	const orders = new Map(state.orders);
	const fresh: string[] = [];
	for (const order of answer.orders) {
		const held = orders.get(order.id);
		if (
			held === undefined &&
			state.loaded &&
			(order.status === "accepted" || order.status === "preparing") &&
			!isScheduled(order, now)
		) {
			fresh.push(order.id);
		}
		if (held === undefined || held.version <= order.version) {
			orders.set(
				order.id,
				held?.money === undefined ? order : { ...order, money: held.money },
			);
		}
	}
	// a new business day starts an empty queue of closed orders
	if (
		state.businessDate !== null &&
		state.businessDate !== answer.business_date
	) {
		for (const [id, order] of orders) {
			if (!isActive(order) && order.business_date !== answer.business_date)
				orders.delete(id);
		}
	}
	// a booking whose preparation start came since the last answer enters the flow now, as a new order would
	for (const id of state.scheduledIds) {
		const held = orders.get(id);
		if (
			state.loaded &&
			held !== undefined &&
			held.status === "accepted" &&
			!isScheduled(held, now) &&
			!fresh.includes(id)
		)
			fresh.push(id);
	}
	const scheduledIds = [...orders.values()]
		.filter((order) => isScheduled(order, now))
		.map((order) => order.id);
	const knownCalls = new Set(state.calls.map((call) => call.id));
	const freshCalls = state.loaded
		? answer.calls
				.filter((call) => !knownCalls.has(call.id))
				.map((call) => call.id)
		: [];
	return {
		cursor: Math.max(state.cursor, answer.cursor),
		orders,
		calls: answer.calls,
		ordering: answer.ordering,
		counts: answer.counts,
		businessDate: answer.business_date,
		loaded: true,
		lastOkAt: now,
		offline: false,
		offlineSince: null,
		fresh,
		freshCalls,
		resynced: state.offline ? fresh.length : state.resynced,
		scheduledIds,
	};
}

/** A poll that failed: everything shown is kept. */
export function boardFailed(state: BoardState, now: number): BoardState {
	return {
		...state,
		offline: true,
		offlineSince: state.offlineSince ?? now,
		fresh: [],
		freshCalls: [],
	};
}

/** An order the device changed itself (its answer is newer than the last poll). */
export function boardOrder(state: BoardState, order: Order): BoardState {
	const held = state.orders.get(order.id);
	if (held !== undefined && held.version > order.version) return state;
	const orders = new Map(state.orders);
	orders.set(
		order.id,
		held?.money === undefined || order.money !== undefined
			? order
			: { ...order, money: held.money },
	);
	return { ...state, orders };
}

export function dismissResynced(state: BoardState): BoardState {
	return { ...state, resynced: null };
}

export type Lane = "new" | "making" | "done";

/** S02's three lanes: Mới (accepted), Đang pha (preparing), Xong (ready or being served). */
export function laneOf(order: Order): Lane | null {
	switch (order.status) {
		case "accepted":
			return "new";
		case "preparing":
			return "making";
		case "ready":
		case "serving":
			return "done";
		default:
			return null;
	}
}

/**
 * The orders of a lane, newest first (the plan: newest on top). With `now`, the Mới lane leaves out the bookings whose
 * preparation start is still ahead (scheduledOrders lists them); without it every accepted order is in Mới.
 */
export function laneOrders(
	state: BoardState,
	lane: Lane,
	now?: number,
): Order[] {
	return [...state.orders.values()]
		.filter(
			(order) =>
				laneOf(order) === lane &&
				(now === undefined || !isScheduled(order, now)),
		)
		.sort((a, b) =>
			(b.accepted_at ?? b.placed_at).localeCompare(
				a.accepted_at ?? a.placed_at,
			),
		);
}

/** The takeaway orders booked for later whose preparation start is still ahead, the next to start first. */
export function scheduledOrders(state: BoardState, now: number): Order[] {
	return [...state.orders.values()]
		.filter((order) => isScheduled(order, now))
		.sort((a, b) => (startOf(a) ?? 0) - (startOf(b) ?? 0));
}

/** The business day's completed and cancelled orders, newest first. */
export function closedOrders(state: BoardState): Order[] {
	return [...state.orders.values()]
		.filter(
			(order) => order.status === "completed" || order.status === "cancelled",
		)
		.sort((a, b) =>
			(b.completed_at ?? b.cancelled_at ?? "").localeCompare(
				a.completed_at ?? a.cancelled_at ?? "",
			),
		);
}

/** The next step of an order at the counter, or null. */
export type NextAction = "start" | "done" | "complete";

export function nextAction(order: Order): NextAction | null {
	switch (order.status) {
		case "accepted":
			return "start";
		case "preparing":
			return "done";
		case "ready":
		case "serving":
			return "complete";
		default:
			return null;
	}
}

/** Whether staff may cancel an order now (the lifecycle: only before preparing). */
export function cancellable(order: Order): boolean {
	return order.status === "awaiting_payment" || order.status === "accepted";
}

/** Whether the counter may take the payment of an order now. */
export function payable(order: Order): boolean {
	return (
		order.payment_status === "unpaid" &&
		order.status !== "cancelled" &&
		order.status !== "completed"
	);
}

/** The minutes an order has waited since it entered the queue (a booking: since its preparation start). */
export function waitingMinutes(order: Order, now: number): number {
	const since = Math.max(
		Date.parse(order.accepted_at ?? order.placed_at),
		startOf(order) ?? Number.NEGATIVE_INFINITY,
	);
	return Number.isFinite(since)
		? Math.max(0, Math.floor((now - since) / 60_000))
		: 0;
}
