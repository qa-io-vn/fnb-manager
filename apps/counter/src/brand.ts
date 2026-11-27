import type { BrandTheme } from "@fnb/zalo-mini/app-config";

/** What a counter build knows of its brand (vite/counter-config.ts writes it into "virtual:counter-config"). */
export interface CounterConfig {
	readonly brand: string;
	readonly title: { readonly vi: string; readonly en: string };
	readonly theme: BrandTheme | null;
}
