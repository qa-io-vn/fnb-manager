// The wire contract of the native till's customer functions (ADR-060 to ADR-065, docs/api.md 3.27): the function
// names, the limits the database enforces, the argument builders and a reader per answer that refuses anything
// malformed. Snake case is the wire; the readers return camel case. Prices are whole đồng; nothing here prices an
// order: the server does, and the app only shows what it answered.

import { type OpeningHours, readOpeningHours } from "../loyalty/contract";

export const ORDERING_FUNCTIONS = {
	menu: "customer_menu",
	menuVersion: "customer_menu_version",
	table: "customer_table",
	callStaff: "customer_call_staff",
	checkCart: "customer_check_cart",
	placeOrder: "customer_place_order",
	order: "customer_order",
	orders: "customer_orders",
	cancelOrder: "customer_cancel_order",
	stampCard: "customer_stamp_card",
} as const;

export type OrderingFunction =
	(typeof ORDERING_FUNCTIONS)[keyof typeof ORDERING_FUNCTIONS];

/** The limits of app.order_lines_valid and app.order_request_shape: a request outside them is refused with 22023. */
export const MAX_LINE_QUANTITY = 20;
export const MIN_LINE_QUANTITY = 1;
export const MAX_CART_LINES = 30;
export const MAX_LINE_OPTIONS = 10;
export const LINE_NOTE_MAX = 100;
export const ORDER_NOTE_MAX = 200;
/** How often the app asks customer_menu_version while the menu or the basket is open (a sold-out item goes in 5 s). */
export const MENU_POLL_MS = 3000;
/** How often the order screen asks customer_order while it is open and the order is not finished. */
export const ORDER_POLL_MS = 3000;
export const TABLE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ORDER_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ORDER_TYPES = ["table", "takeaway"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const PAYMENT_METHODS = ["counter", "zalo_checkout", "vietqr"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

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

export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = [
	"awaiting_payment",
	"accepted",
	"preparing",
	"ready",
	"serving",
];

export const PAYMENT_STATUSES = [
	"unpaid",
	"paid",
	"refund_pending",
	"refunded",
	"partially_refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** The reasons app.ordering_state gives, first one that holds; another snake-case reason is read as it is. */
export const ORDERING_REASONS = [
	"ordering_off",
	"hours_unknown",
	"closed_today",
	"paused",
	"closed_now",
	"last_orders_passed",
	"no_staff_online",
	"busy",
] as const;
export type OrderingReason = (typeof ORDERING_REASONS)[number];

/** The refusals of customer_place_order that the app words (besides the ordering reasons above). */
export const PLACE_REFUSALS = [
	"request_conflict",
	"blocked",
	"rate_limited",
	"too_many_open_orders",
	"table_unknown",
	"table_not_for_takeaway",
	"pickup_time_invalid",
	"payment_not_allowed",
	"item_unavailable",
	"option_invalid",
	"no_reward",
	"reward_not_applicable",
	"amount_over_limit",
	"price_changed",
] as const;
export type PlaceRefusal = (typeof PLACE_REFUSALS)[number];

export interface OrderingState {
	readonly accepting: boolean;
	readonly reason: string | null;
	readonly tillMode: string;
	readonly orderTypes: readonly OrderType[];
	readonly paymentMethods: readonly PaymentMethod[];
	readonly opensAt: string | null;
	readonly closesAt: string | null;
	readonly lastOrderAt: string | null;
	readonly pausedUntil: string | null;
	readonly closureReason: string | null;
	readonly closureEndsOn: string | null;
}

export interface MenuSize {
	readonly id: string;
	/** null for an item sold in one size */
	readonly label: string | null;
	readonly price: number;
	readonly isDefault: boolean;
}

export interface MenuItem {
	readonly id: string;
	readonly categoryId: string;
	readonly name: string;
	readonly description: string | null;
	readonly photoPath: string | null;
	readonly labels: readonly string[];
	readonly orderTypes: readonly OrderType[];
	readonly countsForStamps: boolean;
	readonly sizes: readonly MenuSize[];
	readonly optionGroupIds: readonly string[];
}

export interface MenuCategory {
	readonly id: string;
	readonly name: string;
	readonly items: readonly MenuItem[];
}

export interface MenuOption {
	readonly id: string;
	readonly name: string;
	readonly priceDelta: number;
	readonly isDefault: boolean;
}

export interface OptionGroup {
	readonly id: string;
	readonly name: string;
	readonly minSelect: number;
	readonly maxSelect: number;
	readonly options: readonly MenuOption[];
}

export interface MenuStore {
	readonly code: string;
	readonly name: string;
	readonly address: string | null;
	readonly openingHours: OpeningHours;
}

export interface Menu {
	readonly store: MenuStore;
	readonly orderType: OrderType | null;
	readonly ordering: OrderingState;
	readonly menuVersion: number;
	readonly categories: readonly MenuCategory[];
	readonly optionGroups: readonly OptionGroup[];
	readonly unavailableItems: readonly string[];
}

export interface MenuVersion {
	readonly menuVersion: number;
	readonly ordering: OrderingState;
	readonly unavailableItems: readonly string[];
}

export type TableAnswer =
	| {
			readonly state: "ok";
			readonly label: string;
			readonly area: string | null;
	  }
	| {
			readonly state: "refused";
			readonly refusal: string;
			readonly retryAt: string | null;
	  };

export type CallAnswer =
	| {
			readonly state: "calling";
			readonly calledAt: string;
			readonly replayed: boolean;
	  }
	| {
			readonly state: "refused";
			readonly refusal: string;
			readonly retryAt: string | null;
	  };

export interface ChosenOption {
	readonly groupId: string;
	readonly group: string;
	readonly optionId: string;
	readonly name: string;
	readonly price: number;
}

export interface PricedLine {
	readonly lineNo: number;
	readonly itemId: string | null;
	readonly sizeId: string | null;
	readonly itemName: string;
	readonly sizeLabel: string | null;
	readonly quantity: number;
	readonly unitPrice: number;
	readonly options: readonly ChosenOption[];
	readonly optionsAmount: number;
	readonly lineTotal: number;
	readonly countsForStamps: boolean;
	readonly note: string | null;
}

export interface CartCheck {
	readonly state: "ok" | "refused";
	readonly refusal: string | null;
	readonly unavailableItems: readonly string[];
	readonly badLines: readonly number[];
	readonly lines: readonly PricedLine[];
	readonly subtotal: number | null;
	readonly discountAmount: number;
	readonly total: number | null;
	readonly reward: string | null;
	readonly menuVersion: number;
	readonly ordering: OrderingState;
}

export interface TimelineEvent {
	readonly kind: "status" | "payment";
	readonly action: string;
	readonly from: string | null;
	readonly to: string | null;
	readonly at: string;
	readonly reasonCode: string | null;
	readonly amount: number | null;
}

export interface OrderPayment {
	readonly method: string;
	readonly amount: number;
	readonly status: string;
	readonly settledAt: string | null;
}

export interface OrderRefund {
	readonly method: string;
	readonly amount: number;
	readonly status: string;
	readonly requestedAt: string | null;
	readonly settledAt: string | null;
}

export interface OrderMoney {
	readonly paid: number;
	readonly refunded: number;
	readonly refundOpen: number;
	readonly payments: readonly OrderPayment[];
	readonly refunds: readonly OrderRefund[];
}

export interface Order {
	readonly id: string;
	readonly orderNo: number | null;
	/** "#007", or null before the order has a number (an unpaid online attempt) */
	readonly displayNo: string | null;
	readonly businessDate: string;
	readonly source: string;
	readonly type: OrderType;
	readonly tableLabel: string | null;
	readonly pickupAt: string | null;
	readonly status: OrderStatus;
	readonly paymentStatus: PaymentStatus;
	readonly paymentMethod: PaymentMethod;
	readonly version: number;
	readonly subtotal: number;
	readonly discountAmount: number;
	readonly total: number;
	readonly note: string | null;
	readonly placedAt: string;
	readonly paymentDueAt: string | null;
	readonly acceptedAt: string | null;
	readonly preparingAt: string | null;
	readonly doneAt: string | null;
	readonly completedAt: string | null;
	readonly paidAt: string | null;
	readonly cancelledAt: string | null;
	readonly cancelReason: string | null;
	readonly lines: readonly PricedLine[];
	readonly timeline: readonly TimelineEvent[];
	readonly money: OrderMoney | null;
	/**
	 * When the order should be ready, if the server says so (it does not yet: native-till.md keeps prep_minutes on the
	 * store's settings only); the order screen shows an estimate only with it.
	 */
	readonly readyEstimateAt: string | null;
}

export type OrderAnswer =
	| { readonly state: "ok"; readonly order: Order }
	| { readonly state: "refused"; readonly refusal: string };

export interface PlaceRequest {
	readonly request_id: string;
	readonly store: string;
	readonly type: OrderType;
	readonly table_token?: string;
	readonly lines: readonly {
		readonly size: string;
		readonly qty: number;
		readonly options?: readonly string[];
		readonly note?: string;
	}[];
	readonly note?: string;
	readonly payment: PaymentMethod;
	readonly expected_total: number;
	readonly menu_version?: number;
	readonly use_reward?: boolean;
}

export type CheckRequest = Omit<
	PlaceRequest,
	"request_id" | "payment" | "expected_total"
> & {
	readonly payment?: PaymentMethod;
};

export interface PlaceAnswer {
	readonly state: "placed" | "awaiting_payment" | "cancelled" | "refused";
	readonly refusal: string | null;
	readonly replayed: boolean;
	readonly order: Order | null;
	/** with a refusal from the ordering state */
	readonly ordering: OrderingState | null;
	readonly retryAt: string | null;
	readonly unavailableItems: readonly string[];
	/** option_invalid: the line numbers (from 1) whose options the server refused */
	readonly badLines: readonly number[];
	/** price_changed and amount_over_limit: the total the server would charge */
	readonly total: number | null;
	readonly discountAmount: number | null;
	readonly maxOrderAmount: number | null;
	readonly menuVersion: number | null;
}

export type CancelAnswer =
	| {
			readonly state: "cancelled";
			readonly replayed: boolean;
			readonly order: Order;
	  }
	| {
			readonly state: "refused";
			readonly refusal: string;
			readonly order: Order | null;
	  };

export interface OrderSummary {
	readonly id: string;
	readonly displayNo: string | null;
	readonly storeName: string;
	readonly type: OrderType;
	readonly tableLabel: string | null;
	readonly status: OrderStatus;
	readonly paymentStatus: PaymentStatus;
	readonly total: number;
	readonly placedAt: string;
	readonly items: number;
}

export interface OrderList {
	readonly orders: readonly OrderSummary[];
	readonly nextBefore: string | null;
}

export interface StampEntry {
	readonly kind: string;
	readonly delta: number;
	readonly balanceAfter: number;
	readonly at: string;
	readonly orderNo: string | null;
}

export interface StampReward {
	readonly id: string;
	readonly issuedAt: string;
}

export interface NativeStampCard {
	readonly enabled: boolean;
	readonly stamps: number;
	readonly stampsPerReward: number;
	readonly rewardName: string;
	readonly totalEarned: number;
	readonly rewards: readonly StampReward[];
	readonly history: readonly StampEntry[];
}

export interface OrderingClient {
	menu(store: string, type: OrderType | null): Promise<Menu>;
	menuVersion(store: string): Promise<MenuVersion>;
	table(store: string, token: string): Promise<TableAnswer>;
	callStaff(store: string, token: string): Promise<CallAnswer>;
	checkCart(request: CheckRequest): Promise<CartCheck>;
	placeOrder(request: PlaceRequest): Promise<PlaceAnswer>;
	order(id: string): Promise<OrderAnswer>;
	orders(before: string | null): Promise<OrderList>;
	cancelOrder(id: string): Promise<CancelAnswer>;
	stampCard(): Promise<NativeStampCard>;
}

type Row = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Row {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(what: string): never {
	throw new Error(`the ordering answer has no valid ${what}`);
}

function record(value: unknown, what: string): Row {
	return isRecord(value) ? value : invalid(what);
}

function list(value: unknown, what: string): readonly unknown[] {
	return Array.isArray(value) ? value : invalid(what);
}

function optionalList(value: unknown, what: string): readonly unknown[] {
	return value === null || value === undefined ? [] : list(value, what);
}

function text(value: unknown, what: string): string {
	return typeof value === "string" && value.trim() !== ""
		? value
		: invalid(what);
}

function optionalText(value: unknown, what: string): string | null {
	if (value === null || value === undefined) return null;
	return typeof value === "string" ? value.trim() || null : invalid(what);
}

function id(value: unknown, what: string): string {
	return typeof value === "string" && ORDER_ID_PATTERN.test(value)
		? value
		: invalid(what);
}

function optionalId(value: unknown, what: string): string | null {
	return value === null || value === undefined ? null : id(value, what);
}

function amount(value: unknown, what: string): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: invalid(what);
}

function optionalAmount(value: unknown, what: string): number | null {
	return value === null || value === undefined ? null : amount(value, what);
}

function signed(value: unknown, what: string): number {
	return typeof value === "number" && Number.isSafeInteger(value)
		? value
		: invalid(what);
}

function optionalSigned(value: unknown, what: string): number | null {
	return value === null || value === undefined ? null : signed(value, what);
}

function flag(value: unknown, what: string): boolean {
	return typeof value === "boolean" ? value : invalid(what);
}

function instant(value: unknown, what: string): string {
	return typeof value === "string" && !Number.isNaN(Date.parse(value))
		? value
		: invalid(what);
}

function optionalInstant(value: unknown, what: string): string | null {
	return value === null || value === undefined ? null : instant(value, what);
}

function oneOf<T extends string>(
	allowed: readonly T[],
	value: unknown,
	what: string,
): T {
	return allowed.find((candidate) => candidate === value) ?? invalid(what);
}

const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function optionalCode(value: unknown, what: string): string | null {
	if (value === null || value === undefined) return null;
	return typeof value === "string" && CODE_PATTERN.test(value)
		? value
		: invalid(what);
}

function code(value: unknown, what: string): string {
	return optionalCode(value, what) ?? invalid(what);
}

function knownList<T extends string>(
	allowed: readonly T[],
	value: unknown,
	what: string,
): readonly T[] {
	return optionalList(value, what).flatMap((entry) => {
		const found = allowed.find((candidate) => candidate === entry);
		return found === undefined ? [] : [found];
	});
}

function ids(value: unknown, what: string): readonly string[] {
	return optionalList(value, what).map((entry) => id(entry, what));
}

export function readOrderingState(value: unknown): OrderingState {
	const row = record(value, "ordering state");
	return {
		accepting: flag(row.accepting, "accepting"),
		reason: optionalCode(row.reason, "ordering reason"),
		tillMode: typeof row.till_mode === "string" ? row.till_mode : "ipos",
		orderTypes: knownList(ORDER_TYPES, row.order_types, "order types"),
		paymentMethods: knownList(
			PAYMENT_METHODS,
			row.payment_methods,
			"payment methods",
		),
		opensAt: optionalInstant(row.opens_at, "opens_at"),
		closesAt: optionalInstant(row.closes_at, "closes_at"),
		lastOrderAt: optionalInstant(row.last_order_at, "last_order_at"),
		pausedUntil: optionalInstant(row.paused_until, "paused_until"),
		closureReason: optionalText(row.closure_reason, "closure_reason"),
		closureEndsOn: optionalText(row.closure_ends_on, "closure_ends_on"),
	};
}

function readSize(value: unknown): MenuSize {
	const row = record(value, "size");
	return {
		id: id(row.id, "size id"),
		label: optionalText(row.label, "size label"),
		price: amount(row.price, "size price"),
		isDefault: row.is_default === true,
	};
}

function readItem(value: unknown, categoryId: string): MenuItem {
	const row = record(value, "item");
	const sizes = list(row.sizes, "item sizes").map(readSize);
	if (sizes.length === 0) invalid("item sizes");
	return {
		id: id(row.id, "item id"),
		categoryId,
		name: text(row.name, "item name"),
		description: optionalText(row.description, "item description"),
		photoPath: optionalText(row.photo_path, "item photo"),
		labels: optionalList(row.labels, "item labels").filter(
			(label): label is string => typeof label === "string",
		),
		orderTypes: knownList(ORDER_TYPES, row.order_types, "item order types"),
		countsForStamps: row.counts_for_stamps === true,
		sizes,
		optionGroupIds: ids(row.option_group_ids, "item option groups"),
	};
}

function readCategory(value: unknown): MenuCategory {
	const row = record(value, "category");
	const categoryId = id(row.id, "category id");
	return {
		id: categoryId,
		name: text(row.name, "category name"),
		items: list(row.items, "category items").map((item) =>
			readItem(item, categoryId),
		),
	};
}

function readOption(value: unknown): MenuOption {
	const row = record(value, "option");
	return {
		id: id(row.id, "option id"),
		name: text(row.name, "option name"),
		priceDelta: amount(row.price_delta, "option price"),
		isDefault: row.is_default === true,
	};
}

function readOptionGroup(value: unknown): OptionGroup {
	const row = record(value, "option group");
	const minSelect = amount(row.min_select, "option group minimum");
	const maxSelect = amount(row.max_select, "option group maximum");
	if (maxSelect < 1 || maxSelect < minSelect) invalid("option group limits");
	return {
		id: id(row.id, "option group id"),
		name: text(row.name, "option group name"),
		minSelect,
		maxSelect,
		options: list(row.options, "options").map(readOption),
	};
}

function menuVersionOf(value: unknown): number {
	return amount(value, "menu version");
}

export function readMenu(value: unknown): Menu {
	const row = record(value, "menu");
	const store = record(row.store, "store");
	return {
		store: {
			code: text(store.code, "store code"),
			name: text(store.name, "store name"),
			address: optionalText(store.address, "store address"),
			openingHours: readOpeningHours(store.opening_hours),
		},
		orderType:
			row.order_type === null || row.order_type === undefined
				? null
				: oneOf(ORDER_TYPES, row.order_type, "order type"),
		ordering: readOrderingState(row.ordering),
		menuVersion: menuVersionOf(row.menu_version),
		categories: list(row.categories, "categories").map(readCategory),
		optionGroups: optionalList(row.option_groups, "option groups").map(
			readOptionGroup,
		),
		unavailableItems: ids(row.unavailable_items, "unavailable items"),
	};
}

export function readMenuVersion(value: unknown): MenuVersion {
	const row = record(value, "menu version");
	return {
		menuVersion: menuVersionOf(row.menu_version),
		ordering: readOrderingState(row.ordering),
		unavailableItems: ids(row.unavailable_items, "unavailable items"),
	};
}

function refusedWith(row: Row): {
	readonly state: "refused";
	readonly refusal: string;
	readonly retryAt: string | null;
} {
	return {
		state: "refused",
		refusal: code(row.refusal, "refusal"),
		retryAt: optionalInstant(row.retry_at, "retry_at"),
	};
}

export function readTableAnswer(value: unknown): TableAnswer {
	const row = record(value, "table answer");
	if (row.state === "refused") return refusedWith(row);
	if (row.state !== "ok") invalid("table state");
	const table = record(row.table, "table");
	return {
		state: "ok",
		label: text(table.label, "table label"),
		area: optionalText(table.area, "table area"),
	};
}

export function readCallAnswer(value: unknown): CallAnswer {
	const row = record(value, "call answer");
	if (row.state === "refused") return refusedWith(row);
	if (row.state !== "calling") invalid("call state");
	return {
		state: "calling",
		calledAt: instant(row.called_at, "called_at"),
		replayed: row.replayed === true,
	};
}

function readChosenOption(value: unknown): ChosenOption {
	const row = record(value, "chosen option");
	return {
		groupId: id(row.group_id, "chosen option group"),
		group: text(row.group, "chosen option group name"),
		optionId: id(row.option_id, "chosen option id"),
		name: text(row.name, "chosen option name"),
		price: amount(row.price, "chosen option price"),
	};
}

export function readPricedLine(value: unknown): PricedLine {
	const row = record(value, "line");
	return {
		lineNo: amount(row.line_no, "line number"),
		itemId: optionalId(row.item_id, "line item"),
		sizeId: optionalId(row.size_id, "line size"),
		itemName: text(row.item_name, "line item name"),
		sizeLabel: optionalText(row.size_label, "line size label"),
		quantity: amount(row.quantity, "line quantity"),
		unitPrice: amount(row.unit_price, "line unit price"),
		options: optionalList(row.options, "line options").map(readChosenOption),
		optionsAmount: amount(row.options_amount ?? 0, "line options amount"),
		lineTotal: amount(row.line_total, "line total"),
		countsForStamps: row.counts_for_stamps === true,
		// the note comes back as the customer typed it: the screens write it as text, never as markup
		note: typeof row.note === "string" && row.note !== "" ? row.note : null,
	};
}

function badLinesOf(value: unknown): readonly number[] {
	return optionalList(value, "bad lines").filter(
		(entry): entry is number =>
			typeof entry === "number" && Number.isInteger(entry) && entry >= 1,
	);
}

export function readCartCheck(value: unknown): CartCheck {
	const row = record(value, "cart check");
	return {
		state: oneOf(["ok", "refused"] as const, row.state, "cart check state"),
		refusal: optionalCode(row.refusal, "cart check refusal"),
		unavailableItems: ids(row.unavailable_items, "unavailable items"),
		badLines: badLinesOf(row.bad_lines),
		lines: optionalList(row.lines, "lines").map(readPricedLine),
		subtotal: optionalAmount(row.subtotal, "subtotal"),
		discountAmount: amount(row.discount_amount ?? 0, "discount"),
		total: optionalAmount(row.total, "total"),
		reward: optionalCode(row.reward, "reward"),
		menuVersion: menuVersionOf(row.menu_version),
		ordering: readOrderingState(row.ordering),
	};
}

function readTimelineEvent(value: unknown): TimelineEvent {
	const row = record(value, "timeline event");
	return {
		kind: oneOf(["status", "payment"] as const, row.kind, "event kind"),
		action: code(row.action, "event action"),
		from: optionalCode(row.from, "event from"),
		to: optionalCode(row.to, "event to"),
		at: instant(row.at, "event time"),
		reasonCode: optionalCode(row.reason_code, "event reason"),
		amount: optionalSigned(row.amount, "event amount"),
	};
}

function readMoney(value: unknown): OrderMoney | null {
	if (value === null || value === undefined) return null;
	const row = record(value, "money");
	return {
		paid: amount(row.paid ?? 0, "paid"),
		refunded: amount(row.refunded ?? 0, "refunded"),
		refundOpen: amount(row.refund_open ?? 0, "refund open"),
		payments: optionalList(row.payments, "payments").map((entry) => {
			const payment = record(entry, "payment");
			return {
				method: text(payment.method, "payment method"),
				amount: amount(payment.amount, "payment amount"),
				status: text(payment.status, "payment status"),
				settledAt: optionalInstant(payment.settled_at, "payment settled"),
			};
		}),
		refunds: optionalList(row.refunds, "refunds").map((entry) => {
			const refund = record(entry, "refund");
			return {
				method: text(refund.method, "refund method"),
				amount: amount(refund.amount, "refund amount"),
				status: text(refund.status, "refund status"),
				requestedAt: optionalInstant(refund.requested_at, "refund requested"),
				settledAt: optionalInstant(refund.settled_at, "refund settled"),
			};
		}),
	};
}

export function readOrder(value: unknown): Order {
	const row = record(value, "order");
	const table =
		row.table === null || row.table === undefined ? null : row.table;
	return {
		id: id(row.id, "order id"),
		orderNo: optionalAmount(row.order_no, "order number"),
		displayNo: optionalText(row.display_no, "order display number"),
		businessDate: text(row.business_date, "business date"),
		source: text(row.source, "order source"),
		type: oneOf(ORDER_TYPES, row.type, "order type"),
		tableLabel:
			table === null
				? null
				: optionalText(record(table, "order table").label, "table label"),
		pickupAt: optionalInstant(row.pickup_at, "pickup time"),
		status: oneOf(ORDER_STATUSES, row.status, "order status"),
		paymentStatus: oneOf(
			PAYMENT_STATUSES,
			row.payment_status,
			"payment status",
		),
		paymentMethod: oneOf(PAYMENT_METHODS, row.payment_method, "payment method"),
		version: amount(row.version, "order version"),
		subtotal: amount(row.subtotal, "subtotal"),
		discountAmount: amount(row.discount_amount ?? 0, "discount"),
		total: amount(row.total, "total"),
		note: typeof row.note === "string" && row.note !== "" ? row.note : null,
		placedAt: instant(row.placed_at, "placed_at"),
		paymentDueAt: optionalInstant(row.payment_due_at, "payment_due_at"),
		acceptedAt: optionalInstant(row.accepted_at, "accepted_at"),
		preparingAt: optionalInstant(row.preparing_at, "preparing_at"),
		doneAt: optionalInstant(row.done_at, "done_at"),
		completedAt: optionalInstant(row.completed_at, "completed_at"),
		paidAt: optionalInstant(row.paid_at, "paid_at"),
		cancelledAt: optionalInstant(row.cancelled_at, "cancelled_at"),
		cancelReason: optionalCode(row.cancel_reason, "cancel reason"),
		lines: optionalList(row.lines, "order lines").map(readPricedLine),
		timeline: optionalList(row.timeline, "timeline").map(readTimelineEvent),
		money: readMoney(row.money),
		readyEstimateAt: optionalInstant(
			row.ready_estimate_at,
			"ready_estimate_at",
		),
	};
}

export function readOrderAnswer(value: unknown): OrderAnswer {
	const row = record(value, "order answer");
	if (row.state === "ok") return { state: "ok", order: readOrder(row.order) };
	if (row.state === "refused")
		return { state: "refused", refusal: code(row.refusal, "refusal") };
	return invalid("order answer state");
}

export function readPlaceAnswer(value: unknown): PlaceAnswer {
	const row = record(value, "placement");
	const state = oneOf(
		["placed", "awaiting_payment", "cancelled", "refused"] as const,
		row.state,
		"placement state",
	);
	const refused = state === "refused";
	// option_invalid answers the refused line numbers in `lines`; price_changed answers the priced lines there
	const badLines =
		row.refusal === "option_invalid" ? badLinesOf(row.lines) : [];
	return {
		state,
		refusal: refused ? code(row.refusal, "refusal") : null,
		replayed: row.replayed === true,
		order: refused ? null : readOrder(row.order),
		ordering:
			row.ordering === undefined || row.ordering === null
				? null
				: readOrderingState(row.ordering),
		retryAt: optionalInstant(row.retry_at, "retry_at"),
		unavailableItems: ids(row.unavailable_items, "unavailable items"),
		badLines,
		total: optionalAmount(row.total, "total"),
		discountAmount: optionalAmount(row.discount_amount, "discount"),
		maxOrderAmount: optionalAmount(row.max_order_amount, "max order amount"),
		menuVersion: optionalAmount(row.menu_version, "menu version"),
	};
}

export function readCancelAnswer(value: unknown): CancelAnswer {
	const row = record(value, "cancellation");
	if (row.state === "cancelled")
		return {
			state: "cancelled",
			replayed: row.replayed === true,
			order: readOrder(row.order),
		};
	if (row.state === "refused")
		return {
			state: "refused",
			refusal: code(row.refusal, "refusal"),
			order:
				row.order === null || row.order === undefined
					? null
					: readOrder(row.order),
		};
	return invalid("cancellation state");
}

function readOrderSummary(value: unknown): OrderSummary {
	const row = record(value, "order summary");
	return {
		id: id(row.id, "order id"),
		displayNo: optionalText(row.display_no, "order number"),
		storeName: text(row.store_name, "store name"),
		type: oneOf(ORDER_TYPES, row.type, "order type"),
		tableLabel: optionalText(row.table_label, "table label"),
		status: oneOf(ORDER_STATUSES, row.status, "order status"),
		paymentStatus: oneOf(
			PAYMENT_STATUSES,
			row.payment_status,
			"payment status",
		),
		total: amount(row.total, "total"),
		placedAt: instant(row.placed_at, "placed_at"),
		items: amount(row.items, "item count"),
	};
}

export function readOrderList(value: unknown): OrderList {
	const row = record(value, "order list");
	return {
		orders: list(row.orders, "orders").map(readOrderSummary),
		nextBefore: optionalInstant(row.next_before, "next page"),
	};
}

export function readStampCard(value: unknown): NativeStampCard {
	const row = record(value, "stamp card");
	const stampsPerReward = amount(row.stamps_per_reward, "stamps per reward");
	if (stampsPerReward < 1) invalid("stamps per reward");
	return {
		enabled: flag(row.enabled, "stamp card enabled"),
		stamps: amount(row.stamps, "stamps"),
		stampsPerReward,
		rewardName: text(row.reward_name, "reward name"),
		totalEarned: amount(row.total_earned ?? 0, "stamps earned"),
		rewards: optionalList(row.rewards, "rewards").map((entry) => {
			const reward = record(entry, "reward");
			return {
				id: id(reward.id, "reward id"),
				issuedAt: instant(reward.issued_at, "reward issued"),
			};
		}),
		history: optionalList(row.history, "stamp history").map((entry) => {
			const item = record(entry, "stamp entry");
			return {
				kind: code(item.kind, "stamp entry kind"),
				delta: signed(item.delta, "stamp delta"),
				balanceAfter: signed(item.balance_after, "stamp balance"),
				at: instant(item.at, "stamp entry time"),
				orderNo: optionalText(item.order_no, "stamp entry order"),
			};
		}),
	};
}

export function menuArgs(
	store: string,
	type: OrderType | null,
): Readonly<Record<string, unknown>> {
	return { p_store_code: store, p_order_type: type };
}

export function storeArgs(store: string): Readonly<Record<string, unknown>> {
	return { p_store_code: store };
}

export function tableArgs(
	store: string,
	token: string,
): Readonly<Record<string, unknown>> {
	return { p_store_code: store, p_table_token: token };
}

export function orderArgs(orderId: string): Readonly<Record<string, unknown>> {
	if (!ORDER_ID_PATTERN.test(orderId)) {
		throw new Error("an order id is a UUID");
	}
	return { p_order: orderId };
}

export function ordersArgs(
	before: string | null,
): Readonly<Record<string, unknown>> {
	return before === null ? {} : { p_before: before };
}

export function requestArgs(
	request: PlaceRequest | CheckRequest,
): Readonly<Record<string, unknown>> {
	return { p_request: request };
}

export function isOrderId(value: string): boolean {
	return ORDER_ID_PATTERN.test(value);
}

export function isOpenStatus(status: OrderStatus): boolean {
	return OPEN_ORDER_STATUSES.includes(status);
}
