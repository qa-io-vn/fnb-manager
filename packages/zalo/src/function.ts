import {
	createSupabaseBackend,
	type SupabaseBackend,
	serviceKeyFrom,
} from "./backend.js";
import { UpstreamError, type ZaloFetch } from "./http.js";
import { ZaloRefusal } from "./refusal.js";
import {
	ZaloConfigError,
	type ZaloEnvironment,
	type ZaloSettings,
	zaloSettings,
} from "./settings.js";

export function asRefusal(error: unknown): ZaloRefusal | null {
	if (error instanceof ZaloRefusal) {
		return error;
	}
	if (error instanceof ZaloConfigError) {
		return new ZaloRefusal(500, "not_configured", error.message);
	}
	if (error instanceof UpstreamError) {
		return error.service === "zalo"
			? new ZaloRefusal(502, "zalo_unavailable", error.message)
			: new ZaloRefusal(503, "backend_unavailable", error.message);
	}
	return null;
}

export function functionSettings(environment: ZaloEnvironment): ZaloSettings {
	try {
		return zaloSettings(environment);
	} catch (error) {
		throw asRefusal(error) ?? error;
	}
}

export function functionBackend(
	environment: ZaloEnvironment,
	fetch?: ZaloFetch,
): SupabaseBackend {
	const url = environment.SUPABASE_URL;
	const key = serviceKeyFrom(environment);
	if (url === undefined || url.trim() === "" || key === null) {
		throw new ZaloRefusal(
			500,
			"not_configured",
			"SUPABASE_URL or the service key is missing",
		);
	}
	return createSupabaseBackend({ url, key, fetch });
}
