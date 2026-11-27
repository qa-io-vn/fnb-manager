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
import {
	DEMO_BANK,
	DEMO_CATEGORY_NAMES,
	DEMO_FOREIGN_ORDER_ID,
	DEMO_OPTION_GROUPS,
	DEMO_ORDERING_STORE,
	DEMO_PAYMENT_WINDOW_MS,
	DEMO_ROTATED_TABLE_TOKEN,
	DEMO_TABLES,
	type DemoItem,
	demoMenuItems,
} from "./ordering-fixtures";
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

export type DemoTillAction = "pay" | "start" | "done" | "complete" | "cancel";

/** What the stand-in bank did with a transfer: matched and paid, held for a manager (another amount), or unknown. */
export type DemoTransferOutcome = "paid" | "held" | "unknown";

/** The counter's side of the demo, for tests: what staff do at the till, and the gateway and the bank. */
export interface DemoTill {
	/** switch an item sold out (true) or back on sale; moves the menu version */
	soldOut(itemId: string, on: boolean): void;
	/** change a size's price; moves the menu version */
	setPrice(sizeId: string, price: number): void;
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
	/** the store proposes another time (30 minutes later) for a request (the latest when no id is given) */
	proposeRequest(requestId?: string): string;
	/** the counter attaches a counter order with this many drinks to the customer's card (C20 frame 5) */
	attachToCard(stamps: number): void;
	/** how many member codes the customer was issued */
	stampCodes(): number;
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
): OrderingWorld {
	const items = demoMenuItems();
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

	const orderingState = (type: string | null) => {
		const accepting = reason === null;
		const opensAt =
			reason === "closed_now" ||
			reason === "closed_today" ||
			reason === "last_orders_passed"
				? new Date(
						`${isoDateIn(now() + 24 * 3_600_000)}T07:00:00+07:00`,
					).toISOString()
				: null;
		return {
			accepting: accepting && (type === null || type === "table"),
			reason: !accepting
				? reason
				: type !== null && type !== "table"
					? "ordering_off"
					: null,
			till_mode: "native",
			order_types: ["table"],
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
						order_types: ["table"],
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
				name: "Cửa hàng Mẫu 1",
				address: "12 Đường Số 1, Phường Mẫu, Thành phố Mẫu",
				opening_hours: {
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
			option_groups: DEMO_OPTION_GROUPS.filter((group) =>
				usedGroups.has(group.id),
			),
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
				for (const group of DEMO_OPTION_GROUPS) {
					const option = group.options.find((entry) => entry.id === id);
					if (option !== undefined && found.item.groups.includes(group.id))
						return { group, option };
				}
				return null;
			});
			const badCount = found.item.groups.some((groupId) => {
				const group = DEMO_OPTION_GROUPS.find((entry) => entry.id === groupId);
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
		return from === null
			? null
			: new Date(Date.parse(from) + DEMO_PREP_MS).toISOString();
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
		pickup_at: null,
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
						refunded: 0,
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
						refunds: [],
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
		if (!state.accepting)
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
		if (!methods.includes(payment) || request.type === "takeaway")
			return refused("payment_not_allowed");
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
			type: "table",
			tableLabel: table?.label ?? null,
			paymentMethod: payment as DemoOrder["paymentMethod"],
			status: online ? "awaiting_payment" : "accepted",
			paymentStatus: "unpaid",
			version: 1,
			subtotal: priced.subtotal,
			total: priced.subtotal,
			note: noteOf(request.note),
			placedAt: at,
			paymentDueAt: online
				? new Date(now() + DEMO_PAYMENT_WINDOW_MS).toISOString()
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

	const till: DemoTill = {
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
				version: 1,
				contact_name: "Khách Mẫu",
			});
			return id;
		},
		proposeRequest(requestId) {
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
				"Giờ đó đã kín bàn, quán còn chỗ muộn hơn 30 phút.";
			request.version += 1;
			return request.status;
		},
		attachToCard(count) {
			numbers += 1;
			attached.unshift({
				order_no: displayNo(numbers) ?? "",
				store_name: "Cửa hàng Mẫu 1",
				status: "accepted",
				attached_at: iso(),
				stamps: count,
			});
		},
		stampCodes() {
			return stampCodesIssued;
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
			}
			return order.status;
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
				store_name: "Cửa hàng Mẫu 1",
			})),
			attached_orders: attached,
			requests: requests.map((request) => ({
				...request,
				contact_phone: "0900000000",
			})),
			staff_calls: [],
			order_blocks: [],
			deletion_request: null,
			not_kept: ["location", "contacts", "zalo_messages", "card_numbers"],
			counts: {
				orders: mineNow.length,
				attached_orders: attached.length,
				requests: requests.length,
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
						.map((order) => ({
							id: order.id,
							display_no: displayNo(order.orderNo),
							store_name: "Cửa hàng Mẫu 1",
							type: order.type,
							table_label: order.tableLabel,
							status: order.status,
							payment_status: order.paymentStatus,
							total: order.total,
							placed_at: order.placedAt,
							items: order.lines.reduce((sum, line) => sum + line.quantity, 0),
							ready_estimate_at: readyEstimate(order),
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
			default:
				return undefined;
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
			ORDERING_FUNCTIONS.cancelOrder,
			ORDERING_FUNCTIONS.callStaff,
			ACCOUNT_FUNCTIONS.stampCode,
			ACCOUNT_FUNCTIONS.deleteAccount,
			ACCOUNT_FUNCTIONS.cancelRequest,
		],
	};
}
