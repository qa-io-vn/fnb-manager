import { isLocalDatabaseHost } from "@fnb/sync/postgres";
import { type DatabaseSetting, databaseSetting } from "../config/config.js";
import { type Environment, parseEnvFile } from "../config/env-file.js";

export type Locality = "local" | "remote";

export interface Endpoint {
	locality: Locality;
	projectRef: string | null;
}

export interface BackendTarget {
	databaseVariable: DatabaseSetting["variable"];
	database: Endpoint;
	api: Endpoint | null;
	problem: string | null;
}

const API_HOST = /^([a-z0-9]+)\.supabase\.(?:co|in)$/;
const DIRECT_DATABASE_HOST = /^db\.([a-z0-9]+)\.supabase\.(?:co|in)$/;
const POOLER_USER = /^postgres\.([a-z0-9]+)$/;

function parsedUrl(value: string | undefined): URL | null {
	if (!value) {
		return null;
	}
	try {
		return new URL(value);
	} catch {
		return null;
	}
}

function locality(host: string): Locality {
	return isLocalDatabaseHost(host) ? "local" : "remote";
}

export function databaseEndpoint(url: string): Endpoint {
	const parsed = parsedUrl(url);
	if (!parsed) {
		return { locality: "remote", projectRef: null };
	}
	const host = parsed.hostname.toLowerCase();
	const ref =
		DIRECT_DATABASE_HOST.exec(host)?.[1] ??
		POOLER_USER.exec(decodeURIComponent(parsed.username).toLowerCase())?.[1] ??
		null;
	return { locality: locality(host), projectRef: ref };
}

export function apiEndpoint(url: string | undefined): Endpoint | null {
	const parsed = parsedUrl(url);
	if (!parsed || !/^https?:$/.test(parsed.protocol)) {
		return null;
	}
	const host = parsed.hostname.toLowerCase();
	return {
		locality: locality(host),
		projectRef: API_HOST.exec(host)?.[1] ?? null,
	};
}

export function describeEndpoint(endpoint: Endpoint): string {
	return endpoint.locality === "local" ? "the local stack" : "a remote project";
}

function targetProblem(
	variable: DatabaseSetting["variable"],
	database: Endpoint,
	api: Endpoint | null,
): string | null {
	if (api === null) {
		return null;
	}
	if (database.locality !== api.locality) {
		return `${variable} points at ${describeEndpoint(database)} but SUPABASE_URL at ${describeEndpoint(api)}, so the web app would not see the loaded data. Point both at the same backend in .env (with CI set, SUPABASE_DB_URL is read before DATABASE_URL; an empty value in the environment hides the file's).`;
	}
	if (
		database.projectRef !== null &&
		api.projectRef !== null &&
		database.projectRef !== api.projectRef
	) {
		return `${variable} and SUPABASE_URL belong to two different Supabase projects; point both at the same project in .env.`;
	}
	return null;
}

export function backendTarget(environment: Environment): BackendTarget {
	const setting = databaseSetting(environment);
	const database = databaseEndpoint(setting.url);
	const api = apiEndpoint(environment.SUPABASE_URL);
	return {
		databaseVariable: setting.variable,
		database,
		api,
		problem: targetProblem(setting.variable, database, api),
	};
}

export const WEB_ENV_FILE = "apps/web/.env.local";

export type WebEnvPlan =
	| { kind: "write"; content: string }
	| { kind: "missing"; variables: string[] };

export function webEnvPlan(environment: Environment): WebEnvPlan {
	const url = environment.SUPABASE_URL?.trim() ?? "";
	const key = environment.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
	const missing = [
		...(apiEndpoint(url) === null ? ["SUPABASE_URL"] : []),
		...(key === "" ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
	];
	if (missing.length > 0) {
		return { kind: "missing", variables: missing };
	}
	return {
		kind: "write",
		content: `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_PUBLISHABLE_KEY=${key}\n`,
	};
}

function sameUrl(left: string, right: string): boolean {
	return left.trim().replace(/\/+$/, "") === right.trim().replace(/\/+$/, "");
}

export function webEnvWarnings(
	existingText: string,
	environment: Environment,
): string[] {
	const existing = parseEnvFile(existingText);
	const url = existing.VITE_SUPABASE_URL?.trim() ?? "";
	const key = existing.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
	const warnings: string[] = [];
	if (url === "" || key === "") {
		warnings.push(
			`${WEB_ENV_FILE} leaves VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY empty, so the dev server runs the demo; fill both from .env or pnpm db:status`,
		);
	} else if (
		environment.SUPABASE_URL &&
		!sameUrl(url, environment.SUPABASE_URL)
	) {
		warnings.push(
			`${WEB_ENV_FILE} points at another API than SUPABASE_URL in .env, so the web app may not show the loaded data; it was left as it is`,
		);
	}
	return warnings;
}
