import type { CounterEnvironment } from "../env";

/**
 * The browser half of Zalo's web login (ADR-066): the PKCE verifier is made and kept here (sessionStorage of the tab,
 * removed at the callback), the state the function answered is kept to compare at the callback (CSRF), and the
 * function does everything that needs the App secret.
 */

export const LOGIN_STORAGE_KEY = "fnb-counter-login";
export const LOGIN_MAX_AGE_MS = 10 * 60_000;

export type MemberRole = "owner" | "manager" | "staff";

export interface Member {
	readonly display_name: string;
	readonly role: MemberRole;
	readonly stores: readonly string[];
	readonly store_ids: readonly string[] | null;
	readonly tenant_id: string;
}

export interface StaffNotice {
	readonly version: string;
	readonly title: string;
	readonly body_markdown: string;
	readonly published_at: string;
}

export type SessionAnswer =
	| {
			readonly status: "bound";
			readonly access_token: string;
			readonly refresh_token: string;
			readonly expires_at: number;
			readonly member: Member;
	  }
	| {
			readonly status: "unpaired" | "notice_required";
			readonly ticket: string;
			readonly ticket_expires_at?: string;
			readonly reason?: "code_refused" | "wait" | "notice_outdated";
			readonly retry_after?: number;
			readonly notice?: StaffNotice;
			readonly contact?: string;
	  };

export class LoginError extends Error {
	readonly code: string;
	constructor(code: string) {
		super(code);
		this.name = "LoginError";
		this.code = code;
	}
}

interface Pending {
	readonly verifier: string;
	readonly state: string;
	readonly redirect: string;
	readonly at: number;
}

export function base64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

export function newVerifier(): string {
	return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function challengeOf(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(verifier),
	);
	return base64Url(new Uint8Array(digest));
}

/** The address Zalo brings the person back to: this page without its query or hash. */
export function returnAddress(
	location: Pick<Location, "origin" | "pathname">,
): string {
	return `${location.origin}${location.pathname}`;
}

async function post(
	environment: CounterEnvironment,
	body: Readonly<Record<string, unknown>>,
	fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
	let response: Response;
	try {
		response = await fetchImpl(environment.sessionUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				apikey: environment.publishableKey,
			},
			body: JSON.stringify({ ...body, brand: environment.brand }),
		});
	} catch {
		throw new LoginError("network");
	}
	let answer: unknown;
	try {
		answer = await response.json();
	} catch {
		throw new LoginError("unreadable");
	}
	const record =
		answer !== null && typeof answer === "object" && !Array.isArray(answer)
			? (answer as Record<string, unknown>)
			: {};
	if (!response.ok) {
		throw new LoginError(
			typeof record.error === "string" ? record.error : "failed",
		);
	}
	return record;
}

/** Starts the login: keeps the verifier and the state for this tab and answers Zalo's authorise address. */
export async function startLogin(
	environment: CounterEnvironment,
	options: {
		readonly location: Pick<Location, "origin" | "pathname">;
		readonly storage: Pick<Storage, "setItem">;
		readonly fetch?: typeof fetch;
		readonly now?: () => number;
	},
): Promise<string> {
	const verifier = newVerifier();
	const redirect = returnAddress(options.location);
	const answer = await post(
		environment,
		{
			action: "start",
			redirect_uri: redirect,
			code_challenge: await challengeOf(verifier),
		},
		options.fetch ?? fetch,
	);
	if (
		typeof answer.authorize_url !== "string" ||
		typeof answer.state !== "string"
	) {
		throw new LoginError("unreadable");
	}
	const pending: Pending = {
		verifier,
		state: answer.state,
		redirect,
		at: (options.now ?? Date.now)(),
	};
	options.storage.setItem(LOGIN_STORAGE_KEY, JSON.stringify(pending));
	return answer.authorize_url;
}

/** The code and state Zalo put on the return address, or an error Zalo named, or null when this is no return. */
export function callbackOf(
	search: string,
):
	| { readonly code: string; readonly state: string }
	| { readonly error: string }
	| null {
	const params = new URLSearchParams(search);
	const code = params.get("code");
	const state = params.get("state");
	if (code !== null && state !== null) {
		return { code, state };
	}
	if (params.has("error") || (state !== null && code === null)) {
		return { error: params.get("error") ?? "denied" };
	}
	return null;
}

function pendingOf(
	storage: Pick<Storage, "getItem">,
	now: number,
): Pending | null {
	try {
		const raw = storage.getItem(LOGIN_STORAGE_KEY);
		if (raw === null) return null;
		const value = JSON.parse(raw) as Partial<Pending>;
		if (
			typeof value.verifier !== "string" ||
			typeof value.state !== "string" ||
			typeof value.redirect !== "string" ||
			typeof value.at !== "number" ||
			now - value.at > LOGIN_MAX_AGE_MS
		) {
			return null;
		}
		return value as Pending;
	} catch {
		return null;
	}
}

function sessionAnswerOf(answer: Record<string, unknown>): SessionAnswer {
	if (
		answer.status === "bound" &&
		typeof answer.access_token === "string" &&
		typeof answer.refresh_token === "string" &&
		answer.member !== null &&
		typeof answer.member === "object"
	) {
		return answer as unknown as SessionAnswer;
	}
	if (
		(answer.status === "unpaired" || answer.status === "notice_required") &&
		typeof answer.ticket === "string"
	) {
		return answer as unknown as SessionAnswer;
	}
	throw new LoginError("unreadable");
}

/**
 * Finishes the login at the return address. The state must be the one this tab started with: a return the tab did
 * not start (a forged link, another tab, an old one) is refused before anything is sent.
 */
export async function finishLogin(
	environment: CounterEnvironment,
	callback: { readonly code: string; readonly state: string },
	options: {
		readonly storage: Pick<Storage, "getItem" | "removeItem">;
		readonly fetch?: typeof fetch;
		readonly now?: () => number;
	},
): Promise<SessionAnswer> {
	const pending = pendingOf(options.storage, (options.now ?? Date.now)());
	options.storage.removeItem(LOGIN_STORAGE_KEY);
	if (pending === null || pending.state !== callback.state) {
		throw new LoginError("state_mismatch");
	}
	return sessionAnswerOf(
		await post(
			environment,
			{
				action: "callback",
				redirect_uri: pending.redirect,
				code: callback.code,
				state: callback.state,
				code_verifier: pending.verifier,
			},
			options.fetch ?? fetch,
		),
	);
}

/** The pairing step: the ticket with a six-digit code and/or the staff notice accepted. */
export async function pairLogin(
	environment: CounterEnvironment,
	input: {
		readonly ticket: string;
		readonly pairingCode: string | null;
		readonly notice: {
			readonly version: string;
			readonly shownAt: string;
		} | null;
	},
	fetchImpl: typeof fetch = fetch,
): Promise<SessionAnswer> {
	return sessionAnswerOf(
		await post(
			environment,
			{
				action: "pair",
				ticket: input.ticket,
				...(input.pairingCode === null
					? {}
					: { pairing_code: input.pairingCode }),
				...(input.notice === null
					? {}
					: {
							notice: {
								version: input.notice.version,
								shown_at: input.notice.shownAt,
							},
						}),
			},
			fetchImpl,
		),
	);
}
