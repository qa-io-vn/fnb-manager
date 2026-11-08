import type { SupabaseClient } from "@supabase/supabase-js";
import { type SupabaseConfig, supabaseConfig } from "./env";

let pendingClient: Promise<SupabaseClient> | null = null;

export async function createBrowserClient(
	config: SupabaseConfig,
): Promise<SupabaseClient> {
	const { createClient } = await import("@supabase/supabase-js");
	return createClient(config.url, config.publishableKey, {
		auth: {
			flowType: "pkce",
			persistSession: true,
			autoRefreshToken: true,
			detectSessionInUrl: true,
		},
	});
}

export type SupabaseClientLoader = () => Promise<SupabaseClient>;

export function configuredClientLoader(): SupabaseClientLoader | null {
	const config = supabaseConfig;
	if (config === null) return null;
	return () => {
		pendingClient ??= createBrowserClient(config);
		return pendingClient;
	};
}
