import type { MemberRole } from "@fnb/zalo-mini";
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
import type { HomeFormatters } from "../home/format";
import { isoDayIn } from "../loyalty/model";
import type { ActionResult } from "../shift/env";
import type { Failure } from "../shift/model";
import type { ShiftContext } from "../shift/source";
import type { TeamClient } from "./client";

export const PROFILE_PATH = "/ca-nhan";

export const TEAM_PATHS = {
	notices: "/thong-bao",
	sendRequest: "/gui-yeu-cau",
	myRequests: "/yeu-cau",
	approvals: "/duyet-yeu-cau",
	notifications: "/nhan-thong-bao",
} as const;

export type TeamPath = (typeof TEAM_PATHS)[keyof typeof TEAM_PATHS];

export interface TeamOpen {
	readonly announcementId: string | null;
	readonly storeId: string | null;
}

export const NO_TEAM_OPEN: TeamOpen = { announcementId: null, storeId: null };

export function teamOpenState(open: Partial<TeamOpen>): {
	readonly team: TeamOpen;
} {
	return { team: { ...NO_TEAM_OPEN, ...open } };
}

export function readTeamOpen(state: unknown): TeamOpen {
	if (typeof state !== "object" || state === null) return NO_TEAM_OPEN;
	const open = (state as { readonly team?: unknown }).team;
	if (typeof open !== "object" || open === null) return NO_TEAM_OPEN;
	const value = open as Readonly<Record<string, unknown>>;
	return {
		announcementId:
			typeof value.announcementId === "string" ? value.announcementId : null,
		storeId: typeof value.storeId === "string" ? value.storeId : null,
	};
}

export type When = Readonly<Record<"time" | "date", string>>;

export interface TeamEnv {
	readonly client: TeamClient;
	readonly context: ShiftContext;
	readonly memberId: string | null;
	readonly role: MemberRole;
	readonly manager: boolean;
	readonly formatters: HomeFormatters;
	recover(error: unknown): Failure;
	storeName(id: string): string | null;
	when(iso: string): When;
	go(path: TeamPath, open?: Partial<TeamOpen>): void;
	home(): void;
}

const TeamEnvContext = createContext<TeamEnv | null>(null);

export function TeamEnvProvider({
	value,
	children,
}: {
	readonly value: TeamEnv;
	readonly children: ReactNode;
}) {
	return (
		<TeamEnvContext.Provider value={value}>{children}</TeamEnvContext.Provider>
	);
}

export function useTeamEnv(): TeamEnv {
	const env = useContext(TeamEnvContext);
	if (env === null) throw new Error("useTeamEnv needs a TeamEnvProvider");
	return env;
}

export function whenIn(
	formatters: HomeFormatters,
	timeZone: string,
	iso: string,
): When {
	const instant = new Date(iso);
	return {
		time: formatters.time(instant),
		date: formatters.date(isoDayIn(instant, timeZone)),
	};
}

export interface TeamAction {
	readonly busy: boolean;
	readonly failure: Failure | null;
	run<T>(work: () => Promise<T>): Promise<ActionResult<T>>;
	clear(): void;
}

export function useTeamAction(): TeamAction {
	const { recover } = useTeamEnv();
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<Failure | null>(null);
	const mounted = useRef(true);
	const running = useRef(false);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const run = useCallback(
		async <T,>(work: () => Promise<T>): Promise<ActionResult<T>> => {
			if (running.current) return { ok: false, failure: "duplicate" };
			running.current = true;
			setBusy(true);
			setFailure(null);
			try {
				const value = await work();
				return { ok: true, value };
			} catch (error) {
				const kind = recover(error);
				if (mounted.current) setFailure(kind);
				return { ok: false, failure: kind };
			} finally {
				running.current = false;
				if (mounted.current) setBusy(false);
			}
		},
		[recover],
	);
	const clear = useCallback(() => setFailure(null), []);
	return useMemo(
		() => ({ busy, failure, run, clear }),
		[busy, failure, run, clear],
	);
}

export type Load<T> =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly value: T }
	| { readonly status: "failed"; readonly failure: Failure };

export function useLoad<T>(
	fetch: () => Promise<T>,
	recover: (error: unknown) => Failure,
	enabled = true,
): { readonly load: Load<T>; reload(): void } {
	const [load, setLoad] = useState<Load<T>>({ status: "loading" });
	const generation = useRef(0);
	const reload = useCallback(() => {
		generation.current += 1;
		const current = generation.current;
		setLoad((previous) =>
			previous.status === "ready" ? previous : { status: "loading" },
		);
		fetch().then(
			(value) => {
				if (generation.current === current) setLoad({ status: "ready", value });
			},
			(error: unknown) => {
				if (generation.current === current)
					setLoad({ status: "failed", failure: recover(error) });
			},
		);
	}, [fetch, recover]);
	useEffect(() => {
		if (enabled) reload();
		return () => {
			generation.current += 1;
		};
	}, [enabled, reload]);
	return { load, reload };
}
