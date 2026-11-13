import type { DateRange } from "../repository.js";
import type {
	RunFinish,
	RunStart,
	ShiftRow,
	SyncCheckRow,
	TableCounts,
} from "../rows.js";
import { byText, inRange, type MemoryState } from "./tables.js";

function sameContent(left: object, right: object, ignored: string[]): boolean {
	const strip = (row: object) =>
		JSON.stringify(
			Object.entries(row).filter(([key]) => !ignored.includes(key)),
		);
	return strip(left) === strip(right);
}

export function upsertShifts(
	state: MemoryState,
	shifts: readonly ShiftRow[],
): TableCounts {
	let changed = 0;
	for (const shift of shifts) {
		const existing = state.tables.shifts.find(
			(candidate) =>
				candidate.store_id === shift.store_id &&
				candidate.external_id === shift.external_id,
		);
		if (!existing) {
			state.tables.shifts.push({
				...structuredClone(shift),
				id: state.nextId("shift"),
			});
			changed += 1;
		} else if (!sameContent(existing, shift, ["id"])) {
			Object.assign(existing, structuredClone(shift));
			changed += 1;
		}
	}
	return { shifts: changed };
}

export function upsertChecks(
	state: MemoryState,
	checks: readonly SyncCheckRow[],
): TableCounts {
	let changed = 0;
	const stamp = state.timestamp();
	for (const check of checks) {
		const existing = state.tables.checks.find(
			(candidate) =>
				candidate.store_id === check.store_id &&
				candidate.business_date === check.business_date,
		);
		if (!existing) {
			state.tables.checks.push({
				...check,
				id: state.nextId("check"),
				checked_at: stamp,
			});
			changed += 1;
		} else if (!sameContent(existing, check, ["id", "checked_at"])) {
			Object.assign(existing, check, { checked_at: stamp });
			changed += 1;
		}
	}
	return { sync_checks: changed };
}

export function loadChecks(
	state: MemoryState,
	storeId: string,
	range: DateRange,
): SyncCheckRow[] {
	return state.tables.checks
		.filter(
			(check) =>
				check.store_id === storeId && inRange(check.business_date, range),
		)
		.sort((left, right) => byText(left.business_date, right.business_date))
		.map(({ id: _id, checked_at: _checkedAt, ...check }) => ({ ...check }));
}

export interface MemoryRefresh {
	tenantId: string;
	range: DateRange;
	startedAt: string;
}

export function staleAnalyticsDates(
	state: MemoryState,
	refreshes: readonly MemoryRefresh[],
	storeId: string,
	range: DateRange,
): string[] {
	return state.tables.checks
		.filter(
			(check) =>
				check.store_id === storeId &&
				inRange(check.business_date, range) &&
				!refreshes.some(
					(refresh) =>
						refresh.tenantId === check.tenant_id &&
						inRange(check.business_date, refresh.range) &&
						Date.parse(refresh.startedAt) >= Date.parse(check.checked_at),
				),
		)
		.map((check) => check.business_date)
		.sort(byText);
}

export function openRun(state: MemoryState, run: RunStart): string {
	const id = state.nextId("run");
	state.tables.runs.push({
		...run,
		id,
		status: "running",
		finished_at: null,
		rows_upserted: {},
		error_message: null,
	});
	return id;
}

export function closeAbandonedRuns(
	state: MemoryState,
	storeId: string,
	startedBefore: string,
	message: string,
): number {
	const abandoned = state.tables.runs.filter(
		(run) =>
			run.store_id === storeId &&
			run.kind === "incremental" &&
			run.status === "running" &&
			Date.parse(run.started_at) < Date.parse(startedBefore),
	);
	for (const run of abandoned) {
		Object.assign(run, {
			status: "failed",
			finished_at: state.timestamp(),
			error_message: message,
		});
	}
	return abandoned.length;
}

export function closeRun(
	state: MemoryState,
	runId: string,
	finish: RunFinish,
): void {
	const run = state.tables.runs.find((candidate) => candidate.id === runId);
	if (!run) {
		throw new Error(`unknown run ${runId}`);
	}
	Object.assign(run, structuredClone(finish));
}
