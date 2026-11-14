import {
	canStepRange,
	FIRST_CALENDAR_DATE,
	type IsoDate,
	NAMED_PRESETS,
	type ReportRange,
	rangeOf,
	rangeOfPreset,
	referenceLabel,
	stepRange,
	themeKeys,
} from "@fnb/reports";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { fieldVariants } from "../components/ui/field";
import { useT } from "../i18n";
import type { Formatters } from "../lib/format";
import { DATE_IDLE_COMMIT_MS, pickableDate } from "../reports/period-navigator";
import { formatParts, translateKey } from "../reports/typed-values";

export type RangeChange = (
	range: ReportRange,
	options?: { readonly replace: boolean },
) => void;

function StepButton({
	label,
	disabled,
	onStep,
	children,
}: {
	label: string;
	disabled: boolean;
	onStep: () => void;
	children: string;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-disabled={disabled ? "true" : undefined}
			onClick={() => {
				if (!disabled) onStep();
			}}
			className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-surface-raised text-lg aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
		>
			<span aria-hidden="true">{children}</span>
		</button>
	);
}

function PresetChips({
	range,
	onChange,
}: {
	range: ReportRange;
	onChange: RangeChange;
}) {
	const t = useT();
	const name = useId();
	return (
		<fieldset className="flex flex-wrap gap-1" data-testid="range-presets">
			<legend className="sr-only">{t(themeKeys.range.label)}</legend>
			{NAMED_PRESETS.map((preset) => (
				<label
					key={preset}
					className="relative inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line bg-surface-raised px-3 text-sm has-checked:border-accent has-checked:bg-accent has-checked:text-accent-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
				>
					<input
						type="radio"
						name={name}
						value={preset}
						checked={range.preset === preset}
						onChange={() => onChange(rangeOfPreset(preset, range.asOf))}
						className="absolute inset-0 m-0 cursor-pointer appearance-none rounded-full opacity-0"
					/>
					{translateKey(t, themeKeys.range.preset[preset])}
				</label>
			))}
		</fieldset>
	);
}

function DateField({
	label,
	value,
	min,
	max,
	testId,
	onCommit,
}: {
	label: string;
	value: IsoDate;
	min: IsoDate;
	max: IsoDate;
	testId: string;
	onCommit: (value: IsoDate) => void;
}) {
	const id = useId();
	const [draft, setDraft] = useState<string>(value);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		setDraft(value);
	}, [value]);
	const cancel = useCallback(() => {
		if (timer.current !== null) clearTimeout(timer.current);
		timer.current = null;
	}, []);
	useEffect(() => cancel, [cancel]);
	const commit = (next: string) => {
		cancel();
		const date = pickableDate(next, max);
		if (date === null || date < min || date === value) return;
		onCommit(date);
	};
	return (
		<div className="flex flex-col">
			<label htmlFor={id} className="text-xs text-ink-muted">
				{label}
			</label>
			<input
				id={id}
				type="date"
				min={min}
				max={max}
				value={draft}
				onChange={(event) => {
					const next = event.target.value;
					setDraft(next);
					cancel();
					if (pickableDate(next, max) === null) return;
					timer.current = setTimeout(() => commit(next), DATE_IDLE_COMMIT_MS);
				}}
				onBlur={(event) => commit(event.currentTarget.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") commit(event.currentTarget.value);
				}}
				className={fieldVariants()}
				data-testid={testId}
			/>
		</div>
	);
}

export function RangePicker({
	range,
	maxDays,
	formatters,
	onChange,
}: {
	range: ReportRange;
	maxDays: number;
	formatters: Formatters;
	onChange: RangeChange;
}) {
	const t = useT();
	const labelId = useId();
	const fitted = (from: IsoDate, to: IsoDate) => {
		const span = rangeOf(from, to, range.asOf);
		return span.days > maxDays ? null : span;
	};
	return (
		<section
			aria-labelledby={labelId}
			className="space-y-2 print:hidden"
			data-testid="range-picker"
		>
			<h2 id={labelId} className="sr-only">
				{t(themeKeys.range.label)}
			</h2>
			<PresetChips range={range} onChange={onChange} />
			<div className="flex flex-wrap items-end gap-2">
				<StepButton
					label={t(themeKeys.range.previousStep)}
					disabled={!canStepRange(range, -1)}
					onStep={() => onChange(stepRange(range, -1))}
				>
					‹
				</StepButton>
				<div
					className="min-w-0 flex-1"
					role="status"
					aria-live="polite"
					aria-atomic="true"
				>
					<p className="font-semibold" data-testid="range-label">
						{t(themeKeys.range.summary, {
							from: formatters.date(range.from),
							to: formatters.date(range.to),
							days: formatters.count(range.days),
							reference: formatParts(
								[referenceLabel(range, "previous")],
								t,
								formatters,
							),
						})}
					</p>
				</div>
				<StepButton
					label={t(themeKeys.range.nextStep)}
					disabled={!canStepRange(range, 1)}
					onStep={() => onChange(stepRange(range, 1))}
				>
					›
				</StepButton>
				<DateField
					label={t(themeKeys.range.from)}
					value={range.from}
					min={FIRST_CALENDAR_DATE}
					max={range.to}
					testId="range-from"
					onCommit={(from) => {
						const next = fitted(from, range.to);
						if (next !== null) onChange(next);
					}}
				/>
				<DateField
					label={t(themeKeys.range.to)}
					value={range.to}
					min={range.from}
					max={range.asOf}
					testId="range-to"
					onCommit={(to) => {
						const next = fitted(range.from, to);
						if (next !== null) onChange(next);
					}}
				/>
			</div>
		</section>
	);
}
