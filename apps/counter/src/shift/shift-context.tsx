import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { RpcError } from "../lib/rpc";
import { useSession } from "../lib/session";
import { type MyShift, myShift, type Shift } from "./api";

interface ShiftValue {
	readonly data: MyShift | null;
	/** the person's shift that is not closed, whatever store */
	readonly current: Shift | null;
	readonly error: RpcError | null;
	refresh(): Promise<void>;
	set(data: MyShift): void;
}

const ShiftContext = createContext<ShiftValue | null>(null);

/** The signed-in person's shift (staff_my_shift), asked again while a manager has to confirm a difference. */
export function ShiftProvider({ children }: { readonly children: ReactNode }) {
	const { client } = useSession();
	const [data, setData] = useState<MyShift | null>(null);
	const [error, setError] = useState<RpcError | null>(null);
	const refresh = useCallback(async () => {
		try {
			setData(await myShift(client));
			setError(null);
		} catch (reason) {
			setError(
				reason instanceof RpcError
					? reason
					: new RpcError("unknown", String(reason)),
			);
		}
	}, [client]);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	const awaiting = data?.shift?.status === "awaiting_confirmation";
	useEffect(() => {
		if (!awaiting) return;
		const timer = setInterval(() => void refresh(), 10_000);
		return () => clearInterval(timer);
	}, [awaiting, refresh]);
	const value = useMemo<ShiftValue>(
		() => ({
			data,
			current: data?.shift ?? null,
			error,
			refresh,
			set: setData,
		}),
		[data, error, refresh],
	);
	return (
		<ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>
	);
}

export function useShift(): ShiftValue {
	const value = useContext(ShiftContext);
	if (value === null) throw new Error("useShift needs a ShiftProvider");
	return value;
}
