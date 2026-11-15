import type { SupabaseClient } from "@supabase/supabase-js";
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
	readonly retry: () => void;
}

const SettingsSourceContext = createContext<SettingsSourceHandle>({
	state: { status: "loading" },
	request: () => undefined,
	retry: () => undefined,
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
): readonly [SettingsSourceState, () => void] {
	const [state, setState] = useState<SettingsSourceState>({
		status: "loading",
	});
	const latestRun = useRef(0);
	const start = useCallback(() => {
		if (!load) return;
		latestRun.current += 1;
		const run = latestRun.current;
		setState({ status: "loading" });
		load().then(
			(source) =>
				latestRun.current === run && setState({ status: "ready", source }),
			() => latestRun.current === run && setState({ status: "failed" }),
		);
	}, [load]);
	useEffect(() => {
		start();
		return () => {
			latestRun.current += 1;
		};
	}, [start]);
	return [state, start];
}

export function SettingsSourceProvider({ children }: { children: ReactNode }) {
	const { mode } = useAppMode();
	const { client, clientFailed } = useSession();
	const [requested, setRequested] = useState(false);
	const [demoState, reloadDemo] = useLoadedSettingsSource(
		requested && mode === "demo" ? loadDemoSettingsSource : null,
	);
	const loadLive = useMemo(
		() => (client ? () => loadSupabaseSettingsSource(client) : null),
		[client],
	);
	const [liveState, reloadLive] = useLoadedSettingsSource(
		requested && mode !== "demo" ? loadLive : null,
	);
	const failed = mode !== "demo" && clientFailed;
	const state = useMemo<SettingsSourceState>(
		() =>
			mode === "demo" ? demoState : failed ? { status: "failed" } : liveState,
		[mode, demoState, failed, liveState],
	);
	const retry = mode === "demo" ? reloadDemo : reloadLive;
	const failedBefore = useRef(false);
	useEffect(() => {
		failedBefore.current = state.status === "failed";
	}, [state.status]);
	const request = useCallback(() => {
		setRequested(true);
		if (failedBefore.current) {
			failedBefore.current = false;
			retry();
		}
	}, [retry]);
	const handle = useMemo(
		() => ({ state, request, retry }),
		[state, request, retry],
	);
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

export function useRetrySettingsSource(): () => void {
	return useContext(SettingsSourceContext).retry;
}
