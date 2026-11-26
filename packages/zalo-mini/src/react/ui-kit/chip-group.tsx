import type { ReactNode } from "react";

export type ChipTone = 1 | 2 | 3 | 4;

export interface Chip {
	readonly key: string;
	readonly label: string;
	/** The tone group of the chip when it is selected; the accent without one. */
	readonly tone?: ChipTone;
	/** A small picture before the label (a brand's art, later); hidden from assistive technology. */
	readonly leading?: ReactNode;
}

export interface ChipGroupProps {
	/** The name of the group for assistive technology ("Nhóm món"). */
	readonly label: string;
	readonly chips: readonly Chip[];
	readonly selected: string;
	readonly onSelect: (key: string) => void;
	readonly testId?: string;
}

// a class written out for each tone, so that Tailwind finds it
const SELECTED: Readonly<Record<ChipTone | 0, string>> = {
	0: "bg-accent text-accent-ink",
	1: "bg-tone-1 text-tone-1-ink",
	2: "bg-tone-2 text-tone-2-ink",
	3: "bg-tone-3 text-tone-3-ink",
	4: "bg-tone-4 text-tone-4-ink",
};

const RING =
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/**
 * A row of chips that filter or jump: pills, each a button that says whether it is pressed. The pressed chip is filled
 * with its tone and its ink, an idle one has an outline on a card. It scrolls sideways when it does not fit, and a
 * group is a role="group" (the tab bar stays the only navigation landmark).
 */
export function ChipGroup({
	label,
	chips,
	selected,
	onSelect,
	testId,
}: ChipGroupProps) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: a plain group of buttons; the design spec names the role, and a fieldset would bring a border and a legend
		<div
			role="group"
			aria-label={label}
			data-testid={testId}
			className="flex gap-2 overflow-x-auto px-4 py-2"
		>
			{chips.map((chip) => {
				const on = chip.key === selected;
				return (
					<button
						key={chip.key}
						type="button"
						aria-pressed={on}
						data-tone={chip.tone}
						data-chip={chip.key}
						onClick={() => onSelect(chip.key)}
						className={`inline-flex min-h-12 shrink-0 items-center gap-2 rounded-control px-4 text-body font-bold whitespace-nowrap ${RING} ${on ? SELECTED[chip.tone ?? 0] : "border-outline border-edge bg-surface-raised text-ink"}`}
					>
						{chip.leading === undefined ? null : (
							<span aria-hidden="true" className="flex shrink-0 items-center">
								{chip.leading}
							</span>
						)}
						{chip.label}
					</button>
				);
			})}
		</div>
	);
}
