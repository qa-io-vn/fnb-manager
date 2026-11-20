import { DUE_SOON_DAYS, type DueState } from "./source";

const DAY_MS = 86_400_000;

export interface Deadline {
	readonly state: DueState;
	/** Whole days from now to the deadline, rounded up; negative once overdue. */
	readonly daysLeft: number;
}

/**
 * The state of one deadline: done when the step it governs is done, overdue
 * once the instant has passed, due soon within `soonDays` days (inclusive),
 * on track otherwise. The same rule as dsr_due_soon.
 */
export function deadlineOf(
	now: Date,
	dueAt: string,
	done: boolean,
	soonDays: number = DUE_SOON_DAYS,
): Deadline {
	const remaining = new Date(dueAt).getTime() - now.getTime();
	const daysLeft = Math.ceil(remaining / DAY_MS);
	if (done) return { state: "done", daysLeft };
	if (remaining < 0) return { state: "overdue", daysLeft };
	if (remaining <= soonDays * DAY_MS) return { state: "due_soon", daysLeft };
	return { state: "on_track", daysLeft };
}

export const DEADLINE_TONES: Readonly<Record<DueState, string>> = {
	done: "border-line bg-surface-sunken text-ink-muted",
	overdue: "border-negative bg-negative-soft text-negative",
	due_soon: "border-warning bg-warning-soft",
	on_track: "border-line bg-surface-raised",
};
