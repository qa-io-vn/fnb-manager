import { CupIcon } from "../icons";

/** The most cups a card draws; a longer card still states its count in words. */
export const MAX_CUPS = 12;

export interface StampsProgress {
	readonly filled: number;
	readonly total: number;
	readonly left: number;
	readonly full: boolean;
}

/** How far a stamp card is: the cups to fill (never below zero, never above the card) and the stamps still to earn. */
export function stampsProgress(
	stamps: number,
	perCard: number,
): StampsProgress {
	const total = Math.max(1, Math.floor(perCard));
	const filled = Math.min(Math.max(0, Math.floor(stamps)), total);
	return { filled, total, left: total - filled, full: filled === total };
}

/**
 * A loyalty card drawn as coffee cups: one cup per stamp of a full card, the earned ones filled. Decorative: the card
 * states the count in words next to it, so the row is hidden from screen readers.
 */
export function CupRow({
	total,
	filled = 0,
}: {
	readonly total: number;
	readonly filled?: number;
}) {
	const count = Math.min(stampsProgress(0, total).total, MAX_CUPS);
	const earned = stampsProgress(filled, count).filled;
	return (
		<div
			aria-hidden="true"
			className={`grid gap-1.5 ${count > 6 ? "grid-cols-6" : "grid-flow-col"}`}
			data-testid="cup-row"
		>
			{Array.from({ length: count }, (_, index) => {
				const on = index < earned;
				return (
					<span
						// a fixed row of identical cups: the position is the identity
						// biome-ignore lint/suspicious/noArrayIndexKey: cups never move
						key={index}
						className={`flex aspect-square items-center justify-center rounded-full p-1.5 ${on ? "bg-accent text-accent-ink" : "bg-surface-sunken text-ink-muted"}`}
						data-on={on}
					>
						<CupIcon filled={on} />
					</span>
				);
			})}
		</div>
	);
}
