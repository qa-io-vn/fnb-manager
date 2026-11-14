import { useId } from "react";
import { fieldVariants } from "../components/ui/field";
import type { MessageKey, Translate } from "../i18n";
import { useT } from "../i18n";
import { isIsoDate } from "../lib/business-dates";
import {
	isPeriodKind,
	type Period,
	type PeriodKind,
	periodKinds,
	rangeOf,
} from "../lib/period";

const kindLabel: Record<PeriodKind, MessageKey> = {
	day: "period.day",
	week: "period.week",
	month: "period.month",
	year: "period.year",
	custom: "period.custom",
};

interface PeriodPickerProps {
	period: Period;
	onChange: (period: Period) => void;
	formatDate: (isoDate: string) => string;
}

function DateField({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
}) {
	const id = useId();
	return (
		<div className="flex flex-col">
			<label htmlFor={id} className="text-xs text-ink-muted">
				{label}
			</label>
			<input
				id={id}
				type="date"
				value={value}
				onChange={(event) => {
					if (isIsoDate(event.target.value)) onChange(event.target.value);
				}}
				className={fieldVariants()}
			/>
		</div>
	);
}

export function periodSummary(
	period: Period,
	t: Translate,
	formatDate: (isoDate: string) => string,
): string {
	const range = rangeOf(period);
	const dates =
		range.from === range.to
			? formatDate(range.from)
			: t("period.range", {
					from: formatDate(range.from),
					to: formatDate(range.to),
				});
	return t("shell.scope.period", {
		kind: t(kindLabel[period.kind]),
		range: dates,
	});
}

export function PeriodPicker({
	period,
	onChange,
	formatDate,
}: PeriodPickerProps) {
	const t = useT();
	const kindId = useId();
	const range = rangeOf(period);
	return (
		<fieldset
			className="flex flex-wrap items-end gap-2"
			data-testid="period-picker"
		>
			<legend className="sr-only">{t("period.label")}</legend>
			<div className="flex flex-col">
				<label htmlFor={kindId} className="text-xs text-ink-muted">
					{t("period.label")}
				</label>
				<select
					id={kindId}
					value={period.kind}
					onChange={(event) => {
						if (isPeriodKind(event.target.value))
							onChange({ ...period, kind: event.target.value });
					}}
					className={fieldVariants()}
				>
					{periodKinds.map((kind) => (
						<option key={kind} value={kind}>
							{t(kindLabel[kind])}
						</option>
					))}
				</select>
			</div>
			{period.kind === "custom" ? (
				<>
					<DateField
						label={t("period.from")}
						value={period.custom.from}
						onChange={(from) =>
							onChange({ ...period, custom: { ...period.custom, from } })
						}
					/>
					<DateField
						label={t("period.to")}
						value={period.custom.to}
						onChange={(to) =>
							onChange({ ...period, custom: { ...period.custom, to } })
						}
					/>
				</>
			) : (
				<DateField
					label={t("period.anchor")}
					value={period.anchor}
					onChange={(anchor) => onChange({ ...period, anchor })}
				/>
			)}
			{range.from === range.to ? null : (
				<output
					className="pb-3 text-sm text-ink-muted"
					data-testid="period-range"
				>
					{t("period.range", {
						from: formatDate(range.from),
						to: formatDate(range.to),
					})}
				</output>
			)}
		</fieldset>
	);
}
