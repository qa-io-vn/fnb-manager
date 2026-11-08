import { useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import type { ValueKind } from "./types";

interface HeadlineProps {
	value: number | null;
	kind: Exclude<ValueKind, "text">;
	formatters: Formatters;
	caption?: string;
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
		case "percent":
			return formatters.percent(value);
		case "signedPercent":
			return formatters.signedPercent(value);
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
