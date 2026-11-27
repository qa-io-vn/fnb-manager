import {
	type CheckoutParams,
	PLATFORM_ORDER_ID_PATTERN,
	type TransferQr,
} from "@fnb/zalo-mini/ordering";

// The seam between the payment step and Zalo's Checkout SDK (online-ordering.md 2.5, 6.2). Everything that comes back
// through it is a hint for the screen, never a decision: the app learns that an order is paid only by reading the
// order the server holds. Inside Zalo the real SDK answers (zalo-checkout.ts, loaded only in the Zalo runtime); in the
// browser a stand-in shows a small sheet and, with the demo world, asks the demo till to act as the gateway.

/** Zalo's error code when the Zalo app is too old for a Checkout API. */
export const ZALO_TOO_OLD = -1404;

export type WalletOpen =
	| { readonly kind: "opened"; readonly platformOrderId: string }
	| { readonly kind: "failed"; readonly code: number | null }
	| { readonly kind: "unavailable" };

/** What Zalo says once its checkout sheet closes (checkTransaction's resultCode): shown, never trusted. */
export type WalletHint = "paid" | "processing" | "failed" | "left" | "unknown";

export type TransferOpen =
	/** the customer says they paid in the popup */
	| { readonly kind: "paid"; readonly platformOrderId: string | null }
	| { readonly kind: "closed"; readonly platformOrderId: string | null }
	/** no popup here (outside Zalo, or a Zalo too old): the app shows the QR itself */
	| { readonly kind: "unavailable" };

export interface CheckoutPort {
	readonly kind: "zalo" | "stand-in";
	/** CheckoutSDK.createOrder with the server's signed parameters, exactly as received */
	openWallet(orderId: string, params: CheckoutParams): Promise<WalletOpen>;
	/** waits until Zalo's sheet for that order is done or closed, then asks checkTransaction */
	walletResult(
		platformOrderId: string,
		signal: AbortSignal,
	): Promise<WalletHint>;
	/** Zalo's QR popup for a bank transfer */
	openTransfer(orderId: string, qr: TransferQr): Promise<TransferOpen>;
}

/** The part of zmp-sdk the real port uses, behind an interface so its logic is tested without Zalo. */
export interface ZaloCheckoutSdk {
	createOrder(params: CheckoutParams): Promise<{ readonly orderId: unknown }>;
	checkTransaction(
		platformOrderId: string,
	): Promise<{ readonly resultCode: unknown }>;
	openCheckoutPopup(input: {
		readonly amount: number;
		readonly orderDescription: string;
		readonly qrContent: string;
		readonly method: string;
	}): Promise<{ readonly status?: unknown; readonly orderId?: unknown }>;
	/** listens for PaymentDone and PaymentClose; answers how to stop */
	onPaymentEnd(listener: () => void): () => void;
}

export function errorCode(error: unknown): number | null {
	if (typeof error !== "object" || error === null) return null;
	const code = (error as { readonly code?: unknown }).code;
	return typeof code === "number" ? code : null;
}

/** checkTransaction's resultCode: 1 paid, 0 in progress, -1 failed, -2 the customer chose no method and left. */
export function hintOfResultCode(code: unknown): WalletHint {
	switch (code) {
		case 1:
			return "paid";
		case 0:
			return "processing";
		case -1:
			return "failed";
		case -2:
			return "left";
		default:
			return "unknown";
	}
}

function platformId(value: unknown): string | null {
	return typeof value === "string" && PLATFORM_ORDER_ID_PATTERN.test(value)
		? value
		: null;
}

function aborted(signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) resolve();
		else signal.addEventListener("abort", () => resolve(), { once: true });
	});
}

/** The port over Zalo's SDK, loaded when first used. */
export function sdkCheckoutPort(
	load: () => Promise<ZaloCheckoutSdk>,
): CheckoutPort {
	// the end of each open sheet is listened for before createOrder, so a quick payment is not missed
	const sheets = new Map<
		string,
		{ readonly ended: Promise<void>; readonly stop: () => void }
	>();
	return {
		kind: "zalo",
		async openWallet(_orderId, params) {
			let sdk: ZaloCheckoutSdk;
			try {
				sdk = await load();
			} catch {
				return { kind: "unavailable" };
			}
			let end: (() => void) | null = null;
			const ended = new Promise<void>((resolve) => {
				end = resolve;
			});
			const stop = sdk.onPaymentEnd(() => end?.());
			try {
				const answer = await sdk.createOrder(params);
				const id = platformId(answer.orderId);
				if (id === null) {
					stop();
					return { kind: "failed", code: null };
				}
				sheets.set(id, { ended, stop });
				return { kind: "opened", platformOrderId: id };
			} catch (error) {
				stop();
				const code = errorCode(error);
				return code === ZALO_TOO_OLD
					? { kind: "unavailable" }
					: { kind: "failed", code };
			}
		},
		async walletResult(platformOrderId, signal) {
			const sdk = await load();
			const sheet = sheets.get(platformOrderId);
			if (sheet !== undefined) {
				await Promise.race([sheet.ended, aborted(signal)]);
				sheet.stop();
				sheets.delete(platformOrderId);
			}
			if (signal.aborted) return "unknown";
			try {
				return hintOfResultCode(
					(await sdk.checkTransaction(platformOrderId)).resultCode,
				);
			} catch {
				return "unknown";
			}
		},
		async openTransfer(_orderId, qr) {
			try {
				const sdk = await load();
				const answer = await sdk.openCheckoutPopup({
					amount: qr.amount,
					orderDescription: qr.reference,
					qrContent: qr.payload,
					method: qr.popupMethod,
				});
				const id = platformId(answer.orderId);
				return answer.status === "pay"
					? { kind: "paid", platformOrderId: id }
					: { kind: "closed", platformOrderId: id };
			} catch {
				// -1404 (a Zalo too old) or any other failure: the app shows the QR itself
				return { kind: "unavailable" };
			}
		},
	};
}

/** The real port: zmp-sdk, loaded only inside the Zalo runtime (a browser build never resolves it). */
export function zaloCheckoutPort(): CheckoutPort {
	return sdkCheckoutPort(async () => {
		if (import.meta.env.VITE_ZALO_RUNTIME !== "zalo")
			throw new Error("the Checkout SDK runs inside Zalo only");
		return (await import("./zalo-checkout")).zaloCheckoutSdk;
	});
}

export interface StandInSheet {
	readonly orderId: string;
	readonly platformOrderId: string;
	readonly amount: number;
	readonly desc: string;
}

export interface StandInCall {
	readonly api: "createOrder" | "openCheckoutPopup";
	readonly params: unknown;
}

export interface StandInCheckoutPort extends CheckoutPort {
	readonly kind: "stand-in";
	/** the open sheet, for the page to draw */
	sheet(): StandInSheet | null;
	subscribe(listener: () => void): () => void;
	/** the sheet's buttons: "Thanh toán thử" or "Hủy" */
	choose(choice: "pay" | "cancel"): void;
	/** what the app handed to the stand-in SDK, for tests */
	calls(): readonly StandInCall[];
}

export interface StandInOptions {
	/** the demo till acting as the wallet's gateway; null where there is none (a browser on a real endpoint) */
	readonly gateway: ((orderId: string, result: "paid") => void) | null;
	/** "Thanh toán thử" only claims success to the app, the gateway hears nothing (`?wallet=claim`) */
	readonly claimOnly: boolean;
	/** how the QR popup answers: none outside Zalo (the default), or as if the customer paid or closed it */
	readonly transfer: "unavailable" | "pay" | "close";
}

/**
 * The browser's stand-in of the Checkout SDK: createOrder opens a small sheet; "Thanh toán thử" asks the gateway (the
 * demo till) to report the payment, then tells the app it was paid, as Zalo's checkTransaction would; "Hủy" tells the
 * app the customer left. The app still learns the result only by reading the order.
 */
export function standInCheckoutPort(
	options: StandInOptions,
): StandInCheckoutPort {
	const listeners = new Set<() => void>();
	const recorded: StandInCall[] = [];
	let open: StandInSheet | null = null;
	let count = 0;
	const chosen = new Map<string, WalletHint>();
	const waiting = new Map<string, (hint: WalletHint) => void>();
	const publish = () => {
		for (const listener of [...listeners]) listener();
	};
	const settle = (platformOrderId: string, hint: WalletHint) => {
		const resolve = waiting.get(platformOrderId);
		if (resolve === undefined) chosen.set(platformOrderId, hint);
		else {
			waiting.delete(platformOrderId);
			resolve(hint);
		}
	};
	return {
		kind: "stand-in",
		async openWallet(orderId, params) {
			recorded.push({ api: "createOrder", params });
			count += 1;
			const platformOrderId = `standin-${count}`;
			open = {
				orderId,
				platformOrderId,
				amount: params.amount,
				desc: params.desc,
			};
			publish();
			return { kind: "opened", platformOrderId };
		},
		walletResult(platformOrderId, signal) {
			const known = chosen.get(platformOrderId);
			if (known !== undefined) {
				chosen.delete(platformOrderId);
				return Promise.resolve(known);
			}
			return new Promise((resolve) => {
				waiting.set(platformOrderId, resolve);
				signal.addEventListener(
					"abort",
					() => {
						waiting.delete(platformOrderId);
						if (open?.platformOrderId === platformOrderId) {
							open = null;
							publish();
						}
						resolve("unknown");
					},
					{ once: true },
				);
			});
		},
		async openTransfer(_orderId, qr) {
			recorded.push({ api: "openCheckoutPopup", params: qr });
			if (options.transfer === "pay")
				return { kind: "paid", platformOrderId: null };
			if (options.transfer === "close")
				return { kind: "closed", platformOrderId: null };
			return { kind: "unavailable" };
		},
		sheet: () => open,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		choose(choice) {
			const current = open;
			if (current === null) return;
			open = null;
			publish();
			if (choice === "pay" && !options.claimOnly)
				options.gateway?.(current.orderId, "paid");
			settle(current.platformOrderId, choice === "pay" ? "paid" : "left");
		},
		calls: () => recorded.map((call) => call),
	};
}

export function isStandInPort(port: CheckoutPort): port is StandInCheckoutPort {
	return port.kind === "stand-in";
}
