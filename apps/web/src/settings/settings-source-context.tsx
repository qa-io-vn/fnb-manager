import type { SupabaseClient } from "@supabase/supabase-js";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useAppMode } from "../app-mode/app-mode";
import { useSession } from "../auth/session";
import type { SettingsSource } from "./source";

export type SettingsSourceState =
	| { status: "loading" }
	| { status: "ready"; source: SettingsSource }
	| { status: "failed" };

interface SettingsSourceHandle {
	readonly state: SettingsSourceState;
	readonly request: () => void;
}

const SettingsSourceContext = createContext<SettingsSourceHandle>({
	state: { status: "loading" },
	request: () => undefined,
});

export async function loadDemoSettingsSource(): Promise<SettingsSource> {
	const [demo, store] = await Promise.all([
		import("./demo-settings-source"),
		import("../demo/demo-settings"),
	]);
	return demo.createDemoSettingsSource(store.sharedDemoSettings());
}

export async function loadSupabaseSettingsSource(
	client: SupabaseClient,
): Promise<SettingsSource> {
	const live = await import("./supabase-settings-source");
	return live.createSupabaseSettingsSource(client);
}

function useLoadedSettingsSource(
	load: (() => Promise<SettingsSource>) | null,
): SettingsSourceState {
	const [state, setState] = useState<SettingsSourceState>({
		status: "loading",
	});
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

export function SettingsSourceProvider({ children }: { children: ReactNode }) {
	const { mode } = useAppMode();
	const { client, clientFailed } = useSession();
	const [requested, setRequested] = useState(false);
	const request = useCallback(() => setRequested(true), []);
	const demoState = useLoadedSettingsSource(
		requested && mode === "demo" ? loadDemoSettingsSource : null,
	);
	const loadLive = useMemo(
		() => (client ? () => loadSupabaseSettingsSource(client) : null),
		[client],
	);
	const liveState = useLoadedSettingsSource(
		requested && mode !== "demo" ? loadLive : null,
	);
	const failed = mode !== "demo" && clientFailed;
	const state = useMemo<SettingsSourceState>(
		() =>
			mode === "demo" ? demoState : failed ? { status: "failed" } : liveState,
		[mode, demoState, failed, liveState],
	);
	const handle = useMemo(() => ({ state, request }), [state, request]);
	return (
		<SettingsSourceContext.Provider value={handle}>
			{children}
		</SettingsSourceContext.Provider>
	);
}

export function useSettingsSourceState(): SettingsSourceState {
	const { state, request } = useContext(SettingsSourceContext);
	useEffect(() => {
		request();
	}, [request]);
	return state;
}
