import type {
	OnlinePaymentMethod,
	Order,
	PlaceRequest,
} from "@fnb/zalo-mini/ordering";
import type { NewLine } from "./cart";

// The state of an online payment as the screens show it (native-till.md 5.1 and 6; online-ordering.md 6.2 and 6.6).
// The server's order decides: accepted (or moved on) means paid, cancelled with payment_timeout means expired, a failed
// attempt means failed. What Zalo's SDK says is only a hint that picks the words while the order still waits; it never
// shows an order paid.

/** The order's payment as the server holds it. */
export type ServerPayment =
	/** the order left awaiting_payment: accepted after a verified payment (or moved on): the order screen shows it */
	"accepted" | "expired" | "cancelled" | "failed" | "pending";

const ONLINE = new Set(["zalo_checkout", "vietqr"]);

/**
 * The server's state of the attempt the screen follows (or the order's latest one): only the order says paid, and a
 * failure counts only for that attempt, so a new attempt started after one failed is not read as failed.
 */
export function serverPayment(
	order: Order,
	attemptId: string | null = null,
): ServerPayment {
	if (order.status === "cancelled")
		return order.cancelReason === "payment_timeout" ? "expired" : "cancelled";
	if (order.status !== "awaiting_payment" || order.paymentStatus !== "unpaid")
		return "accepted";
	const attempts = (order.money?.payments ?? []).filter((payment) =>
		ONLINE.has(payment.method),
	);
	const followed =
		attemptId === null
			? attempts[attempts.length - 1]
			: attempts.find((payment) => payment.id === attemptId);
	return followed?.status === "failed" ? "failed" : "pending";
}

/** What the SDK said so far, for the words only. */
export type SdkHint =
	| "none"
	| "opened"
	| "claimed"
	| "processing"
	| "failed"
	| "left"
	| "closed"
	| "unavailable";

export type StartPhase = "starting" | "started" | "refused" | "error";

/** The hint the result screen (C11) words a still-waiting order with. */
export type ResultHint = "failed" | "left" | "unavailable";

export type PayView =
	| { readonly kind: "order" }
	| { readonly kind: "result"; readonly hint: ResultHint | null }
	| { readonly kind: "starting" }
	| {
			readonly kind: "waiting";
			readonly note: "opened" | "claimed" | "processing";
	  }
	| { readonly kind: "transfer"; readonly claimed: boolean }
	| { readonly kind: "refused" }
	| { readonly kind: "error" };

/**
 * The payment step's view (decision table: method × SDK hint × server state). The server's state goes first: accepted
 * shows the order, expired, cancelled or failed shows the result screen. While the order waits, the step follows its
 * own start and the SDK: the wallet waits after its sheet opened (a claim of success changes the words, not the state)
 * and goes to the result screen when Zalo says it failed or the customer left; the transfer shows its QR in every
 * case once the popup is past, because a transfer can still be made from it.
 */
export function payStepView(input: {
	readonly method: OnlinePaymentMethod;
	readonly server: ServerPayment | null;
	readonly start: StartPhase;
	readonly sdk: SdkHint;
}): PayView {
	const { method, server, start, sdk } = input;
	if (server === "accepted") return { kind: "order" };
	if (server === "expired" || server === "cancelled" || server === "failed")
		return { kind: "result", hint: null };
	if (server === null || start === "starting") return { kind: "starting" };
	if (start === "refused") return { kind: "refused" };
	if (start === "error") return { kind: "error" };
	if (method === "vietqr")
		return sdk === "none"
			? { kind: "starting" }
			: { kind: "transfer", claimed: sdk === "claimed" };
	switch (sdk) {
		case "none":
			return { kind: "starting" };
		case "failed":
		case "left":
		case "unavailable":
			return { kind: "result", hint: sdk };
		case "claimed":
		case "processing":
			return { kind: "waiting", note: sdk };
		default:
			return { kind: "waiting", note: "opened" };
	}
}

/** The result screen's state (C11): the server's, worded by the hint while the order still waits. */
export type ResultState =
	| "accepted"
	| "expired"
	| "cancelled"
	| "failed"
	| "left"
	| "unknown";

export function resultState(
	order: Order,
	hint: ResultHint | null,
): ResultState {
	const server = serverPayment(order);
	if (server !== "pending") return server;
	if (hint === "failed" || hint === "unavailable") return "failed";
	if (hint === "left") return "left";
	return "unknown";
}

/** Whether the result screen offers another online try: only while the order still waits for its payment. */
export function canRetry(order: Order): boolean {
	return (
		order.status === "awaiting_payment" && order.paymentStatus === "unpaid"
	);
}

/**
 * Whether "Trả tại quầy" can replace the order: a table order not paid, still waiting or cancelled because its time
 * ran out or the customer left the payment (never one staff cancelled), whose every line names its size.
 */
export function canSwitchToCounter(order: Order): boolean {
	if (order.type !== "table" || order.paymentStatus !== "unpaid") return false;
	if (
		order.status !== "awaiting_payment" &&
		!(
			order.status === "cancelled" &&
			(order.cancelReason === "payment_timeout" ||
				order.cancelReason === "customer_cancelled")
		)
	)
		return false;
	return (
		order.lines.length > 0 && order.lines.every((line) => line.sizeId !== null)
	);
}

/** The order's lines as a new placement takes them: sizes, quantities, options and notes, never a price. */
export function linesOf(order: Order): PlaceRequest["lines"] {
	return order.lines.flatMap((line) =>
		line.sizeId === null
			? []
			: [
					{
						size: line.sizeId,
						qty: line.quantity,
						...(line.options.length === 0
							? {}
							: { options: line.options.map((option) => option.optionId) }),
						...(line.note === null ? {} : { note: line.note }),
					},
				],
	);
}

/** The same order to pay at the counter: a new request (its own request_id), the same lines and the same total. */
export function counterRequest(
	order: Order,
	input: {
		readonly requestId: string;
		readonly store: string;
		readonly tableToken: string;
	},
): PlaceRequest {
	return {
		request_id: input.requestId,
		store: input.store,
		type: "table",
		table_token: input.tableToken,
		lines: linesOf(order),
		payment: "counter",
		expected_total: order.total,
	};
}

/** The order's lines back in the basket (when the counter order could not be placed): the menu's names and prices. */
export function basketLinesOf(order: Order): readonly NewLine[] {
	return order.lines.flatMap((line) =>
		line.itemId === null || line.sizeId === null
			? []
			: [
					{
						itemId: line.itemId,
						itemName: line.itemName,
						sizeId: line.sizeId,
						sizeLabel: line.sizeLabel,
						unitPrice: line.unitPrice,
						options: line.options.map((option) => ({
							id: option.optionId,
							name: option.name,
							groupName: option.group,
							price: option.price,
						})),
						quantity: line.quantity,
						note: line.note,
						countsForStamps: line.countsForStamps,
					},
				],
	);
}

/** Minutes and seconds left until an instant, "14:05" style ("04:59"), never below zero. */
export function countdown(until: string, now: number): string {
	const left = Math.max(0, Math.floor((Date.parse(until) - now) / 1000));
	const minutes = Math.floor(left / 60);
	const seconds = left % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
