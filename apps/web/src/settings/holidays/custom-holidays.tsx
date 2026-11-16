import {
	type FormEvent,
	type ReactNode,
	type Ref,
	useId,
	useState,
} from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { useT } from "../../i18n";
import type { IsoDate } from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";
import type { SettingsAccess } from "../access";
import { AuditLine } from "../forms/audit-line";
import { DateField } from "../forms/date-field";
import { controlClass, Field } from "../forms/field";
import { dateBound, issueText } from "../forms/issue-text";
import type { SaveBarStatus } from "../forms/save-bar";
import { UNAVAILABLE_CLASS } from "../forms/save-bar";
import { ReadOnlyNotice } from "../read-only-notice";
import type { HolidayChange, HolidayRow } from "../source";
import { HOLIDAY_NAME_MAX_LENGTH } from "../validation";
import { HolidayDay, useHolidayDayText } from "./holiday-day";
import {
	EMPTY_HOLIDAY_DRAFT,
	HOLIDAY_DATE_BOUNDS,
	type HolidayDraft,
	readHolidayDraft,
} from "./holidays";

const STATUS_TONES: Readonly<Record<SaveBarStatus["tone"], string>> = {
	info: "text-ink-muted",
	success: "text-positive",
	error: "text-negative",
};

export interface CustomHolidaysProps {
	readonly year: number;
	readonly rows: readonly HolidayRow[] | undefined;
	readonly pending: ReactNode;
	readonly clearSignal: number;
	readonly sectionRef: Ref<HTMLElement>;
	readonly headingRef: Ref<HTMLHeadingElement>;
	readonly formatters: Formatters;
	readonly timeZone: string;
	readonly today: IsoDate;
	readonly access: SettingsAccess;
	readonly busy: boolean;
	readonly status: SaveBarStatus | null;
	readonly onRetry: (() => void) | null;
	readonly onAdd: (change: HolidayChange) => void;
	readonly onDelete: (row: HolidayRow) => void;
	readonly onEdit: () => void;
}

function CustomHolidayRow({
	row,
	formatters,
	timeZone,
	canWrite,
	busy,
	onDelete,
}: {
	readonly row: HolidayRow;
	readonly formatters: Formatters;
	readonly timeZone: string;
	readonly canWrite: boolean;
	readonly busy: boolean;
	readonly onDelete: (row: HolidayRow) => void;
}) {
	const t = useT();
	const dayText = useHolidayDayText(formatters);
	return (
		<li
			className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3"
			data-testid="holiday-row"
			data-custom="true"
			data-kind={row.kind}
			data-date={row.holidayDate}
		>
			<div className="flex min-w-0 flex-1 basis-48 flex-col">
				<span className="break-words font-medium" data-testid="holiday-name">
					{row.name}
				</span>
				<HolidayDay date={row.holidayDate} formatters={formatters} />
				{row.audit === null ? null : (
					<AuditLine
						entry={row.audit}
						formatters={formatters}
						timeZone={timeZone}
					/>
				)}
			</div>
			{canWrite ? (
				<Button
					tone="secondary"
					size="compact"
					aria-label={t("settings.holidays.custom.deleteLabel", {
						name: row.name,
						date: dayText(row.holidayDate),
					})}
					aria-disabled={busy || undefined}
					onClick={busy ? undefined : () => onDelete(row)}
					className={UNAVAILABLE_CLASS}
					data-testid="holiday-delete"
				>
					{t("settings.holidays.custom.delete")}
				</Button>
			) : null}
		</li>
	);
}

const UNTOUCHED = { date: false, name: false } as const;

function AddHolidayForm({
	known,
	formatters,
	today,
	busy,
	clearSignal,
	onAdd,
	onEdit,
}: {
	readonly known: readonly HolidayRow[];
	readonly formatters: Formatters;
	readonly today: IsoDate;
	readonly busy: boolean;
	readonly clearSignal: number;
	readonly onAdd: (change: HolidayChange) => void;
	readonly onEdit: () => void;
}) {
	const t = useT();
	const ids = useId();
	const headingId = `${ids}-title`;
	const [draft, setDraft] = useState<HolidayDraft>(EMPTY_HOLIDAY_DRAFT);
	const [touched, setTouched] = useState<{
		readonly date: boolean;
		readonly name: boolean;
	}>(UNTOUCHED);
	const [submitted, setSubmitted] = useState(false);
	const [clearedAt, setClearedAt] = useState(clearSignal);
	if (clearedAt !== clearSignal) {
		setClearedAt(clearSignal);
		setDraft(EMPTY_HOLIDAY_DRAFT);
		setTouched(UNTOUCHED);
		setSubmitted(false);
	}
	const reading = readHolidayDraft(draft, known);
	const formatBound = dateBound(formatters.date);
	const showDate = submitted || touched.date;
	const showName = submitted || touched.name;
	const nameError =
		reading.nameIssue !== null
			? issueText(t, reading.nameIssue)
			: reading.exists
				? t("settings.holidays.add.exists")
				: null;
	const edit = (next: HolidayDraft) => {
		setDraft(next);
		onEdit();
	};
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setSubmitted(true);
		if (busy || reading.change === null) return;
		onAdd(reading.change);
	};
	return (
		<form
			noValidate
			aria-labelledby={headingId}
			onSubmit={submit}
			className="space-y-3 border-t border-line pt-3"
			data-testid="holidays-add"
		>
			<h4 id={headingId} className="text-sm font-semibold">
				{t("settings.holidays.add.title")}
			</h4>
			<div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
				<DateField
					id={`${ids}-date`}
					label={t("settings.holidays.add.date")}
					hint={t("settings.holidays.add.dateHint", {
						from: formatters.date(HOLIDAY_DATE_BOUNDS.min),
						to: formatters.date(HOLIDAY_DATE_BOUNDS.max),
					})}
					error={showDate ? issueText(t, reading.dateIssue, formatBound) : null}
					value={draft.date}
					onChange={(date) => edit({ ...draft, date })}
					onBlur={() => setTouched({ ...touched, date: true })}
					today={today}
					bounds={HOLIDAY_DATE_BOUNDS}
					testId="holidays-add-date"
				/>
				<Field
					id={`${ids}-name`}
					label={t("settings.holidays.add.name")}
					hint={t("settings.holidays.add.nameHint", {
						max: HOLIDAY_NAME_MAX_LENGTH,
					})}
					error={showName ? nameError : null}
				>
					{(control) => (
						<input
							{...control}
							type="text"
							autoComplete="off"
							value={draft.name}
							onChange={(event) => edit({ ...draft, name: event.target.value })}
							onBlur={() => setTouched({ ...touched, name: true })}
							className={controlClass}
							data-testid="holidays-add-name"
						/>
					)}
				</Field>
			</div>
			<Button
				type="submit"
				size="compact"
				aria-disabled={busy || undefined}
				className={UNAVAILABLE_CLASS}
				data-testid="holidays-add-submit"
			>
				{t("settings.holidays.add.submit")}
			</Button>
		</form>
	);
}

export function CustomHolidays({
	year,
	rows,
	pending,
	clearSignal,
	sectionRef,
	headingRef,
	formatters,
	timeZone,
	today,
	access,
	busy,
	status,
	onRetry,
	onAdd,
	onDelete,
	onEdit,
}: CustomHolidaysProps) {
	const t = useT();
	const headingId = useId();
	return (
		<section
			ref={sectionRef}
			aria-labelledby={headingId}
			className="space-y-3 rounded-xl border border-line bg-surface-raised px-4 py-3"
			data-testid="holidays-custom"
		>
			<h3
				ref={headingRef}
				id={headingId}
				tabIndex={-1}
				className="text-base font-semibold"
				data-testid="holidays-custom-title"
			>
				{t("settings.holidays.custom.title")}
			</h3>
			<p
				role="note"
				className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm"
				data-testid="holidays-custom-note"
			>
				{t("settings.holidays.custom.note")}
			</p>
			<ReadOnlyNotice access={access} />
			{rows === undefined ? (
				pending
			) : rows.length === 0 ? (
				<p className="text-ink-muted" data-testid="holidays-custom-empty">
					{t("settings.holidays.custom.empty", { year })}
				</p>
			) : (
				<ul className="divide-y divide-line" data-testid="holidays-custom-list">
					{rows.map((row) => (
						<CustomHolidayRow
							key={row.id}
							row={row}
							formatters={formatters}
							timeZone={timeZone}
							canWrite={access.canWrite}
							busy={busy}
							onDelete={onDelete}
						/>
					))}
				</ul>
			)}
			{access.canWrite ? (
				<AddHolidayForm
					known={rows ?? []}
					formatters={formatters}
					today={today}
					busy={busy}
					clearSignal={clearSignal}
					onAdd={onAdd}
					onEdit={onEdit}
				/>
			) : null}
			<div className="flex flex-wrap items-center gap-2">
				<p
					role="status"
					className={cn("text-sm", status ? STATUS_TONES[status.tone] : null)}
					data-testid="holidays-status"
				>
					{status?.text ?? ""}
				</p>
				{onRetry === null ? null : (
					<Button
						tone="secondary"
						size="compact"
						aria-disabled={busy || undefined}
						onClick={busy ? undefined : onRetry}
						data-testid="settings-retry-save"
					>
						{t("app.retry")}
					</Button>
				)}
			</div>
		</section>
	);
}
