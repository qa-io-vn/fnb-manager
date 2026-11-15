import { asOfDate, type IsoDate, maxDate, type StoreClock } from "@fnb/reports";
import { useCallback } from "react";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { useCatchUpStatus } from "../queries";
import { useSettingsSourceState } from "../settings-source-context";
import type { CatchUpStatus } from "../source";
import { type CatchUpProblem, useCatchUpRunner } from "./catch-up-context";
import { pendingDaysThrough } from "./run-catch-up";

export interface AnalyticsCatchUp {
	readonly status: CatchUpStatus | null;
	readonly pendingDays: number;
	readonly running: boolean;
	readonly problem: CatchUpProblem | null;
	readonly completed: boolean;
	readonly start: () => void;
	readonly abort: () => void;
	readonly dismiss: () => void;
}

export function lastDayAStoreShows(
	stores: readonly StoreClock[],
	now: Date,
): IsoDate {
	const [first, ...others] = stores;
	if (first === undefined) return asOfDate([], now);
	return others.reduce(
		(latest, store) => maxDate(latest, asOfDate([store], now)),
		asOfDate([first], now),
	);
}

export function useAnalyticsCatchUp(): AnalyticsCatchUp {
	const sourceState = useSettingsSourceState();
	const { stores } = useReadyTenantScope();
	const statusQuery = useCatchUpStatus();
	const runner = useCatchUpRunner();
	const source = sourceState.status === "ready" ? sourceState.source : null;
	const startRunner = runner.start;
	const start = useCallback(() => {
		if (source !== null) startRunner(source);
	}, [source, startRunner]);
	const status = statusQuery.data ?? null;
	return {
		status,
		pendingDays:
			status === null
				? 0
				: pendingDaysThrough(status, lastDayAStoreShows(stores, new Date())),
		running: runner.running,
		problem: runner.problem,
		completed: runner.completed,
		start,
		abort: runner.abort,
		dismiss: runner.dismiss,
	};
}
