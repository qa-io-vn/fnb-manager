import {
	isOpeningTime,
	MIDNIGHT_CLOSE,
	type OpeningHours,
	type OpeningSpan,
	WEEKDAYS,
	type Weekday,
} from "../validation";

export const MAX_SPANS_PER_DAY = 3;

export interface EditorSpan {
	readonly open: string;
	readonly close: string;
}

export type OpeningHoursDraft = Readonly<
	Record<Weekday, readonly EditorSpan[]>
>;

export const DEFAULT_SPAN: EditorSpan = { open: "07:00", close: "22:00" };

const EMPTY_SPAN: EditorSpan = { open: "", close: "" };

const START_OF_DAY = "00:00";
const MINUTES_PER_HOUR = 60;

function padded(value: string): string {
	return value.length === 4 ? `0${value}` : value;
}

export function editorTime(value: string, part: SpanPart): string {
	if (part === "close" && value === MIDNIGHT_CLOSE) return START_OF_DAY;
	return padded(value);
}

function minutesOf(value: string): number {
	const [hours, minutes] = value.split(":").map(Number);
	return (hours ?? 0) * MINUTES_PER_HOUR + (minutes ?? 0);
}

export function isEditorTime(value: string): boolean {
	return value !== MIDNIGHT_CLOSE && isOpeningTime(value);
}

export function runsPastMidnight(span: EditorSpan): boolean {
	return (
		isEditorTime(span.open) &&
		isEditorTime(span.close) &&
		minutesOf(span.close) <= minutesOf(span.open)
	);
}

function emptyDraft(): OpeningHoursDraft {
	return {
		mon: [],
		tue: [],
		wed: [],
		thu: [],
		fri: [],
		sat: [],
		sun: [],
	};
}

export function draftOfOpeningHours(
	hours: OpeningHours | null,
): OpeningHoursDraft {
	const draft = { ...emptyDraft() };
	if (hours === null) return draft;
	for (const day of WEEKDAYS) {
		draft[day] = (hours[day] ?? []).map(([open, close]) => ({
			open: editorTime(open, "open"),
			close: editorTime(close, "close"),
		}));
	}
	return draft;
}

export type SpanPart = keyof EditorSpan;

export interface SpanIssue {
	readonly day: Weekday;
	readonly index: number;
	readonly part: SpanPart;
}

export type OpeningHoursWrite =
	| { readonly ok: true; readonly hours: OpeningHours | null }
	| { readonly ok: false; readonly issues: readonly SpanIssue[] };

export function spanIssues(draft: OpeningHoursDraft): SpanIssue[] {
	const issues: SpanIssue[] = [];
	for (const day of WEEKDAYS) {
		draft[day].forEach((span, index) => {
			for (const part of ["open", "close"] as const) {
				if (!isEditorTime(span[part])) issues.push({ day, index, part });
			}
		});
	}
	return issues;
}

export function openingHoursOfDraft(
	draft: OpeningHoursDraft,
): OpeningHoursWrite {
	const issues = spanIssues(draft);
	if (issues.length > 0) return { ok: false, issues };
	if (WEEKDAYS.every((day) => draft[day].length === 0)) {
		return { ok: true, hours: null };
	}
	const hours: Partial<Record<Weekday, readonly OpeningSpan[]>> = {};
	for (const day of WEEKDAYS) {
		hours[day] = draft[day].map((span) => [span.open, span.close] as const);
	}
	return { ok: true, hours };
}

function withDay(
	draft: OpeningHoursDraft,
	day: Weekday,
	spans: readonly EditorSpan[],
): OpeningHoursDraft {
	return { ...draft, [day]: spans };
}

export function setDayOpen(
	draft: OpeningHoursDraft,
	day: Weekday,
	open: boolean,
): OpeningHoursDraft {
	if (!open) return withDay(draft, day, []);
	return draft[day].length > 0 ? draft : withDay(draft, day, [DEFAULT_SPAN]);
}

export function addSpan(
	draft: OpeningHoursDraft,
	day: Weekday,
): OpeningHoursDraft {
	const spans = draft[day];
	if (spans.length >= MAX_SPANS_PER_DAY) return draft;
	return withDay(draft, day, [...spans, EMPTY_SPAN]);
}

export function removeSpan(
	draft: OpeningHoursDraft,
	day: Weekday,
	index: number,
): OpeningHoursDraft {
	const spans = draft[day];
	if (spans.length <= 1) return draft;
	return withDay(
		draft,
		day,
		spans.filter((_, position) => position !== index),
	);
}

export function updateSpan(
	draft: OpeningHoursDraft,
	day: Weekday,
	index: number,
	part: SpanPart,
	value: string,
): OpeningHoursDraft {
	return withDay(
		draft,
		day,
		draft[day].map((span, position) =>
			position === index ? { ...span, [part]: value } : span,
		),
	);
}

export function copyDayToOthers(
	draft: OpeningHoursDraft,
	source: Weekday,
): OpeningHoursDraft {
	const spans = draft[source];
	const next = { ...draft };
	for (const day of WEEKDAYS) next[day] = spans;
	return next;
}

function sameSpans(
	left: readonly EditorSpan[],
	right: readonly EditorSpan[],
): boolean {
	return (
		left.length === right.length &&
		left.every(
			(span, index) =>
				span.open === right[index]?.open && span.close === right[index]?.close,
		)
	);
}

export function changedDays(
	saved: OpeningHoursDraft,
	draft: OpeningHoursDraft,
): Weekday[] {
	return WEEKDAYS.filter((day) => !sameSpans(saved[day], draft[day]));
}
