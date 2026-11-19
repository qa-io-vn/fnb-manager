import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import type { JoinRequest } from "../loyalty/contract";
import type {
	CustomerSessionClient,
	CustomerSessionState,
	JoinResult,
} from "../session/customer-session-client";

export interface CustomerSessionValue {
	readonly state: CustomerSessionState;
	retry(): void;
	renew(): void;
	join(request: JoinRequest): Promise<JoinResult>;
}

const CustomerSessionContext = createContext<CustomerSessionValue | null>(null);

export interface CustomerSessionProviderProps {
	readonly client: CustomerSessionClient;
	readonly children: ReactNode;
}

export function CustomerSessionProvider({
	client,
	children,
}: CustomerSessionProviderProps) {
	const [state, setState] = useState<CustomerSessionState>({
		status: "connecting",
	});

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

	const renew = useCallback(() => {
		setState({ status: "connecting" });
		client.refresh().then(setState);
	}, [client]);

	const join = useCallback(
		async (request: JoinRequest) => {
			const result = await client.join(request);
			if (result.ok) setState({ status: "ready", session: result.session });
			return result;
		},
		[client],
	);

	const value = useMemo(
		() => ({ state, retry, renew, join }),
		[state, retry, renew, join],
	);
	return (
		<CustomerSessionContext.Provider value={value}>
			{children}
		</CustomerSessionContext.Provider>
	);
}

export function useCustomerSession(): CustomerSessionValue {
	const value = useContext(CustomerSessionContext);
	if (!value)
		throw new Error("useCustomerSession needs a CustomerSessionProvider");
	return value;
}
