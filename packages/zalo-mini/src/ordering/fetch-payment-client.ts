import {
	CHECKOUT_ORDER_FUNCTION,
	FUNCTIONS_PATH,
	type LinkRequest,
	linkBody,
	type PaymentClient,
	type PaymentErrorCode,
	readLinkAnswer,
	readPaymentError,
	readStartAnswer,
	type StartRequest,
	startBody,
} from "./payment-contract";

export const PAYMENT_TIMEOUT_MS = 15_000;
export const PAYMENT_NETWORK_FAILURE = 0;

/** A start or link the function did not answer with 200: its status (0 when nothing came back) and error code. */
export class PaymentError extends Error {
	readonly status: number;
	readonly code: PaymentErrorCode | null;
	readonly requestId: string | null;

	constructor(
		status: number,
		code: PaymentErrorCode | null = null,
		requestId: string | null = null,
	) {
		super(
			status === PAYMENT_NETWORK_FAILURE
				? "the payment request did not complete"
				: `the payment request was answered with ${status}${code === null ? "" : ` (${code})`}`,
		);
		this.name = "PaymentError";
		this.status = status;
		this.code = code;
		this.requestId = requestId;
	}

	/** nothing answered, or the answer was lost: the same request may go again (the key makes it the same attempt) */
	get network(): boolean {
		return this.status === PAYMENT_NETWORK_FAILURE;
	}

	/** the function or a provider behind it failed for now: worth another try later */
	get retryable(): boolean {
		return this.network || this.status >= 500;
	}
}

export interface PaymentClientOptions {
	/** the Supabase API (the functions live under /functions/v1), or the local proxy path */
	readonly url: string;
	readonly publishableKey: string;
	/** the session's access token, or a way to read the current one (a session that refreshes itself) */
	readonly accessToken: string | (() => Promise<string | null> | string | null);
	/** checkout-order's own address instead of the one under `url` (a function served on its own port) */
	readonly endpoint?: string;
	readonly fetch?: typeof fetch;
	readonly timeoutMs?: number;
}

/** The Edge Function checkout-order with the caller's session (the customer's, or a staff member's at the counter). */
export function createPaymentClient(
	options: PaymentClientOptions,
): PaymentClient {
	const send = options.fetch ?? ((input, init) => fetch(input, init));
	const address =
		options.endpoint?.trim() ||
		`${options.url.replace(/\/+$/, "")}${FUNCTIONS_PATH}/${CHECKOUT_ORDER_FUNCTION}`;

	async function token(): Promise<string> {
		const given =
			typeof options.accessToken === "string"
				? options.accessToken
				: await options.accessToken();
		if (given === null || given.trim() === "")
			throw new PaymentError(401, "unauthorized");
		return given;
	}

	async function call(
		body: Readonly<Record<string, unknown>>,
	): Promise<unknown> {
		const bearer = await token();
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(),
			options.timeoutMs ?? PAYMENT_TIMEOUT_MS,
		);
		try {
			let response: Response;
			try {
				response = await send(address, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${bearer}`,
						apikey: options.publishableKey,
						"content-type": "application/json",
						Accept: "application/json",
					},
					body: JSON.stringify(body),
					signal: controller.signal,
				});
			} catch {
				throw new PaymentError(PAYMENT_NETWORK_FAILURE);
			}
			let parsed: unknown = null;
			let readable = true;
			try {
				parsed = await response.json();
			} catch {
				readable = false;
			}
			if (response.status !== 200) {
				const { code, requestId } = readPaymentError(parsed);
				throw new PaymentError(response.status, code, requestId);
			}
			if (!readable) throw new PaymentError(PAYMENT_NETWORK_FAILURE);
			return parsed;
		} finally {
			clearTimeout(timer);
		}
	}

	return {
		async start(request: StartRequest) {
			const answer = readStartAnswer(await call(startBody(request)));
			// an answer about another order or another method is not this attempt's: refused like a malformed one
			if (
				answer.state === "pending" &&
				(answer.payment.orderId.toLowerCase() !==
					request.orderId.toLowerCase() ||
					answer.payment.method !== request.method)
			)
				throw new Error("the payment answer is for another order or method");
			return answer;
		},
		async link(request: LinkRequest) {
			return readLinkAnswer(await call(linkBody(request)));
		},
	};
}
