import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadEnv, type Plugin } from "vite";
import {
	type AppConfig,
	AppConfigError,
	buildAppConfig,
	type MiniAppBuildConfig,
	type MiniAppKind,
	parseMiniAppConfiguration,
	readAppConfig,
	selectMiniAppRow,
} from "../app-config/index.ts";
import { ZALO_SESSION_PATH } from "../session/endpoint.ts";
import {
	ACCESS_KEY_PATTERN,
	guardUpgrades,
	type LocalAccess,
	localAccessGuard,
	TUNNEL_HOST_PATTERN,
} from "./access-guard.ts";

export {
	ACCESS_COOKIE,
	ACCESS_KEY_PARAMETER,
	type AccessDecision,
	type AccessRequest,
	accessCookieName,
	accessDecision,
	FORBIDDEN_PAGE,
	guardUpgrades,
	isForwarded,
	isLoopbackAddress,
	type LocalAccess,
	localAccessGuard,
	SECURE_ACCESS_COOKIE,
} from "./access-guard.ts";

export const MINI_APP_RUNTIMES = ["browser", "zalo"] as const;
export type MiniAppRuntime = (typeof MINI_APP_RUNTIMES)[number];

export const MINI_APP_STAGES = ["development", "testing"] as const;
export type MiniAppStage = (typeof MINI_APP_STAGES)[number];

export const MINI_APP_SESSIONS = ["stand-in", "local"] as const;
export type MiniAppSession = (typeof MINI_APP_SESSIONS)[number];

export const LOCAL_SESSION_URL_VARIABLE = "ZALO_LOCAL_SESSION_URL";
export const LOCAL_ACCESS_TOKEN_VARIABLE = "ZALO_LOCAL_ACCESS_TOKEN";
export const LOCAL_ACCESS_KEY_VARIABLE = "ZALO_LOCAL_ACCESS_KEY";
export const LOCAL_TUNNEL_HOST_VARIABLE = "ZALO_LOCAL_TUNNEL_HOST";
export const LOCAL_SUPABASE_URL_VARIABLE = "ZALO_LOCAL_SUPABASE_URL";
export const LOCAL_SUPABASE_PATH = "/supabase";
export const LOCAL_SUPABASE_SERVICES = ["rest", "auth"] as const;
const LOOPBACK_URL = /^http:\/\/(127\.0\.0\.1|localhost):[0-9]{1,5}$/;

export const VIRTUAL_APP_CONFIG = "virtual:mini-app-config";
const RESOLVED_VIRTUAL_APP_CONFIG = `\0${VIRTUAL_APP_CONFIG}`;
export const FORBIDDEN_IMPORTS: readonly string[] = ["echarts", "zrender"];
export const SYNTHETIC_BRAND = "brand-1";
export const MINI_APP_BUILD_TARGET = "es2015";
const CHUNK_WARNING_KB = 3000;

export const MOCK_SDK_PATH = join(
	import.meta.dirname,
	"..",
	"testing",
	"mock-sdk.ts",
);
export const SYNTHETIC_CONFIGURATION_PATH = join(
	import.meta.dirname,
	"..",
	"..",
	"config",
	"synthetic-brands.json",
);

export interface LocalSessionSettings {
	readonly functionUrl: string;
	readonly accessToken: string;
	readonly supabaseUrl: string | null;
	readonly access: LocalAccess;
}

export interface MiniAppSettings {
	readonly runtime: MiniAppRuntime;
	readonly stage: MiniAppStage;
	readonly session: MiniAppSession;
	readonly local: LocalSessionSettings | null;
	readonly brand: string;
	readonly appConfigPath: string;
}

export interface MiniAppPluginOptions {
	readonly kind: MiniAppKind;
	readonly appRoot: string;
	readonly developmentOnlyMarkers?: readonly string[];
}

function pick<T extends string>(
	allowed: readonly T[],
	value: string | undefined,
	fallback: T,
	name: string,
): T {
	if (value === undefined || value === "") return fallback;
	const match = allowed.find((candidate) => candidate === value);
	if (!match) {
		throw new Error(`${name} must be one of ${allowed.join(", ")}`);
	}
	return match;
}

export function miniAppSettings(
	env: Readonly<Record<string, string | undefined>>,
	command: "build" | "serve",
	appRoot: string,
): MiniAppSettings {
	const runtime = pick(
		MINI_APP_RUNTIMES,
		env.VITE_ZALO_RUNTIME,
		"browser",
		"VITE_ZALO_RUNTIME",
	);
	const stage = pick(
		MINI_APP_STAGES,
		env.VITE_MINI_APP_STAGE,
		command === "serve" ? "development" : "testing",
		"VITE_MINI_APP_STAGE",
	);
	const session = pick(
		MINI_APP_SESSIONS,
		env.VITE_ZALO_SESSION,
		"stand-in",
		"VITE_ZALO_SESSION",
	);
	const brand = env.VITE_BRAND_KEY?.trim() || "";
	if (runtime === "zalo") {
		const missing = [
			"VITE_BRAND_KEY",
			"VITE_SUPABASE_URL",
			"VITE_SUPABASE_PUBLISHABLE_KEY",
		].filter((name) => !env[name]?.trim());
		if (missing.length > 0) {
			throw new Error(`a Zalo build needs ${missing.join(", ")}`);
		}
	}
	return {
		runtime,
		stage,
		session,
		local:
			session === "local" ? localSessionSettings(env, runtime, command) : null,
		brand: brand || SYNTHETIC_BRAND,
		appConfigPath: resolve(appRoot, env.MINI_APP_CONFIG || "app-config.json"),
	};
}

function localSessionSettings(
	env: Readonly<Record<string, string | undefined>>,
	runtime: MiniAppRuntime,
	command: "build" | "serve",
): LocalSessionSettings {
	if (runtime !== "browser" || command !== "serve") {
		throw new Error(
			"VITE_ZALO_SESSION=local runs only on the browser dev server, never in a build",
		);
	}
	const functionUrl = env[LOCAL_SESSION_URL_VARIABLE]?.trim() ?? "";
	if (!LOOPBACK_URL.test(functionUrl)) {
		throw new Error(
			`VITE_ZALO_SESSION=local needs ${LOCAL_SESSION_URL_VARIABLE}, the loopback address of the local zalo-session such as http://127.0.0.1:5745`,
		);
	}
	const accessToken = env[LOCAL_ACCESS_TOKEN_VARIABLE]?.trim() ?? "";
	if (accessToken === "") {
		throw new Error(
			`VITE_ZALO_SESSION=local needs ${LOCAL_ACCESS_TOKEN_VARIABLE}, the mock Zalo access token of the local user`,
		);
	}
	const supabaseUrl = env[LOCAL_SUPABASE_URL_VARIABLE]?.trim() ?? "";
	if (supabaseUrl !== "" && !LOOPBACK_URL.test(supabaseUrl)) {
		throw new Error(
			`${LOCAL_SUPABASE_URL_VARIABLE} must be the loopback address of the local Supabase API such as http://127.0.0.1:54321`,
		);
	}
	return {
		functionUrl,
		accessToken,
		supabaseUrl: supabaseUrl === "" ? null : supabaseUrl,
		access: localAccess(env),
	};
}

function localAccess(
	env: Readonly<Record<string, string | undefined>>,
): LocalAccess {
	const key = env[LOCAL_ACCESS_KEY_VARIABLE]?.trim() ?? "";
	if (key !== "" && !ACCESS_KEY_PATTERN.test(key)) {
		throw new Error(
			`${LOCAL_ACCESS_KEY_VARIABLE} must be a random key of 22 to 128 base64url characters (at least 128 bits)`,
		);
	}
	const tunnelHost = env[LOCAL_TUNNEL_HOST_VARIABLE]?.trim() ?? "";
	if (tunnelHost !== "" && !TUNNEL_HOST_PATTERN.test(tunnelHost)) {
		throw new Error(
			`${LOCAL_TUNNEL_HOST_VARIABLE} must be a quick tunnel host such as name.trycloudflare.com`,
		);
	}
	if (tunnelHost !== "" && key === "") {
		throw new Error(
			`${LOCAL_TUNNEL_HOST_VARIABLE} needs ${LOCAL_ACCESS_KEY_VARIABLE}: a tunnel serves only visitors with the key`,
		);
	}
	return {
		key: key === "" ? null : key,
		tunnelHost: tunnelHost === "" ? null : tunnelHost,
	};
}

export function loadMiniAppConfig(
	settings: MiniAppSettings,
	kind: MiniAppKind,
): AppConfig {
	if (existsSync(settings.appConfigPath)) {
		return readAppConfig(
			JSON.parse(readFileSync(settings.appConfigPath, "utf8")),
		);
	}
	if (settings.runtime === "zalo") {
		throw new AppConfigError([
			"a Zalo build needs the generated app-config.json of its brand",
		]);
	}
	const rows = parseMiniAppConfiguration(
		JSON.parse(readFileSync(SYNTHETIC_CONFIGURATION_PATH, "utf8")),
	);
	return buildAppConfig(selectMiniAppRow(rows, SYNTHETIC_BRAND, kind));
}

export function forbiddenImport(source: string): string | null {
	const bare = source.replace(/^\0/, "");
	return (
		FORBIDDEN_IMPORTS.find(
			(name) => bare === name || bare.startsWith(`${name}/`),
		) ?? null
	);
}

export function forbidHeavyImports(): Plugin {
	return {
		name: "fnb-mini-app-forbidden-imports",
		enforce: "pre",
		resolveId(source) {
			const name = forbiddenImport(source);
			if (name) {
				this.error(
					`${name} is not allowed in a Mini App (bundle budget, NFR-PERF-09)`,
				);
			}
			return null;
		},
	};
}

interface OutputChunkLike {
	readonly type: "chunk";
	readonly fileName: string;
	readonly isEntry: boolean;
	readonly imports: readonly string[];
}

interface OutputAssetLike {
	readonly type: "asset";
	readonly fileName: string;
}

type OutputLike = OutputChunkLike | OutputAssetLike;

interface OutputContentLike {
	readonly fileName: string;
	readonly code?: string;
	readonly source?: string | Uint8Array;
}

export function developmentOnlyLeaks(
	stage: MiniAppStage,
	markers: readonly string[],
	bundle: Readonly<Record<string, OutputContentLike>>,
): string[] {
	if (stage !== "testing") return [];
	return Object.values(bundle).flatMap((output) => {
		const content =
			output.code ??
			(typeof output.source === "string"
				? output.source
				: new TextDecoder().decode(output.source ?? new Uint8Array()));
		return markers
			.filter((marker) => content.includes(marker))
			.map((marker) => `${output.fileName} contains ${marker}`);
	});
}

export function deployedAppConfig(
	config: AppConfig,
	bundle: Readonly<Record<string, OutputLike>>,
): AppConfig {
	const outputs = Object.values(bundle);
	const entries = outputs.filter(
		(output): output is OutputChunkLike =>
			output.type === "chunk" && output.isEntry,
	);
	const preloaded: string[] = [];
	const seen = new Set<string>();
	const visit = (chunk: OutputChunkLike) => {
		for (const file of chunk.imports) {
			const imported = bundle[file];
			if (imported?.type !== "chunk" || seen.has(file)) continue;
			seen.add(file);
			visit(imported);
			preloaded.push(file);
		}
	};
	for (const entry of entries) visit(entry);
	return {
		app: config.app,
		listCSS: [
			...outputs
				.filter(
					(output) =>
						output.type === "asset" && output.fileName.endsWith(".css"),
				)
				.map((output) => output.fileName),
			...config.listCSS,
		],
		listSyncJS: [
			...entries.map((entry) => entry.fileName),
			...config.listSyncJS,
		],
		listAsyncJS: [...preloaded, ...config.listAsyncJS],
	};
}

export interface LocalProxyRoute {
	readonly target: string;
	readonly changeOrigin: true;
	readonly rewrite?: (path: string) => string;
}

function withoutSupabasePath(path: string): string {
	return path.slice(LOCAL_SUPABASE_PATH.length);
}

export function localSessionProxy(local: LocalSessionSettings): {
	readonly proxy: Record<string, LocalProxyRoute>;
} {
	const supabaseUrl = local.supabaseUrl;
	return {
		proxy: {
			[ZALO_SESSION_PATH]: { target: local.functionUrl, changeOrigin: true },
			...(supabaseUrl === null
				? {}
				: Object.fromEntries(
						LOCAL_SUPABASE_SERVICES.map((service) => [
							`${LOCAL_SUPABASE_PATH}/${service}/v1/`,
							{
								target: supabaseUrl,
								changeOrigin: true,
								rewrite: withoutSupabasePath,
							} satisfies LocalProxyRoute,
						]),
					)),
		},
	};
}

export function localServerOptions(local: LocalSessionSettings): {
	readonly proxy: Record<string, LocalProxyRoute>;
	readonly allowedHosts?: string[];
	readonly hmr?: false;
} {
	const tunnelHost = local.access.tunnelHost;
	return {
		...localSessionProxy(local),
		...(tunnelHost === null ? {} : { allowedHosts: [tunnelHost], hmr: false }),
	};
}

export function miniApp(options: MiniAppPluginOptions): Plugin[] {
	let settings: MiniAppSettings | null = null;
	let appConfig: AppConfig | null = null;
	const current = () => {
		if (!settings || !appConfig)
			throw new Error("the Mini App plugin ran out of order");
		return { settings, appConfig };
	};
	const main: Plugin = {
		name: "fnb-mini-app",
		config(userConfig, env) {
			const loaded = loadEnv(
				env.mode,
				userConfig.envDir === false
					? options.appRoot
					: (userConfig.envDir ?? options.appRoot),
				["VITE_", "MINI_APP_"],
			);
			settings = miniAppSettings(
				{ ...loaded, ...process.env },
				env.command,
				options.appRoot,
			);
			appConfig = loadMiniAppConfig(settings, options.kind);
			const local = settings.local;
			return {
				...(env.command === "build" ? { base: "./" } : {}),
				define: {
					"import.meta.env.VITE_ZALO_RUNTIME": JSON.stringify(settings.runtime),
					"import.meta.env.VITE_MINI_APP_STAGE": JSON.stringify(settings.stage),
					"import.meta.env.VITE_BRAND_KEY": JSON.stringify(settings.brand),
					"import.meta.env.VITE_ZALO_SESSION": JSON.stringify(settings.session),
					"import.meta.env.VITE_ZALO_MOCK_ACCESS_TOKEN": JSON.stringify(
						local?.accessToken ?? "",
					),
				},
				...(local ? { server: localServerOptions(local) } : {}),
				resolve:
					settings.runtime === "browser"
						? { alias: [{ find: /^zmp-sdk$/, replacement: MOCK_SDK_PATH }] }
						: {},
				build: {
					target: MINI_APP_BUILD_TARGET,
					chunkSizeWarningLimit: CHUNK_WARNING_KB,
					rolldownOptions: {
						output: {
							entryFileNames: "assets/[name].[hash].module.js",
							chunkFileNames: "assets/[name].[hash].module.js",
						},
					},
				},
			};
		},
		configureServer: {
			order: "pre",
			handler(server) {
				const local = current().settings.local;
				if (!local) return;
				server.middlewares.use(localAccessGuard(local.access));
				return () => {
					if (server.httpServer) guardUpgrades(server.httpServer, local.access);
				};
			},
		},
		resolveId(source) {
			return source === VIRTUAL_APP_CONFIG ? RESOLVED_VIRTUAL_APP_CONFIG : null;
		},
		load(id) {
			if (id !== RESOLVED_VIRTUAL_APP_CONFIG) return null;
			const { settings: active, appConfig: config } = current();
			const value: MiniAppBuildConfig = {
				brand: active.brand,
				kind: options.kind,
				app: config.app,
			};
			return `export default ${JSON.stringify(value)};`;
		},
		transformIndexHtml(html) {
			const title = current()
				.appConfig.app.title.replaceAll("&", "&amp;")
				.replaceAll("<", "&lt;");
			return html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
		},
		generateBundle(_outputOptions, bundle) {
			const leaks = developmentOnlyLeaks(
				current().settings.stage,
				options.developmentOnlyMarkers ?? [],
				bundle,
			);
			if (leaks.length > 0) {
				this.error(
					`a Testing build must not contain Development-only screens: ${leaks.join(", ")}`,
				);
			}
		},
		writeBundle(outputOptions, bundle) {
			const outDir = outputOptions.dir;
			if (!outDir) return;
			const deployed = deployedAppConfig(current().appConfig, bundle);
			writeFileSync(
				join(outDir, "app-config.json"),
				`${JSON.stringify(deployed)}\n`,
			);
		},
	};
	return [forbidHeavyImports(), main];
}
