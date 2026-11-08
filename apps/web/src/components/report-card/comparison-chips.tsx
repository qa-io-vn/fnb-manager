import { useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import { type ChipTone, toneForChange } from "../../metrics/registry";
import type { ChipSpec } from "./types";

const toneClasses: Record<ChipTone, string> = {
	positive: "bg-positive-soft text-positive",
	negative: "bg-negative-soft text-negative",
	neutral: "bg-neutral-soft text-ink-muted",
};

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
				const tone = toneForChange(chip.direction, chip.change);
				return (
					<li
						key={chip.id}
						className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium ${toneClasses[tone]}`}
						data-tone={tone}
						data-testid="comparison-chip"
					>
						{chip.change === null ? (
							<span>{chip.label}</span>
						) : (
							<>
								<span aria-hidden="true">{arrowFor(chip.change)}</span>
								<span className="tabular-nums">
									{formatters.signedPercent(chip.change)}
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
