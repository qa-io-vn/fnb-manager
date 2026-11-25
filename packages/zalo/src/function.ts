import {
	createSupabaseBackend,
	type SupabaseBackend,
	serviceKeyFrom,
} from "./backend.js";
import { UpstreamError, type ZaloFetch } from "./http.js";
import { ZaloRefusal } from "./refusal.js";
import {
	importRelayKey,
	relayFetch,
	relayUrlProblem,
	ZALO_RELAY_KEY_VARIABLE,
} from "./relay.js";
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

/**
 * The relay key when the function has one: read through `secret`, which keeps it out of the logs. Unset or blank
 * means no relay, and the Graph is called directly.
 */
export function relayKeyText(
	environment: ZaloEnvironment,
	secret: (name: string) => string,
): string | null {
	const raw = environment[ZALO_RELAY_KEY_VARIABLE];
	return raw === undefined || raw.trim() === ""
		? null
		: secret(ZALO_RELAY_KEY_VARIABLE);
}

export async function relayKeyOf(keyText: string): Promise<CryptoKey> {
	try {
		return await importRelayKey(keyText);
	} catch {
		throw new ZaloRefusal(
			500,
			"not_configured",
			`${ZALO_RELAY_KEY_VARIABLE} must be 32 bytes in base64`,
		);
	}
}

/** The relay address the database answers, or null; anything that is not an https DNS origin is refused. */
export function relayUrlOf(value: unknown): string | null {
	if (value === null) {
		return null;
	}
	if (typeof value !== "string" || relayUrlProblem(value) !== null) {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	return value;
}

/**
 * The fetch for Graph calls (ADR-057): with a relay key, the allowed Graph calls go through the relay the database
 * names (asked at most once per request), or straight to the Graph while no relay has announced itself recently;
 * without a key, the given fetch.
 */
export async function graphFetchFor(
	keyText: string | null,
	backend: SupabaseBackend,
	fetch?: ZaloFetch,
): Promise<ZaloFetch | undefined> {
	if (keyText === null) {
		return fetch;
	}
	const key = await relayKeyOf(keyText);
	let current: Promise<string | null> | undefined;
	return relayFetch({
		key,
		fetch,
		relayUrl: () => {
			current ??= backend
				.rpc("zalo_relay_current", {})
				.then((value) => relayUrlOf(value));
			return current;
		},
	});
}
