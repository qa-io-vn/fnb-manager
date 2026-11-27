/// <reference types="vite/client" />

declare module "virtual:counter-config" {
	const config: import("./brand").CounterConfig;
	export default config;
}

interface ImportMetaEnv {
	readonly VITE_SUPABASE_URL?: string;
	readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
	readonly VITE_COUNTER_SESSION_URL?: string;
	readonly VITE_BRAND_KEY?: string;
}
