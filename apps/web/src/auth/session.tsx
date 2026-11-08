import type {
	AuthChangeEvent,
	Session,
	SupabaseClient,
} from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
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
import type { SupabaseClientLoader } from "../lib/supabase";

export type SessionStatus = "loading" | "signed-out" | "signed-in";

export interface SessionState {
	status: SessionStatus;
	session: Session | null;
	recovering: boolean;
}

interface SessionContextValue extends SessionState {
	client: SupabaseClient | null;
	clientFailed: boolean;
	finishRecovery: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function stateOf(session: Session | null, recovering: boolean): SessionState {
	return session
		? { status: "signed-in", session, recovering }
		: { status: "signed-out", session: null, recovering: false };
}

function isRecovering(
	event: AuthChangeEvent,
	session: Session | null,
	previous: SessionState,
): boolean {
	return (
		event === "PASSWORD_RECOVERY" || (previous.recovering && session !== null)
	);
}

function useLoadedClient(loadClient: SupabaseClientLoader | null) {
	const [client, setClient] = useState<SupabaseClient | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		if (!loadClient) return;
		let active = true;
		loadClient().then(
			(loaded) => active && setClient(loaded),
			() => active && setFailed(true),
		);
		return () => {
			active = false;
		};
	}, [loadClient]);
	return { client, failed };
}

function useCacheClearedOnUserChange() {
	const queryClient = useQueryClient();
	const userIdRef = useRef<string | null | undefined>(undefined);
	return useCallback(
		(session: Session | null) => {
			const userId = session?.user.id ?? null;
			const previous = userIdRef.current;
			userIdRef.current = userId;
			if (previous !== undefined && previous !== userId) queryClient.clear();
		},
		[queryClient],
	);
}

export function SessionProvider({
	loadClient,
	children,
}: {
	loadClient: SupabaseClientLoader | null;
	children: ReactNode;
}) {
	const { client, failed } = useLoadedClient(loadClient);
	const [state, setState] = useState<SessionState>(() =>
		loadClient
			? { status: "loading", session: null, recovering: false }
			: stateOf(null, false),
	);
	const noteUser = useCacheClearedOnUserChange();

	useEffect(() => {
		if (failed) setState(stateOf(null, false));
	}, [failed]);

	useEffect(() => {
		if (!client) return;
		let active = true;
		void client.auth.getSession().then(({ data }) => {
			if (!active) return;
			noteUser(data.session);
			setState((previous) =>
				previous.status === "loading" ? stateOf(data.session, false) : previous,
			);
		});
		const { data } = client.auth.onAuthStateChange((event, session) => {
			if (!active) return;
			noteUser(session);
			setState((previous) =>
				stateOf(session, isRecovering(event, session, previous)),
			);
		});
		return () => {
			active = false;
			data.subscription.unsubscribe();
		};
	}, [client, noteUser]);

	const finishRecovery = useCallback(() => {
		setState((previous) => ({ ...previous, recovering: false }));
	}, []);

	const value = useMemo(
		() => ({ ...state, client, clientFailed: failed, finishRecovery }),
		[state, client, failed, finishRecovery],
	);
	return (
		<SessionContext.Provider value={value}>{children}</SessionContext.Provider>
	);
}

export function useSession(): SessionContextValue {
	const value = useContext(SessionContext);
	if (value === null) throw new Error("SessionProvider is missing");
	return value;
}
