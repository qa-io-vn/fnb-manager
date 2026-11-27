import { kitButton } from "@fnb/zalo-mini/ui-kit";
import type { ReactNode } from "react";

/** The kit's buttons with the counter's larger touch size (design: buttons 56 on the tablet). */
export const button = {
	primary: `${kitButton.primary} min-h-14`,
	secondary: `${kitButton.secondary} min-h-14`,
	danger: `${kitButton.danger} min-h-14`,
	inverse: `${kitButton.inverse} min-h-14`,
	quiet: kitButton.quiet,
	/** a filled positive action ("Xong, mang ra") */
	positive:
		"inline-flex min-h-14 items-center justify-center gap-2 rounded-control bg-positive px-5 text-body font-bold text-surface-raised shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:bg-surface-sunken disabled:text-ink-muted disabled:shadow-none",
	/** a filled warning action ("Bắt đầu pha") */
	warning:
		"inline-flex min-h-14 items-center justify-center gap-2 rounded-control bg-warning px-5 text-body font-bold text-ink shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:bg-surface-sunken disabled:text-ink-muted disabled:shadow-none",
	/** a filled destructive confirmation (red with white text) */
	destructive:
		"inline-flex min-h-14 items-center justify-center gap-2 rounded-control bg-negative px-5 text-body font-bold text-surface-raised shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:bg-surface-sunken disabled:text-ink-muted disabled:shadow-none",
} as const;

export const card =
	"rounded-card-2xl border-card border-line bg-surface-raised";
export const field =
	"min-h-12 w-full rounded-field border-field border-line-strong bg-surface-raised px-3 text-base text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-focus";

export function PageTitle({
	children,
	aside,
}: {
	readonly children: ReactNode;
	readonly aside?: ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-center gap-3 pb-4">
			<h1 className="min-w-0 flex-1 text-2xl font-extrabold">{children}</h1>
			{aside}
		</div>
	);
}

/** A plain line for an empty list or a state (no character on a staff screen). */
export function PlainNote({
	children,
	tone = "muted",
	testId,
}: {
	readonly children: ReactNode;
	readonly tone?: "muted" | "negative" | "warning";
	readonly testId?: string;
}) {
	const tones = {
		muted: "text-ink-muted",
		negative: "rounded-card-xl bg-negative-soft px-4 py-3 text-ink",
		warning: "rounded-card-xl bg-warning-soft px-4 py-3 text-ink",
	} as const;
	return (
		<p
			className={`text-body ${tones[tone]}`}
			data-testid={testId}
			role={tone === "muted" ? undefined : "alert"}
		>
			{children}
		</p>
	);
}

/** "Đang tải…" while a list or a screen loads. */
export function Loading({ label }: { readonly label: string }) {
	return (
		<p
			className="py-8 text-center text-ink-muted"
			role="status"
			aria-live="polite"
		>
			{label}
		</p>
	);
}
