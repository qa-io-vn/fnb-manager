/**
 * Ordering with prices (VITE_ORDERING=on, set by the build; ADR-058, ADR-062): only in builds for testers until the
 * Checkout SDK is integrated, because Zalo's review asks for it as soon as an app shows prices and takes orders. Off,
 * the app is the loyalty app it was, with no price anywhere.
 */
export const ORDERING_ENABLED = import.meta.env.VITE_ORDERING === "on";

/**
 * The online ways to pay (ZaloPay through the Checkout SDK, a dynamic VietQR with the bank's notification): shown as
 * the owner drew them but disabled with a note until their providers and the server's Edge Functions exist (the
 * database already has the server-only seams, checkout_payment_start and checkout_payment_confirm).
 */
export const ONLINE_PAYMENT_READY = false;
