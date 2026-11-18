import { ZALO_GRAPH_BASE_URL } from "./graph.js";

export const ZALO_INTEGRATION_VARIABLE = "ZALO_INTEGRATION";
export const ZALO_LOCAL_DEV_VARIABLE = "ZALO_LOCAL_DEV";
export const ZALO_TENANT_VARIABLE = "ZALO_TENANT_ID";
export const ZALO_GRAPH_BASE_URL_VARIABLE = "ZALO_GRAPH_BASE_URL";
export const ZALO_FIXTURE_SLUG_PREFIX = "zalo-it-";
export const LOCAL_SUPABASE_URL_VARIABLE = "SUPABASE_URL";
export const LOCAL_DATABASE_URL_VARIABLE = "SUPABASE_DB_URL";

const LOOPBACK_BASE_URL = /^http:\/\/(127\.0\.0\.1|localhost):[0-9]{1,5}$/;
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);
const DATABASE_PROTOCOLS: ReadonlySet<string> = new Set([
	"postgres:",
	"postgresql:",
]);
const DATABASE_HOST_PARAMETERS = ["host", "hostaddr"];
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ZaloEnvironment = Readonly<Record<string, string | undefined>>;

export interface ZaloSettings {
	readonly integration: boolean;
	readonly local: boolean;
	readonly tenantId: string | null;
	readonly graphBaseUrl: string;
}

export class ZaloConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ZaloConfigError";
	}
}

export function isLoopbackBaseUrl(value: string): boolean {
	return LOOPBACK_BASE_URL.test(value);
}

export function isLoopbackDatabaseUrl(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	return (
		DATABASE_PROTOCOLS.has(url.protocol) &&
		LOOPBACK_HOSTS.has(url.hostname) &&
		DATABASE_HOST_PARAMETERS.every((name) => !url.searchParams.has(name))
	);
}

function present(value: string | undefined): string | null {
	return value === undefined || value.trim() === "" ? null : value.trim();
}

function switchValue(environment: ZaloEnvironment, name: string): boolean {
	const value = present(environment[name]);
	if (value !== null && value !== "1" && value !== "0") {
		throw new ZaloConfigError(`${name} must be 1, 0 or unset`);
	}
	return value === "1";
}

function requireLocalStack(environment: ZaloEnvironment): void {
	if (
		!isLoopbackBaseUrl(present(environment[LOCAL_SUPABASE_URL_VARIABLE]) ?? "")
	) {
		throw new ZaloConfigError(
			`${ZALO_LOCAL_DEV_VARIABLE}=1 runs only on the local stack: ${LOCAL_SUPABASE_URL_VARIABLE} must be a loopback address such as http://127.0.0.1:54321`,
		);
	}
	if (
		!isLoopbackDatabaseUrl(
			present(environment[LOCAL_DATABASE_URL_VARIABLE]) ?? "",
		)
	) {
		throw new ZaloConfigError(
			`${ZALO_LOCAL_DEV_VARIABLE}=1 runs only on the local stack: ${LOCAL_DATABASE_URL_VARIABLE} must name a database on 127.0.0.1 or localhost`,
		);
	}
}

export function zaloSettings(environment: ZaloEnvironment): ZaloSettings {
	const integration = switchValue(environment, ZALO_INTEGRATION_VARIABLE);
	const local = switchValue(environment, ZALO_LOCAL_DEV_VARIABLE);
	if (integration && local) {
		throw new ZaloConfigError(
			`${ZALO_INTEGRATION_VARIABLE}=1 and ${ZALO_LOCAL_DEV_VARIABLE}=1 exclude each other`,
		);
	}
	const tenantId = present(environment[ZALO_TENANT_VARIABLE]);
	if (tenantId !== null && !UUID_PATTERN.test(tenantId)) {
		throw new ZaloConfigError(`${ZALO_TENANT_VARIABLE} must be a tenant id`);
	}
	if (integration && tenantId === null) {
		throw new ZaloConfigError(
			`${ZALO_INTEGRATION_VARIABLE}=1 needs ${ZALO_TENANT_VARIABLE}, the id of a ${ZALO_FIXTURE_SLUG_PREFIX} fixture tenant`,
		);
	}
	if (local) {
		requireLocalStack(environment);
		if (tenantId === null) {
			throw new ZaloConfigError(
				`${ZALO_LOCAL_DEV_VARIABLE}=1 needs ${ZALO_TENANT_VARIABLE}, the id of the local tenant it serves`,
			);
		}
	}
	const override = present(environment[ZALO_GRAPH_BASE_URL_VARIABLE]);
	if (override !== null && !integration && !local) {
		throw new ZaloConfigError(
			`${ZALO_GRAPH_BASE_URL_VARIABLE} is accepted only with ${ZALO_INTEGRATION_VARIABLE}=1, or with ${ZALO_LOCAL_DEV_VARIABLE}=1 on the local stack`,
		);
	}
	if (override !== null && !isLoopbackBaseUrl(override)) {
		throw new ZaloConfigError(
			`${ZALO_GRAPH_BASE_URL_VARIABLE} must be a loopback address such as http://127.0.0.1:8788`,
		);
	}
	return {
		integration,
		local,
		tenantId: tenantId === null ? null : tenantId.toLowerCase(),
		graphBaseUrl: override ?? ZALO_GRAPH_BASE_URL,
	};
}

export function isFixtureTenantSlug(slug: string): boolean {
	return slug.startsWith(ZALO_FIXTURE_SLUG_PREFIX);
}
