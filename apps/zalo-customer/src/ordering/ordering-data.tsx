import {
	MENU_POLL_MS,
	type Menu,
	type OrderingClient,
	type OrderList,
	type PlaceAnswer,
	type PlaceRequest,
} from "@fnb/zalo-mini/ordering";
import { useDataEndpoint } from "@fnb/zalo-mini/react";
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
import { type Load, useCustomerData } from "../data/customer-data";
import { useOnline } from "../data/offline";
import { useStoreLink } from "../data/store-link";
import {
	type AddOutcome,
	addToCart,
	againstMenu,
	type Cart,
	EMPTY_CART,
	type NewLine,
	type PriceChange,
	removeLine,
	replaceLine,
	requestLines,
	setQuantity,
} from "./cart";
import { type OrderingSourceFactory, orderingClientFor } from "./source";
import {
	type TableLink,
	tableLinkFromEvent,
	tableLinkFromText,
} from "./table-link";

// The ordering state of the app (design spec 6.1, C01 to C07): the store it orders from, the table the server named
// for the scanned QR, the menu and its version poll, the basket in memory, the request being placed (one request_id
// for every retry of the same basket, criterion 3) and the customer's orders for the strip above the tabs.

export type TableContext =
	| {
			readonly state: "checking";
			readonly store: string;
			readonly token: string;
	  }
	| {
			readonly state: "ok";
			readonly store: string;
			readonly token: string;
			readonly label: string;
			readonly area: string | null;
	  }
	| {
			readonly state: "refused";
			readonly store: string;
			readonly refusal: string;
	  }
	| {
			readonly state: "failed";
			readonly store: string;
			readonly token: string;
	  };

interface PendingPlacement {
	readonly signature: string;
	readonly request: PlaceRequest;
}

interface PollRegistry {
	start(): void;
	stop(): void;
}

export interface OrderingValue {
	readonly client: OrderingClient | null;
	/** the store orders go to: the table's, the linked store, else the first store of the brand */
	readonly store: string | null;
	readonly table: TableContext | null;
	readonly menu: Load<Menu>;
	/** items the store does not sell now (sold out, not offered, gone from the menu) */
	readonly unavailable: ReadonlySet<string>;
	readonly cart: Cart;
	readonly priceChanges: readonly PriceChange[];
	readonly orders: Load<OrderList>;
	readonly polls: PollRegistry;
	reloadMenu(): void;
	add(line: NewLine): AddOutcome;
	replace(key: string, line: NewLine): void;
	setQuantity(key: string, quantity: number): void;
	remove(key: string): void;
	clearCart(): void;
	acknowledgePriceChanges(): void;
	/** the request for this basket: the one made before when the basket is the same, so a retry replays it */
	placement(
		signature: string,
		build: (requestId: string) => PlaceRequest,
	): PlaceRequest;
	/** an answer came back: the request is spent (an order) or refused; the next tap makes a new one */
	settlePlacement(answer: PlaceAnswer): void;
	reloadOrders(): void;
	retryTable(): void;
	/** a scanned code: a table's link sets the table (checked by the server); answers whether it was one */
	scanTable(content: string): boolean;
}

const OrderingContext = createContext<OrderingValue | null>(null);

export function useOrdering(): OrderingValue {
	const value = useContext(OrderingContext);
	if (value === null) throw new Error("useOrdering needs an OrderingProvider");
	return value;
}

export function newRequestId(): string {
	if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
	return [
		hex.slice(0, 4).join(""),
		hex.slice(4, 6).join(""),
		hex.slice(6, 8).join(""),
		hex.slice(8, 10).join(""),
		hex.slice(10).join(""),
	].join("-");
}

function union(
	a: ReadonlySet<string>,
	b: ReadonlySet<string>,
): ReadonlySet<string> {
	return new Set([...a, ...b]);
}

export function OrderingProvider({
	children,
	sourceFor = orderingClientFor,
}: {
	readonly children: ReactNode;
	readonly sourceFor?: OrderingSourceFactory;
}) {
	const { session, home, recover } = useCustomerData();
	const endpoint = useDataEndpoint();
	const { currentStore, opening } = useStoreLink();
	const online = useOnline();
	const client = useMemo(
		() => (session === null ? null : sourceFor(endpoint, session)),
		[session, endpoint, sourceFor],
	);

	const [table, setTable] = useState<TableContext | null>(null);
	const [tableAttempt, setTableAttempt] = useState(0);
	const [tableLink, setTableLink] = useState<TableLink | null>(null);
	// a link that opened the app (at launch or through OpenApp) with a table's token; another link keeps the table
	useEffect(() => {
		const found = opening === null ? null : tableLinkFromEvent(opening.data);
		if (found !== null) setTableLink(found);
	}, [opening]);
	const scanTable = useCallback((content: string): boolean => {
		const found = tableLinkFromText(content);
		if (found !== null) setTableLink(found);
		return found !== null;
	}, []);
	// a new table QR replaces the table: the label is always the server's answer for the token, never the address's
	useEffect(() => {
		if (tableLink === null || client === null) return;
		void tableAttempt;
		let live = true;
		setTable({
			state: "checking",
			store: tableLink.store,
			token: tableLink.token,
		});
		client.table(tableLink.store, tableLink.token).then(
			(answer) => {
				if (!live) return;
				setTable(
					answer.state === "ok"
						? {
								state: "ok",
								store: tableLink.store,
								token: tableLink.token,
								label: answer.label,
								area: answer.area,
							}
						: {
								state: "refused",
								store: tableLink.store,
								refusal: answer.refusal,
							},
				);
			},
			(error: unknown) => {
				if (!live) return;
				recover(error);
				setTable({
					state: "failed",
					store: tableLink.store,
					token: tableLink.token,
				});
			},
		);
		return () => {
			live = false;
		};
	}, [tableLink, client, recover, tableAttempt]);

	const homeStore =
		home.status === "ready" ? (home.data.stores[0]?.code ?? null) : null;
	const store = table?.store ?? currentStore ?? homeStore;

	const [menu, setMenu] = useState<Load<Menu>>({ status: "loading" });
	const [polled, setPolled] = useState<ReadonlySet<string>>(() => new Set());
	const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
	const [cart, setCart] = useState<Cart>(EMPTY_CART);
	const cartRef = useRef(cart);
	cartRef.current = cart;
	const [priceChanges, setPriceChanges] = useState<readonly PriceChange[]>([]);
	const menuGeneration = useRef(0);
	const loadedVersion = useRef<number | null>(null);

	const reloadMenu = useCallback(() => {
		if (client === null || store === null) return;
		menuGeneration.current += 1;
		const current = menuGeneration.current;
		setMenu((previous) =>
			previous.status === "failed" ? { status: "loading" } : previous,
		);
		client.menu(store, null).then(
			(data) => {
				if (menuGeneration.current !== current) return;
				loadedVersion.current = data.menuVersion;
				setMenu({ status: "ready", data });
				setPolled(new Set(data.unavailableItems));
				const basket = cartRef.current;
				if (basket.store === store && basket.lines.length > 0) {
					const checked = againstMenu(basket, data);
					cartRef.current = checked.cart;
					setCart(checked.cart);
					setGone(checked.gone);
					if (checked.changes.length > 0)
						setPriceChanges((known) => [...known, ...checked.changes]);
				} else {
					setGone(new Set());
				}
			},
			(error: unknown) => {
				if (menuGeneration.current !== current) return;
				const failure = recover(error);
				setMenu((previous) =>
					previous.status === "ready"
						? previous
						: { status: "failed", failure },
				);
			},
		);
	}, [client, store, recover]);

	useEffect(() => {
		loadedVersion.current = null;
		reloadMenu();
	}, [reloadMenu]);

	const [orders, setOrders] = useState<Load<OrderList>>({ status: "loading" });
	const ordersGeneration = useRef(0);
	const reloadOrders = useCallback(() => {
		if (client === null) return;
		ordersGeneration.current += 1;
		const current = ordersGeneration.current;
		client.orders(null).then(
			(data) => {
				if (ordersGeneration.current === current)
					setOrders({ status: "ready", data });
			},
			(error: unknown) => {
				if (ordersGeneration.current !== current) return;
				const failure = recover(error);
				setOrders((previous) =>
					previous.status === "ready"
						? previous
						: { status: "failed", failure },
				);
			},
		);
	}, [client, recover]);
	useEffect(() => {
		reloadOrders();
	}, [reloadOrders]);

	// the cheap version poll, every 3 s while a screen asks for it: a sold-out item leaves at once and a new version
	// reads the menu again (criterion 2: within 5 seconds)
	const [pollers, setPollers] = useState(0);
	useEffect(() => {
		if (pollers === 0 || client === null || store === null || !online) return;
		let live = true;
		const timer = setInterval(() => {
			client.menuVersion(store).then(
				(answer) => {
					if (!live) return;
					setPolled(new Set(answer.unavailableItems));
					setMenu((previous) =>
						previous.status === "ready"
							? {
									status: "ready",
									data: { ...previous.data, ordering: answer.ordering },
								}
							: previous,
					);
					if (
						loadedVersion.current !== null &&
						answer.menuVersion !== loadedVersion.current
					)
						reloadMenu();
				},
				() => undefined,
			);
		}, MENU_POLL_MS);
		return () => {
			live = false;
			clearInterval(timer);
		};
	}, [pollers, client, store, online, reloadMenu]);
	const polls = useMemo<PollRegistry>(
		() => ({
			start: () => setPollers((count) => count + 1),
			stop: () => setPollers((count) => Math.max(0, count - 1)),
		}),
		[],
	);

	const pending = useRef<PendingPlacement | null>(null);
	const placement = useCallback(
		(signature: string, build: (requestId: string) => PlaceRequest) => {
			const known = pending.current;
			if (known !== null && known.signature === signature) return known.request;
			const request = build(newRequestId());
			pending.current = { signature, request };
			return request;
		},
		[],
	);
	const settlePlacement = useCallback(
		(answer: PlaceAnswer) => {
			pending.current = null;
			if (answer.state !== "refused") {
				cartRef.current = EMPTY_CART;
				setCart(EMPTY_CART);
				setPriceChanges([]);
				reloadOrders();
			}
		},
		[reloadOrders],
	);

	const add = useCallback(
		(line: NewLine): AddOutcome => {
			if (store === null) return "invalid";
			const result = addToCart(cartRef.current, store, line);
			cartRef.current = result.cart;
			setCart(result.cart);
			return result.outcome;
		},
		[store],
	);
	const change = useCallback((next: (cart: Cart) => Cart) => {
		const updated = next(cartRef.current);
		cartRef.current = updated;
		setCart(updated);
	}, []);

	const unavailable = useMemo(() => union(polled, gone), [polled, gone]);
	const value = useMemo<OrderingValue>(
		() => ({
			client,
			store,
			table,
			menu,
			unavailable,
			cart,
			priceChanges,
			orders,
			polls,
			reloadMenu,
			add,
			replace: (key, line) =>
				change((previous) => replaceLine(previous, key, line)),
			setQuantity: (key, quantity) =>
				change((previous) => setQuantity(previous, key, quantity)),
			remove: (key) => change((previous) => removeLine(previous, key)),
			clearCart: () => change(() => EMPTY_CART),
			acknowledgePriceChanges: () => setPriceChanges([]),
			placement,
			settlePlacement,
			reloadOrders,
			retryTable: () => setTableAttempt((count) => count + 1),
			scanTable,
		}),
		[
			client,
			store,
			table,
			menu,
			unavailable,
			cart,
			priceChanges,
			orders,
			polls,
			reloadMenu,
			add,
			change,
			placement,
			settlePlacement,
			reloadOrders,
			scanTable,
		],
	);
	return (
		<OrderingContext.Provider value={value}>
			{children}
		</OrderingContext.Provider>
	);
}

/** Keeps the menu's version poll running while the calling screen is on show (the menu, an item, the basket). */
export function useMenuPoll(): void {
	const { polls } = useOrdering();
	useEffect(() => {
		polls.start();
		return () => polls.stop();
	}, [polls]);
}

/** The basket's identity for a placement: the same lines and choices make the same request. */
export function basketSignature(
	cart: Cart,
	extra: Readonly<Record<string, unknown>>,
): string {
	return JSON.stringify({ lines: requestLines(cart), ...extra });
}
