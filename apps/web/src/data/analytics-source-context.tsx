import type { ReportSource } from "@fnb/reports";
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

export type AnalyticsSourceState =
	| { status: "loading" }
	| { status: "ready"; source: ReportSource }
	| { status: "failed" };

interface AnalyticsSourceHandle {
	readonly state: AnalyticsSourceState;
	readonly request: () => void;
}

const AnalyticsSourceContext = createContext<AnalyticsSourceHandle>({
	state: { status: "loading" },
	request: () => undefined,
});

export async function loadDemoAnalyticsSource(): Promise<ReportSource> {
	const demo = await import("../demo/demo-analytics-source");
	return demo.createWebDemoAnalyticsSource();
}

export async function loadSupabaseAnalyticsSource(
	client: SupabaseClient,
): Promise<ReportSource> {
	const live = await import("./supabase-analytics-source");
	return live.createSupabaseAnalyticsSource(client);
}

function useLoadedAnalyticsSource(
	load: (() => Promise<ReportSource>) | null,
): AnalyticsSourceState {
	const [state, setState] = useState<AnalyticsSourceState>({
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

export function AnalyticsSourceProvider({ children }: { children: ReactNode }) {
	const { mode } = useAppMode();
	const { client, clientFailed } = useSession();
	const [requested, setRequested] = useState(false);
	const request = useCallback(() => setRequested(true), []);
	const demoState = useLoadedAnalyticsSource(
		requested && mode === "demo" ? loadDemoAnalyticsSource : null,
	);
	const loadLive = useMemo(
		() => (client ? () => loadSupabaseAnalyticsSource(client) : null),
		[client],
	);
	const liveState = useLoadedAnalyticsSource(
		requested && mode !== "demo" ? loadLive : null,
	);
	const failed = mode !== "demo" && clientFailed;
	const state = useMemo<AnalyticsSourceState>(
		() =>
			mode === "demo" ? demoState : failed ? { status: "failed" } : liveState,
		[mode, demoState, failed, liveState],
	);
	const handle = useMemo(() => ({ state, request }), [state, request]);
	return (
		<AnalyticsSourceContext.Provider value={handle}>
			{children}
		</AnalyticsSourceContext.Provider>
	);
}

export function useAnalyticsSourceState(): AnalyticsSourceState {
	const { state, request } = useContext(AnalyticsSourceContext);
	useEffect(() => request(), [request]);
	return state;
}
