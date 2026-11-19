import {
	isRecord,
	readJson,
	timedFetch,
	UpstreamError,
	type ZaloFetch,
	type ZaloRequestInit,
} from "./http.js";
import type { ZaloEnvironment } from "./settings.js";

export interface MintedSession {
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly expiresAt: number;
}

export interface SupabaseBackend {
	rpc(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
	userEmail(userId: string): Promise<string | null | undefined>;
	mintSession(email: string): Promise<MintedSession>;
	sessionUser(accessToken: string): Promise<string | null>;
	createLogin(
		email: string,
		appMetadata?: Readonly<Record<string, unknown>>,
	): Promise<string>;
	setAppMetadata(
		userId: string,
		appMetadata: Readonly<Record<string, unknown>>,
	): Promise<void>;
	deleteLogin(userId: string): Promise<void>;
}

export interface SupabaseBackendOptions {
	readonly url: string;
	readonly key: string;
	readonly fetch?: ZaloFetch | undefined;
	readonly timeoutMs?: number | undefined;
}

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function serviceKeyFrom(environment: ZaloEnvironment): string | null {
	const dictionary = environment.SUPABASE_SECRET_KEYS;
	if (dictionary !== undefined && dictionary.trim() !== "") {
		try {
			const parsed: unknown = JSON.parse(dictionary);
			if (isRecord(parsed)) {
				const preferred = parsed.default;
				if (typeof preferred === "string" && preferred !== "") {
					return preferred;
				}
				const first = Object.values(parsed).find(
					(value): value is string => typeof value === "string" && value !== "",
				);
				if (first !== undefined) {
					return first;
				}
			}
		} catch {
			return null;
		}
	}
	const legacy = environment.SUPABASE_SERVICE_ROLE_KEY;
	return legacy !== undefined && legacy.trim() !== "" ? legacy : null;
}

function keyHeaders(key: string): Record<string, string> {
	return key.startsWith("sb_")
		? { apikey: key }
		: { apikey: key, authorization: `Bearer ${key}` };
}

function requireString(value: unknown): string {
	if (typeof value !== "string" || value === "") {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	return value;
}

export function createSupabaseBackend(
	options: SupabaseBackendOptions,
): SupabaseBackend {
	const base = options.url.replace(/\/+$/, "");
	const serviceHeaders = keyHeaders(options.key);

	async function call(
		path: string,
		init: ZaloRequestInit,
	): Promise<{ readonly status: number; readonly body: unknown }> {
		const response = await timedFetch(`${base}${path}`, init, {
			service: "supabase",
			fetch: options.fetch,
			timeoutMs: options.timeoutMs,
		});
		return {
			status: response.status,
			body: await readJson(response, "supabase"),
		};
	}

	function post(body: unknown): ZaloRequestInit {
		return {
			method: "POST",
			headers: { ...serviceHeaders, "content-type": "application/json" },
			body: JSON.stringify(body),
		};
	}

	function expectOk(status: number): void {
		if (status < 200 || status > 299) {
			throw new UpstreamError("supabase", "status", status);
		}
	}

	return {
		async rpc(name, args) {
			if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
				throw new Error("an RPC name is lower-case letters, digits and _");
			}
			const { status, body } = await call(`/rest/v1/rpc/${name}`, post(args));
			expectOk(status);
			return body;
		},
		async userEmail(userId) {
			if (!UUID_PATTERN.test(userId)) {
				throw new UpstreamError("supabase", "invalid_answer");
			}
			const { status, body } = await call(`/auth/v1/admin/users/${userId}`, {
				method: "GET",
				headers: serviceHeaders,
			});
			if (status === 404) {
				return undefined;
			}
			expectOk(status);
			if (!isRecord(body)) {
				throw new UpstreamError("supabase", "invalid_answer", status);
			}
			return typeof body.email === "string" && body.email !== ""
				? body.email
				: null;
		},
		async mintSession(email) {
			const link = await call(
				"/auth/v1/admin/generate_link",
				post({ type: "magiclink", email }),
			);
			expectOk(link.status);
			const linkBody = isRecord(link.body) ? link.body : {};
			const properties = isRecord(linkBody.properties)
				? linkBody.properties
				: linkBody;
			const tokenHash = requireString(properties.hashed_token);
			const verified = await call(
				"/auth/v1/verify",
				post({ type: "magiclink", token_hash: tokenHash }),
			);
			expectOk(verified.status);
			const session = isRecord(verified.body) ? verified.body : {};
			const expiresAt = session.expires_at;
			if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
				throw new UpstreamError("supabase", "invalid_answer", verified.status);
			}
			return {
				accessToken: requireString(session.access_token),
				refreshToken: requireString(session.refresh_token),
				expiresAt,
			};
		},
		async sessionUser(accessToken) {
			const { status, body } = await call("/auth/v1/user", {
				method: "GET",
				headers: {
					apikey: options.key,
					authorization: `Bearer ${accessToken}`,
				},
			});
			if (status === 401 || status === 403) {
				return null;
			}
			expectOk(status);
			if (
				!isRecord(body) ||
				typeof body.id !== "string" ||
				!UUID_PATTERN.test(body.id)
			) {
				throw new UpstreamError("supabase", "invalid_answer", status);
			}
			return body.id;
		},
		async createLogin(email, appMetadata) {
			const { status, body } = await call(
				"/auth/v1/admin/users",
				post({
					email,
					email_confirm: true,
					...(appMetadata === undefined ? {} : { app_metadata: appMetadata }),
				}),
			);
			expectOk(status);
			if (
				!isRecord(body) ||
				typeof body.id !== "string" ||
				!UUID_PATTERN.test(body.id)
			) {
				throw new UpstreamError("supabase", "invalid_answer", status);
			}
			return body.id;
		},
		async setAppMetadata(userId, appMetadata) {
			if (!UUID_PATTERN.test(userId)) {
				throw new UpstreamError("supabase", "invalid_answer");
			}
			const { status } = await call(`/auth/v1/admin/users/${userId}`, {
				method: "PUT",
				headers: { ...serviceHeaders, "content-type": "application/json" },
				body: JSON.stringify({ app_metadata: appMetadata }),
			});
			expectOk(status);
		},
		async deleteLogin(userId) {
			if (!UUID_PATTERN.test(userId)) {
				throw new UpstreamError("supabase", "invalid_answer");
			}
			const { status } = await call(`/auth/v1/admin/users/${userId}`, {
				method: "DELETE",
				headers: serviceHeaders,
			});
			if (status !== 404) {
				expectOk(status);
			}
		},
	};
}
