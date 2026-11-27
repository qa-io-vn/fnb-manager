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
import { RpcError, rpc } from "../lib/rpc";
import { useSession } from "../lib/session";
import { Chime } from "../lib/sound";
import { useStore } from "../lib/store";
import {
	applyBoard,
	type BoardState,
	boardFailed,
	boardOrder,
	dismissResynced,
	EMPTY_BOARD,
} from "./board-model";
import type { BoardAnswer, Order } from "./types";

export const POLL_MS = 2_000;

interface BoardValue {
	readonly state: BoardState;
	readonly soundOn: boolean;
	unlockSound(): Promise<void>;
	/** a call this device just answered */
	removeCall(id: string): void;
	/** an order this device just changed */
	update(order: Order): void;
	refresh(): Promise<void>;
	dismissResynced(): void;
}

const BoardContext = createContext<BoardValue | null>(null);

/**
 * Polls counter_board every 2 seconds while the app is open (the database records the device's presence with each
 * call: without it the store stops taking orders after 180 seconds), merges the changes, rings for new orders and keeps
 * everything shown when a poll fails. A refusal of the store (42501) means the person lost access: they are signed out.
 */
export function BoardProvider({ children }: { readonly children: ReactNode }) {
	const { client, signOut } = useSession();
	const { store } = useStore();
	const [state, setState] = useState<BoardState>(EMPTY_BOARD);
	const held = useRef<BoardState>(EMPTY_BOARD);
	const [soundOn, setSoundOn] = useState(false);
	const chime = useRef(new Chime());
	const running = useRef(false);
	const commit = useCallback((next: BoardState) => {
		held.current = next;
		setState(next);
	}, []);

	const poll = useCallback(async () => {
		if (running.current) return;
		running.current = true;
		try {
			const answer = await rpc<BoardAnswer>(client, "counter_board", {
				p_store: store.id,
				p_cursor: held.current.cursor,
			});
			const next = applyBoard(held.current, answer, Date.now());
			commit(next);
			if (next.fresh.length + next.freshCalls.length > 0) chime.current.play();
		} catch (error) {
			if (error instanceof RpcError && error.forbidden) {
				void signOut("locked");
				return;
			}
			commit(boardFailed(held.current, Date.now()));
		} finally {
			running.current = false;
		}
	}, [client, store.id, signOut, commit]);

	useEffect(() => {
		commit(EMPTY_BOARD);
		let stopped = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const loop = async () => {
			await poll();
			if (!stopped) timer = setTimeout(() => void loop(), POLL_MS);
		};
		void loop();
		return () => {
			stopped = true;
			if (timer !== undefined) clearTimeout(timer);
		};
	}, [poll, commit]);

	const value = useMemo<BoardValue>(
		() => ({
			state,
			soundOn,
			async unlockSound() {
				setSoundOn(await chime.current.unlock());
			},
			removeCall(id) {
				commit({
					...held.current,
					calls: held.current.calls.filter((call) => call.id !== id),
				});
			},
			update(order) {
				commit(boardOrder(held.current, order));
			},
			refresh: poll,
			dismissResynced() {
				commit(dismissResynced(held.current));
			},
		}),
		[state, soundOn, poll, commit],
	);
	return (
		<BoardContext.Provider value={value}>{children}</BoardContext.Provider>
	);
}

export function useBoard(): BoardValue {
	const value = useContext(BoardContext);
	if (value === null) throw new Error("useBoard needs a BoardProvider");
	return value;
}

/**
 * Whether the store takes a VietQR: the ordering state of the last board answer lists it (the server lists an online
 * method only when its provider is configured). False before the first answer or outside a board.
 */
export function useBoardOffersVietQr(): boolean {
	const value = useContext(BoardContext);
	return value?.state.ordering?.payment_methods?.includes("vietqr") === true;
}
