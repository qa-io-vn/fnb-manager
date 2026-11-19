import {
	addDays,
	businessDateOf,
	businessDayStartOf,
	type IsoDate,
	isoWeekday,
} from "../lib/business-dates";
import { type OpeningHours, WEEKDAYS } from "../settings/validation";
import {
	type ChecklistRun,
	type ChecklistTemplate,
	SHIFT_PHASES,
	type ShiftPhase,
} from "./source";

export const COMPLIANCE_STATUSES = [
	"done",
	"late",
	"inProgress",
	"due",
	"missing",
] as const;

export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export const CLOSING_GRACE_MINUTES = 60;

const MINUTES_PER_DAY = 24 * 60;
const MILLISECONDS_PER_MINUTE = 60_000;

export interface ComplianceStore {
	readonly id: string;
	readonly name: string;
	readonly timeZone: string;
	readonly businessDayStartMinutes: number;
	readonly openingHours: OpeningHours | null;
}

export interface ComplianceRow {
	readonly key: string;
	readonly storeId: string;
	readonly businessDate: IsoDate;
	readonly phase: ShiftPhase;
	readonly templateId: string;
	readonly title: string;
	readonly status: ComplianceStatus;
	readonly deadline: Date | null;
	readonly run: ChecklistRun | null;
	readonly runs: number;
}

export interface ComplianceSummary {
	readonly done: number;
	readonly late: number;
	readonly missing: number;
	readonly inProgress: number;
	readonly due: number;
	readonly decided: number;
	readonly rate: number | null;
}

function minutesOf(time: string): number {
	const [hours = "0", minutes = "0"] = time.split(":");
	return Number(hours) * 60 + Number(minutes);
}

export function openingWindow(
	openingHours: OpeningHours | null,
	date: IsoDate,
): { readonly open: number; readonly close: number } | null {
	if (openingHours === null) return null;
	const weekday = WEEKDAYS[isoWeekday(date) - 1];
	const spans = weekday === undefined ? [] : (openingHours[weekday] ?? []);
	if (spans.length === 0) return null;
	let open = Number.POSITIVE_INFINITY;
	let close = Number.NEGATIVE_INFINITY;
	for (const [start, end] of spans) {
		const from = minutesOf(start);
		const to = minutesOf(end);
		open = Math.min(open, from);
		close = Math.max(close, to <= from ? to + MINUTES_PER_DAY : to);
	}
	return { open, close };
}

export function phaseDeadlineMinutes(
	phase: ShiftPhase,
	window: { readonly open: number; readonly close: number },
): number {
	switch (phase) {
		case "opening":
			return window.open;
		case "midshift":
			return Math.round((window.open + window.close) / 2);
		case "closing":
			return window.close + CLOSING_GRACE_MINUTES;
	}
}

export function phaseDeadline(
	store: ComplianceStore,
	date: IsoDate,
	phase: ShiftPhase,
): Date | null {
	const window = openingWindow(store.openingHours, date);
	if (window === null) return null;
	const midnight = businessDayStartOf(date, {
		timeZone: store.timeZone,
		businessDayStartMinutes: 0,
	});
	return new Date(
		midnight.getTime() +
			phaseDeadlineMinutes(phase, window) * MILLISECONDS_PER_MINUTE,
	);
}

function storeToday(store: ComplianceStore, now: Date): IsoDate {
	return businessDateOf(now, store);
}

function datesBetween(from: IsoDate, to: IsoDate): IsoDate[] {
	const dates: IsoDate[] = [];
	for (let date = from; date <= to; date = addDays(date, 1)) {
		dates.push(date);
	}
	return dates;
}

function finishedFirst(runs: readonly ChecklistRun[]): ChecklistRun[] {
	return runs
		.filter((run) => run.status === "finished" && run.finishedAt !== null)
		.sort((left, right) =>
			(left.finishedAt ?? "") < (right.finishedAt ?? "") ? -1 : 1,
		);
}

export function statusOfRuns(
	runs: readonly ChecklistRun[],
	deadline: Date | null,
	isToday: boolean,
	now: Date,
): ComplianceStatus {
	const [first] = finishedFirst(runs);
	if (first?.finishedAt) {
		return deadline !== null &&
			new Date(first.finishedAt).getTime() > deadline.getTime()
			? "late"
			: "done";
	}
	if (!isToday) return "missing";
	if (runs.some((run) => run.status === "open")) return "inProgress";
	if (deadline !== null && now.getTime() > deadline.getTime()) {
		return "missing";
	}
	return "due";
}

function representativeRun(runs: readonly ChecklistRun[]): ChecklistRun | null {
	const [first] = finishedFirst(runs);
	if (first !== undefined) return first;
	const open = runs.filter((run) => run.status === "open");
	return open.at(-1) ?? runs.at(-1) ?? null;
}

function appliesTo(template: ChecklistTemplate, storeId: string): boolean {
	return template.storeId === null || template.storeId === storeId;
}

const PHASE_ORDER: Readonly<Record<ShiftPhase, number>> = Object.fromEntries(
	SHIFT_PHASES.map((phase, index) => [phase, index]),
) as Record<ShiftPhase, number>;

export interface ComplianceInput {
	readonly stores: readonly ComplianceStore[];
	readonly templates: readonly ChecklistTemplate[];
	readonly runs: readonly ChecklistRun[];
	readonly from: IsoDate;
	readonly to: IsoDate;
	readonly now: Date;
}

export function complianceRows(input: ComplianceInput): ComplianceRow[] {
	const runsByKey = new Map<string, ChecklistRun[]>();
	for (const run of input.runs) {
		const key = `${run.storeId}|${run.businessDate}|${run.templateId}`;
		runsByKey.set(key, [...(runsByKey.get(key) ?? []), run]);
	}
	const rows: ComplianceRow[] = [];
	for (const store of input.stores) {
		const today = storeToday(store, input.now);
		for (const date of datesBetween(input.from, input.to)) {
			if (date > today) continue;
			const seen = new Set<string>();
			const entries: {
				templateId: string;
				title: string;
				phase: ShiftPhase;
				runs: ChecklistRun[];
			}[] = [];
			for (const template of input.templates) {
				if (!appliesTo(template, store.id)) continue;
				const key = `${store.id}|${date}|${template.id}`;
				const runs = runsByKey.get(key) ?? [];
				const created = businessDateOf(new Date(template.createdAt), store);
				if (runs.length === 0 && (!template.active || created > date)) {
					continue;
				}
				seen.add(template.id);
				entries.push({
					templateId: template.id,
					title: template.title,
					phase: template.phase,
					runs,
				});
			}
			for (const [key, runs] of runsByKey) {
				const [storeId, runDate, templateId] = key.split("|");
				if (storeId !== store.id || runDate !== date) continue;
				if (templateId === undefined || seen.has(templateId)) continue;
				const first = runs[0];
				if (first === undefined) continue;
				entries.push({
					templateId,
					title: first.title,
					phase: first.phase,
					runs,
				});
			}
			for (const entry of entries) {
				const deadline = phaseDeadline(store, date, entry.phase);
				rows.push({
					key: `${store.id}|${date}|${entry.templateId}`,
					storeId: store.id,
					businessDate: date,
					phase: entry.phase,
					templateId: entry.templateId,
					title: entry.title,
					status: statusOfRuns(entry.runs, deadline, date === today, input.now),
					deadline,
					run: representativeRun(entry.runs),
					runs: entry.runs.length,
				});
			}
		}
	}
	const storeOrder = new Map(
		input.stores.map((store, index) => [store.id, index]),
	);
	return rows.sort(
		(left, right) =>
			(left.businessDate < right.businessDate
				? 1
				: left.businessDate > right.businessDate
					? -1
					: 0) ||
			(storeOrder.get(left.storeId) ?? 0) -
				(storeOrder.get(right.storeId) ?? 0) ||
			PHASE_ORDER[left.phase] - PHASE_ORDER[right.phase] ||
			left.title.localeCompare(right.title, "vi") ||
			(left.templateId < right.templateId ? -1 : 1),
	);
}

export function complianceSummary(
	rows: readonly ComplianceRow[],
): ComplianceSummary {
	const count = (status: ComplianceStatus) =>
		rows.filter((row) => row.status === status).length;
	const done = count("done");
	const late = count("late");
	const missing = count("missing");
	const decided = done + late + missing;
	return {
		done,
		late,
		missing,
		inProgress: count("inProgress"),
		due: count("due"),
		decided,
		rate: decided === 0 ? null : (done + late) / decided,
	};
}
