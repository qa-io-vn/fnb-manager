export interface SupabaseConfig {
	url: string;
	publishableKey: string;
}

export function supabaseConfigFrom(
	url: string | undefined,
	publishableKey: string | undefined,
): SupabaseConfig | null {
	const trimmedUrl = url?.trim() ?? "";
	const trimmedKey = publishableKey?.trim() ?? "";
	if (trimmedUrl === "" || trimmedKey === "") return null;
	return { url: trimmedUrl, publishableKey: trimmedKey };
}

export const supabaseConfig: SupabaseConfig | null = supabaseConfigFrom(
	import.meta.env.VITE_SUPABASE_URL,
	import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
