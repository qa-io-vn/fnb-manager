import { RestError } from "@fnb/zalo-mini";
import { REFUSAL_INVALID } from "@fnb/zalo-mini/loyalty";
import {
	LINE_NOTE_MAX,
	MAX_CART_LINES,
	MAX_LINE_OPTIONS,
	MAX_LINE_QUANTITY,
	ORDER_NOTE_MAX,
	ORDERING_FUNCTIONS,
	TABLE_TOKEN_PATTERN,
} from "@fnb/zalo-mini/ordering";
import { isoDateIn } from "../data/dates";
import { hasForbiddenCharacter } from "../ordering/cart";
import {
	DEMO_CATEGORY_NAMES,
	DEMO_FOREIGN_ORDER_ID,
	DEMO_OPTION_GROUPS,
	DEMO_ORDERING_STORE,
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

export type DemoTillAction = "pay" | "start" | "done" | "complete" | "cancel";

/** The counter's side of the demo, for tests: what staff do at the till. */
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
	readonly orderNo: number;
	readonly type: "table" | "takeaway";
	readonly tableLabel: string | null;
	status: string;
	paymentStatus: string;
	version: number;
	readonly subtotal: number;
	readonly total: number;
	readonly note: string | null;
	readonly placedAt: string;
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLE_MISSES_ALLOWED = 10;
const MAX_OPEN_ORDERS = 3;
const STAMPS_PER_REWARD = 9;
const REWARD_NAME = "Ly miễn phí";

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
): OrderingWorld {
	const items = demoMenuItems();
	const soldOut = new Set<string>();
	let version = 1;
	let reason: string | null = initialReason;
	let orderCount = 0;
	let placements = 0;
	let tableMisses = 0;
	const orders: DemoOrder[] = [];
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

	const iso = () => new Date(now()).toISOString();
	const displayNo = (no: number) => `#${String(no).padStart(3, "0")}`;

	// another customer's order, which this customer's session must never read
	orders.push({
		id: DEMO_FOREIGN_ORDER_ID,
		owner: "someone",
		requestId: "ffffffff-0000-4000-8000-000000000002",
		hash: "",
		orderNo: 1,
		type: "table",
		tableLabel: "Bàn 3",
		status: "accepted",
		paymentStatus: "unpaid",
		version: 1,
		subtotal: 29000,
		total: 29000,
		note: null,
		placedAt: new Date(now() - 600_000).toISOString(),
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
			payment_methods: ["counter"],
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
		payment_method: "counter",
		version: order.version,
		subtotal: order.subtotal,
		discount_amount: 0,
		total: order.total,
		note: order.note,
		placed_at: order.placedAt,
		payment_due_at: null,
		accepted_at: order.acceptedAt,
		preparing_at: order.preparingAt,
		done_at: order.doneAt,
		completed_at: order.completedAt,
		paid_at: order.paidAt,
		cancelled_at: order.cancelledAt,
		cancel_reason: order.cancelReason,
		late: false,
		lines: order.lines,
		...(withTimeline
			? {
					timeline: order.events,
					money: {
						paid: order.paymentStatus === "paid" ? order.total : 0,
						refunded: 0,
						refund_open: 0,
						payments:
							order.paidAt === null
								? []
								: [
										{
											id: null,
											method: "cash",
											amount: order.total,
											status: "succeeded",
											settled_at: order.paidAt,
											recorded_by: null,
										},
									],
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

	const place = (args: Readonly<Record<string, unknown>>) => {
		const request = checkShape(args.p_request, true);
		const hash = canonical(request);
		const replay = orders.find(
			(order) => order.owner === "me" && order.requestId === request.request_id,
		);
		if (replay !== undefined) {
			if (replay.hash !== hash) return refused("request_conflict");
			return {
				state: "placed",
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
		if (request.payment !== "counter" || request.type === "takeaway")
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
		const order: DemoOrder = {
			id: `99999999-0000-4000-8000-${String(orderCount).padStart(12, "0")}`,
			owner: "me",
			requestId: String(request.request_id),
			hash,
			orderNo: orderCount,
			type: "table",
			tableLabel: table?.label ?? null,
			status: "accepted",
			paymentStatus: "unpaid",
			version: 1,
			subtotal: priced.subtotal,
			total: priced.subtotal,
			note: noteOf(request.note),
			placedAt: at,
			acceptedAt: at,
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
					to: "accepted",
					at,
					reason_code: null,
					amount: priced.subtotal,
				},
			],
			stampsCounted: false,
		};
		orders.push(order);
		return {
			state: "placed",
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

	const move = (order: DemoOrder, to: string, action: string) => {
		const at = iso();
		order.events.push({
			kind: "status",
			action,
			from: order.status,
			to,
			at,
			reason_code: null,
			amount: null,
		});
		order.status = to;
		order.version += 1;
		return at;
	};

	const till: DemoTill = {
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
			const order =
				orderId === undefined
					? [...orders].reverse().find((entry) => entry.owner === "me")
					: orders.find((entry) => entry.id === orderId);
			if (order === undefined) throw new Error("no such order");
			const at = iso();
			switch (action) {
				case "pay":
					if (order.paymentStatus !== "unpaid" || order.status === "cancelled")
						break;
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
					break;
			}
			return order.status;
		},
		placements: () => placements,
		openCalls: () => calls.size,
		ackCalls: () => calls.clear(),
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
				if (!(order.status === "accepted" && order.paymentStatus === "unpaid"))
					return {
						state: "refused",
						refusal:
							order.status === "accepted" ? "contact_store" : "not_allowed",
						order: orderJson(order, false),
					};
				order.cancelledAt = move(order, "cancelled", "cancel");
				order.cancelReason = "customer_cancelled";
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
				};
			default:
				return undefined;
		}
	};

	return {
		answer,
		till,
		changingFunctions: [
			ORDERING_FUNCTIONS.placeOrder,
			ORDERING_FUNCTIONS.cancelOrder,
			ORDERING_FUNCTIONS.callStaff,
		],
	};
}
