import type { NativeStorage } from "../storage/native-storage";
import {
	createSessionStore,
	isSessionFresh,
	readStoredSession,
} from "./session-store";
import type { SessionClient, SessionState, StoredSession } from "./types";

export type SessionAnswer =
	| { readonly status: "unpaired" }
	| { readonly status: "bound"; readonly session: StoredSession };

export const BINDING_CODE_PATTERN = /^\d{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSessionAnswer(value: unknown): SessionAnswer | null {
	if (!isRecord(value)) return null;
	if (value.status === "unpaired") return { status: "unpaired" };
	if (value.status !== "bound" || !isRecord(value.member)) return null;
	const session = readStoredSession({
		accessToken: value.access_token,
		refreshToken: value.refresh_token,
		expiresAt: value.expires_at,
		member: {
			displayName: value.member.display_name,
			role: value.member.role,
			stores: value.member.stores,
		},
	});
	return session ? { status: "bound", session } : null;
}

export interface ZaloSessionClientOptions {
	readonly endpoint: string;
	readonly brandKey: string;
	readonly publishableKey: string;
	readonly storage: NativeStorage;
	readonly getAccessToken: () => Promise<string>;
	readonly fetch?: typeof fetch;
	readonly now?: () => number;
}

export function createZaloSessionClient(
	options: ZaloSessionClientOptions,
): SessionClient {
	const store = createSessionStore(options.storage);
	const now = options.now ?? Date.now;
	const send = options.fetch ?? ((input, init) => fetch(input, init));

	async function mint(bindingCode: string | null): Promise<SessionState> {
		let zaloAccessToken: string;
		try {
			zaloAccessToken = await options.getAccessToken();
		} catch {
			return { status: "failed", reason: "zalo" };
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
					access_token: zaloAccessToken,
					brand: options.brandKey,
					...(bindingCode === null ? {} : { binding_code: bindingCode }),
				}),
			});
		} catch {
			return { status: "failed", reason: "network" };
		}
		let answer: SessionAnswer | null = null;
		if (response.ok) {
			try {
				answer = parseSessionAnswer(await response.json());
			} catch {
				answer = null;
			}
		}
		if (!answer) {
			store.clear();
			return { status: "failed", reason: "refused" };
		}
		if (answer.status === "unpaired") {
			store.clear();
			return { status: "unpaired", codeRejected: bindingCode !== null };
		}
		store.write(answer.session);
		return { status: "signed-in", session: answer.session };
	}

	let connecting: Promise<SessionState> | null = null;

	return {
		async connect() {
			const stored = store.read();
			if (stored && isSessionFresh(stored, now())) {
				return { status: "signed-in", session: stored };
			}
			if (connecting === null) {
				connecting = mint(null).finally(() => {
					connecting = null;
				});
			}
			return connecting;
		},
		async bind(code) {
			if (!BINDING_CODE_PATTERN.test(code)) {
				return { status: "unpaired", codeRejected: true };
			}
			return mint(code);
		},
		forget() {
			store.clear();
		},
	};
}
