import type {
	RunFinish,
	RunStart,
	ShiftRow,
	SyncCheckRow,
	TableCounts,
} from "../rows.js";
import type { MemoryState } from "./tables.js";

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
