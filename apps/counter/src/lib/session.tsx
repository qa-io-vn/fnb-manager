import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { CounterEnvironment } from "../env";
import {
	callbackOf,
	finishLogin,
	LoginError,
	type Member,
	pairLogin,
	type SessionAnswer,
	startLogin,
} from "./zalo-login";

export const MEMBER_STORAGE_KEY = "fnb-counter-member";
export const STORE_STORAGE_KEY = "fnb-counter-store";
export const AUTH_STORAGE_KEY = "fnb-counter-auth";

export type Blocked = Extract<
	SessionAnswer,
	{ status: "unpaired" | "notice_required" }
>;

export type AuthState =
	| { readonly phase: "loading" }
	| { readonly phase: "signed-out"; readonly error?: string }
	| {
			readonly phase: "blocked";
			readonly answer: Blocked;
			readonly error?: string;
	  }
	| {
			readonly phase: "signed-in";
			readonly member: Member;
			readonly userId: string;
	  };

export interface SessionValue {
	readonly state: AuthState;
	readonly client: SupabaseClient;
	readonly environment: CounterEnvironment;
	signIn(): Promise<void>;
	pair(input: {
		readonly pairingCode: string | null;
		readonly noticeShownAt: string | null;
	}): Promise<void>;
	/** Ends the session on this device; `reason` is shown on the sign-in screen. */
	signOut(reason?: string): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function createCounterClient(
	environment: CounterEnvironment,
): SupabaseClient {
	return createClient(environment.supabaseUrl, environment.publishableKey, {
		auth: {
			persistSession: true,
			autoRefreshToken: true,
			detectSessionInUrl: false,
			storageKey: AUTH_STORAGE_KEY,
		},
	});
}

function readMember(
	storage: Storage,
): { member: Member; userId: string } | null {
	try {
		const raw = storage.getItem(MEMBER_STORAGE_KEY);
		if (raw === null) return null;
		const value = JSON.parse(raw) as { member?: Member; userId?: string };
		if (value.member === undefined || typeof value.userId !== "string")
			return null;
		return { member: value.member, userId: value.userId };
	} catch {
		return null;
	}
}

function safeStorage(kind: "local" | "session"): Storage {
	try {
		return kind === "local" ? window.localStorage : window.sessionStorage;
	} catch {
		const memory = new Map<string, string>();
		return {
			get length() {
				return memory.size;
			},
			clear: () => memory.clear(),
			getItem: (key) => memory.get(key) ?? null,
			key: (index) => [...memory.keys()][index] ?? null,
			removeItem: (key) => void memory.delete(key),
			setItem: (key, value) => void memory.set(key, value),
		};
	}
}

export function SessionProvider({
	environment,
	client: given,
	children,
}: {
	readonly environment: CounterEnvironment;
	readonly client?: SupabaseClient;
	readonly children: ReactNode;
}) {
	const client = useMemo(
		() => given ?? createCounterClient(environment),
		[given, environment],
	);
	const [state, setState] = useState<AuthState>({ phase: "loading" });
	const started = useRef(false);
	const local = useMemo(() => safeStorage("local"), []);
	const tab = useMemo(() => safeStorage("session"), []);

	const accept = useCallback(
		async (answer: SessionAnswer) => {
			if (answer.status !== "bound") {
				setState({ phase: "blocked", answer });
				return;
			}
			const { data, error } = await client.auth.setSession({
				access_token: answer.access_token,
				refresh_token: answer.refresh_token,
			});
			const userId = data.user?.id ?? data.session?.user.id;
			if (error !== null || userId === undefined) {
				setState({ phase: "signed-out", error: "session" });
				return;
			}
			local.setItem(
				MEMBER_STORAGE_KEY,
				JSON.stringify({ member: answer.member, userId }),
			);
			setState({ phase: "signed-in", member: answer.member, userId });
		},
		[client, local],
	);

	useEffect(() => {
		if (started.current) return;
		started.current = true;
		const callback = callbackOf(window.location.search);
		if (callback !== null) {
			window.history.replaceState(
				null,
				"",
				`${window.location.pathname}${window.location.hash}`,
			);
			if ("error" in callback) {
				setState({ phase: "signed-out", error: "denied" });
				return;
			}
			finishLogin(environment, callback, { storage: tab })
				.then(accept)
				.catch((error: unknown) =>
					setState({
						phase: "signed-out",
						error: error instanceof LoginError ? error.code : "failed",
					}),
				);
			return;
		}
		client.auth
			.getSession()
			.then(({ data }) => {
				const stored = readMember(local);
				if (
					data.session !== null &&
					stored !== null &&
					stored.userId === data.session.user.id
				) {
					setState({
						phase: "signed-in",
						member: stored.member,
						userId: stored.userId,
					});
				} else {
					setState({ phase: "signed-out" });
				}
			})
			.catch(() => setState({ phase: "signed-out" }));
	}, [accept, client, environment, local, tab]);

	useEffect(() => {
		const { data } = client.auth.onAuthStateChange((event, session) => {
			if (
				event === "SIGNED_OUT" ||
				(event === "TOKEN_REFRESHED" && session === null)
			) {
				setState((current) =>
					current.phase === "signed-in"
						? { phase: "signed-out", error: "expired" }
						: current,
				);
			}
		});
		return () => data.subscription.unsubscribe();
	}, [client]);

	const value = useMemo<SessionValue>(
		() => ({
			state,
			client,
			environment,
			async signIn() {
				const address = await startLogin(environment, {
					location: window.location,
					storage: tab,
				});
				window.location.assign(address);
			},
			async pair({ pairingCode, noticeShownAt }) {
				if (state.phase !== "blocked") return;
				const notice =
					noticeShownAt !== null && state.answer.notice !== undefined
						? { version: state.answer.notice.version, shownAt: noticeShownAt }
						: null;
				try {
					await accept(
						await pairLogin(environment, {
							ticket: state.answer.ticket,
							pairingCode,
							notice,
						}),
					);
				} catch (error) {
					setState({
						phase: "blocked",
						answer: state.answer,
						error: error instanceof LoginError ? error.code : "failed",
					});
				}
			},
			async signOut(reason) {
				local.removeItem(MEMBER_STORAGE_KEY);
				try {
					await client.auth.signOut({ scope: "local" });
				} catch {
					// the session is gone on this device either way
				}
				setState(
					reason === undefined
						? { phase: "signed-out" }
						: { phase: "signed-out", error: reason },
				);
			},
		}),
		[state, client, environment, accept, local, tab],
	);

	return (
		<SessionContext.Provider value={value}>{children}</SessionContext.Provider>
	);
}

export function useSession(): SessionValue {
	const value = useContext(SessionContext);
	if (value === null) throw new Error("useSession needs a SessionProvider");
	return value;
}

/** The signed-in member; only for screens behind the sign-in gate. */
export function useMember(): {
	readonly member: Member;
	readonly userId: string;
} {
	const { state } = useSession();
	if (state.phase !== "signed-in")
		throw new Error("useMember needs a signed-in member");
	return { member: state.member, userId: state.userId };
}

export function isManager(member: Member): boolean {
	return member.role === "owner" || member.role === "manager";
}
