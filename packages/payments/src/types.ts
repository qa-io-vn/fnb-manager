/**
 * The provider seam of online payment (ADR-067). The database owns the money (order_payments, order_refunds, the
 * attempts and their references); a provider adapter only turns an attempt into what the customer's device needs,
 * proves that a notification came from the provider, asks the provider again about a lost notification and sends a
 * refund. Nothing here decides that an order is paid: the Edge Function hands a verified event to the database,
 * which checks the attempt, the amount and the order before it moves anything.
 */

export type PaymentMethod = "zalo_checkout" | "vietqr";
export type ProviderMode = "sandbox" | "live";
/** A row's mode: off rows still verify the notifications of attempts opened before the switch-off. */
export type ConfigMode = ProviderMode | "off";

/** A fetch the Zalo calls go through: the relay of ADR-057 wraps it in the cloud, a fake replaces it in tests. */
export interface PaymentRequestInit {
	readonly method: "GET" | "POST";
	readonly headers: Readonly<Record<string, string>>;
	readonly body?: string;
	readonly signal?: AbortSignal;
}

export type PaymentFetch = (
	url: string,
	init: PaymentRequestInit,
) => Promise<Response>;

/** One line of an order as a checkout sheet lists it: an id and the line's total in đồng. */
export interface AttemptLine {
	readonly id: string;
	readonly amount: number;
}

/** What the database answers when it opens (or resumes) an attempt, and all an adapter may use. */
export interface PaymentAttempt {
	readonly paymentId: string;
	readonly orderId: string;
	readonly method: PaymentMethod;
	/** whole đồng, the order's total */
	readonly amount: number;
	/** the attempt's reference: in the transfer's purpose for VietQR, in extradata for the Checkout SDK */
	readonly reference: string;
	readonly expiresAt: string;
	/** a short text for the sheet or the bank app, such as the store's name */
	readonly description: string;
	readonly lines: readonly AttemptLine[];
}

/** The parameters of CheckoutSDK.createOrder, the MAC made on the server with the brand's private key. */
export interface CheckoutParams {
	readonly amount: number;
	readonly desc: string;
	readonly item: readonly AttemptLine[];
	readonly extradata: string;
	readonly method: string | null;
	readonly mac: string;
}

/** What a VietQR attempt shows: the payload and the details a customer may type by hand instead. */
export interface QrPayment {
	readonly payload: string;
	readonly bankBin: string;
	readonly bankName: string;
	readonly accountNumber: string;
	readonly accountName: string;
	readonly amount: number;
	readonly reference: string;
	/** the method of Zalo's bank-transfer popup (Payment.openCheckoutPopup) for this mode */
	readonly popupMethod: "BANK" | "BANK_SANDBOX";
}

export interface CreatedPayment {
	readonly checkout: CheckoutParams | null;
	readonly qr: QrPayment | null;
	readonly expiresAt: string;
}

/** A notification as the webhook received it: the path under the function, lower-case headers and the raw body. */
export interface NotificationRequest {
	readonly path: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly rawBody: string;
	/** milliseconds since the epoch */
	readonly receivedAt: number;
}

/**
 * One verified money event. `providerRef` is unique per provider and transaction (a bank adapter prefixes its own
 * id), so a repeated notification answers its first outcome. `reference` is exact when the provider carries it back
 * (Checkout extradata); `candidates` are reference-shaped words of a transfer's text, for the database to match.
 */
export interface PaymentEvent {
	readonly providerRef: string;
	readonly amount: number;
	readonly success: boolean;
	readonly reason: string | null;
	readonly reference: string | null;
	readonly candidates: readonly string[];
	readonly platformOrderId: string | null;
	readonly occurredAt: string | null;
}

export type NotificationRefusal =
	| "malformed"
	| "signature"
	| "stale"
	| "wrong_app"
	| "wrong_account"
	| "not_offered";

export type NotificationResult =
	| { readonly ok: true; readonly events: readonly PaymentEvent[] }
	| { readonly ok: false; readonly refusal: NotificationRefusal };

/** How a webhook's work ended, for the provider's own answer format. */
export type NotificationOutcome = "accepted" | "replayed" | "refused" | "error";

export interface NotificationReply {
	readonly status: number;
	readonly body: Readonly<Record<string, unknown>>;
}

export interface StatusQuery {
	readonly paymentId: string;
	readonly reference: string;
	readonly amount: number;
	/** Zalo's order id the app linked, when the provider needs it */
	readonly platformOrderId: string | null;
}

export type StatusAnswer =
	| { readonly state: "paid"; readonly event: PaymentEvent }
	| { readonly state: "failed"; readonly event: PaymentEvent }
	| { readonly state: "processing" }
	| { readonly state: "unknown" }
	| { readonly state: "unsupported" };

export interface RefundRequest {
	readonly refundId: string;
	/** the provider's transaction id of the payment */
	readonly providerRef: string;
	readonly amount: number;
	readonly description: string;
}

export type RefundAnswer =
	| {
			readonly state: "succeeded" | "pending";
			readonly providerRefundId: string | null;
	  }
	| {
			readonly state: "failed";
			readonly providerRefundId: string | null;
			readonly reason: string;
	  }
	| { readonly state: "unsupported" };

export interface PaymentProvider {
	/** the adapter: zalo_checkout, sepay, mock */
	readonly adapter: string;
	readonly method: PaymentMethod;
	readonly mode: ConfigMode;
	createPayment(attempt: PaymentAttempt): Promise<CreatedPayment>;
	verifyNotification(request: NotificationRequest): Promise<NotificationResult>;
	reply(outcome: NotificationOutcome): NotificationReply;
	queryStatus(query: StatusQuery): Promise<StatusAnswer>;
	refund(request: RefundRequest): Promise<RefundAnswer>;
	queryRefund(providerRefundId: string): Promise<RefundAnswer>;
}

/** A provider the function could not reach or whose answer it could not read; the caller retries later. */
export class ProviderUnavailableError extends Error {
	readonly status: number | null;

	constructor(message: string, status: number | null = null) {
		super(message);
		this.name = "ProviderUnavailableError";
		this.status = status;
	}
}

/** A configuration row the adapter cannot work with (a missing setting, a mock where mocks are off). */
export class ProviderConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProviderConfigError";
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
