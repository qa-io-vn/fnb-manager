import type {
	Order,
	OrderPayment,
	PaymentMethod,
	PricedLine,
} from "@fnb/zalo-mini/ordering";
import { describe, expect, it } from "vitest";
import { methodSelectable } from "./flag";
import {
	basketLinesOf,
	canRetry,
	canSwitchToCounter,
	countdown,
	counterRequest,
	payStepView,
	resultState,
	type SdkHint,
	type ServerPayment,
	type StartPhase,
	serverPayment,
} from "./payment-step";

// Test design (ISTQB) for the state of an online payment on the customer's screens (native-till.md 5.1, 6;
// online-ordering.md 6.2, 6.6):
// - decision table of the payment step: method (wallet, transfer) × what the SDK said (nothing, opened, a claim of
//   success, processing, failed, left, closed, no SDK) × the server's state (not read yet, pending, failed, expired,
//   cancelled, accepted) × the start (starting, started, refused, error). The rule under test: only the server's
//   accepted order leads to the order screen; a client's claim of success only changes the words;
// - state transitions of the order the server holds against the step and the result screen (C11), with the attempt
//   the step follows (a failure of an earlier attempt does not count once a new one started);
// - equivalence partitions of the build flag × the store's offered methods for the methods that can be chosen;
// - the counter switch: which orders it may replace, and a request with ids only (no price), a request of its own;
// - boundary values of the countdown: 0, 59 and 60 seconds, a time passed.

const T0 = "2026-11-27T03:00:00.000Z";
const DUE = "2026-11-27T03:15:00.000Z";
const ATTEMPT_1 = "77777777-0000-4000-8000-000000000001";
const ATTEMPT_2 = "77777777-0000-4000-8000-000000000002";

function payment(id: string, status: string): OrderPayment {
	return {
		id,
		method: "zalo_checkout",
		amount: 35000,
		status,
		settledAt: null,
	};
}

function line(overrides: Partial<PricedLine> = {}): PricedLine {
	return {
		lineNo: 1,
		itemId: "dddddddd-0000-4000-8000-000000000002",
		sizeId: "eeeeeeee-0000-4000-8000-000000000003",
		itemName: "Cà phê đen",
		sizeLabel: null,
		quantity: 2,
		unitPrice: 29000,
		options: [
			{
				groupId: "aaaaaaaa-0000-4000-8000-000000000001",
				group: "Đá",
				optionId: "bbbbbbbb-0000-4000-8000-000000000001",
				name: "Ít đá",
				price: 0,
			},
		],
		optionsAmount: 0,
		lineTotal: 58000,
		countsForStamps: true,
		note: "ít ngọt",
		...overrides,
	};
}

function order(overrides: Partial<Order> = {}): Order {
	return {
		id: "66666666-6666-4666-8666-666666666601",
		orderNo: null,
		displayNo: null,
		businessDate: "2026-11-27",
		source: "app",
		type: "table",
		tableLabel: "Bàn 12",
		pickupAt: null,
		status: "awaiting_payment",
		paymentStatus: "unpaid",
		paymentMethod: "zalo_checkout",
		version: 1,
		subtotal: 58000,
		discountAmount: 0,
		total: 58000,
		note: null,
		placedAt: T0,
		paymentDueAt: DUE,
		acceptedAt: null,
		preparingAt: null,
		doneAt: null,
		completedAt: null,
		paidAt: null,
		cancelledAt: null,
		cancelReason: null,
		lines: [line()],
		timeline: [],
		money: {
			paid: 0,
			refunded: 0,
			refundOpen: 0,
			payments: [],
			refunds: [],
		},
		readyEstimateAt: null,
		...overrides,
	};
}

function withPayments(...payments: OrderPayment[]): Partial<Order> {
	return {
		money: { paid: 0, refunded: 0, refundOpen: 0, payments, refunds: [] },
	};
}

describe("the server's state of a payment", () => {
	it.each<[string, Partial<Order>, string | null, ServerPayment]>([
		["waiting, no attempt yet", {}, null, "pending"],
		[
			"waiting, its attempt pending",
			withPayments(payment(ATTEMPT_1, "pending")),
			null,
			"pending",
		],
		[
			"waiting, its attempt failed",
			withPayments(payment(ATTEMPT_1, "failed")),
			null,
			"failed",
		],
		[
			"waiting, an earlier attempt failed and the followed one is pending",
			withPayments(payment(ATTEMPT_1, "failed"), payment(ATTEMPT_2, "pending")),
			ATTEMPT_2,
			"pending",
		],
		[
			"waiting, the followed attempt not listed yet (an older read)",
			withPayments(payment(ATTEMPT_1, "failed")),
			ATTEMPT_2,
			"pending",
		],
		[
			"accepted and paid by the server",
			{
				status: "accepted",
				paymentStatus: "paid",
				orderNo: 4,
				displayNo: "#004",
			},
			null,
			"accepted",
		],
		[
			"cancelled by the payment window",
			{ status: "cancelled", cancelReason: "payment_timeout" },
			null,
			"expired",
		],
		[
			"cancelled by staff",
			{ status: "cancelled", cancelReason: "store_busy" },
			null,
			"cancelled",
		],
		[
			"cancelled by the customer",
			{ status: "cancelled", cancelReason: "customer_cancelled" },
			null,
			"cancelled",
		],
	])("%s", (_name, overrides, attemptId, expected) => {
		expect(serverPayment(order(overrides), attemptId)).toBe(expected);
	});

	it("never reads a counter cash record as an online attempt", () => {
		expect(
			serverPayment(
				order(
					withPayments({ ...payment(ATTEMPT_1, "failed"), method: "cash" }),
				),
			),
		).toBe("pending");
	});
});

describe("the payment step (decision table: method × SDK × server × start)", () => {
	const view = (
		method: "zalo_checkout" | "vietqr",
		server: ServerPayment | null,
		start: StartPhase,
		sdk: SdkHint,
	) => payStepView({ method, server, start, sdk });

	// R1: the server's state goes first, whatever the SDK said
	it.each<SdkHint>([
		"none",
		"opened",
		"claimed",
		"processing",
		"failed",
		"left",
		"closed",
		"unavailable",
	])("shows the order once the server accepted it (SDK %s)", (sdk) => {
		expect(view("zalo_checkout", "accepted", "started", sdk)).toEqual({
			kind: "order",
		});
		expect(view("vietqr", "accepted", "started", sdk)).toEqual({
			kind: "order",
		});
	});

	// R2: expired, cancelled or failed on the server: the result screen, with no hint of the client's
	it.each<ServerPayment>(["expired", "cancelled", "failed"])(
		"shows the result screen for a %s payment, even after a claim of success",
		(server) => {
			expect(view("zalo_checkout", server, "started", "claimed")).toEqual({
				kind: "result",
				hint: null,
			});
		},
	);

	// R3: a client's claim never shows paid
	it("keeps waiting when the wallet claims success and the server still waits", () => {
		expect(view("zalo_checkout", "pending", "started", "claimed")).toEqual({
			kind: "waiting",
			note: "claimed",
		});
		expect(view("vietqr", "pending", "started", "claimed")).toEqual({
			kind: "transfer",
			claimed: true,
		});
	});

	it.each<[SdkHint, ReturnType<typeof payStepView>]>([
		["none", { kind: "starting" }],
		["opened", { kind: "waiting", note: "opened" }],
		["processing", { kind: "waiting", note: "processing" }],
		["failed", { kind: "result", hint: "failed" }],
		["left", { kind: "result", hint: "left" }],
		["unavailable", { kind: "result", hint: "unavailable" }],
	])(
		"words a pending wallet payment after the SDK said %s",
		(sdk, expected) => {
			expect(view("zalo_checkout", "pending", "started", sdk)).toEqual(
				expected,
			);
		},
	);

	it.each<[SdkHint, ReturnType<typeof payStepView>]>([
		["none", { kind: "starting" }],
		["closed", { kind: "transfer", claimed: false }],
		["unavailable", { kind: "transfer", claimed: false }],
		["claimed", { kind: "transfer", claimed: true }],
	])("shows the transfer's QR once the popup said %s", (sdk, expected) => {
		expect(view("vietqr", "pending", "started", sdk)).toEqual(expected);
	});

	it("waits for the order and the start, and words a refusal or a lost answer", () => {
		expect(view("zalo_checkout", null, "started", "opened")).toEqual({
			kind: "starting",
		});
		expect(view("zalo_checkout", "pending", "starting", "none")).toEqual({
			kind: "starting",
		});
		expect(view("vietqr", "pending", "refused", "none")).toEqual({
			kind: "refused",
		});
		expect(view("vietqr", "pending", "error", "none")).toEqual({
			kind: "error",
		});
	});
});

describe("the result screen's state (C11)", () => {
	it.each<
		[string, Partial<Order>, "failed" | "left" | "unavailable" | null, string]
	>([
		[
			"the server failed it",
			withPayments(payment(ATTEMPT_1, "failed")),
			null,
			"failed",
		],
		["Zalo said it failed", {}, "failed", "failed"],
		["no Zalo checkout here", {}, "unavailable", "failed"],
		["the customer left the sheet", {}, "left", "left"],
		["still waiting, no hint", {}, null, "unknown"],
		[
			"the window passed",
			{ status: "cancelled", cancelReason: "payment_timeout" },
			"left",
			"expired",
		],
		[
			"staff cancelled it",
			{ status: "cancelled", cancelReason: "store_busy" },
			null,
			"cancelled",
		],
		[
			"the server accepted it after a hint of failure",
			{ status: "accepted", paymentStatus: "paid" },
			"failed",
			"accepted",
		],
	])("reads %s", (_name, overrides, hint, expected) => {
		expect(resultState(order(overrides), hint)).toBe(expected);
	});

	it("offers another try only while the order waits for its payment", () => {
		expect(canRetry(order())).toBe(true);
		expect(
			canRetry(order({ status: "cancelled", cancelReason: "payment_timeout" })),
		).toBe(false);
		expect(canRetry(order({ status: "accepted", paymentStatus: "paid" }))).toBe(
			false,
		);
	});
});

describe("Trả tại quầy (the counter switch)", () => {
	it.each<[string, Partial<Order>, boolean]>([
		["a waiting table order", {}, true],
		[
			"an expired table order",
			{ status: "cancelled", cancelReason: "payment_timeout" },
			true,
		],
		[
			"a table order the customer cancelled",
			{ status: "cancelled", cancelReason: "customer_cancelled" },
			true,
		],
		[
			"an order staff cancelled",
			{ status: "cancelled", cancelReason: "store_busy" },
			false,
		],
		["a paid order", { status: "accepted", paymentStatus: "paid" }, false],
		[
			"a refund to make",
			{
				status: "cancelled",
				cancelReason: "payment_timeout",
				paymentStatus: "refund_pending",
			},
			false,
		],
		["a takeaway order", { type: "takeaway" }, false],
		["an order without lines", { lines: [] }, false],
		["a line whose size is gone", { lines: [line({ sizeId: null })] }, false],
	])("replaces %s: %s", (_name, overrides, expected) => {
		expect(canSwitchToCounter(order(overrides))).toBe(expected);
	});

	it("places the same lines with ids only, to pay at the counter, under a request of its own", () => {
		const request = counterRequest(order(), {
			requestId: "cccccccc-0000-4000-8000-000000000001",
			store: "mau-1",
			tableToken: "demo-table-12",
		});
		expect(request).toEqual({
			request_id: "cccccccc-0000-4000-8000-000000000001",
			store: "mau-1",
			type: "table",
			table_token: "demo-table-12",
			lines: [
				{
					size: "eeeeeeee-0000-4000-8000-000000000003",
					qty: 2,
					options: ["bbbbbbbb-0000-4000-8000-000000000001"],
					note: "ít ngọt",
				},
			],
			payment: "counter",
			expected_total: 58000,
		});
		expect(JSON.stringify(request.lines)).not.toMatch(/price|29000|58000/);
	});

	it("puts the lines back in the basket with the menu's names and options", () => {
		expect(basketLinesOf(order())).toEqual([
			{
				itemId: "dddddddd-0000-4000-8000-000000000002",
				itemName: "Cà phê đen",
				sizeId: "eeeeeeee-0000-4000-8000-000000000003",
				sizeLabel: null,
				unitPrice: 29000,
				options: [
					{
						id: "bbbbbbbb-0000-4000-8000-000000000001",
						name: "Ít đá",
						groupName: "Đá",
						price: 0,
					},
				],
				quantity: 2,
				note: "ít ngọt",
				countsForStamps: true,
			},
		]);
		expect(basketLinesOf(order({ lines: [line({ itemId: null })] }))).toEqual(
			[],
		);
	});
});

describe("the ways to pay that can be chosen (flag × the store's offer)", () => {
	const all: readonly PaymentMethod[] = ["counter", "zalo_checkout", "vietqr"];
	it.each<[boolean, readonly PaymentMethod[], readonly boolean[]]>([
		[false, ["counter"], [true, false, false]],
		[false, all, [true, false, false]],
		[true, ["counter"], [true, false, false]],
		[true, ["counter", "vietqr"], [true, false, true]],
		[true, all, [true, true, true]],
		[true, [], [true, false, false]],
	])("flag %s, offered %j", (online, offered, expected) => {
		expect(
			all.map((method) => methodSelectable(method, offered, online)),
		).toEqual(expected);
	});
});

describe("the countdown", () => {
	const now = Date.parse(DUE);
	it.each([
		[60_000, "01:00"],
		[59_999, "00:59"],
		[59_000, "00:59"],
		[1000, "00:01"],
		[0, "00:00"],
		[-5000, "00:00"],
		[15 * 60_000, "15:00"],
	])("%s ms before the end reads %s", (left, expected) => {
		expect(countdown(DUE, now - left)).toBe(expected);
	});
});
