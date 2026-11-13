import { useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import { type ChipTone, toneForChange } from "../../metrics/registry";
import type { ChipSpec } from "./types";

const toneClasses: Record<ChipTone, string> = {
	positive: "bg-positive-soft text-positive",
	negative: "bg-negative-soft text-negative",
	neutral: "bg-neutral-soft text-ink-muted",
};

const SHOWN_FRACTION_STEPS = 1000;

export function shownChange(change: number | null): number | null {
	if (change === null) return null;
	const steps = Math.round(Math.abs(change) * SHOWN_FRACTION_STEPS);
	return steps === 0 ? 0 : (Math.sign(change) * steps) / SHOWN_FRACTION_STEPS;
}

export function chipValue(
	chip: ChipSpec,
	formatters: Formatters,
	points: (value: string) => string,
): string {
	const change = shownChange(chip.change);
	if (change === null) return "";
	if (chip.unit === "points") return points(formatters.points(change));
	return formatters.signedPercent(change);
}

function arrowFor(change: number | null): string {
	if (change === null || change === 0) return "";
	return change > 0 ? "▲" : "▼";
}

export function ComparisonChips({
	chips,
	formatters,
}: {
	chips: readonly ChipSpec[];
	formatters: Formatters;
}) {
	const t = useT();
	if (chips.length === 0) return null;
	return (
		<ul
			className="flex flex-wrap gap-2"
			aria-label={t("reportCard.comparisons")}
		>
			{chips.map((chip) => {
				const change = shownChange(chip.change);
				const tone = toneForChange(chip.direction, change);
				return (
					<li
						key={chip.id}
						className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium ${toneClasses[tone]}`}
						data-tone={tone}
						data-testid="comparison-chip"
					>
						{change === null ? (
							<span>{chip.label}</span>
						) : (
							<>
								<span aria-hidden="true">{arrowFor(change)}</span>
								<span className="tabular-nums">
									{chipValue(chip, formatters, (value) =>
										t("report.value.points", { value }),
									)}
								</span>
								<span className="font-normal">{chip.label}</span>
							</>
						)}
					</li>
				);
			})}
		</ul>
	);
}
