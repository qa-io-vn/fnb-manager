import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import {
	isLoopbackBaseUrl,
	isLoopbackDatabaseUrl,
	LOCAL_DATABASE_URL_VARIABLE,
	LOCAL_SUPABASE_URL_VARIABLE,
	ZALO_GRAPH_BASE_URL_VARIABLE,
	ZALO_LOCAL_DEV_VARIABLE,
	ZALO_TENANT_VARIABLE,
	type ZaloEnvironment,
} from "../settings.js";
import { LocalLoopError } from "./options.js";

export const LOCAL_SESSION_URL_VARIABLE = "ZALO_LOCAL_SESSION_URL";
export const LOCAL_PHONE_URL_VARIABLE = "ZALO_LOCAL_PHONE_URL";
export const LOCAL_ACCESS_TOKEN_VARIABLE = "ZALO_LOCAL_ACCESS_TOKEN";
export const LOCAL_ACCESS_KEY_VARIABLE = "ZALO_LOCAL_ACCESS_KEY";
export const LOCAL_TUNNEL_HOST_VARIABLE = "ZALO_LOCAL_TUNNEL_HOST";
export const STAFF_SUPABASE_URL_VARIABLE = "ZALO_LOCAL_SUPABASE_URL";
export const DENO_SERVE_ADDRESS_VARIABLE = "DENO_SERVE_ADDRESS";

export const PASSTHROUGH_VARIABLES: readonly string[] = [
	"PATH",
	"Path",
	"PATHEXT",
	"SystemRoot",
	"SYSTEMROOT",
	"SystemDrive",
	"windir",
	"ComSpec",
	"TEMP",
	"TMP",
	"TMPDIR",
	"HOME",
	"USERPROFILE",
	"HOMEDRIVE",
	"HOMEPATH",
	"LOCALAPPDATA",
	"APPDATA",
	"XDG_CACHE_HOME",
	"DENO_DIR",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"LANG",
	"TZ",
];

export interface LocalStack {
	readonly supabaseUrl: string;
	readonly databaseUrl: string;
	readonly secretKey: string;
	readonly publishableKey: string;
}

function value(
	environment: ZaloEnvironment,
	...names: readonly string[]
): string {
	for (const name of names) {
		const found = environment[name]?.trim();
		if (found) {
			return found;
		}
	}
	return "";
}

export function findRepositoryRoot(
	start: string = dirname(fileURLToPath(import.meta.url)),
): string {
	let current = resolve(start);
	for (;;) {
		if (existsSync(join(current, "pnpm-workspace.yaml"))) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) {
			throw new LocalLoopError("could not find the repository root");
		}
		current = parent;
	}
}

export function withRepositoryEnv(
	rootDir: string,
	environment: ZaloEnvironment,
): ZaloEnvironment {
	const path = join(rootDir, ".env");
	const fromFile = existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
	const merged: Record<string, string | undefined> = { ...fromFile };
	for (const [name, current] of Object.entries(environment)) {
		if (current !== undefined && current.trim() !== "") {
			merged[name] = current;
		}
	}
	return merged;
}

export function localStackFrom(environment: ZaloEnvironment): LocalStack {
	const stack = {
		supabaseUrl: value(environment, "SUPABASE_URL").replace(/\/+$/, ""),
		databaseUrl: value(environment, "DATABASE_URL", "SUPABASE_DB_URL"),
		secretKey: value(
			environment,
			"SUPABASE_SECRET_KEY",
			"SUPABASE_SERVICE_ROLE_KEY",
		),
		publishableKey: value(
			environment,
			"SUPABASE_PUBLISHABLE_KEY",
			"SUPABASE_ANON_KEY",
		),
	};
	const missing = [
		["SUPABASE_URL", stack.supabaseUrl],
		["DATABASE_URL", stack.databaseUrl],
		["SUPABASE_SECRET_KEY", stack.secretKey],
		["SUPABASE_PUBLISHABLE_KEY", stack.publishableKey],
	]
		.filter(([, found]) => found === "")
		.map(([name]) => name);
	if (missing.length > 0) {
		throw new LocalLoopError(
			`the local loop needs ${missing.join(", ")} of the local stack in .env (pnpm db:status shows them)`,
		);
	}
	if (!isLoopbackBaseUrl(stack.supabaseUrl)) {
		throw new LocalLoopError(
			"SUPABASE_URL is not the local stack: the local loop runs only against a loopback API such as http://127.0.0.1:54321",
		);
	}
	if (!isLoopbackDatabaseUrl(stack.databaseUrl)) {
		throw new LocalLoopError(
			"DATABASE_URL is not the local stack: the local loop runs only against a database on 127.0.0.1",
		);
	}
	return stack;
}

export function passthroughEnvironment(
	environment: ZaloEnvironment,
): Record<string, string> {
	const kept: Record<string, string> = {};
	for (const name of PASSTHROUGH_VARIABLES) {
		const found = environment[name];
		if (found !== undefined && found !== "") {
			kept[name] = found;
		}
	}
	return kept;
}

export interface SessionFunctionInput {
	readonly stack: LocalStack;
	readonly tenantId: string;
	readonly graphBaseUrl: string;
	readonly secretName: string;
	readonly appSecret: string;
	readonly port: number;
}

export function sessionFunctionEnvironment(
	environment: ZaloEnvironment,
	input: SessionFunctionInput,
): Record<string, string> {
	return {
		...passthroughEnvironment(environment),
		NO_COLOR: "1",
		[DENO_SERVE_ADDRESS_VARIABLE]: `tcp:127.0.0.1:${input.port}`,
		[LOCAL_SUPABASE_URL_VARIABLE]: input.stack.supabaseUrl,
		[LOCAL_DATABASE_URL_VARIABLE]: input.stack.databaseUrl,
		SUPABASE_SECRET_KEYS: JSON.stringify({ default: input.stack.secretKey }),
		[ZALO_LOCAL_DEV_VARIABLE]: "1",
		[ZALO_TENANT_VARIABLE]: input.tenantId,
		[ZALO_GRAPH_BASE_URL_VARIABLE]: input.graphBaseUrl,
		[input.secretName]: input.appSecret,
	};
}

export interface StaffAppInput {
	readonly brand: string;
	readonly publishableKey: string;
	readonly functionUrl: string;
	readonly phoneFunctionUrl: string;
	readonly accessToken: string;
	readonly appConfigPath: string | null;
	readonly access: StaffAppAccess | null;
}

export interface StaffAppAccess {
	readonly key: string;
	readonly tunnelHost: string | null;
	readonly supabaseUrl: string;
}

export function staffAppEnvironment(
	environment: ZaloEnvironment,
	input: StaffAppInput,
): Record<string, string> {
	return {
		...passthroughEnvironment(environment),
		VITE_ZALO_RUNTIME: "browser",
		VITE_ZALO_SESSION: "local",
		VITE_BRAND_KEY: input.brand,
		VITE_SUPABASE_PUBLISHABLE_KEY: input.publishableKey,
		[LOCAL_SESSION_URL_VARIABLE]: input.functionUrl,
		[LOCAL_PHONE_URL_VARIABLE]: input.phoneFunctionUrl,
		[LOCAL_ACCESS_TOKEN_VARIABLE]: input.accessToken,
		...(input.appConfigPath === null
			? {}
			: { MINI_APP_CONFIG: input.appConfigPath }),
		...(input.access === null
			? {}
			: {
					[LOCAL_ACCESS_KEY_VARIABLE]: input.access.key,
					[STAFF_SUPABASE_URL_VARIABLE]: input.access.supabaseUrl,
					...(input.access.tunnelHost === null
						? {}
						: { [LOCAL_TUNNEL_HOST_VARIABLE]: input.access.tunnelHost }),
				}),
	};
}

export interface CustomerDemoInput {
	readonly brand: string;
	readonly access: {
		readonly key: string;
		readonly tunnelHost: string | null;
	} | null;
}

export function customerDemoEnvironment(
	environment: ZaloEnvironment,
	input: CustomerDemoInput,
): Record<string, string> {
	return {
		...passthroughEnvironment(environment),
		VITE_ZALO_RUNTIME: "browser",
		VITE_ZALO_SESSION: "stand-in",
		VITE_BRAND_KEY: input.brand,
		...(input.access === null
			? {}
			: {
					[LOCAL_ACCESS_KEY_VARIABLE]: input.access.key,
					...(input.access.tunnelHost === null
						? {}
						: { [LOCAL_TUNNEL_HOST_VARIABLE]: input.access.tunnelHost }),
				}),
	};
}
