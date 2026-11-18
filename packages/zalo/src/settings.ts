import { ZALO_GRAPH_BASE_URL } from "./graph.js";

export const ZALO_INTEGRATION_VARIABLE = "ZALO_INTEGRATION";
export const ZALO_TENANT_VARIABLE = "ZALO_TENANT_ID";
export const ZALO_GRAPH_BASE_URL_VARIABLE = "ZALO_GRAPH_BASE_URL";
export const ZALO_FIXTURE_SLUG_PREFIX = "zalo-it-";

const LOOPBACK_BASE_URL = /^http:\/\/(127\.0\.0\.1|localhost):[0-9]{1,5}$/;
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ZaloEnvironment = Readonly<Record<string, string | undefined>>;

export interface ZaloSettings {
	readonly integration: boolean;
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

function present(value: string | undefined): string | null {
	return value === undefined || value.trim() === "" ? null : value.trim();
}

export function zaloSettings(environment: ZaloEnvironment): ZaloSettings {
	const gate = present(environment[ZALO_INTEGRATION_VARIABLE]);
	if (gate !== null && gate !== "1" && gate !== "0") {
		throw new ZaloConfigError(
			`${ZALO_INTEGRATION_VARIABLE} must be 1, 0 or unset`,
		);
	}
	const integration = gate === "1";
	const tenantId = present(environment[ZALO_TENANT_VARIABLE]);
	if (tenantId !== null && !UUID_PATTERN.test(tenantId)) {
		throw new ZaloConfigError(`${ZALO_TENANT_VARIABLE} must be a tenant id`);
	}
	if (integration && tenantId === null) {
		throw new ZaloConfigError(
			`${ZALO_INTEGRATION_VARIABLE}=1 needs ${ZALO_TENANT_VARIABLE}, the id of a ${ZALO_FIXTURE_SLUG_PREFIX} fixture tenant`,
		);
	}
	const override = present(environment[ZALO_GRAPH_BASE_URL_VARIABLE]);
	if (override !== null && !integration) {
		throw new ZaloConfigError(
			`${ZALO_GRAPH_BASE_URL_VARIABLE} is accepted only with ${ZALO_INTEGRATION_VARIABLE}=1`,
		);
	}
	if (override !== null && !isLoopbackBaseUrl(override)) {
		throw new ZaloConfigError(
			`${ZALO_GRAPH_BASE_URL_VARIABLE} must be a loopback address such as http://127.0.0.1:8788`,
		);
	}
	return {
		integration,
		tenantId: tenantId === null ? null : tenantId.toLowerCase(),
		graphBaseUrl: override ?? ZALO_GRAPH_BASE_URL,
	};
}

export function isFixtureTenantSlug(slug: string): boolean {
	return slug.startsWith(ZALO_FIXTURE_SLUG_PREFIX);
}
