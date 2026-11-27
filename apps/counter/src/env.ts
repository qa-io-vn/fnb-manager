/**
 * Where the counter finds its backend: the Supabase API with its publishable key, the sign-in function, and the
 * online payment function (checkout-order, the VietQR of "Thu tiền").
 */
export interface CounterEnvironment {
	readonly supabaseUrl: string;
	readonly publishableKey: string;
	readonly sessionUrl: string;
	readonly checkoutUrl: string;
	readonly brand: string;
}

export function counterEnvironment(
	env: Readonly<Record<string, string | undefined>>,
	fallbackBrand: string,
): CounterEnvironment | null {
	const supabaseUrl = (env.VITE_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
	const publishableKey = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
	if (supabaseUrl === "" || publishableKey === "") {
		return null;
	}
	const sessionUrl =
		(env.VITE_COUNTER_SESSION_URL ?? "").trim() ||
		`${supabaseUrl}/functions/v1/counter-session`;
	const checkoutUrl =
		(env.VITE_CHECKOUT_ORDER_URL ?? "").trim() ||
		`${supabaseUrl}/functions/v1/checkout-order`;
	return {
		supabaseUrl,
		publishableKey,
		sessionUrl,
		checkoutUrl,
		brand: (env.VITE_BRAND_KEY ?? "").trim() || fallbackBrand,
	};
}
