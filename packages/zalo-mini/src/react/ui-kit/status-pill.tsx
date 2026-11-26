import type { ReactNode } from "react";

export type StatusPillTone =
	| "badge"
	| "positive"
	| "negative"
	| "warning"
	| "neutral";

// the text is the ink on every tone: the soft fills and the badge are checked against it by the theme's contrast rules
const TONES: Readonly<Record<StatusPillTone, string>> = {
	badge: "bg-badge text-badge-ink",
	positive: "bg-positive-soft text-ink",
	negative: "bg-negative-soft text-ink",
	warning: "bg-warning-soft text-ink",
	neutral: "bg-neutral-soft text-ink",
};

export interface StatusPillProps {
	readonly tone: StatusPillTone;
	/** The word that says the status: a colour never carries a status alone. */
	readonly children: ReactNode;
	readonly testId?: string;
}

/** A small pill with a status, a count or a label: 12 px bold, the brand's soft colour behind the ink. */
export function StatusPill({ tone, children, testId }: StatusPillProps) {
	return (
		<span
			data-tone={tone}
			data-testid={testId}
			className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs leading-tight font-bold ${TONES[tone]}`}
		>
			{children}
		</span>
	);
}
