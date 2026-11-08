import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { supabaseConfig } from "../lib/env";
import { readStoredJson, removeStored, writeStoredJson } from "../lib/storage";

const DEMO_SESSION_KEY = "fnb.demo-session";

export type AppMode = "live" | "demo";

interface AppModeValue {
	mode: AppMode;
	isConfigured: boolean;
	enterDemo: () => void;
	exitDemo: () => void;
}

const AppModeContext = createContext<AppModeValue | null>(null);

function demoRequestedForSession(): boolean {
	return (
		readStoredJson(DEMO_SESSION_KEY, (value) => value === true, "session") ===
		true
	);
}

export function AppModeProvider({
	children,
	isConfigured = supabaseConfig !== null,
}: {
	children: ReactNode;
	isConfigured?: boolean;
}) {
	const [demoRequested, setDemoRequested] = useState(demoRequestedForSession);
	const enterDemo = useCallback(() => {
		writeStoredJson(DEMO_SESSION_KEY, true, "session");
		setDemoRequested(true);
	}, []);
	const exitDemo = useCallback(() => {
		removeStored(DEMO_SESSION_KEY, "session");
		setDemoRequested(false);
	}, []);
	const value = useMemo<AppModeValue>(
		() => ({
			mode: !isConfigured || demoRequested ? "demo" : "live",
			isConfigured,
			enterDemo,
			exitDemo,
		}),
		[isConfigured, demoRequested, enterDemo, exitDemo],
	);
	return (
		<AppModeContext.Provider value={value}>{children}</AppModeContext.Provider>
	);
}

export function useAppMode(): AppModeValue {
	const value = useContext(AppModeContext);
	if (value === null) throw new Error("AppModeProvider is missing");
	return value;
}
