import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { type MessageKey, useT } from "../../i18n";
import { VALIDATION_MESSAGE_KEYS, WEEKDAYS, type Weekday } from "../validation";
import { controlClass } from "./field";
import {
	addSpan,
	changedDays,
	copyDayToOthers,
	type EditorSpan,
	isEditorTime,
	MAX_SPANS_PER_DAY,
	type OpeningHoursDraft,
	removeSpan,
	runsPastMidnight,
	type SpanPart,
	setDayOpen,
	updateSpan,
} from "./opening-hours";

export const WEEKDAY_KEYS: Readonly<Record<Weekday, MessageKey>> = {
	mon: "settings.weekday.mon",
	tue: "settings.weekday.tue",
	wed: "settings.weekday.wed",
	thu: "settings.weekday.thu",
	fri: "settings.weekday.fri",
	sat: "settings.weekday.sat",
	sun: "settings.weekday.sun",
};

const PART_KEYS: Readonly<Record<SpanPart, MessageKey>> = {
	open: "settings.hours.open",
	close: "settings.hours.close",
};

function slotsOf(
	day: Weekday,
	spans: readonly EditorSpan[],
): { slot: string; span: EditorSpan; index: number }[] {
	return spans.map((span, index) => ({ slot: `${day}-${index}`, span, index }));
}

function touchKey(day: Weekday, index: number, part: SpanPart): string {
	return `${day}:${index}:${part}`;
}

interface SpanRowProps {
	readonly id: string;
	readonly day: Weekday;
	readonly index: number;
	readonly span: EditorSpan;
	readonly removable: boolean;
	readonly readOnly: boolean;
	readonly showIssue: (part: SpanPart) => boolean;
	readonly onChange: (part: SpanPart, value: string) => void;
	readonly onTouch: (part: SpanPart) => void;
	readonly onRemove: () => void;
}

function SpanRow({
	id,
	day,
	index,
	span,
	removable,
	readOnly,
	showIssue,
	onChange,
	onTouch,
	onRemove,
}: SpanRowProps) {
	const t = useT();
	const number = index + 1;
	const issueId = `${id}-${day}-${index}-issue`;
	const overnightId = `${id}-${day}-${index}-overnight`;
	const flagged = (part: SpanPart) =>
		!isEditorTime(span[part]) && (showIssue(part) || span[part] !== "");
	const invalid = (["open", "close"] as const).some(flagged);
	const overnight = runsPastMidnight(span);
	const describedBy =
		[invalid ? issueId : null, overnight ? overnightId : null]
			.filter((value) => value !== null)
			.join(" ") || undefined;
	return (
		<li className="space-y-1" data-testid="opening-hours-span">
			<div className="flex flex-wrap items-center gap-2">
				{(["open", "close"] as const).map((part, position) => (
					<span key={part} className="contents">
						{position === 1 ? (
							<span aria-hidden="true" className="text-ink-muted">
								–
							</span>
						) : null}
						<input
							type="time"
							step={60}
							aria-label={`${t(WEEKDAY_KEYS[day])}, ${t(PART_KEYS[part], { n: number })}`}
							aria-describedby={describedBy}
							aria-invalid={flagged(part) ? true : undefined}
							readOnly={readOnly}
							required
							value={span[part]}
							onChange={(event) => onChange(part, event.target.value)}
							onBlur={() => onTouch(part)}
							className={cn(controlClass, "w-32 flex-1 tabular-nums")}
							data-testid={`opening-hours-${part}`}
						/>
					</span>
				))}
				{removable && !readOnly ? (
					<Button
						tone="secondary"
						size="compact"
						onClick={onRemove}
						aria-label={t("settings.hours.removeSpan", {
							day: t(WEEKDAY_KEYS[day]),
							n: number,
						})}
						data-testid="opening-hours-remove"
					>
						{t("settings.hours.remove")}
					</Button>
				) : null}
			</div>
			{overnight ? (
				<p
					id={overnightId}
					className="text-xs text-ink-muted"
					data-testid="opening-hours-overnight"
				>
					{t("settings.hours.overnight")}
				</p>
			) : null}
			{invalid ? (
				<p id={issueId} className="text-sm text-negative">
					{t(VALIDATION_MESSAGE_KEYS.time)}
				</p>
			) : null}
		</li>
	);
}

export interface OpeningHoursEditorProps {
	readonly id: string;
	readonly legend: string;
	readonly hint?: string | null;
	readonly value: OpeningHoursDraft;
	readonly onChange: (draft: OpeningHoursDraft) => void;
	readonly readOnly?: boolean;
	readonly showIssues?: boolean;
}

export function OpeningHoursEditor({
	id,
	legend,
	hint,
	value,
	onChange,
	readOnly = false,
	showIssues = false,
}: OpeningHoursEditorProps) {
	const t = useT();
	const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
	const [copiedFrom, setCopiedFrom] = useState<Weekday | null>(null);
	const hintId = `${id}-hint`;
	const emitted = useRef(value);
	useEffect(() => {
		if (changedDays(emitted.current, value).length === 0) return;
		emitted.current = value;
		setTouched(new Set());
		setCopiedFrom(null);
	}, [value]);
	const touch = (key: string) =>
		setTouched((current) => new Set(current).add(key));
	const forgetSpan = (day: Weekday, removed: number) =>
		setTouched((current) => {
			const next = new Set<string>();
			for (const key of current) {
				const [keyDay, position, part] = key.split(":");
				const index = Number(position);
				if (keyDay !== day || index < removed) next.add(key);
				else if (index > removed) next.add(`${day}:${index - 1}:${part}`);
			}
			return next;
		});
	const emit = (draft: OpeningHoursDraft) => {
		emitted.current = draft;
		onChange(draft);
	};
	const change = (draft: OpeningHoursDraft) => {
		setCopiedFrom(null);
		emit(draft);
	};
	return (
		<fieldset
			id={id}
			aria-describedby={hint ? hintId : undefined}
			className="min-w-0 space-y-3"
			data-testid="opening-hours-editor"
		>
			<legend className="text-sm font-medium">{legend}</legend>
			{hint ? (
				<p id={hintId} className="text-xs text-ink-muted">
					{hint}
				</p>
			) : null}
			<ul className="divide-y divide-line rounded-lg border border-line bg-surface-raised">
				{WEEKDAYS.map((day) => {
					const spans = value[day];
					const closed = spans.length === 0;
					const dayLabel = t(WEEKDAY_KEYS[day]);
					const closedId = `${id}-${day}-closed`;
					return (
						<li
							key={day}
							className="space-y-2 p-3"
							data-testid={`opening-hours-${day}`}
							data-closed={closed ? "true" : undefined}
						>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<span className="font-medium">{dayLabel}</span>
								<label
									htmlFor={closedId}
									className="flex min-h-11 items-center gap-2 text-sm"
								>
									<input
										id={closedId}
										type="checkbox"
										className="size-6 accent-accent"
										checked={closed}
										disabled={readOnly}
										onChange={(event) =>
											change(setDayOpen(value, day, !event.target.checked))
										}
										aria-label={t("settings.hours.closedOn", { day: dayLabel })}
										data-testid="opening-hours-closed"
									/>
									{t("settings.hours.closed")}
								</label>
							</div>
							{closed ? null : (
								<ul className="space-y-2">
									{slotsOf(day, spans).map(({ slot, span, index }) => (
										<SpanRow
											key={slot}
											id={id}
											day={day}
											index={index}
											span={span}
											removable={spans.length > 1}
											readOnly={readOnly}
											showIssue={(part) =>
												showIssues || touched.has(touchKey(day, index, part))
											}
											onChange={(part, next) =>
												change(updateSpan(value, day, index, part, next))
											}
											onTouch={(part) => touch(touchKey(day, index, part))}
											onRemove={() => {
												forgetSpan(day, index);
												change(removeSpan(value, day, index));
											}}
										/>
									))}
								</ul>
							)}
							{closed || readOnly ? null : (
								<div className="flex flex-wrap items-center gap-2">
									<Button
										tone="secondary"
										size="compact"
										disabled={spans.length >= MAX_SPANS_PER_DAY}
										onClick={() => change(addSpan(value, day))}
										aria-label={t("settings.hours.addSpanTo", {
											day: dayLabel,
										})}
										data-testid="opening-hours-add"
									>
										{t("settings.hours.addSpan")}
									</Button>
									<Button
										tone="secondary"
										size="compact"
										onClick={() => {
											emit(copyDayToOthers(value, day));
											setCopiedFrom(day);
										}}
										aria-label={t("settings.hours.copyFrom", { day: dayLabel })}
										data-testid="opening-hours-copy"
									>
										{t("settings.hours.copy")}
									</Button>
									{spans.length >= MAX_SPANS_PER_DAY ? (
										<span className="text-xs text-ink-muted">
											{t("settings.hours.maxSpans", {
												count: MAX_SPANS_PER_DAY,
											})}
										</span>
									) : null}
								</div>
							)}
						</li>
					);
				})}
			</ul>
			<p role="status" className="sr-only" data-testid="opening-hours-status">
				{copiedFrom === null
					? ""
					: t("settings.hours.copied", { day: t(WEEKDAY_KEYS[copiedFrom]) })}
			</p>
		</fieldset>
	);
}
