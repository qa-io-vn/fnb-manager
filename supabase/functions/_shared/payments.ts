import {
	createPaymentProvider,
	type PaymentFetch,
	type PaymentProvider,
	type ProviderConfig,
	ProviderConfigError,
	readProviderConfig,
} from "@fnb/payments";
import {
	functionBackend,
	isLoopbackBaseUrl,
	type SupabaseBackend,
	UpstreamError,
	ZaloRefusal,
} from "@fnb/zalo";
import { ZALO_ORIGINS } from "./cors.ts";
import {
	type FunctionEnvironment,
	HttpError,
	type RequestContext,
} from "./http.ts";

/**
 * What the payment functions share (ADR-067, ADR-068): the provider of a database row with its key read from the
 * function's secrets (never from the row), the switch that lets the mock bank run (PAYMENTS_MOCK=on, local and tests
 * only), a loopback base for Zalo's payment API in tests, the origins of the customer Mini App and the counter, and
 * the address a webhook came from behind a known number of proxies.
 */

export const PAYMENTS_MOCK_VARIABLE = "PAYMENTS_MOCK";
export const ZALO_PAYMENT_BASE_URL_VARIABLE = "ZALO_PAYMENT_BASE_URL";
export const COUNTER_REDIRECT_URIS_VARIABLE = "COUNTER_REDIRECT_URIS";
const HTTPS_ADDRESS = /^https:\/\/[a-z0-9.-]+(:[0-9]{1,5})?\/[A-Za-z0-9/_-]*$/;
const IPV4_PATTERN =
	/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6_PATTERN = /^[0-9A-Fa-f:.]{2,45}$/;

export function mocksAllowed(environment: FunctionEnvironment): boolean {
	return environment[PAYMENTS_MOCK_VARIABLE]?.trim() === "on";
}

/**
 * A loopback base for Zalo's payment API (a mock), honoured only with a local or test switch on (ZALO_LOCAL_DEV=1,
 * ZALO_INTEGRATION=1 or PAYMENTS_MOCK=on), as the other Zalo base overrides; anything else means Zalo's own address.
 */
export function zaloPaymentBase(
	environment: FunctionEnvironment,
): string | undefined {
	const value = environment[ZALO_PAYMENT_BASE_URL_VARIABLE]?.trim() ?? "";
	const local =
		environment.ZALO_LOCAL_DEV === "1" ||
		environment.ZALO_INTEGRATION === "1" ||
		mocksAllowed(environment);
	return local && value !== "" && isLoopbackBaseUrl(value) ? value : undefined;
}

/** CORS for the payment calls of the apps: the Zalo Mini App's origins, the counter's, and loopback on the local stack. */
export function paymentOrigins(
	request: Request,
	environment: FunctionEnvironment,
): string[] {
	const origins = [...ZALO_ORIGINS];
	for (const entry of (environment[COUNTER_REDIRECT_URIS_VARIABLE] ?? "").split(
		",",
	)) {
		const address = entry.trim();
		if (HTTPS_ADDRESS.test(address)) {
			const origin = new URL(address).origin;
			if (!origins.includes(origin)) {
				origins.push(origin);
			}
		}
	}
	const origin = request.headers.get("origin");
	if (
		origin !== null &&
		environment.ZALO_LOCAL_DEV === "1" &&
		isLoopbackBaseUrl(origin)
	) {
		origins.push(origin);
	}
	return origins;
}

export function backendOf(
	environment: FunctionEnvironment,
	backend: SupabaseBackend | undefined,
): SupabaseBackend {
	if (backend !== undefined) {
		return backend;
	}
	try {
		return functionBackend(environment);
	} catch (error) {
		if (error instanceof ZaloRefusal) {
			throw new HttpError(500, "not_configured");
		}
		throw error;
	}
}

/** A backend call: an unreachable or failing database answers 503 backend_unavailable, never a guess. */
export async function rpc(
	backend: SupabaseBackend,
	name: string,
	args: Readonly<Record<string, unknown>>,
): Promise<unknown> {
	try {
		return await backend.rpc(name, args);
	} catch (error) {
		if (error instanceof UpstreamError) {
			throw new HttpError(503, "backend_unavailable");
		}
		throw error;
	}
}

export interface ProviderOptions {
	readonly fetch?: PaymentFetch;
}

/**
 * The provider of a row the database answered: the row is checked again, the key comes from the function secret the
 * row names (MissingSecretError when unset), and a row the adapter cannot run is not_configured.
 */
export function providerOf(
	value: unknown,
	context: RequestContext,
	options: ProviderOptions = {},
): { readonly config: ProviderConfig; readonly provider: PaymentProvider } {
	const config = readProviderConfig(value);
	if (config === null) {
		context.log("a provider row is out of shape");
		throw new HttpError(500, "not_configured");
	}
	const secret = context.secret(config.secretName);
	const base = zaloPaymentBase(context.environment);
	try {
		return {
			config,
			provider: createPaymentProvider(config, {
				secret,
				allowMock: mocksAllowed(context.environment),
				...(options.fetch === undefined ? {} : { fetch: options.fetch }),
				...(base === undefined ? {} : { zaloBaseUrl: base }),
			}),
		};
	} catch (error) {
		if (error instanceof ProviderConfigError) {
			context.log(
				`the ${config.adapter} provider cannot run: ${error.message}`,
			);
			throw new HttpError(500, "not_configured");
		}
		throw error;
	}
}

/** Lower-case header names and their values, for the adapters. */
export function headersOf(request: Request): Record<string, string> {
	const headers: Record<string, string> = {};
	request.headers.forEach((value, name) => {
		headers[name.toLowerCase()] = value;
	});
	return headers;
}

function validAddress(value: string | null | undefined): string | null {
	const text = value?.trim() ?? "";
	if (IPV4_PATTERN.test(text)) {
		return text;
	}
	return text.includes(":") && IPV6_PATTERN.test(text) ? text : null;
}

/** The caller's address: the connection's, or the entry the given number of proxy hops from the end of x-forwarded-for. */
export function sourceAddress(
	request: Request,
	hops: number,
	connectionAddress: string | null,
): string | null {
	if (hops === 0) {
		return validAddress(connectionAddress);
	}
	const entries = (request.headers.get("x-forwarded-for") ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
	return entries.length < hops
		? null
		: validAddress(entries[entries.length - hops]);
}

/** The last path segment after the function's name, or null when the path has another shape. */
export function segmentAfter(url: string, name: string): string | null {
	const parts = new URL(url).pathname.split("/").filter((part) => part !== "");
	const at = parts.lastIndexOf(name);
	return at >= 0 && at === parts.length - 2 ? (parts[at + 1] ?? null) : null;
}
