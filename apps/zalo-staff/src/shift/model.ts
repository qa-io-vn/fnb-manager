import {
	type DueChecklist,
	type MemberRole,
	REFUSAL,
	RestError,
	SHIFT_PHASES,
	type ShiftPhase,
} from "@fnb/zalo-mini";
import {
	type OpeningHours,
	type RevenueVisibility,
	type StoreClock,
	storeDays,
	weekdayOf,
} from "../home/model";

export const PHASE_EDGE_MINUTES = 120;
const DAY_MINUTES = 1440;

export function canManage(role: MemberRole): boolean {
	return role === "owner" || role === "manager";
}

export function seesDifference(
	role: MemberRole,
	access: RevenueVisibility,
): boolean {
	return canManage(role) || (role === "staff" && access === "all");
}

function minutesOf(time: string): number {
	const [hours, minutes] = time.split(":").map(Number);
	return (hours ?? 0) * 60 + (minutes ?? 0);
}

export function localMinutes(now: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(now);
	const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
	const minute = Number(
		parts.find((part) => part.type === "minute")?.value ?? 0,
	);
	return hour * 60 + minute;
}

export function phaseAt(
	hours: OpeningHours,
	now: Date,
	clock: StoreClock,
): ShiftPhase | null {
	if (!hours.known) return null;
	const today = storeDays(now, clock).today;
	const spans = hours.spans[weekdayOf(today)];
	const first = spans[0];
	const last = spans[spans.length - 1];
	if (first === undefined || last === undefined) return null;
	let minutes = localMinutes(now, clock.timeZone);
	if (minutes < clock.businessDayStartMinutes) minutes += DAY_MINUTES;
	const open = minutesOf(first[0]);
	let close = minutesOf(last[1]);
	if (close <= open) close += DAY_MINUTES;
	const middle = (open + close) / 2;
	if (minutes < Math.min(open + PHASE_EDGE_MINUTES, middle)) return "opening";
	if (minutes >= Math.max(close - PHASE_EDGE_MINUTES, middle)) return "closing";
	return "midshift";
}

export function byPhase(
	checklists: readonly DueChecklist[],
	phase: ShiftPhase | null,
): { readonly now: DueChecklist[]; readonly later: DueChecklist[] } {
	const order = (checklist: DueChecklist) =>
		SHIFT_PHASES.indexOf(checklist.shiftPhase);
	const sorted = [...checklists].sort((a, b) => order(a) - order(b));
	if (phase === null) return { now: [], later: sorted };
	return {
		now: sorted.filter((checklist) => checklist.shiftPhase === phase),
		later: sorted.filter((checklist) => checklist.shiftPhase !== phase),
	};
}

export type ChecklistState =
	| "not-started"
	| "mine-open"
	| "other-open"
	| "finished";

export function checklistState(
	checklist: DueChecklist,
	memberId: string | null,
): ChecklistState {
	const run = checklist.run;
	if (run === null) return "not-started";
	if (run.status === "finished") return "finished";
	return run.startedBy === null || run.startedBy === memberId
		? "mine-open"
		: "other-open";
}

export type PrimaryTarget =
	| { readonly kind: "checklist"; readonly templateId: string }
	| { readonly kind: "close" };

export function primaryTarget(
	checklists: readonly DueChecklist[],
	phase: ShiftPhase | null,
	memberId: string | null,
): PrimaryTarget {
	const due = byPhase(checklists, phase).now.find((checklist) => {
		const state = checklistState(checklist, memberId);
		return state === "not-started" || state === "mine-open";
	});
	return due === undefined
		? { kind: "close" }
		: { kind: "checklist", templateId: due.templateId };
}

export type Failure =
	| "network"
	| "session"
	| "not-allowed"
	| "duplicate"
	| "state"
	| "check"
	| "invalid"
	| "unknown";

const UNAUTHORIZED = 401;
const FORBIDDEN = 403;

export function failureOf(error: unknown): Failure {
	if (!(error instanceof RestError)) return "unknown";
	switch (error.code) {
		case REFUSAL.notAllowed:
			return "not-allowed";
		case REFUSAL.duplicate:
			return "duplicate";
		case REFUSAL.state:
			return "state";
		case REFUSAL.check:
			return "check";
		case REFUSAL.invalid:
			return "invalid";
	}
	if (error.status === 0) return "network";
	if (error.status === UNAUTHORIZED || error.status === FORBIDDEN)
		return "session";
	return "unknown";
}

export function isoDateShift(date: string, days: number): string {
	const instant = new Date(`${date}T00:00:00Z`);
	instant.setUTCDate(instant.getUTCDate() + days);
	return instant.toISOString().slice(0, 10);
}
