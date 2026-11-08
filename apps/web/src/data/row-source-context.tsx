import type { SupabaseClient } from "@supabase/supabase-js";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useAppMode } from "../app-mode/app-mode";
import { useSession } from "../auth/session";
import type { RowSource } from "./row-source";

export type RowSourceState =
	| { status: "loading" }
	| { status: "ready"; source: RowSource }
	| { status: "failed" };

const RowSourceContext = createContext<RowSourceState>({ status: "loading" });

export async function loadDemoRowSource(): Promise<RowSource> {
	const demo = await import("../demo/demo-row-source");
	return demo.createDemoRowSource();
}

export async function loadSupabaseRowSource(
	client: SupabaseClient,
): Promise<RowSource> {
	const live = await import("./supabase-row-source");
	return live.createSupabaseRowSource(client);
}

function useLoadedRowSource(
	load: (() => Promise<RowSource>) | null,
): RowSourceState {
	const [state, setState] = useState<RowSourceState>({ status: "loading" });
	useEffect(() => {
		if (!load) return;
		let active = true;
		setState({ status: "loading" });
		load().then(
			(source) => active && setState({ status: "ready", source }),
			() => active && setState({ status: "failed" }),
		);
		return () => {
			active = false;
		};
	}, [load]);
	return state;
}

export function RowSourceProvider({ children }: { children: ReactNode }) {
	const { mode } = useAppMode();
	const { client, clientFailed } = useSession();
	const demoState = useLoadedRowSource(
		mode === "demo" ? loadDemoRowSource : null,
	);
	const loadLive = useMemo(
		() => (client ? () => loadSupabaseRowSource(client) : null),
		[client],
	);
	const liveState = useLoadedRowSource(loadLive);
	const state: RowSourceState =
		mode === "demo"
			? demoState
			: clientFailed
				? { status: "failed" }
				: liveState;
	return (
		<RowSourceContext.Provider value={state}>
			{children}
		</RowSourceContext.Provider>
	);
}

export function useRowSourceState(): RowSourceState {
	return useContext(RowSourceContext);
}
