import type { CustomerSessionState, JoinResult } from "@fnb/zalo-mini";
import type {
	CustomerHome,
	CustomerSession,
	JoinRequest,
	LoyaltyClient,
} from "@fnb/zalo-mini/loyalty";
import { useCustomerSession, useDataEndpoint } from "@fnb/zalo-mini/react";
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
import {
	type Failure,
	failureOf,
	type LoyaltySourceFactory,
	loyaltyClientFor,
} from "./source";

export type Load<T> =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly data: T }
	| { readonly status: "failed"; readonly failure: Failure };

export interface CustomerDataValue {
	readonly sessionState: CustomerSessionState;
	readonly session: CustomerSession | null;
	readonly member: boolean;
	readonly client: LoyaltyClient | null;
	readonly home: Load<CustomerHome>;
	reloadHome(): void;
	retrySession(): void;
	recover(error: unknown): Failure;
	join(request: JoinRequest): Promise<JoinResult>;
}

const CustomerDataContext = createContext<CustomerDataValue | null>(null);

export function useCustomerData(): CustomerDataValue {
	const value = useContext(CustomerDataContext);
	if (value === null)
		throw new Error("useCustomerData needs a CustomerDataProvider");
	return value;
}

export function CustomerDataProvider({
	children,
	sourceFor = loyaltyClientFor,
}: {
	readonly children: ReactNode;
	readonly sourceFor?: LoyaltySourceFactory;
}) {
	const { state, retry, renew, join } = useCustomerSession();
	const endpoint = useDataEndpoint();
	const session = state.status === "ready" ? state.session : null;
	const client = useMemo(
		() => (session === null ? null : sourceFor(endpoint, session)),
		[session, endpoint, sourceFor],
	);
	const [home, setHome] = useState<Load<CustomerHome>>({ status: "loading" });
	const generation = useRef(0);

	const renewedFor = useRef<string | null>(null);
	const renewOnce = useCallback(() => {
		const token = session?.accessToken ?? null;
		if (token === null || renewedFor.current === token) return;
		renewedFor.current = token;
		renew();
	}, [renew, session]);

	const recover = useCallback(
		(error: unknown): Failure => {
			const failure = failureOf(error);
			if (
				failure === "session" ||
				(failure === "not-member" && session?.customer.customerId != null)
			)
				renewOnce();
			return failure;
		},
		[renewOnce, session],
	);

	const loadHome = useCallback(() => {
		if (client === null) return;
		generation.current += 1;
		const current = generation.current;
		setHome((previous) =>
			previous.status === "ready" ? previous : { status: "loading" },
		);
		client.home().then(
			(data) => {
				if (generation.current === current) setHome({ status: "ready", data });
			},
			(error: unknown) => {
				if (generation.current !== current) return;
				const failure = recover(error);
				setHome((previous) =>
					previous.status === "ready"
						? previous
						: { status: "failed", failure },
				);
			},
		);
	}, [client, recover]);

	useEffect(() => {
		loadHome();
	}, [loadHome]);

	const value = useMemo<CustomerDataValue>(
		() => ({
			sessionState: state,
			session,
			member: session?.customer.customerId != null,
			client,
			home:
				state.status === "failed" && home.status !== "ready"
					? {
							status: "failed",
							failure: state.reason === "network" ? "network" : "unknown",
						}
					: home,
			reloadHome: loadHome,
			retrySession: retry,
			recover,
			join,
		}),
		[state, session, client, home, loadHome, retry, recover, join],
	);
	return (
		<CustomerDataContext.Provider value={value}>
			{children}
		</CustomerDataContext.Provider>
	);
}

export function useLoad<T>(
	load: ((client: LoyaltyClient) => Promise<T>) | null,
): { readonly state: Load<T>; reload(): void } {
	const { client, recover } = useCustomerData();
	const [state, setState] = useState<Load<T>>({ status: "loading" });
	const generation = useRef(0);
	const loadRef = useRef(load);
	loadRef.current = load;
	const reload = useCallback(() => {
		const run = loadRef.current;
		if (client === null || run === null) return;
		generation.current += 1;
		const current = generation.current;
		setState((previous) =>
			previous.status === "failed" ? { status: "loading" } : previous,
		);
		run(client).then(
			(data) => {
				if (generation.current === current) setState({ status: "ready", data });
			},
			(error: unknown) => {
				if (generation.current !== current) return;
				const failure = recover(error);
				setState({ status: "failed", failure });
			},
		);
	}, [client, recover]);
	const enabled = load !== null;
	useEffect(() => {
		if (enabled) reload();
		return () => {
			generation.current += 1;
		};
	}, [reload, enabled]);
	return { state, reload };
}
