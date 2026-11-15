import { daysBetween, type IsoDate, minDate } from "@fnb/reports";
import type { CatchUpStatus, SettingsSource } from "../source";

export const MAX_CHUNKS_WITHOUT_PROGRESS = 2;

export type CatchUpEnd = "done" | "aborted" | "notAllowed" | "stalled";

export interface CatchUpRun {
	readonly source: Pick<SettingsSource, "catchUpStatus" | "refreshChunk">;
	readonly tenantId: string;
	readonly aborted: () => boolean;
	readonly afterStatus: (status: CatchUpStatus) => void;
	readonly afterChunk: (status: CatchUpStatus) => void;
}

export interface CatchUpResult {
	readonly end: CatchUpEnd;
	readonly status: CatchUpStatus;
	readonly chunks: number;
}

export function samePending(
	left: CatchUpStatus,
	right: CatchUpStatus,
): boolean {
	return (
		left.pendingFrom === right.pendingFrom &&
		left.pendingTo === right.pendingTo &&
		left.inputsChangedAt === right.inputsChangedAt
	);
}

export function pendingDaysThrough(
	status: CatchUpStatus,
	lastDay: IsoDate,
): number {
	if (status.pendingFrom === null || status.pendingTo === null) return 0;
	const end = minDate(status.pendingTo, lastDay);
	return end < status.pendingFrom
		? 0
		: daysBetween(status.pendingFrom, end) + 1;
}

export async function runCatchUp(run: CatchUpRun): Promise<CatchUpResult> {
	let status = await run.source.catchUpStatus(run.tenantId);
	run.afterStatus(status);
	let chunks = 0;
	let chunksWithoutProgress = 0;
	while (status.pendingDays > 0) {
		if (!status.canRefresh) return { end: "notAllowed", status, chunks };
		if (run.aborted()) return { end: "aborted", status, chunks };
		const next = await run.source.refreshChunk(run.tenantId);
		chunks += 1;
		run.afterChunk(next);
		chunksWithoutProgress = samePending(next, status)
			? chunksWithoutProgress + 1
			: 0;
		status = next;
		if (chunksWithoutProgress >= MAX_CHUNKS_WITHOUT_PROGRESS) {
			return { end: "stalled", status, chunks };
		}
	}
	return { end: "done", status, chunks };
}
