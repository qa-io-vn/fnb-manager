/** Where the counter finds its backend: the Supabase API with its publishable key, and the sign-in function. */
export interface CounterEnvironment {
	readonly supabaseUrl: string;
	readonly publishableKey: string;
	readonly sessionUrl: string;
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
	return {
		supabaseUrl,
		publishableKey,
		sessionUrl,
		brand: (env.VITE_BRAND_KEY ?? "").trim() || fallbackBrand,
	};
}
