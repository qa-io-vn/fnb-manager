import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import type { SessionClient, SessionState } from "../session/types";

interface SessionValue {
	readonly state: SessionState;
	readonly busy: boolean;
	retry(): void;
	bind(code: string): void;
}

const SessionContext = createContext<SessionValue | null>(null);

export interface SessionProviderProps {
	readonly client: SessionClient;
	readonly children: ReactNode;
}

export function SessionProvider({ client, children }: SessionProviderProps) {
	const [state, setState] = useState<SessionState>({ status: "connecting" });
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let active = true;
		client.connect().then((next) => {
			if (active) setState(next);
		});
		return () => {
			active = false;
		};
	}, [client]);

	const retry = useCallback(() => {
		setState({ status: "connecting" });
		client.connect().then(setState);
	}, [client]);

	const bind = useCallback(
		(code: string) => {
			setBusy(true);
			client.bind(code).then((next) => {
				setBusy(false);
				setState(next);
			});
		},
		[client],
	);

	const value = useMemo(
		() => ({ state, busy, retry, bind }),
		[state, busy, retry, bind],
	);
	return (
		<SessionContext.Provider value={value}>{children}</SessionContext.Provider>
	);
}

export function useSession(): SessionValue {
	const value = useContext(SessionContext);
	if (!value) throw new Error("useSession needs a SessionProvider");
	return value;
}
