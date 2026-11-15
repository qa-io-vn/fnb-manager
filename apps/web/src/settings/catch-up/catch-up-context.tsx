import { type QueryClient, useQueryClient } from "@tanstack/react-query";
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
import { invalidateAnalytics } from "../../data/invalidate-analytics";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { isTenantSettingsKey, settingsQueryKey } from "../queries";
import {
	type CatchUpStatus,
	type SettingsSource,
	SettingsWriteError,
} from "../source";
import { runCatchUp } from "./run-catch-up";

export type CatchUpProblem = SettingsWriteError["code"] | "stalled" | "failed";

export interface CatchUpRunner {
	readonly running: boolean;
	readonly problem: CatchUpProblem | null;
	readonly completed: boolean;
	readonly start: (source: SettingsSource) => void;
	readonly abort: () => void;
	readonly dismiss: () => void;
}

interface RunState {
	readonly running: boolean;
	readonly problem: CatchUpProblem | null;
	readonly completed: boolean;
}

interface RunToken {
	readonly tenantId: string;
	aborted: boolean;
}

const IDLE: RunState = { running: false, problem: null, completed: false };

const NO_RUNNER: CatchUpRunner = {
	...IDLE,
	start: () => undefined,
	abort: () => undefined,
	dismiss: () => undefined,
};

const CatchUpContext = createContext<CatchUpRunner>(NO_RUNNER);

const CATCH_UP_READ = "catchUp";

function problemOf(error: unknown): CatchUpProblem {
	return error instanceof SettingsWriteError ? error.code : "failed";
}

export function pendingKeyOf(status: CatchUpStatus): string {
	return [status.inputsChangedAt, status.pendingFrom, status.pendingTo].join(
		"|",
	);
}

function changedDuringSession(
	status: CatchUpStatus,
	sessionStartedAt: number,
): boolean {
	return (
		status.inputsChangedAt !== null &&
		Date.parse(status.inputsChangedAt) >= sessionStartedAt
	);
}

function useAnalyticsFollowTheStatus(
	queryClient: QueryClient,
	tenantId: string,
): void {
	useEffect(() => {
		const sessionStartedAt = Date.now();
		let lastSeen: string | null = null;
		return queryClient.getQueryCache().subscribe((event) => {
			const { queryKey, state } = event.query;
			if (
				event.type !== "updated" ||
				event.action.type !== "success" ||
				queryKey[3] !== CATCH_UP_READ ||
				!isTenantSettingsKey(queryKey, tenantId)
			) {
				return;
			}
			const status = state.data as CatchUpStatus | undefined;
			if (status === undefined) return;
			const seen = pendingKeyOf(status);
			const moved =
				lastSeen === null
					? changedDuringSession(status, sessionStartedAt)
					: seen !== lastSeen;
			lastSeen = seen;
			if (moved) void invalidateAnalytics(queryClient, tenantId);
		});
	}, [queryClient, tenantId]);
}

export function CatchUpProvider({ children }: { children: ReactNode }) {
	const queryClient = useQueryClient();
	const { tenant } = useReadyTenantScope();
	const tenantId = tenant.id;
	const [run, setRun] = useState<RunState>(IDLE);
	const active = useRef<RunToken | null>(null);
	useAnalyticsFollowTheStatus(queryClient, tenantId);

	useEffect(() => {
		setRun(IDLE);
		return () => {
			const token = active.current;
			if (token === null || token.tenantId !== tenantId) return;
			token.aborted = true;
			active.current = null;
		};
	}, [tenantId]);

	const start = useCallback(
		(source: SettingsSource) => {
			if (active.current !== null) return;
			const token: RunToken = { tenantId, aborted: false };
			active.current = token;
			setRun({ running: true, problem: null, completed: false });
			const statusKey = settingsQueryKey(source.kind, tenantId, CATCH_UP_READ);
			const remember = (status: CatchUpStatus) => {
				queryClient.setQueryData(statusKey, status);
			};
			const finish = (state: RunState) => {
				if (active.current !== token) return;
				active.current = null;
				setRun(state);
			};
			runCatchUp({
				source,
				tenantId,
				aborted: () => token.aborted,
				afterStatus: remember,
				afterChunk: remember,
			}).then(
				(result) =>
					finish({
						running: false,
						problem: result.end === "stalled" ? "stalled" : null,
						completed: result.end === "done" && result.chunks > 0,
					}),
				(error: unknown) => {
					void invalidateAnalytics(queryClient, tenantId);
					finish({
						running: false,
						problem: problemOf(error),
						completed: false,
					});
				},
			);
		},
		[tenantId, queryClient],
	);

	const abort = useCallback(() => {
		if (active.current !== null) active.current.aborted = true;
	}, []);

	const dismiss = useCallback(() => {
		setRun((current) => (current.running ? current : IDLE));
	}, []);

	const runner = useMemo(
		() => ({ ...run, start, abort, dismiss }),
		[run, start, abort, dismiss],
	);
	return (
		<CatchUpContext.Provider value={runner}>{children}</CatchUpContext.Provider>
	);
}

export function useCatchUpRunner(): CatchUpRunner {
	return useContext(CatchUpContext);
}
