import {
	CUSTOMER_SESSION_KIND,
	type CustomerSession,
	type JoinOutcome,
	type JoinRefusal,
	type JoinRequest,
	joinBody,
	joinRefusalOf,
	POLICY_VERSION_PATTERN,
	parseCustomerSessionAnswer,
	readCustomerSession,
	SCREEN_VERSION_PATTERN,
	STORE_CODE_PATTERN,
} from "../loyalty/contract";
import type { NativeStorage } from "../storage/native-storage";
import { SESSION_EXPIRY_SKEW_MS } from "./session-store";
import type { SessionFailure } from "./types";

export const CUSTOMER_SESSION_STORAGE_KEY = "fnb.customer-session";

export type CustomerSessionState =
	| { readonly status: "connecting" }
	| { readonly status: "ready"; readonly session: CustomerSession }
	| {
			readonly status: "failed";
			readonly reason: SessionFailure;
			/** A short technical code for a Development build's error line: never a token or personal data. */
			readonly detail?: string;
	  };

export type JoinFailure = JoinRefusal | SessionFailure;

export type JoinResult =
	| {
			readonly ok: true;
			readonly session: CustomerSession;
			readonly joined: JoinOutcome;
	  }
	| { readonly ok: false; readonly failure: JoinFailure };

export interface CustomerSessionClient {
	connect(): Promise<CustomerSessionState>;
	refresh(): Promise<CustomerSessionState>;
	join(request: JoinRequest): Promise<JoinResult>;
	forget(): void;
}

export interface CustomerSessionStore {
	read(): CustomerSession | null;
	write(session: CustomerSession): void;
	clear(): void;
}

export function createCustomerSessionStore(
	storage: NativeStorage,
	key: string = CUSTOMER_SESSION_STORAGE_KEY,
): CustomerSessionStore {
	return {
		read() {
			const raw = storage.getItem(key);
			if (raw === null) return null;
			let session: CustomerSession | null = null;
			try {
				session = readCustomerSession(JSON.parse(raw));
			} catch {
				session = null;
			}
			if (session === null) storage.removeItem(key);
			return session;
		},
		write(session) {
			storage.setItem(key, JSON.stringify(session));
		},
		clear() {
			storage.removeItem(key);
		},
	};
}

export function isCustomerSessionFresh(
	session: CustomerSession,
	nowMs: number,
	skewMs: number = SESSION_EXPIRY_SKEW_MS,
): boolean {
	return session.expiresAt * 1000 - skewMs > nowMs;
}

export function joinRequestProblems(request: JoinRequest): string[] {
	const problems: string[] = [];
	if (request.phoneToken.trim() === "") problems.push("phone token");
	if (request.loyaltyConsent !== true) problems.push("loyalty consent");
	if (typeof request.marketingConsent !== "boolean")
		problems.push("marketing consent");
	if (!POLICY_VERSION_PATTERN.test(request.policyVersion))
		problems.push("policy version");
	if (!SCREEN_VERSION_PATTERN.test(request.screenVersion))
		problems.push("screen version");
	if (request.store !== null && !STORE_CODE_PATTERN.test(request.store))
		problems.push("store");
	if (!Number.isFinite(request.shownAt)) problems.push("shown at");
	return problems;
}

export interface ZaloCustomerSessionClientOptions {
	readonly endpoint: string;
	readonly brandKey: string;
	readonly publishableKey: string;
	readonly storage: NativeStorage;
	readonly getAccessToken: () => Promise<string>;
	readonly fetch?: typeof fetch;
	readonly now?: () => number;
}

type MintResult =
	| {
			readonly ok: true;
			readonly session: CustomerSession;
			readonly joined: JoinOutcome | null;
	  }
	| {
			readonly ok: false;
			readonly failure: JoinFailure;
			readonly detail?: string;
	  };

function sdkErrorCode(error: unknown): string {
	if (typeof error === "object" && error !== null && "code" in error) {
		const code = error.code;
		if (typeof code === "number" || typeof code === "string") {
			return String(code).slice(0, 20);
		}
	}
	return "error";
}

async function errorCodeOf(response: Response): Promise<unknown> {
	try {
		const body: unknown = await response.json();
		return typeof body === "object" && body !== null && "error" in body
			? body.error
			: null;
	} catch {
		return null;
	}
}

export function createZaloCustomerSessionClient(
	options: ZaloCustomerSessionClientOptions,
): CustomerSessionClient {
	const store = createCustomerSessionStore(options.storage);
	const now = options.now ?? Date.now;
	const send = options.fetch ?? ((input, init) => fetch(input, init));

	async function mint(join: JoinRequest | null): Promise<MintResult> {
		let zaloAccessToken: string;
		try {
			zaloAccessToken = await options.getAccessToken();
		} catch (error) {
			return {
				ok: false,
				failure: "zalo",
				detail: `zalo-sdk ${sdkErrorCode(error)}`,
			};
		}
		if (typeof zaloAccessToken !== "string" || zaloAccessToken === "") {
			return { ok: false, failure: "zalo", detail: "zalo-sdk no-token" };
		}
		let response: Response;
		try {
			response = await send(options.endpoint, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					apikey: options.publishableKey,
				},
				body: JSON.stringify({
					kind: CUSTOMER_SESSION_KIND,
					access_token: zaloAccessToken,
					brand: options.brandKey,
					...(join === null ? {} : { join: joinBody(join) }),
				}),
			});
		} catch {
			return { ok: false, failure: "network", detail: "session fetch" };
		}
		if (!response.ok) {
			const code = await errorCodeOf(response);
			const refusal = join === null ? null : joinRefusalOf(code);
			const named =
				typeof code === "string" && /^[a-z_]{1,40}$/.test(code)
					? ` ${code}`
					: "";
			return {
				ok: false,
				failure: refusal ?? "refused",
				detail: `session ${response.status}${named}`,
			};
		}
		let answer: ReturnType<typeof parseCustomerSessionAnswer> = null;
		try {
			answer = parseCustomerSessionAnswer(await response.json());
		} catch {
			answer = null;
		}
		if (answer === null) {
			return { ok: false, failure: "refused", detail: "session answer" };
		}
		store.write(answer.session);
		return { ok: true, session: answer.session, joined: answer.joined };
	}

	let connecting: Promise<CustomerSessionState> | null = null;

	function connect(): Promise<CustomerSessionState> {
		const stored = store.read();
		if (stored !== null && isCustomerSessionFresh(stored, now())) {
			return Promise.resolve({ status: "ready", session: stored });
		}
		if (connecting === null) {
			connecting = mint(null)
				.then(
					(result): CustomerSessionState =>
						result.ok
							? { status: "ready", session: result.session }
							: {
									status: "failed",
									reason:
										result.failure === "network" || result.failure === "zalo"
											? result.failure
											: "refused",
									...(result.detail === undefined
										? {}
										: { detail: result.detail }),
								},
				)
				.finally(() => {
					connecting = null;
				});
		}
		return connecting;
	}

	return {
		connect,
		refresh() {
			store.clear();
			return connect();
		},
		async join(request) {
			if (joinRequestProblems(request).length > 0) {
				return { ok: false, failure: "refused" };
			}
			const result = await mint(request);
			// the detail is for a Development build's error line only; a join answer names its failure alone
			if (!result.ok) return { ok: false, failure: result.failure };
			if (result.joined === null || result.session.customer.customerId === null)
				return { ok: false, failure: "refused" };
			return { ok: true, session: result.session, joined: result.joined };
		},
		forget() {
			store.clear();
		},
	};
}
