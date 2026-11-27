import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	type BrandTheme,
	buildAppConfig,
	buildThemeOf,
	parseMiniAppConfiguration,
	readAppConfig,
	selectMiniAppRow,
} from "@fnb/zalo-mini/app-config";
import type { Plugin } from "vite";

/**
 * The brand of a counter build (ADR-066): its look and names come from the same configuration as the brand's staff
 * Mini App, so the code stays generic. COUNTER_APP_CONFIG names the brand's generated app-config.json (private, made
 * by the app-config command); without it the synthetic configuration of the repository is used for VITE_BRAND_KEY
 * (brand-1 by default). The configuration reaches the app as the virtual module "virtual:counter-config".
 */

export const VIRTUAL_COUNTER_CONFIG = "virtual:counter-config";
const RESOLVED = `\0${VIRTUAL_COUNTER_CONFIG}`;
export const SYNTHETIC_BRAND = "brand-1";
const SYNTHETIC_CONFIGURATION = join(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"packages",
	"zalo-mini",
	"config",
	"synthetic-brands.json",
);

export interface CounterConfig {
	readonly brand: string;
	readonly title: { readonly vi: string; readonly en: string };
	readonly theme: BrandTheme | null;
}

export function loadCounterConfig(
	env: Readonly<Record<string, string | undefined>>,
	appRoot: string,
): CounterConfig {
	const brand = env.VITE_BRAND_KEY?.trim() || SYNTHETIC_BRAND;
	const configured = env.COUNTER_APP_CONFIG?.trim() ?? "";
	if (configured !== "") {
		const path = resolve(appRoot, configured);
		if (!existsSync(path)) {
			throw new Error(`COUNTER_APP_CONFIG names ${path}, which does not exist`);
		}
		const config = readAppConfig(JSON.parse(readFileSync(path, "utf8")));
		return {
			brand,
			title: config.app.headerTitle,
			theme: buildThemeOf(config),
		};
	}
	const rows = parseMiniAppConfiguration(
		JSON.parse(readFileSync(SYNTHETIC_CONFIGURATION, "utf8")),
	);
	const named = rows.some(
		(row) => row.brand_key === brand && row.kind === "staff",
	);
	const config = buildAppConfig(
		selectMiniAppRow(rows, named ? brand : SYNTHETIC_BRAND, "staff"),
	);
	return { brand, title: config.app.headerTitle, theme: buildThemeOf(config) };
}

export function counterConfig(appRoot: string): Plugin {
	let config: CounterConfig | null = null;
	return {
		name: "fnb-counter-config",
		configResolved(resolved) {
			config = loadCounterConfig({ ...process.env, ...resolved.env }, appRoot);
		},
		resolveId(id) {
			return id === VIRTUAL_COUNTER_CONFIG ? RESOLVED : null;
		},
		load(id) {
			if (id !== RESOLVED || config === null) return null;
			return `export default ${JSON.stringify(config)};`;
		},
	};
}
