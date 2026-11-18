import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import type {
	NoticeAcceptance,
	PublishedTexts,
	SessionClient,
	SessionState,
} from "../session/types";

interface SessionValue {
	readonly state: SessionState;
	readonly busy: boolean;
	retry(): void;
	start(): void;
	expire(): void;
	bind(code: string): void;
	pair(code: string, acceptance: NoticeAcceptance): void;
	acceptNotice(acceptance: NoticeAcceptance): void;
	texts(): Promise<PublishedTexts | null>;
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

	const start = useCallback(() => {
		setState({ status: "connecting" });
		client.start().then(setState);
	}, [client]);

	const expire = useCallback(() => {
		client.forget();
		setState({ status: "connecting" });
		client.start().then(setState);
	}, [client]);

	const run = useCallback((step: Promise<SessionState>) => {
		setBusy(true);
		step.then((next) => {
			setBusy(false);
			setState(next);
		});
	}, []);

	const bind = useCallback(
		(code: string) => run(client.bind(code)),
		[client, run],
	);

	const pair = useCallback(
		(code: string, acceptance: NoticeAcceptance) =>
			run(client.pair(code, acceptance)),
		[client, run],
	);

	const acceptNotice = useCallback(
		(acceptance: NoticeAcceptance) => run(client.acceptNotice(acceptance)),
		[client, run],
	);

	const texts = useCallback(() => client.texts(), [client]);

	const value = useMemo(
		() => ({
			state,
			busy,
			retry,
			start,
			expire,
			bind,
			pair,
			acceptNotice,
			texts,
		}),
		[state, busy, retry, start, expire, bind, pair, acceptNotice, texts],
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
