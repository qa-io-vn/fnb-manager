import { STORE_CODE_PATTERN } from "@fnb/zalo-mini/loyalty";
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

export const LINK_SOURCES = ["qr", "standee", "receipt"] as const;
export type LinkSource = (typeof LINK_SOURCES)[number];

export interface StoreLink {
	readonly store: string;
	readonly source: LinkSource | null;
}

export function storeLinkFrom(
	params: Readonly<Record<string, string | undefined>>,
): StoreLink | null {
	const store = params.store?.trim().toLowerCase() ?? "";
	if (!STORE_CODE_PATTERN.test(store)) return null;
	const source = LINK_SOURCES.find((name) => name === params.src) ?? null;
	return { store, source };
}

export function storeLinkFromPath(path: unknown): StoreLink | null {
	if (typeof path !== "string") return null;
	const query = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
	return storeLinkFrom(Object.fromEntries(new URLSearchParams(query)));
}

export function storeLinkFromEvent(data: unknown): StoreLink | null {
	if (typeof data !== "object" || data === null) return null;
	const record = data as Readonly<Record<string, unknown>>;
	const params = record.params ?? record.query;
	if (typeof params === "object" && params !== null) {
		const found = storeLinkFrom(
			Object.fromEntries(
				Object.entries(params).map(([key, value]) => [key, String(value)]),
			),
		);
		if (found !== null) return found;
	}
	return storeLinkFromPath(record.path);
}

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
