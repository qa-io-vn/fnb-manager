import type { PaymentMethod } from "@fnb/zalo-mini/ordering";

/**
 * Ordering with prices (VITE_ORDERING=on, set by the build; ADR-058, ADR-062): only in builds for testers until the
 * Checkout SDK is integrated, because Zalo's review asks for it as soon as an app shows prices and takes orders. Off,
 * the app is the loyalty app it was, with no price anywhere.
 */
export const ORDERING_ENABLED = import.meta.env.VITE_ORDERING === "on";

/**
 * The online ways to pay (ZaloPay through the Checkout SDK, a dynamic VietQR with the bank's notification), a build
 * flag on top of ordering (VITE_ONLINE_PAYMENT=on). Off, they are shown as the owner drew them but disabled with a
 * note; on, each one works where the store offers it (its ordering state's payment_methods, which the server fills
 * only when the method's provider is configured).
 */
export const ONLINE_PAYMENT_ENABLED =
	ORDERING_ENABLED && import.meta.env.VITE_ONLINE_PAYMENT === "on";

/**
 * Whether a way to pay can be chosen: the counter always (the server refuses it where the store does not take it), an
 * online method only with the build flag (`online`, ONLINE_PAYMENT_ENABLED) and when the store offers it.
 */
export function methodSelectable(
	method: PaymentMethod,
	offered: readonly PaymentMethod[],
	online: boolean,
): boolean {
	return method === "counter" || (online && offered.includes(method));
}
