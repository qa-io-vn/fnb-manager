import {
	ZALO_GRAPH_BASE_URL_VARIABLE,
	ZALO_INTEGRATION_VARIABLE,
	ZALO_TENANT_VARIABLE,
	type ZaloEnvironment,
} from "../settings.js";

export const SYNTHETIC_SECRET_PREFIX = "synthetic-";
export const INTEGRATION_SECRET_NAME_PATTERN =
	/^ZALO_(APP|OA)_SECRET_IT_[A-Z0-9_]{1,40}$/;

export const ZALO_SYNTHETIC_ENVIRONMENT_KEYS = [
	"DATABASE_URL",
	"SUPABASE_URL",
	"SUPABASE_SECRET_KEYS",
	ZALO_INTEGRATION_VARIABLE,
	ZALO_TENANT_VARIABLE,
	ZALO_GRAPH_BASE_URL_VARIABLE,
	"ZALO_OAUTH_BASE_URL",
] as const;

export class SyntheticEnvironmentError extends Error {
	constructor(keys: readonly string[]) {
		super(
			`the test environment carries keys outside the synthetic list: ${keys.join(", ")}`,
		);
		this.name = "SyntheticEnvironmentError";
	}
}

export function assertSyntheticZaloEnvironment(
	environment: ZaloEnvironment,
): void {
	const allowed = new Set<string>(ZALO_SYNTHETIC_ENVIRONMENT_KEYS);
	const outside = Object.keys(environment).filter((key) => {
		if (allowed.has(key)) {
			return false;
		}
		return !(
			INTEGRATION_SECRET_NAME_PATTERN.test(key) &&
			(environment[key] ?? "").startsWith(SYNTHETIC_SECRET_PREFIX)
		);
	});
	if (outside.length > 0) {
		throw new SyntheticEnvironmentError(outside);
	}
}

export interface ZaloIntegrationGate {
	readonly enabled: boolean;
	readonly databaseUrl: string;
	readonly supabaseUrl: string;
	readonly secretKey: string;
	readonly publishableKey: string;
}

export function zaloIntegrationGate(
	environment: ZaloEnvironment,
): ZaloIntegrationGate {
	const databaseUrl = environment.DATABASE_URL ?? "";
	const supabaseUrl = environment.SUPABASE_URL ?? "";
	const secretKey = environment.SUPABASE_SECRET_KEY ?? "";
	const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY ?? "";
	return {
		enabled:
			environment[ZALO_INTEGRATION_VARIABLE] === "1" &&
			databaseUrl !== "" &&
			supabaseUrl !== "" &&
			secretKey !== "" &&
			publishableKey !== "",
		databaseUrl,
		supabaseUrl,
		secretKey,
		publishableKey,
	};
}
