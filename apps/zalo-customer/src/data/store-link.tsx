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
import { useNavigate } from "react-router-dom";
import { EventName, events, getRouteParams } from "zmp-sdk";
import {
	type LinkSource,
	type StoreLink,
	storeLinkFrom,
	storeLinkFromEvent,
} from "./link";

export {
	LINK_SOURCES,
	type LinkSource,
	type StoreLink,
	storeLinkFrom,
	storeLinkFromEvent,
	storeLinkFromPath,
} from "./link";

interface StoreLinkValue {
	readonly currentStore: string | null;
	readonly source: LinkSource | null;
	chooseStore(store: string): void;
}

const StoreLinkContext = createContext<StoreLinkValue>({
	currentStore: null,
	source: null,
	chooseStore: () => undefined,
});

export function useStoreLink(): StoreLinkValue {
	return useContext(StoreLinkContext);
}

function readRouteParams(): Record<string, string> {
	try {
		return getRouteParams();
	} catch {
		return {};
	}
}

export function StoreLinkProvider({
	children,
}: {
	readonly children: ReactNode;
}) {
	const navigate = useNavigate();
	const [link, setLink] = useState<StoreLink | null>(() =>
		storeLinkFrom(readRouteParams()),
	);
	const [chosen, setChosen] = useState<string | null>(null);
	const opened = useRef(false);

	useEffect(() => {
		if (opened.current || link === null) return;
		opened.current = true;
		navigate(`/cua-hang/${link.store}`);
	}, [link, navigate]);

	useEffect(() => {
		const onOpen = (data: unknown) => {
			const found = storeLinkFromEvent(data);
			if (found === null) return;
			setLink(found);
			setChosen(null);
			navigate(`/cua-hang/${found.store}`);
		};
		events.on(EventName.OpenApp, onOpen);
		return () => {
			events.off(EventName.OpenApp, onOpen);
		};
	}, [navigate]);

	const chooseStore = useCallback((store: string) => setChosen(store), []);
	const value = useMemo<StoreLinkValue>(
		() => ({
			currentStore: chosen ?? link?.store ?? null,
			source: link?.source ?? null,
			chooseStore,
		}),
		[chosen, link, chooseStore],
	);
	return (
		<StoreLinkContext.Provider value={value}>
			{children}
		</StoreLinkContext.Provider>
	);
}
