import { useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import type { ValueKind } from "./types";

interface HeadlineProps {
	value: number | null;
	kind: Exclude<ValueKind, "text">;
	formatters: Formatters;
	caption?: string;
}

export function signed(text: string, value: number): string {
	return value > 0 ? `+${text}` : text;
}

export function hourText(hour: number): string {
	return `${String(((Math.trunc(hour) % 24) + 24) % 24).padStart(2, "0")}:00`;
}

export function formatValue(
	kind: ValueKind,
	value: number,
	formatters: Formatters,
	compact: boolean,
): string {
	switch (kind) {
		case "money":
			return compact
				? formatters.moneyCompact(value)
				: formatters.moneyExact(value);
		case "count":
			return formatters.count(value);
		case "decimal":
			return formatters.decimal(value);
		case "ratio":
			return formatters.ratio(value);
		case "percent":
			return formatters.percent(value);
		case "signedPercent":
			return formatters.signedPercent(value);
		case "percentPoints":
			return formatters.points(value);
		case "percentChange":
			return formatters.signedPercent(value / 100);
		case "hour":
			return hourText(value);
		case "date":
		case "weekday":
		case "month":
		case "text":
			return String(value);
	}
}

export function Headline({ value, kind, formatters, caption }: HeadlineProps) {
	const t = useT();
	if (value === null) {
		return (
			<p
				className="text-3xl font-semibold tabular-nums text-ink-muted"
				data-testid="headline"
			>
				{t("reportCard.noValue")}
			</p>
		);
	}
	const compact = formatValue(kind, value, formatters, true);
	const exact = formatValue(kind, value, formatters, false);
	return (
		<p className="flex flex-wrap items-baseline gap-x-2">
			<span
				className="text-3xl font-semibold tabular-nums"
				title={exact}
				data-testid="headline"
				data-exact={exact}
			>
				{compact}
			</span>
			{compact === exact ? null : (
				<span className="sr-only">
					{t("reportCard.exactValue", { value: exact })}
				</span>
			)}
			{caption ? (
				<span className="text-sm text-ink-muted">{caption}</span>
			) : null}
		</p>
	);
}
