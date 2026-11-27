import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { query } from "./rpc";
import { STORE_STORAGE_KEY, useMember, useSession } from "./session";

export interface StoreChoice {
	readonly id: string;
	readonly name: string;
}

interface StoreValue {
	readonly store: StoreChoice;
	readonly stores: readonly StoreChoice[];
	choose(id: string): void;
}

const StoreContext = createContext<StoreValue | null>(null);

/** The stores of the signed-in member at this brand: from the sign-in answer, else read under RLS. */
function useMemberStores(): readonly StoreChoice[] | null {
	const { member } = useMember();
	const { client } = useSession();
	const given = useMemo(() => {
		if (member.store_ids === null) return null;
		return member.store_ids.map((id, index) => ({
			id,
			name: member.stores[index] ?? id,
		}));
	}, [member]);
	const [read, setRead] = useState<readonly StoreChoice[] | null>(null);
	useEffect(() => {
		if (given !== null) return;
		query<{ id: string; name: string }[]>(
			client
				.from("stores")
				.select("id, name")
				.eq("tenant_id", member.tenant_id)
				.order("name"),
		)
			.then((rows) =>
				setRead(rows.map((row) => ({ id: row.id, name: row.name }))),
			)
			.catch(() => setRead([]));
	}, [client, given, member.tenant_id]);
	return given ?? read;
}

export function StoreProvider({
	children,
	picker,
	loading,
	none,
}: {
	readonly children: ReactNode;
	readonly picker: (
		stores: readonly StoreChoice[],
		choose: (id: string) => void,
	) => ReactNode;
	readonly loading: ReactNode;
	readonly none: ReactNode;
}) {
	const stores = useMemberStores();
	const [chosen, setChosen] = useState<string | null>(() => {
		try {
			return window.localStorage.getItem(STORE_STORAGE_KEY);
		} catch {
			return null;
		}
	});
	const choose = (id: string) => {
		try {
			window.localStorage.setItem(STORE_STORAGE_KEY, id);
		} catch {
			// remembered for this visit only
		}
		setChosen(id);
	};
	if (stores === null) return <>{loading}</>;
	if (stores.length === 0) return <>{none}</>;
	const store =
		stores.find((candidate) => candidate.id === chosen) ??
		(stores.length === 1 ? stores[0] : undefined);
	if (store === undefined) return <>{picker(stores, choose)}</>;
	return (
		<StoreContext.Provider value={{ store, stores, choose }}>
			{children}
		</StoreContext.Provider>
	);
}

export function useStore(): StoreValue {
	const value = useContext(StoreContext);
	if (value === null) throw new Error("useStore needs a StoreProvider");
	return value;
}
