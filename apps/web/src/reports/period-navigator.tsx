import {
	FIRST_CALENDAR_DATE,
	type IsoDate,
	periodContaining,
	type ReportPeriod,
	stepPeriod,
} from "@fnb/reports";
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { fieldVariants } from "../components/ui/field";
import { useT } from "../i18n";
import { isIsoDate } from "../lib/business-dates";
import type { Formatters } from "../lib/format";
import { periodLabel } from "./period-label";

export const DATE_IDLE_COMMIT_MS = 700;

export interface PeriodChangeOptions {
	readonly replace: boolean;
}

export type PeriodChange = (
	period: ReportPeriod,
	options?: PeriodChangeOptions,
) => void;

function StepButton({
	label,
	target,
	onStep,
	children,
}: {
	label: string;
	target: ReportPeriod | null;
	onStep: (period: ReportPeriod) => void;
	children: string;
}) {
	const unavailable = target === null;
	return (
		<button
			type="button"
			aria-label={label}
			aria-disabled={unavailable ? "true" : undefined}
			onClick={() => {
				if (target !== null) onStep(target);
			}}
			className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-surface-raised text-lg aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
		>
			<span aria-hidden="true">{children}</span>
		</button>
	);
}

export function pickableDate(value: string, asOf: IsoDate): IsoDate | null {
	if (!isIsoDate(value) || value < FIRST_CALENDAR_DATE || value > asOf) {
		return null;
	}
	return value;
}

function DatePicker({
	period,
	asOf,
	onChange,
}: {
	period: ReportPeriod;
	asOf: IsoDate;
	onChange: PeriodChange;
}) {
	const t = useT();
	const dateId = useId();
	const [draft, setDraft] = useState<string>(period.end);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const committedThisFocus = useRef(false);

	useEffect(() => {
		setDraft(period.end);
	}, [period.end]);

	const cancel = useCallback(() => {
		if (timer.current !== null) clearTimeout(timer.current);
		timer.current = null;
	}, []);
	useEffect(() => cancel, [cancel]);

	const commit = (value: string) => {
		cancel();
		const date = pickableDate(value, asOf);
		if (date === null || date === period.end) return;
		const target = periodContaining(period.kind, date, asOf);
		if (target.key === period.key) return;
		onChange(target, { replace: committedThisFocus.current });
		committedThisFocus.current = true;
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") commit(event.currentTarget.value);
	};

	return (
		<div className="flex flex-col">
			<label htmlFor={dateId} className="text-xs text-ink-muted">
				{t("report.navigator.pick")}
			</label>
			<input
				id={dateId}
				type="date"
				min={FIRST_CALENDAR_DATE}
				max={asOf}
				value={draft}
				onFocus={() => {
					committedThisFocus.current = false;
				}}
				onChange={(event) => {
					const value = event.target.value;
					setDraft(value);
					cancel();
					if (pickableDate(value, asOf) === null) return;
					timer.current = setTimeout(() => commit(value), DATE_IDLE_COMMIT_MS);
				}}
				onBlur={(event) => commit(event.currentTarget.value)}
				onKeyDown={onKeyDown}
				className={fieldVariants()}
				data-testid="period-date"
			/>
		</div>
	);
}

export function PeriodNavigator({
	period,
	asOf,
	formatters,
	onChange,
}: {
	period: ReportPeriod;
	asOf: IsoDate;
	formatters: Formatters;
	onChange: PeriodChange;
}) {
	const t = useT();
	const labelId = useId();
	const previous = stepPeriod(period, -1);
	const next = stepPeriod(period, 1);
	return (
		<section
			aria-labelledby={labelId}
			className="flex flex-wrap items-center gap-2 print:hidden"
			data-testid="period-navigator"
		>
			<h2 id={labelId} className="sr-only">
				{t("report.navigator.label")}
			</h2>
			<StepButton
				label={t("report.navigator.previous")}
				target={previous}
				onStep={onChange}
			>
				‹
			</StepButton>
			<div
				className="min-w-0 flex-1"
				role="status"
				aria-live="polite"
				aria-atomic="true"
			>
				<p className="font-semibold" data-testid="period-label">
					{periodLabel(period, t, formatters)}
				</p>
				{period.complete ? null : (
					<p className="text-sm text-ink-muted" data-testid="period-through">
						{t("report.period.through", { date: formatters.date(period.end) })}
					</p>
				)}
			</div>
			<StepButton
				label={t("report.navigator.next")}
				target={next}
				onStep={onChange}
			>
				›
			</StepButton>
			<DatePicker period={period} asOf={asOf} onChange={onChange} />
		</section>
	);
}
