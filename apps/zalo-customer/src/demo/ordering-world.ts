import { RestError } from "@fnb/zalo-mini";
import { REFUSAL_INVALID } from "@fnb/zalo-mini/loyalty";
import {
	ACCOUNT_FUNCTIONS,
	CHECKOUT_ORDER_FUNCTION,
	IDEMPOTENCY_KEY_PATTERN,
	isOnlineMethod,
	LINE_NOTE_MAX,
	MAX_CART_LINES,
	MAX_LINE_OPTIONS,
	MAX_LINE_QUANTITY,
	ORDER_NOTE_MAX,
	ORDERING_FUNCTIONS,
	PLATFORM_ORDER_ID_PATTERN,
	TABLE_TOKEN_PATTERN,
	vietQrPayload,
} from "@fnb/zalo-mini/ordering";
import { isoDateIn } from "../data/dates";
import { hasForbiddenCharacter } from "../ordering/cart";
import { createInvoiceWorld, type DemoInvoiceTill } from "./invoice-world";
import {
	DEMO_BANK,
	DEMO_CATEGORY_NAMES,
	DEMO_FOREIGN_ORDER_ID,
	DEMO_OPTION_GROUPS,
	DEMO_ORDERING_STORE,
	DEMO_PAYMENT_WINDOW_MS,
	DEMO_ROTATED_TABLE_TOKEN,
	DEMO_TABLES,
	type DemoGroup,
	type DemoItem,
	demoMenuItems,
} from "./ordering-fixtures";

/** The demo store's name, as customer_menu and customer_orders answer it. */
const DEMO_STORE_NAME = "Cửa hàng Mẫu 1";

import type { DemoExtension } from "./world";

// The native till's customer functions in the demo world (docs/api.md 3.27), answered at the wire level so the app's
// readers and REST client run as in production. It follows the server's rules where the screens depend on them: the
// price from the menu only, the request_id replay, one call open per table, the refusals and their order, the
// lifecycle and the payment status apart. A test drives the counter's side through the till (DemoTill), as the
// counter web app does on the real stack.
//
// With `?payments=online` the store offers the two online ways to pay as well, and the world stands in for the Edge
// Function checkout-order (start and link, with the server's answers and refusals) and, through the till, for the
// gateway and the bank: only they move an order to paid, never the app.

/** "refund" cancels a paid order and hands the money back at once (payment_status refunded, C14's pill) */
export type DemoTillAction =
	| "pay"
	| "start"
	| "done"
	| "complete"
	| "cancel"
	| "refund";

/** What the stand-in bank did with a transfer: matched and paid, held for a manager (another amount), or unknown. */
export type DemoTransferOutcome = "paid" | "held" | "unknown";

/** A line of an earlier order (DemoTill.pastOrder), by its size as the menu knows it now or knew it then. */
export interface DemoPastLine {
	readonly size: string;
	readonly qty?: number;
	readonly options?: readonly string[];
	readonly note?: string;
	/** the item's name as it was sold: needed for a size the menu does not know, or to try a hostile name */
	readonly name?: string;
	/** the size's price as it was sold, when it differs from today's */
	readonly price?: number;
}

/** An earlier order of the customer, for the history (C14) and "Đặt lại". */
export interface DemoPastOrder {
	/** "table" (Bàn 12) by default */
	readonly type?: "table" | "takeaway";
	/** placed this many days ago, 1 by default */
	readonly daysAgo?: number;
	/** completed and paid by default; cancelled unpaid, or cancelled and refunded */
	readonly status?: "completed" | "cancelled" | "refunded";
	/** the store's name in the history (another store's order), the demo store's by default */
	readonly storeName?: string;
	readonly lines: readonly DemoPastLine[];
}

/** The counter's side of the demo, for tests: what staff do at the till, and the gateway and the bank. */
export interface DemoTill extends DemoInvoiceTill {
	/** switch an item sold out (true) or back on sale; moves the menu version */
	soldOut(itemId: string, on: boolean): void;
	/** change a size's price; moves the menu version */
	setPrice(sizeId: string, price: number): void;
	/** take a size off the menu (its item keeps its other sizes); moves the menu version */
	removeSize(sizeId: string): void;
	/** take an option off the menu; moves the menu version */
	removeOption(optionId: string): void;
	/**
	 * set how many options a group needs at least, and which one is its default (null: none); moves the menu version
	 */
	requireGroup(
		groupId: string,
		min: number,
		defaultOption: string | null,
	): void;
	/**
	 * an earlier order of the customer (C14), priced from the menu unless a line says otherwise; answers its id (it is
	 * then the latest order for the calls here without an id)
	 */
	pastOrder(order: DemoPastOrder): string;
	/** hold orders for a reason (null: take orders) */
	setOrdering(reason: string | null): void;
	/** a counter action on an order (the latest when no id is given); answers the order's status after it */
	act(action: DemoTillAction, orderId?: string): string;
	/** how many orders the customer placed (a replay is not one) */
	placements(): number;
	/** the open staff calls of the store */
	openCalls(): number;
	/** "Tới ngay": closes the open calls */
	ackCalls(): void;
	/** the id of the customer's latest order, or null */
	latestOrder(): string | null;
	/** an order's status (the latest order's when no id is given), or null */
	status(orderId?: string): string | null;
	/** how many online payment attempts an order has (the latest order's when no id is given) */
	attempts(orderId?: string): number;
	/** the reference of an order's latest attempt (the latest order's when no id is given), or null */
	reference(orderId?: string): string | null;
	/**
	 * The wallet's gateway reports the order's pending Checkout attempt (the latest order's when no id is given): paid
	 * moves the order to accepted with a number, failed fails the attempt and leaves the order waiting for payment.
	 */
	walletResult(orderId: string | undefined, result: "paid" | "failed"): string;
	/** the bank reports a transfer: the exact amount with the reference pays the order; any other amount is held */
	bankTransfer(reference: string, amount: number): DemoTransferOutcome;
	/** the payment window passes: an order still waiting is cancelled with payment_timeout */
	expirePayment(orderId?: string): string;
	/** the customer's booking for tomorrow 19:00, as the booking form sends it; answers its id */
	addRequest(): string;
	/**
	 * the store proposes another time (30 minutes later) for a request (the latest when no id is given), with its
	 * message (a default one when none is given)
	 */
	proposeRequest(requestId?: string, message?: string): string;
	/** the store confirms a request itself, as a manager does on the customer's word (the latest when no id is given) */
	confirmRequest(requestId?: string): string;
	/** a request's status (the latest request's when no id is given), or null */
	requestStatus(requestId?: string): string | null;
	/** how many times the customer accepted a proposal (a replay is not one) */
	acceptances(): number;
	/** the counter attaches a counter order with this many drinks to the customer's card (C20 frame 5) */
	attachToCard(stamps: number): void;
	/** how many member codes the customer was issued */
	stampCodes(): number;
	/**
	 * C17: other customers take places in a takeaway slot (its start, an ISO instant), as their bookings would; answers
	 * the places the slot has given
	 */
	fillSlot(at: string, count?: number): number;
	/** C17: how many takeaway orders one slot takes (2 by default) */
	setSlotLimit(limit: number): void;
	/** C17: the store's preparation minutes (15 with takeaway on) */
	setPrepMinutes(minutes: number): void;
	/** C17: an order's pick-up time (the latest order's when no id is given), or null */
	pickupOf(orderId?: string): string | null;
}

interface DemoLine {
	readonly line_no: number;
	readonly item_id: string;
	readonly size_id: string;
	readonly item_name: string;
	readonly size_label: string | null;
	readonly quantity: number;
	readonly unit_price: number;
	readonly options: readonly {
		readonly group_id: string;
		readonly group: string;
		readonly option_id: string;
		readonly name: string;
		readonly price: number;
	}[];
	readonly options_amount: number;
	readonly line_total: number;
	readonly counts_for_stamps: boolean;
	readonly note: string | null;
}

interface DemoEvent {
	readonly kind: "status" | "payment";
	readonly action: string;
	readonly from: string | null;
	readonly to: string | null;
	readonly at: string;
	readonly reason_code: string | null;
	readonly amount: number | null;
}

interface DemoOrder {
	readonly id: string;
	readonly owner: "me" | "someone";
	readonly requestId: string;
	readonly hash: string;
	/** given when the order is accepted: an unpaid online attempt never takes a number */
	orderNo: number | null;
	readonly type: "table" | "takeaway";
	readonly tableLabel: string | null;
	/** a takeaway's pick-up slot (C17); moved by customer_change_pickup while the payment is open */
	pickupAt?: string | null;
	readonly paymentMethod: "counter" | "zalo_checkout" | "vietqr";
	status: string;
	paymentStatus: string;
	version: number;
	readonly subtotal: number;
	readonly total: number;
	readonly note: string | null;
	readonly placedAt: string;
	paymentDueAt: string | null;
	acceptedAt: string | null;
	preparingAt: string | null;
	doneAt: string | null;
	completedAt: string | null;
	paidAt: string | null;
	cancelledAt: string | null;
	cancelReason: string | null;
	readonly lines: readonly DemoLine[];
	readonly events: DemoEvent[];
	stampsCounted: boolean;
	/** the store's name in the history; the demo store's unless an earlier order says otherwise */
	readonly storeName?: string;
}

/** A payment record: the counter's cash, or an online attempt with its reference, keys and Zalo order id. */
interface DemoPayment {
	readonly id: string;
	readonly orderId: string;
	readonly method: "cash" | "zalo_checkout" | "vietqr";
	readonly amount: number;
	status: "pending" | "succeeded" | "failed";
	readonly requestedAt: string;
	settledAt: string | null;
	readonly reference: string | null;
	readonly expiresAt: string | null;
	readonly keys: string[];
	platformOrderId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLE_MISSES_ALLOWED = 10;
const MAX_OPEN_ORDERS = 3;
const MAX_FAILED_ATTEMPTS = 3;
const STAMPS_PER_REWARD = 9;
const REWARD_NAME = "Ly miễn phí";
/** How long the store takes to prepare an order in the demo (the store's prep_minutes, 10 by default). */
const DEMO_PREP_MS = 10 * 60_000;
const STAMP_CODE_LIMIT = 30;

/** The Luhn check digit of a string of digits (the 8th digit of a member number checks the first seven). */
function luhn(digits: string): number {
	let sum = 0;
	for (let index = 0; index < digits.length; index += 1) {
		const digit = Number(digits[digits.length - 1 - index]);
		const doubled = index % 2 === 0 ? digit * 2 : digit;
		sum += doubled > 9 ? doubled - 9 : doubled;
	}
	return (10 - (sum % 10)) % 10;
}

function randomToken(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/** A request as its customer sees it (customer_requests), never the phone. */
interface DemoRequest {
	readonly id: string;
	readonly kind: "booking";
	readonly store: string;
	status: "new" | "proposed" | "confirmed" | "declined" | "cancelled";
	readonly party_size: number;
	requested_for: string;
	proposed_for: string | null;
	readonly subject: null;
	readonly note: string | null;
	readonly created_at: string;
	answered_at: string | null;
	answer_message: string | null;
	cancelled_at: string | null;
	cancelled_by: string | null;
	customer_accepted_at: string | null;
	version: number;
	readonly contact_name: string;
}

function invalidRequest(): never {
	throw new RestError(400, REFUSAL_INVALID);
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (typeof value === "object" && value !== null) {
		const row = value as Record<string, unknown>;
		return `{${Object.keys(row)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

/** 32 bits of FNV-1a over a text, from a seed: the demo's stand-in for a signature (no key, nothing secret). */
function fnv(text: string, seed: number): string {
	let hash = (2166136261 ^ seed) >>> 0;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

function textOk(value: unknown, max: number): boolean {
	if (value === undefined || value === null) return true;
	if (typeof value !== "string") return false;
	return [...value.trim()].length <= max && !hasForbiddenCharacter(value);
}

function noteOf(value: unknown): string | null {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** The request's shape, as app.order_request_shape checks it before anything is read (22023 for any break). */
function checkShape(
	request: unknown,
	placing: boolean,
): Record<string, unknown> {
	if (typeof request !== "object" || request === null || Array.isArray(request))
		invalidRequest();
	const row = request as Record<string, unknown>;
	const allowed = [
		"request_id",
		"store",
		"type",
		"table_token",
		"pickup_at",
		"lines",
		"note",
		"payment",
		"expected_total",
		"menu_version",
		"use_reward",
	];
	if (Object.keys(row).some((key) => !allowed.includes(key))) invalidRequest();
	if (
		placing &&
		(typeof row.request_id !== "string" || !UUID.test(row.request_id))
	)
		invalidRequest();
	if (row.type !== "table" && row.type !== "takeaway") invalidRequest();
	if (typeof row.store !== "string") invalidRequest();
	const lines = row.lines;
	if (
		!Array.isArray(lines) ||
		lines.length < 1 ||
		lines.length > MAX_CART_LINES
	)
		invalidRequest();
	for (const line of lines) {
		if (typeof line !== "object" || line === null) invalidRequest();
		const entry = line as Record<string, unknown>;
		if (
			Object.keys(entry).some(
				(key) => !["size", "qty", "options", "note"].includes(key),
			)
		)
			invalidRequest();
		if (typeof entry.size !== "string" || !UUID.test(entry.size))
			invalidRequest();
		if (
			typeof entry.qty !== "number" ||
			!Number.isInteger(entry.qty) ||
			entry.qty < 1 ||
			entry.qty > MAX_LINE_QUANTITY
		)
			invalidRequest();
		if (entry.options !== undefined && entry.options !== null) {
			if (
				!Array.isArray(entry.options) ||
				entry.options.length > MAX_LINE_OPTIONS
			)
				invalidRequest();
			const seen = new Set<string>();
			for (const option of entry.options) {
				if (
					typeof option !== "string" ||
					!UUID.test(option) ||
					seen.has(option)
				)
					invalidRequest();
				seen.add(option);
			}
		}
		if (!textOk(entry.note, LINE_NOTE_MAX)) invalidRequest();
	}
	if (!textOk(row.note, ORDER_NOTE_MAX)) invalidRequest();
	const expected = row.expected_total;
	if (placing) {
		if (
			typeof expected !== "number" ||
			!Number.isInteger(expected) ||
			expected < 0
		)
			invalidRequest();
		if (!["counter", "zalo_checkout", "vietqr"].includes(String(row.payment)))
			invalidRequest();
	}
	if (
		row.table_token !== undefined &&
		row.table_token !== null &&
		typeof row.table_token !== "string"
	)
		invalidRequest();
	return row;
}

export interface OrderingWorld extends DemoExtension {
	readonly till: DemoTill;
}

export function createOrderingWorld(
	now: () => number,
	initialReason: string | null,
	onlinePayments = false,
	member = false,
	einvoiceOn = true,
	takeawayOn = false,
): OrderingWorld {
	const items = demoMenuItems();
	// this world's own option groups: the till takes options off and makes a group required
	const groups: DemoGroup[] = DEMO_OPTION_GROUPS.map((group) => ({
		...group,
		options: [...group.options],
	}));
	const soldOut = new Set<string>();
	let version = 1;
	let reason: string | null = initialReason;
	let orderCount = 0;
	let numbers = 0;
	let placements = 0;
	let tableMisses = 0;
	const orders: DemoOrder[] = [];
	const payments: DemoPayment[] = [];
	const calls = new Map<string, string>();
	let stamps = 0;
	let totalEarned = 0;
	const rewards: { id: string; issued_at: string }[] = [];
	const history: {
		kind: string;
		delta: number;
		balance_after: number;
		at: string;
		order_no: string | null;
	}[] = [];
	const requests: DemoRequest[] = [];
	// the customer's acceptances by the app's request id (customer_accept_proposal is idempotent per id)
	const acceptedBy = new Map<string, string>();
	let acceptanceCount = 0;
	const attached: {
		order_no: string;
		store_name: string;
		status: string;
		attached_at: string;
		stamps: number;
	}[] = [];
	let stampCodesIssued = 0;
	const methods = onlinePayments
		? ["counter", "zalo_checkout", "vietqr"]
		: ["counter"];
	// C17 with `?takeaway=on`: the store takes takeaway too, open 07:00-23:00 every day, 15 minutes to prepare, slots of
	// 15 minutes, the last pick-up at 22:45, two orders a slot; a booking holds its place 10 minutes while unpaid
	let prepMs = takeawayOn ? 15 * 60_000 : DEMO_PREP_MS;
	let slotLimit = 2;
	const slotFill = new Map<number, number>();

	const iso = () => new Date(now()).toISOString();
	const displayNo = (no: number | null) =>
		no === null ? null : `#${String(no).padStart(3, "0")}`;

	// another customer's order, which this customer's session must never read
	orders.push({
		id: DEMO_FOREIGN_ORDER_ID,
		owner: "someone",
		requestId: "ffffffff-0000-4000-8000-000000000002",
		hash: "",
		orderNo: 1,
		type: "table",
		tableLabel: "Bàn 3",
		paymentMethod: "counter",
		status: "accepted",
		paymentStatus: "unpaid",
		version: 1,
		subtotal: 29000,
		total: 29000,
		note: null,
		placedAt: new Date(now() - 600_000).toISOString(),
		paymentDueAt: null,
		acceptedAt: new Date(now() - 600_000).toISOString(),
		preparingAt: null,
		doneAt: null,
		completedAt: null,
		paidAt: null,
		cancelledAt: null,
		cancelReason: null,
		lines: [],
		events: [],
		stampsCounted: false,
	});
	orderCount = 1;
	numbers = 1;

	const types = takeawayOn ? ["table", "takeaway"] : ["table"];
	/** the next 07:00 on the shop's clock: today's before it, else tomorrow's */
	const nextOpening = () => {
		const opening = Date.parse(`${isoDateIn(now())}T07:00:00+07:00`);
		return opening > now()
			? opening
			: Date.parse(`${isoDateIn(now() + 24 * 3_600_000)}T07:00:00+07:00`);
	};
	const orderingState = (type: string | null) => {
		const accepting = reason === null;
		const opensAt =
			reason === "closed_now" ||
			reason === "closed_today" ||
			reason === "last_orders_passed"
				? new Date(
						takeawayOn
							? nextOpening()
							: Date.parse(
									`${isoDateIn(now() + 24 * 3_600_000)}T07:00:00+07:00`,
								),
					).toISOString()
				: null;
		return {
			accepting: accepting && (type === null || types.includes(type)),
			reason: !accepting
				? reason
				: type !== null && !types.includes(type)
					? "ordering_off"
					: null,
			till_mode: "native",
			order_types: types,
			payment_methods: methods,
			opens_at: opensAt,
			closes_at: null,
			last_order_at: null,
			paused_until:
				reason === "paused"
					? new Date(now() + 30 * 60_000).toISOString()
					: null,
			closure_reason: reason === "closed_today" ? "Nghỉ sửa quán" : null,
			closure_ends_on: reason === "closed_today" ? isoDateIn(now()) : null,
		};
	};

	const itemOf = (sizeId: string) => {
		for (const item of items) {
			const size = item.sizes.find((entry) => entry.id === sizeId);
			if (size !== undefined) return { item, size };
		}
		return null;
	};

	const available = (item: DemoItem) => !soldOut.has(item.id);

	const checkStore = (store: unknown) => {
		if (store !== DEMO_ORDERING_STORE) invalidRequest();
	};

	const menu = (type: string | null) => {
		const listed = items.filter(available);
		const categories = Object.keys(DEMO_CATEGORY_NAMES)
			.map((categoryId) => ({
				id: categoryId,
				name: DEMO_CATEGORY_NAMES[categoryId],
				items: listed
					.filter((item) => item.category === categoryId)
					.map((item) => ({
						id: item.id,
						name: item.name,
						description: item.description,
						photo_path: null,
						labels: item.labels,
						order_types: types,
						counts_for_stamps: item.counts_for_stamps,
						sizes: item.sizes.map((size) => ({
							id: size.id,
							label: size.label,
							price: size.price,
							is_default: size.is_default,
						})),
						option_group_ids: item.groups,
					})),
			}))
			.filter((category) => category.items.length > 0);
		const usedGroups = new Set(listed.flatMap((item) => item.groups));
		return {
			store: {
				code: DEMO_ORDERING_STORE,
				name: DEMO_STORE_NAME,
				address: "12 Đường Số 1, Phường Mẫu, Thành phố Mẫu",
				opening_hours: takeawayOn
					? {
							mon: [["07:00", "23:00"]],
							tue: [["07:00", "23:00"]],
							wed: [["07:00", "23:00"]],
							thu: [["07:00", "23:00"]],
							fri: [["07:00", "23:00"]],
							sat: [["07:00", "23:00"]],
							sun: [["07:00", "23:00"]],
						}
					: {
							mon: [["07:00", "22:00"]],
							tue: [["07:00", "22:00"]],
							wed: [["07:00", "22:00"]],
							thu: [["07:00", "22:00"]],
							fri: [["07:00", "22:30"]],
							sat: [["07:30", "22:30"]],
							sun: [["07:30", "21:30"]],
						},
			},
			order_type: type,
			ordering: orderingState(type),
			menu_version: version,
			currency: "VND",
			categories,
			option_groups: groups.filter((group) => usedGroups.has(group.id)),
			unavailable_items: items
				.filter((item) => !available(item))
				.map((item) => item.id),
		};
	};

	const tableOf = (token: unknown) => {
		if (typeof token !== "string" || !TABLE_TOKEN_PATTERN.test(token))
			invalidRequest();
		if (tableMisses >= TABLE_MISSES_ALLOWED)
			return {
				state: "refused",
				refusal: "rate_limited",
				retry_at: new Date(now() + 15 * 60_000).toISOString(),
			} as const;
		const table = DEMO_TABLES.find((entry) => entry.token === token);
		if (table === undefined || token === DEMO_ROTATED_TABLE_TOKEN) {
			tableMisses += 1;
			return { state: "refused", refusal: "table_unknown" } as const;
		}
		return { state: "ok", table } as const;
	};

	const priceLines = (lines: readonly Record<string, unknown>[]) => {
		const unavailable: string[] = [];
		const badLines: number[] = [];
		const priced: DemoLine[] = [];
		lines.forEach((line, index) => {
			const found = itemOf(String(line.size));
			if (found === null || !available(found.item)) {
				unavailable.push(found?.item.id ?? String(line.size));
				return;
			}
			const chosen = Array.isArray(line.options)
				? (line.options as string[])
				: [];
			const options = chosen.map((id) => {
				for (const group of groups) {
					const option = group.options.find((entry) => entry.id === id);
					if (option !== undefined && found.item.groups.includes(group.id))
						return { group, option };
				}
				return null;
			});
			const badCount = found.item.groups.some((groupId) => {
				const group = groups.find((entry) => entry.id === groupId);
				const count = options.filter(
					(entry) => entry?.group.id === groupId,
				).length;
				return (
					group !== undefined &&
					(count < group.min_select || count > group.max_select)
				);
			});
			if (options.some((entry) => entry === null) || badCount) {
				badLines.push(index + 1);
				return;
			}
			const chosenOptions = options.flatMap((entry) =>
				entry === null
					? []
					: [
							{
								group_id: entry.group.id,
								group: entry.group.name,
								option_id: entry.option.id,
								name: entry.option.name,
								price: entry.option.price_delta,
							},
						],
			);
			const optionsAmount = chosenOptions.reduce(
				(sum, entry) => sum + entry.price,
				0,
			);
			const quantity = Number(line.qty);
			priced.push({
				line_no: index + 1,
				item_id: found.item.id,
				size_id: found.size.id,
				item_name: found.item.name,
				size_label: found.size.label,
				quantity,
				unit_price: found.size.price,
				options: chosenOptions,
				options_amount: optionsAmount,
				line_total: quantity * (found.size.price + optionsAmount),
				counts_for_stamps: found.item.counts_for_stamps,
				note: noteOf(line.note),
			});
		});
		if (unavailable.length > 0)
			return {
				ok: false,
				refusal: "item_unavailable",
				unavailable_items: unavailable,
			} as const;
		if (badLines.length > 0)
			return { ok: false, refusal: "option_invalid", lines: badLines } as const;
		return {
			ok: true,
			lines: priced,
			subtotal: priced.reduce((sum, line) => sum + line.line_total, 0),
		} as const;
	};

	const paymentsOf = (order: DemoOrder) =>
		payments.filter((payment) => payment.orderId === order.id);

	const readyEstimate = (order: DemoOrder): string | null => {
		const from =
			order.status === "preparing"
				? order.preparingAt
				: order.status === "accepted"
					? order.acceptedAt
					: null;
		if (from === null) return null;
		const at = Date.parse(from) + prepMs;
		// not before the pick-up time (app.order_ready_estimate)
		const pickup =
			order.status === "accepted" && order.pickupAt
				? Date.parse(order.pickupAt)
				: 0;
		return new Date(Math.max(at, pickup)).toISOString();
	};

	// C17's slots, as app.takeaway_slots answers them: the day from the clock, each slot free, passed or full
	const SLOT_MS = 15 * 60_000;
	const localDay = (date: string, minutes: number) =>
		Date.parse(`${date}T00:00:00+07:00`) + minutes * 60_000;
	const minutesOfDay = (instant: number) =>
		Math.round(
			(instant - Date.parse(`${isoDateIn(instant)}T00:00:00+07:00`)) / 60_000,
		);
	const takenAt = (start: number) =>
		(slotFill.get(start) ?? 0) +
		orders.filter(
			(order) =>
				order.type === "takeaway" &&
				typeof order.pickupAt === "string" &&
				Date.parse(order.pickupAt) === start &&
				(["accepted", "preparing", "ready", "completed"].includes(
					order.status,
				) ||
					(order.status === "awaiting_payment" &&
						order.paymentDueAt !== null &&
						Date.parse(order.paymentDueAt) > now())),
		).length;
	const closedLike = (value: string | null) =>
		value === "closed_now" ||
		value === "closed_today" ||
		value === "last_orders_passed";
	/** the bookable day and its earliest start, or the refusal (app.takeaway_offer) */
	const takeawayOffer = () => {
		const state = orderingState("takeaway");
		if (!takeawayOn) return { refusal: "ordering_off", state } as const;
		if (!state.accepting && !closedLike(state.reason))
			return { refusal: state.reason ?? "ordering_off", state } as const;
		let earliest = now() + prepMs;
		if (!state.accepting && state.opens_at !== null)
			earliest = Math.max(earliest, Date.parse(state.opens_at));
		let date = isoDateIn(earliest);
		const first = Math.max(
			localDay(date, 7 * 60),
			Math.ceil(earliest / SLOT_MS) * SLOT_MS,
		);
		if (first > localDay(date, 22 * 60 + 45))
			date = isoDateIn(localDay(date, 25 * 60));
		return { refusal: null, state, earliest, date } as const;
	};
	const takeawaySlots = () => {
		const offer = takeawayOffer();
		if (offer.refusal !== null)
			return {
				state: "refused",
				refusal: offer.refusal,
				now: iso(),
				date: null,
				pre_order: false,
				asap_at: null,
				opens_at: null,
				closes_at: null,
				last_pickup_at: null,
				prep_minutes: prepMs / 60_000,
				slot_minutes: 15,
				slots: [],
				ordering: offer.state,
			};
		const slots = [];
		for (let minutes = 7 * 60; minutes <= 22 * 60 + 45; minutes += 15) {
			const start = localDay(offer.date, minutes);
			const passed = start < offer.earliest;
			const full = !passed && takenAt(start) >= slotLimit;
			slots.push({
				start: new Date(start).toISOString(),
				available: !passed && !full,
				reason: passed ? "passed" : full ? "full" : null,
			});
		}
		return {
			state: "ok",
			refusal: null,
			now: iso(),
			date: offer.date,
			pre_order: !offer.state.accepting,
			asap_at: offer.state.accepting
				? new Date(now() + prepMs).toISOString()
				: null,
			opens_at: new Date(localDay(offer.date, 7 * 60)).toISOString(),
			closes_at: new Date(localDay(offer.date, 23 * 60)).toISOString(),
			last_pickup_at: new Date(
				localDay(offer.date, 22 * 60 + 45),
			).toISOString(),
			prep_minutes: prepMs / 60_000,
			slot_minutes: 15,
			slots,
			ordering: offer.state,
		};
	};
	/** why a pick-up time cannot be booked now, null when it can (app.takeaway_slot_refusal) */
	const slotRefusal = (pickup: number): string | null => {
		if (!Number.isFinite(pickup)) return "pickup_time_invalid";
		if (pickup < now() + prepMs) return "slot_passed";
		const offer = takeawayOffer();
		if (offer.refusal !== null) return offer.refusal;
		if (!offer.state.accepting && pickup < offer.earliest) return "closed";
		if (pickup % SLOT_MS !== 0) return "pickup_time_invalid";
		const minutes = minutesOfDay(pickup);
		if (minutes < 7 * 60 || minutes > 22 * 60 + 45) return "closed";
		if (isoDateIn(pickup) !== offer.date) return "pickup_time_invalid";
		if (takenAt(pickup) >= slotLimit) return "slot_full";
		return null;
	};

	const orderJson = (order: DemoOrder, withTimeline: boolean) => ({
		id: order.id,
		order_no: order.orderNo,
		display_no: displayNo(order.orderNo),
		business_date: isoDateIn(Date.parse(order.placedAt)),
		source: "app",
		type: order.type,
		table:
			order.tableLabel === null ? null : { id: null, label: order.tableLabel },
		pickup_at: order.pickupAt ?? null,
		start_at: order.pickupAt
			? new Date(Date.parse(order.pickupAt) - prepMs).toISOString()
			: null,
		scheduled:
			order.status === "accepted" &&
			typeof order.pickupAt === "string" &&
			Date.parse(order.pickupAt) - prepMs > now(),
		status: order.status,
		payment_status: order.paymentStatus,
		payment_method: order.paymentMethod,
		version: order.version,
		subtotal: order.subtotal,
		discount_amount: 0,
		total: order.total,
		note: order.note,
		placed_at: order.placedAt,
		payment_due_at: order.paymentDueAt,
		accepted_at: order.acceptedAt,
		preparing_at: order.preparingAt,
		done_at: order.doneAt,
		completed_at: order.completedAt,
		paid_at: order.paidAt,
		cancelled_at: order.cancelledAt,
		cancel_reason: order.cancelReason,
		ready_estimate_at: readyEstimate(order),
		late: false,
		lines: order.lines,
		...(withTimeline
			? {
					timeline: order.events,
					money: {
						paid: order.paymentStatus === "unpaid" ? 0 : order.total,
						refunded: order.paymentStatus === "refunded" ? order.total : 0,
						refund_open:
							order.paymentStatus === "refund_pending" ? order.total : 0,
						payments: paymentsOf(order).map((payment) => ({
							id: payment.id,
							method: payment.method,
							amount: payment.amount,
							status: payment.status,
							settled_at: payment.settledAt,
							recorded_by: null,
						})),
						refunds:
							order.paymentStatus === "refunded"
								? [
										{
											method: "cash",
											amount: order.total,
											status: "succeeded",
											requested_at: order.cancelledAt,
											settled_at: order.cancelledAt,
										},
									]
								: [],
					},
				}
			: {}),
	});

	const refused = (refusal: string, extra: Record<string, unknown> = {}) => ({
		state: "refused",
		refusal,
		replayed: false,
		order: null,
		...extra,
	});

	const mine = (id: unknown) =>
		orders.find((order) => order.id === id && order.owner === "me") ?? null;

	const openStatuses = [
		"awaiting_payment",
		"accepted",
		"preparing",
		"ready",
		"serving",
	];

	const placeState = (order: DemoOrder) =>
		order.status === "awaiting_payment"
			? "awaiting_payment"
			: order.status === "cancelled"
				? "cancelled"
				: "placed";

	const place = (args: Readonly<Record<string, unknown>>) => {
		const request = checkShape(args.p_request, true);
		const hash = canonical(request);
		const replay = orders.find(
			(order) => order.owner === "me" && order.requestId === request.request_id,
		);
		if (replay !== undefined) {
			if (replay.hash !== hash) return refused("request_conflict");
			return {
				state: placeState(replay),
				refusal: null,
				replayed: true,
				order: orderJson(replay, false),
			};
		}
		checkStore(request.store);
		const state = orderingState(String(request.type));
		const booking =
			request.type === "takeaway" && typeof request.pickup_at === "string";
		if (!state.accepting && !(booking && closedLike(state.reason)))
			return refused(String(state.reason), { ordering: state });
		if (
			orders.filter(
				(order) => order.owner === "me" && openStatuses.includes(order.status),
			).length >= MAX_OPEN_ORDERS
		)
			return refused("too_many_open_orders");
		let table: (typeof DEMO_TABLES)[number] | null = null;
		if (request.type === "table") {
			if (typeof request.table_token !== "string")
				return refused("table_unknown");
			const found = tableOf(request.table_token);
			if (found.state !== "ok")
				return refused(
					found.refusal,
					found.refusal === "rate_limited" ? { retry_at: found.retry_at } : {},
				);
			table = found.table;
		} else if (typeof request.table_token === "string") {
			return refused("table_not_for_takeaway");
		}
		const payment = String(request.payment);
		if (
			!methods.includes(payment) ||
			(request.type === "takeaway" && payment === "counter")
		)
			return refused("payment_not_allowed");
		if (request.type === "table" && typeof request.pickup_at === "string")
			return refused("pickup_time_invalid");
		const pickupAt = booking
			? new Date(Date.parse(String(request.pickup_at))).toISOString()
			: null;
		if (booking) {
			const refusal = slotRefusal(Date.parse(String(request.pickup_at)));
			if (refusal !== null)
				return refused(refusal, { pickup_at: request.pickup_at });
		}
		const priced = priceLines(request.lines as Record<string, unknown>[]);
		if (!priced.ok) {
			const { ok: _ok, refusal, ...rest } = priced;
			return refused(refusal, { ...rest, menu_version: version });
		}
		if (priced.subtotal !== request.expected_total)
			return refused("price_changed", {
				total: priced.subtotal,
				discount_amount: 0,
				menu_version: version,
				lines: priced.lines,
			});
		placements += 1;
		orderCount += 1;
		const at = iso();
		const online = payment !== "counter";
		if (!online) numbers += 1;
		const order: DemoOrder = {
			id: `99999999-0000-4000-8000-${String(orderCount).padStart(12, "0")}`,
			owner: "me",
			requestId: String(request.request_id),
			hash,
			orderNo: online ? null : numbers,
			type: request.type === "takeaway" ? "takeaway" : "table",
			tableLabel: table?.label ?? null,
			pickupAt,
			paymentMethod: payment as DemoOrder["paymentMethod"],
			status: online ? "awaiting_payment" : "accepted",
			paymentStatus: "unpaid",
			version: 1,
			subtotal: priced.subtotal,
			total: priced.subtotal,
			note: noteOf(request.note),
			placedAt: at,
			paymentDueAt: online
				? new Date(
						now() + (pickupAt === null ? DEMO_PAYMENT_WINDOW_MS : 10 * 60_000),
					).toISOString()
				: null,
			acceptedAt: online ? null : at,
			preparingAt: null,
			doneAt: null,
			completedAt: null,
			paidAt: null,
			cancelledAt: null,
			cancelReason: null,
			lines: priced.lines,
			events: [
				{
					kind: "status",
					action: "placed",
					from: null,
					to: online ? "awaiting_payment" : "accepted",
					at,
					reason_code: null,
					amount: priced.subtotal,
				},
			],
			stampsCounted: false,
		};
		orders.push(order);
		return {
			state: placeState(order),
			refusal: null,
			replayed: false,
			order: orderJson(order, false),
		};
	};

	const checkCart = (args: Readonly<Record<string, unknown>>) => {
		const request = checkShape(args.p_request, false);
		checkStore(request.store);
		const priced = priceLines(request.lines as Record<string, unknown>[]);
		return {
			state: priced.ok ? "ok" : "refused",
			refusal: priced.ok ? null : priced.refusal,
			unavailable_items: priced.ok
				? []
				: ((priced as { unavailable_items?: string[] }).unavailable_items ??
					[]),
			bad_lines: priced.ok
				? []
				: ((priced as { lines?: number[] }).lines ?? []),
			lines: priced.ok ? priced.lines : [],
			subtotal: priced.ok ? priced.subtotal : null,
			discount_amount: 0,
			total: priced.ok ? priced.subtotal : null,
			reward: null,
			menu_version: version,
			ordering: orderingState(String(request.type)),
		};
	};

	const changePickup = (args: Readonly<Record<string, unknown>>) => {
		const order = mine(args.p_order);
		if (order === null)
			return {
				state: "refused",
				refusal: "unknown_order",
				replayed: false,
				order: null,
			};
		const at = String(args.p_pickup_at);
		if (
			order.status === "awaiting_payment" &&
			typeof order.pickupAt === "string" &&
			Date.parse(order.pickupAt) === Date.parse(at)
		)
			return {
				state: "changed",
				refusal: null,
				replayed: true,
				order: orderJson(order, false),
			};
		if (
			order.type !== "takeaway" ||
			order.status !== "awaiting_payment" ||
			order.paymentDueAt === null ||
			Date.parse(order.paymentDueAt) <= now()
		)
			return {
				state: "refused",
				refusal: "not_changeable",
				replayed: false,
				order: orderJson(order, false),
			};
		const refusal = slotRefusal(Date.parse(at));
		if (refusal !== null)
			return {
				state: "refused",
				refusal,
				replayed: false,
				pickup_at: at,
				order: orderJson(order, false),
			};
		order.pickupAt = new Date(Date.parse(at)).toISOString();
		order.version += 1;
		order.events.push({
			kind: "status",
			action: "pickup_changed",
			from: "awaiting_payment",
			to: "awaiting_payment",
			at: iso(),
			reason_code: null,
			amount: null,
		});
		return {
			state: "changed",
			refusal: null,
			replayed: false,
			order: orderJson(order, false),
		};
	};

	const earnStamps = (order: DemoOrder) => {
		if (order.stampsCounted) return;
		order.stampsCounted = true;
		const earned = order.lines
			.filter((line) => line.counts_for_stamps)
			.reduce((sum, line) => sum + line.quantity, 0);
		if (earned === 0) return;
		stamps += earned;
		totalEarned += earned;
		const at = iso();
		history.unshift({
			kind: "order_earned",
			delta: earned,
			balance_after: stamps,
			at,
			order_no: displayNo(order.orderNo),
		});
		while (stamps >= STAMPS_PER_REWARD) {
			stamps -= STAMPS_PER_REWARD;
			rewards.push({
				id: `88888888-0000-4000-8000-${String(rewards.length + 1).padStart(12, "0")}`,
				issued_at: at,
			});
			history.unshift({
				kind: "reward_issued",
				delta: -STAMPS_PER_REWARD,
				balance_after: stamps,
				at,
				order_no: displayNo(order.orderNo),
			});
		}
	};

	const move = (
		order: DemoOrder,
		to: string,
		action: string,
		reasonCode: string | null = null,
	) => {
		const at = iso();
		order.events.push({
			kind: "status",
			action,
			from: order.status,
			to,
			at,
			reason_code: reasonCode,
			amount: null,
		});
		order.status = to;
		order.version += 1;
		return at;
	};

	const newPayment = (
		order: DemoOrder,
		method: DemoPayment["method"],
		status: DemoPayment["status"],
		key: string | null,
	): DemoPayment => {
		const count = payments.length + 1;
		const online = method !== "cash";
		const payment: DemoPayment = {
			id: `77777777-0000-4000-8000-${String(count).padStart(12, "0")}`,
			orderId: order.id,
			method,
			amount: order.total,
			status,
			requestedAt: iso(),
			settledAt: status === "succeeded" ? iso() : null,
			reference: online
				? `FNB${(count * 7_919 + 1_000_003).toString(36).toUpperCase().padStart(8, "0")}`
				: null,
			expiresAt: online ? order.paymentDueAt : null,
			keys: key === null ? [] : [key],
			platformOrderId: null,
		};
		payments.push(payment);
		return payment;
	};

	const markPaid = (order: DemoOrder, at: string) => {
		order.paymentStatus = "paid";
		order.paidAt = at;
		order.version += 1;
		order.events.push({
			kind: "payment",
			action: "paid",
			from: "unpaid",
			to: "paid",
			at,
			reason_code: null,
			amount: order.total,
		});
		invoices.paid(order);
	};

	// the verified notification of the gateway or the bank: the only way an online attempt pays an order (T3)
	const settle = (payment: DemoPayment, success: boolean) => {
		const order = orders.find((entry) => entry.id === payment.orderId);
		if (order === undefined || payment.status !== "pending") return;
		const at = iso();
		payment.settledAt = at;
		if (!success) {
			payment.status = "failed";
			order.version += 1;
			order.events.push({
				kind: "payment",
				action: "failed",
				from: null,
				to: null,
				at,
				reason_code: "provider_failed",
				amount: payment.amount,
			});
			return;
		}
		payment.status = "succeeded";
		if (order.status === "cancelled") {
			// money after a cancellation is kept as a refund to make
			order.paymentStatus = "refund_pending";
			order.version += 1;
			return;
		}
		markPaid(order, at);
		if (order.status === "awaiting_payment") {
			numbers += 1;
			order.orderNo = numbers;
			order.acceptedAt = move(order, "accepted", "payment_confirmed");
			order.paymentDueAt = null;
		}
	};

	const failPending = (order: DemoOrder) => {
		for (const payment of paymentsOf(order))
			if (payment.status === "pending") {
				payment.status = "failed";
				payment.settledAt = iso();
			}
	};

	const target = (orderId?: string) =>
		orderId === undefined
			? [...orders].reverse().find((entry) => entry.owner === "me")
			: orders.find((entry) => entry.id === orderId);

	// e-invoices and company invoices (C18), with the order's money as this world holds it
	const invoices = createInvoiceWorld({ now, einvoiceOn, mine, target });

	const till: DemoTill = {
		...invoices.till,
		addRequest() {
			const tomorrow = isoDateIn(now() + 24 * 3_600_000);
			const id = crypto.randomUUID();
			requests.push({
				id,
				kind: "booking",
				store: DEMO_ORDERING_STORE,
				status: "new",
				party_size: 4,
				requested_for: new Date(`${tomorrow}T19:00:00+07:00`).toISOString(),
				proposed_for: null,
				subject: null,
				note: null,
				created_at: iso(),
				answered_at: null,
				answer_message: null,
				cancelled_at: null,
				cancelled_by: null,
				customer_accepted_at: null,
				version: 1,
				contact_name: "Khách Mẫu",
			});
			return id;
		},
		proposeRequest(requestId, message) {
			const request =
				requestId === undefined
					? requests[requests.length - 1]
					: requests.find((entry) => entry.id === requestId);
			if (request === undefined) throw new Error("no such request");
			request.status = "proposed";
			request.proposed_for = new Date(
				Date.parse(request.requested_for) + 30 * 60_000,
			).toISOString();
			request.answered_at = iso();
			request.answer_message =
				message ?? "Giờ đó đã kín bàn, quán còn chỗ muộn hơn 30 phút.";
			request.version += 1;
			return request.status;
		},
		confirmRequest(requestId) {
			const request =
				requestId === undefined
					? requests[requests.length - 1]
					: requests.find((entry) => entry.id === requestId);
			if (request === undefined) throw new Error("no such request");
			if (request.status === "proposed" && request.proposed_for !== null)
				request.requested_for = request.proposed_for;
			request.status = "confirmed";
			request.answered_at = iso();
			request.version += 1;
			return request.status;
		},
		requestStatus(requestId) {
			const request =
				requestId === undefined
					? requests[requests.length - 1]
					: requests.find((entry) => entry.id === requestId);
			return request?.status ?? null;
		},
		acceptances() {
			return acceptanceCount;
		},
		attachToCard(count) {
			numbers += 1;
			attached.unshift({
				order_no: displayNo(numbers) ?? "",
				store_name: DEMO_STORE_NAME,
				status: "accepted",
				attached_at: iso(),
				stamps: count,
			});
		},
		stampCodes() {
			return stampCodesIssued;
		},
		fillSlot(at, count = 1) {
			const start = Date.parse(at);
			slotFill.set(start, (slotFill.get(start) ?? 0) + count);
			return takenAt(start);
		},
		setSlotLimit(limit) {
			slotLimit = limit;
		},
		setPrepMinutes(minutes) {
			prepMs = minutes * 60_000;
		},
		pickupOf(orderId) {
			return target(orderId)?.pickupAt ?? null;
		},

		soldOut(itemId, on) {
			if (on) soldOut.add(itemId);
			else soldOut.delete(itemId);
			version += 1;
		},
		setPrice(sizeId, price) {
			const found = itemOf(sizeId);
			if (found !== null) found.size.price = price;
			version += 1;
		},
		setOrdering(next) {
			reason = next;
			version += 1;
		},
		act(action, orderId) {
			const order = target(orderId);
			if (order === undefined) throw new Error("no such order");
			const at = iso();
			switch (action) {
				case "pay":
					if (
						order.paymentStatus !== "unpaid" ||
						order.status === "cancelled" ||
						order.status === "awaiting_payment"
					)
						break;
					newPayment(order, "cash", "succeeded", null);
					markPaid(order, at);
					break;
				case "start":
					if (order.status !== "accepted") break;
					order.preparingAt = move(order, "preparing", "start");
					break;
				case "done":
					if (order.status !== "preparing") break;
					order.doneAt = move(
						order,
						order.type === "table" ? "serving" : "ready",
						"done",
					);
					break;
				case "complete":
					if (
						(order.status !== "serving" && order.status !== "ready") ||
						order.paymentStatus !== "paid"
					)
						break;
					order.completedAt = move(order, "completed", "complete");
					earnStamps(order);
					break;
				case "cancel":
					if (
						order.status !== "accepted" &&
						order.status !== "awaiting_payment"
					)
						break;
					order.cancelledAt = move(order, "cancelled", "cancel");
					order.cancelReason = "store_busy";
					failPending(order);
					break;
				case "refund":
					// the counter cancels a paid order and hands the money back at once
					if (
						order.paymentStatus !== "paid" ||
						order.status === "completed" ||
						order.status === "cancelled"
					)
						break;
					order.cancelledAt = move(order, "cancelled", "cancel");
					order.cancelReason = "store_busy";
					order.paymentStatus = "refunded";
					order.version += 1;
					order.events.push({
						kind: "payment",
						action: "refunded",
						from: "paid",
						to: "refunded",
						at,
						reason_code: null,
						amount: order.total,
					});
					break;
			}
			return order.status;
		},
		removeSize(sizeId) {
			const index = items.findIndex((item) =>
				item.sizes.some((size) => size.id === sizeId),
			);
			const item = items[index];
			if (item !== undefined)
				items[index] = {
					...item,
					sizes: item.sizes.filter((size) => size.id !== sizeId),
				};
			version += 1;
		},
		removeOption(optionId) {
			for (const [index, group] of groups.entries())
				groups[index] = {
					...group,
					options: group.options.filter((option) => option.id !== optionId),
				};
			version += 1;
		},
		requireGroup(groupId, min, defaultOption) {
			const index = groups.findIndex((group) => group.id === groupId);
			const group = groups[index];
			if (group !== undefined)
				groups[index] = {
					...group,
					min_select: min,
					max_select: Math.max(group.max_select, min),
					options: group.options.map((option) => ({
						...option,
						is_default: option.id === defaultOption,
					})),
				};
			version += 1;
		},
		pastOrder(past) {
			const lines: DemoLine[] = past.lines.map((line, index) => {
				const found = itemOf(line.size);
				const options = (line.options ?? []).flatMap((id) => {
					for (const group of groups) {
						const option = group.options.find((entry) => entry.id === id);
						if (option !== undefined)
							return [
								{
									group_id: group.id,
									group: group.name,
									option_id: option.id,
									name: option.name,
									price: option.price_delta,
								},
							];
					}
					return [];
				});
				const unit = line.price ?? found?.size.price ?? 0;
				const optionsAmount = options.reduce(
					(sum, option) => sum + option.price,
					0,
				);
				const quantity = line.qty ?? 1;
				return {
					line_no: index + 1,
					// an item the menu no longer knows keeps an id of its own
					item_id:
						found?.item.id ??
						`dddddddd-0000-4000-8000-9${String(index + 1).padStart(11, "0")}`,
					size_id: line.size,
					item_name: line.name ?? found?.item.name ?? "Món cũ",
					size_label: found?.size.label ?? null,
					quantity,
					unit_price: unit,
					options,
					options_amount: optionsAmount,
					line_total: quantity * (unit + optionsAmount),
					counts_for_stamps: found?.item.counts_for_stamps ?? false,
					note: line.note ?? null,
				};
			});
			const total = lines.reduce((sum, line) => sum + line.line_total, 0);
			const placedAt = new Date(
				now() - (past.daysAgo ?? 1) * 24 * 3_600_000,
			).toISOString();
			const status = past.status ?? "completed";
			const takeaway = past.type === "takeaway";
			orderCount += 1;
			numbers += 1;
			const order: DemoOrder = {
				id: `99999999-0000-4000-8000-${String(orderCount).padStart(12, "0")}`,
				owner: "me",
				requestId: crypto.randomUUID(),
				hash: "",
				orderNo: numbers,
				type: takeaway ? "takeaway" : "table",
				tableLabel: takeaway ? null : "Bàn 12",
				paymentMethod: "counter",
				status: status === "completed" ? "completed" : "cancelled",
				paymentStatus:
					status === "completed"
						? "paid"
						: status === "refunded"
							? "refunded"
							: "unpaid",
				version: 1,
				subtotal: total,
				total,
				note: null,
				placedAt,
				paymentDueAt: null,
				acceptedAt: placedAt,
				preparingAt: status === "completed" ? placedAt : null,
				doneAt: status === "completed" ? placedAt : null,
				completedAt: status === "completed" ? placedAt : null,
				paidAt: status === "cancelled" ? null : placedAt,
				cancelledAt: status === "completed" ? null : placedAt,
				cancelReason: status === "completed" ? null : "store_busy",
				lines,
				events: [],
				stampsCounted: true,
				...(past.storeName === undefined ? {} : { storeName: past.storeName }),
			};
			orders.push(order);
			return order.id;
		},
		placements: () => placements,
		openCalls: () => calls.size,
		ackCalls: () => calls.clear(),
		latestOrder: () => target()?.id ?? null,
		status: (orderId) => target(orderId)?.status ?? null,
		attempts(orderId) {
			const order = target(orderId);
			return order === undefined
				? 0
				: paymentsOf(order).filter((payment) => payment.method !== "cash")
						.length;
		},
		reference(orderId) {
			const order = target(orderId);
			if (order === undefined) return null;
			const online = paymentsOf(order).filter(
				(payment) => payment.reference !== null,
			);
			return online[online.length - 1]?.reference ?? null;
		},
		walletResult(orderId, result) {
			const order = target(orderId);
			if (order === undefined) throw new Error("no such order");
			const attempt = paymentsOf(order)
				.reverse()
				.find(
					(payment) =>
						payment.method === "zalo_checkout" && payment.status === "pending",
				);
			if (attempt !== undefined) settle(attempt, result === "paid");
			return order.status;
		},
		bankTransfer(reference, amount) {
			const attempt = payments.find(
				(payment) =>
					payment.method === "vietqr" &&
					payment.status === "pending" &&
					payment.reference?.toUpperCase() === reference.trim().toUpperCase(),
			);
			if (attempt === undefined) return "unknown";
			// another amount goes to a manager's queue: nothing changes for the order
			if (amount !== attempt.amount) return "held";
			settle(attempt, true);
			return "paid";
		},
		expirePayment(orderId) {
			const order = target(orderId);
			if (order === undefined) throw new Error("no such order");
			if (order.status !== "awaiting_payment") return order.status;
			order.cancelledAt = move(order, "cancelled", "expire", "payment_timeout");
			order.cancelReason = "payment_timeout";
			order.paymentDueAt = null;
			failPending(order);
			return order.status;
		},
	};

	// the customer's own account (C19, C20) and requests, as the database answers them (docs/api.md)
	const stampCode = () => {
		if (stampCodesIssued >= STAMP_CODE_LIMIT)
			return {
				state: "refused",
				refusal: "rate_limited",
				retry_at: new Date(now() + 15 * 60_000).toISOString(),
				code: null,
			};
		stampCodesIssued += 1;
		const seven = String(crypto.getRandomValues(new Uint32Array(1))[0] ?? 0)
			.padStart(7, "0")
			.slice(-7);
		const number = `${seven}${luhn(seven)}`;
		const issued = now();
		return {
			state: "issued",
			refusal: null,
			code: {
				qr_payload: `fnb-stamp:1:${randomToken()}`,
				number,
				display_number: `${number.slice(0, 4)} ${number.slice(4)}`,
				issued_at: new Date(issued).toISOString(),
				refresh_at: new Date(issued + 9 * 60_000).toISOString(),
				expires_at: new Date(issued + 10 * 60_000).toISOString(),
			},
		};
	};

	const deleteAccount = (args: Readonly<Record<string, unknown>>) => {
		if (args.p_confirm !== true) invalidRequest();
		if (member)
			return { state: "refused", refusal: "member_request", deleted: false };
		const mineNow = orders.filter((order) => order.owner === "me");
		const open = mineNow.filter((order) => openStatuses.includes(order.status));
		if (open.length > 0)
			return {
				state: "refused",
				refusal: "open_orders",
				deleted: false,
				orders: open.length,
			};
		const owed = mineNow.filter(
			(order) => order.paymentStatus === "refund_pending",
		);
		if (owed.length > 0)
			return {
				state: "refused",
				refusal: "refund_pending",
				deleted: false,
				orders: owed.length,
			};
		// the orders stay as money records without the link; the card, the requests and the attachments go
		for (const order of mineNow)
			(order as { owner: "me" | "someone" }).owner = "someone";
		stamps = 0;
		totalEarned = 0;
		rewards.length = 0;
		history.length = 0;
		requests.length = 0;
		attached.length = 0;
		invoices.accountDeleted();
		return {
			state: "deleted",
			refusal: null,
			deleted: true,
			deleted_at: iso(),
			counts: { orders: mineNow.length },
		};
	};

	const exportData = () => {
		const mineNow = orders.filter((order) => order.owner === "me");
		const invoiceSections = invoices.exportSections();
		const since = new Date(now() - 30 * 86_400_000).toISOString();
		return {
			generated_at: iso(),
			login: {
				zalo_user_id: "demo-zalo-user",
				brand: "Thương hiệu mẫu",
				created_at: since,
				joined: member,
			},
			customer: member
				? {
						name: "Khách Mẫu",
						phone: "0900000000",
						first_seen_at: since,
						last_seen_at: iso(),
					}
				: null,
			memberships: [],
			consents: [],
			stamp_card: {
				stamps,
				total_earned: totalEarned,
				created_at: since,
				rewards,
				entries: history,
			},
			orders: mineNow.map((order) => ({
				...orderJson(order, false),
				store_name: DEMO_STORE_NAME,
			})),
			attached_orders: attached,
			requests: requests.map((request) => ({
				...request,
				contact_phone: "0900000000",
			})),
			invoice_requests: invoiceSections.invoice_requests,
			saved_companies: invoiceSections.saved_companies,
			staff_calls: [],
			order_blocks: [],
			deletion_request: null,
			not_kept: ["location", "contacts", "zalo_messages", "card_numbers"],
			counts: {
				orders: mineNow.length,
				attached_orders: attached.length,
				requests: requests.length,
				invoice_requests: invoiceSections.invoice_requests.length,
				saved_companies: invoiceSections.saved_companies.length,
				staff_calls: 0,
				stamp_entries: history.length,
				memberships: 0,
				consents: 0,
			},
		};
	};

	const cancelRequest = (id: unknown) => {
		if (typeof id !== "string" || !UUID.test(id)) invalidRequest();
		const request = requests.find((entry) => entry.id === id);
		if (request === undefined)
			return {
				state: "refused",
				refusal: "unknown_request",
				replayed: false,
				request: null,
			};
		if (request.status === "cancelled")
			return { state: "cancelled", refusal: null, replayed: true, request };
		if (request.status === "declined")
			return {
				state: "refused",
				refusal: "not_allowed",
				replayed: false,
				request,
			};
		request.status = "cancelled";
		request.cancelled_at = iso();
		request.cancelled_by = "customer";
		request.version += 1;
		return { state: "cancelled", refusal: null, replayed: false, request };
	};

	// "Đồng ý giờ mới" as app.customer_accept_proposal answers it, in its order: both ids required (22023); the app's
	// id used on another request is request_conflict; another customer's or an unknown request is unknown_request; the
	// same id again is a replay of the request as it is now; only a proposed request (not_allowed) whose time is still
	// ahead (proposal_expired at that instant) is confirmed at the time proposed.
	const acceptProposal = (id: unknown, attemptId: unknown) => {
		if (
			typeof id !== "string" ||
			!UUID.test(id) ||
			typeof attemptId !== "string" ||
			!UUID.test(attemptId)
		)
			invalidRequest();
		const refused = (refusal: string, request: DemoRequest | null) => ({
			state: "refused",
			refusal,
			replayed: false,
			request,
		});
		const earlier = acceptedBy.get(attemptId);
		if (earlier !== undefined && earlier !== id)
			return refused("request_conflict", null);
		const request = requests.find((entry) => entry.id === id);
		if (request === undefined) return refused("unknown_request", null);
		if (earlier === id)
			return { state: "accepted", refusal: null, replayed: true, request };
		if (request.status !== "proposed") return refused("not_allowed", request);
		if (
			request.proposed_for === null ||
			Date.parse(request.proposed_for) <= now()
		)
			return refused("proposal_expired", request);
		request.status = "confirmed";
		request.requested_for = request.proposed_for;
		request.customer_accepted_at = iso();
		request.version += 1;
		acceptedBy.set(attemptId, id);
		acceptanceCount += 1;
		return { state: "accepted", refusal: null, replayed: false, request };
	};

	const answer = (
		fn: string,
		args: Readonly<Record<string, unknown>>,
	): unknown => {
		switch (fn) {
			case ORDERING_FUNCTIONS.menu: {
				checkStore(args.p_store_code);
				const type = args.p_order_type ?? null;
				if (type !== null && type !== "table" && type !== "takeaway")
					invalidRequest();
				return menu(type as string | null);
			}
			case ORDERING_FUNCTIONS.menuVersion: {
				checkStore(args.p_store_code);
				const full = menu(null);
				return {
					menu_version: full.menu_version,
					ordering: full.ordering,
					unavailable_items: full.unavailable_items,
				};
			}
			case ORDERING_FUNCTIONS.table: {
				checkStore(args.p_store_code);
				const found = tableOf(args.p_table_token);
				return found.state === "ok"
					? {
							state: "ok",
							table: { label: found.table.label, area: found.table.area },
						}
					: found;
			}
			case ORDERING_FUNCTIONS.callStaff: {
				checkStore(args.p_store_code);
				const found = tableOf(args.p_table_token);
				if (found.state !== "ok") return found;
				const open = calls.get(found.table.label);
				if (open !== undefined)
					return { state: "calling", called_at: open, replayed: true };
				const at = iso();
				calls.set(found.table.label, at);
				return { state: "calling", called_at: at, replayed: false };
			}
			case ORDERING_FUNCTIONS.checkCart:
				return checkCart(args);
			case ORDERING_FUNCTIONS.takeawaySlots:
				checkStore(args.p_store_code);
				return takeawaySlots();
			case ORDERING_FUNCTIONS.changePickup:
				return changePickup(args);
			case ORDERING_FUNCTIONS.placeOrder:
				return place(args);
			case ORDERING_FUNCTIONS.order: {
				const order = mine(args.p_order);
				return order === null
					? { state: "refused", refusal: "unknown_order", order: null }
					: { state: "ok", refusal: null, order: orderJson(order, true) };
			}
			case ORDERING_FUNCTIONS.orders:
				return {
					orders: orders
						.filter((order) => order.owner === "me")
						.reverse()
						// newest first as the server sorts them (an earlier order the till adds goes below)
						.sort((a, b) => Date.parse(b.placedAt) - Date.parse(a.placedAt))
						.map((order) => ({
							id: order.id,
							display_no: displayNo(order.orderNo),
							store_name: order.storeName ?? DEMO_STORE_NAME,
							type: order.type,
							table_label: order.tableLabel,
							status: order.status,
							payment_status: order.paymentStatus,
							total: order.total,
							placed_at: order.placedAt,
							items: order.lines.reduce((sum, line) => sum + line.quantity, 0),
							ready_estimate_at: readyEstimate(order),
							pickup_at: order.pickupAt ?? null,
						})),
					next_before: null,
				};
			case ORDERING_FUNCTIONS.cancelOrder: {
				const order = mine(args.p_order);
				if (order === null)
					return { state: "refused", refusal: "unknown_order", order: null };
				if (order.status === "cancelled")
					return {
						state: "cancelled",
						refusal: null,
						replayed: true,
						order: orderJson(order, false),
					};
				if (
					!(
						order.status === "awaiting_payment" ||
						(order.status === "accepted" && order.paymentStatus === "unpaid")
					)
				)
					return {
						state: "refused",
						refusal:
							order.status === "accepted" ? "contact_store" : "not_allowed",
						order: orderJson(order, false),
					};
				order.cancelledAt = move(order, "cancelled", "cancel");
				order.cancelReason = "customer_cancelled";
				order.paymentDueAt = null;
				failPending(order);
				return {
					state: "cancelled",
					refusal: null,
					replayed: false,
					order: orderJson(order, false),
				};
			}
			case ORDERING_FUNCTIONS.stampCard:
				return {
					enabled: true,
					stamps,
					stamps_per_reward: STAMPS_PER_REWARD,
					reward_name: REWARD_NAME,
					total_earned: totalEarned,
					rewards,
					history: history.slice(0, 20),
					attached,
				};
			case ACCOUNT_FUNCTIONS.stampCode:
				return stampCode();
			case ACCOUNT_FUNCTIONS.deleteAccount:
				return deleteAccount(args);
			case ACCOUNT_FUNCTIONS.exportData:
				return exportData();
			case ACCOUNT_FUNCTIONS.requests:
				return { requests: [...requests].reverse() };
			case ACCOUNT_FUNCTIONS.cancelRequest:
				return cancelRequest(args.p_request);
			case ACCOUNT_FUNCTIONS.acceptProposal:
				return acceptProposal(args.p_request, args.p_request_id);
			default:
				return invoices.answer(fn, args);
		}
	};

	// the stand-in of the Edge Function checkout-order: the server's answers and refusals, in the server's order
	const startRefused = (refusal: string) => ({
		status: 200,
		body: { state: "refused", refusal, replayed: false, payment: null },
	});

	const attemptJson = (order: DemoOrder, payment: DemoPayment) => {
		const wallet = payment.method === "zalo_checkout";
		const reference = payment.reference ?? "";
		const extradata = JSON.stringify({
			o: order.id,
			s: DEMO_ORDERING_STORE,
			v: 1,
		});
		const item = order.lines.map((line) => ({
			id: line.item_id,
			amount: line.line_total,
		}));
		const desc = "Cửa hàng Mẫu 1 - Đơn trực tuyến";
		const signed = canonical({ amount: payment.amount, desc, extradata, item });
		return {
			id: payment.id,
			order_id: order.id,
			method: payment.method,
			amount: payment.amount,
			reference,
			expires_at: payment.expiresAt,
			mode: "sandbox",
			checkout: wallet
				? {
						amount: payment.amount,
						desc,
						item,
						extradata,
						method: null,
						mac: [0, 1, 2, 3, 4, 5, 6, 7]
							.map((seed) => fnv(signed, seed))
							.join(""),
					}
				: null,
			qr: wallet
				? null
				: {
						payload: vietQrPayload({
							bankBin: DEMO_BANK.bin,
							accountNumber: DEMO_BANK.accountNumber,
							amount: payment.amount,
							reference,
						}),
						bank_bin: DEMO_BANK.bin,
						bank_name: DEMO_BANK.name,
						account_number: DEMO_BANK.accountNumber,
						account_name: DEMO_BANK.accountName,
						amount: payment.amount,
						reference,
						popup_method: "BANK_SANDBOX",
					},
		};
	};

	const pendingAnswer = (
		order: DemoOrder,
		payment: DemoPayment,
		replayed: boolean,
	) => ({
		status: 200,
		body: {
			state: "pending",
			refusal: null,
			replayed,
			payment: attemptJson(order, payment),
		},
	});

	const invalid = () => ({
		status: 400,
		body: { error: "invalid_request", request_id: "demo" },
	});

	const startPayment = (body: Readonly<Record<string, unknown>>) => {
		const allowed = ["action", "order_id", "method", "idempotency_key", "for"];
		if (Object.keys(body).some((key) => !allowed.includes(key)))
			return invalid();
		const method = String(body.method);
		const key = body.idempotency_key;
		if (
			typeof body.order_id !== "string" ||
			!UUID.test(body.order_id) ||
			!isOnlineMethod(method) ||
			typeof key !== "string" ||
			!IDEMPOTENCY_KEY_PATTERN.test(key) ||
			(body.for !== undefined && body.for !== "counter")
		)
			return invalid();
		const order = mine(body.order_id);
		if (order === null) return startRefused("unknown_order");
		// the customer's session never starts the counter's attempt
		if (body.for === "counter") return startRefused("not_payable");
		if (!onlinePayments) return startRefused("provider_off");
		if (order.status === "cancelled") return startRefused("order_cancelled");
		if (order.paymentStatus !== "unpaid") return startRefused("already_paid");
		if (order.status !== "awaiting_payment")
			return startRefused("not_awaiting_payment");
		if (order.paymentMethod !== method) return startRefused("method_differs");
		const attempts = paymentsOf(order);
		const replay = attempts.find((payment) => payment.keys.includes(key));
		if (replay !== undefined) return pendingAnswer(order, replay, true);
		const pending = attempts.find((payment) => payment.status === "pending");
		if (pending !== undefined) {
			pending.keys.push(key);
			return pendingAnswer(order, pending, false);
		}
		if (
			attempts.filter((payment) => payment.status === "failed").length >=
			MAX_FAILED_ATTEMPTS
		)
			return startRefused("too_many_attempts");
		order.version += 1;
		return pendingAnswer(
			order,
			newPayment(order, method, "pending", key),
			false,
		);
	};

	const linkPayment = (body: Readonly<Record<string, unknown>>) => {
		const allowed = ["action", "order_id", "payment_id", "platform_order_id"];
		if (Object.keys(body).some((key) => !allowed.includes(key)))
			return invalid();
		if (
			typeof body.order_id !== "string" ||
			!UUID.test(body.order_id) ||
			typeof body.payment_id !== "string" ||
			!UUID.test(body.payment_id) ||
			typeof body.platform_order_id !== "string" ||
			!PLATFORM_ORDER_ID_PATTERN.test(body.platform_order_id)
		)
			return invalid();
		const order = mine(body.order_id);
		const payment =
			order === null
				? undefined
				: paymentsOf(order).find((entry) => entry.id === body.payment_id);
		if (payment === undefined || payment.method === "cash")
			return {
				status: 200,
				body: { state: "refused", refusal: "unknown_payment" },
			};
		if (payment.status !== "pending")
			return {
				status: 200,
				body: { state: "refused", refusal: "not_pending" },
			};
		payment.platformOrderId = body.platform_order_id;
		return { status: 200, body: { state: "linked", refusal: null } };
	};

	const call = (name: string, body: unknown) => {
		if (name !== CHECKOUT_ORDER_FUNCTION) return undefined;
		if (typeof body !== "object" || body === null || Array.isArray(body))
			return invalid();
		const row = body as Readonly<Record<string, unknown>>;
		if (row.action === "start") return startPayment(row);
		if (row.action === "link") return linkPayment(row);
		return invalid();
	};

	return {
		answer,
		call,
		till,
		changingFunctions: [
			ORDERING_FUNCTIONS.placeOrder,
			ORDERING_FUNCTIONS.changePickup,
			ORDERING_FUNCTIONS.cancelOrder,
			ORDERING_FUNCTIONS.callStaff,
			ACCOUNT_FUNCTIONS.stampCode,
			ACCOUNT_FUNCTIONS.deleteAccount,
			ACCOUNT_FUNCTIONS.cancelRequest,
			ACCOUNT_FUNCTIONS.acceptProposal,
			...invoices.changingFunctions,
		],
	};
}
