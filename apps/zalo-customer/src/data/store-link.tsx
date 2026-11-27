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

/** The last link the app was opened with: the launch's route params, or what OpenApp handed over, numbered. */
export interface LinkOpening {
	readonly data: unknown;
	readonly serial: number;
}

interface StoreLinkValue {
	readonly currentStore: string | null;
	readonly source: LinkSource | null;
	readonly opening: LinkOpening | null;
	chooseStore(store: string): void;
}

const StoreLinkContext = createContext<StoreLinkValue>({
	currentStore: null,
	source: null,
	opening: null,
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
	pathFor,
}: {
	readonly children: ReactNode;
	/**
	 * Where a link opens: the store page unless this names another screen for it (the ordering build opens a table's
	 * QR on the menu). It gets the link and what it came with: the launch's route params as `params`, or OpenApp's data.
	 */
	readonly pathFor?: (link: StoreLink, data: unknown) => string | null;
}) {
	const navigate = useNavigate();
	const [launch] = useState(() => ({ params: readRouteParams() }));
	const [link, setLink] = useState<StoreLink | null>(() =>
		storeLinkFrom(launch.params),
	);
	const [opening, setOpening] = useState<LinkOpening | null>(() => ({
		data: launch,
		serial: 0,
	}));
	const [chosen, setChosen] = useState<string | null>(null);
	const opened = useRef(false);
	const pathRef = useRef(pathFor);
	pathRef.current = pathFor;

	// the launch's own link opens its screen once; a link that comes later through OpenApp is opened by its handler
	useEffect(() => {
		if (opened.current) return;
		opened.current = true;
		const atLaunch = storeLinkFrom(launch.params);
		if (atLaunch === null) return;
		navigate(
			pathRef.current?.(atLaunch, launch) ?? `/cua-hang/${atLaunch.store}`,
		);
	}, [navigate, launch]);

	useEffect(() => {
		const onOpen = (data: unknown) => {
			const found = storeLinkFromEvent(data);
			if (found === null) return;
			setLink(found);
			setChosen(null);
			setOpening((previous) => ({
				data,
				serial: (previous?.serial ?? 0) + 1,
			}));
			navigate(pathRef.current?.(found, data) ?? `/cua-hang/${found.store}`);
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
			opening,
			chooseStore,
		}),
		[chosen, link, opening, chooseStore],
	);
	return (
		<StoreLinkContext.Provider value={value}>
			{children}
		</StoreLinkContext.Provider>
	);
}
