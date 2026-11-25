import { useI18n } from "@fnb/zalo-mini/react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { Failure } from "./data/source";
import { AlertIcon } from "./icons";

const focusRing =
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

const press = "transition-transform active:scale-[0.98]";

export const primaryButton = `inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-accent px-5 text-base font-semibold text-accent-ink shadow-sm disabled:opacity-60 disabled:active:scale-100 ${press} ${focusRing}`;

export const secondaryButton = `inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-line bg-surface-raised px-5 text-base font-medium text-ink disabled:opacity-60 disabled:active:scale-100 ${press} ${focusRing}`;

export const dangerButton = `inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-line px-5 text-base text-negative disabled:opacity-60 ${press} ${focusRing}`;

export const quietButton = `inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl px-3 text-base text-ink underline underline-offset-4 ${focusRing}`;

export const rowButton = `flex min-h-11 w-full items-center gap-3 rounded-2xl border border-line/60 bg-surface-raised px-4 py-3.5 text-left text-ink ${press} ${focusRing}`;

/** A round tinted holder for a line icon, in the brand's tile colour. */
export function IconBadge({ children }: { readonly children: ReactNode }) {
	return (
		<span
			aria-hidden="true"
			className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink"
		>
			{children}
		</span>
	);
}

/** The heading of a home section, with an optional count or note on the right. */
export function SectionTitle({
	id,
	children,
}: {
	readonly id: string;
	readonly children: ReactNode;
}) {
	return (
		<h2 id={id} className="px-1 text-lg font-bold text-ink">
			{children}
		</h2>
	);
}

export const fieldClass =
	"min-h-11 w-full rounded-xl border border-line bg-surface-raised px-4 text-base text-ink";

export function Spinner() {
	return (
		<span
			aria-hidden="true"
			className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
		/>
	);
}

export function Screen({
	testId,
	children,
}: {
	readonly testId: string;
	readonly children: ReactNode;
}) {
	return (
		<section data-testid={testId} className="flex flex-col gap-5 px-4 py-5">
			{children}
		</section>
	);
}

export function Card({
	children,
	testId,
	labelledBy,
}: {
	readonly children: ReactNode;
	readonly testId?: string;
	readonly labelledBy?: string;
}) {
	return (
		<section
			data-testid={testId}
			aria-labelledby={labelledBy}
			className="flex flex-col gap-3 rounded-3xl border border-line/60 bg-surface-raised p-5 shadow-sm"
		>
			{children}
		</section>
	);
}

export function Loading({ label }: { readonly label?: string }) {
	const { t } = useI18n();
	return (
		<p
			role="status"
			aria-live="polite"
			className="flex items-center gap-3 px-4 py-6 text-base text-ink"
			data-testid="loading"
		>
			<span
				aria-hidden="true"
				className="size-5 animate-spin rounded-full border-2 border-line border-t-accent"
			/>
			{label ?? t("customer.loading")}
		</p>
	);
}

/** Grey placeholders in the shape of the home card and two rows while the first answer is on its way. */
export function HomeSkeleton() {
	return (
		<div
			aria-hidden="true"
			className="flex animate-pulse flex-col gap-3 px-4"
			data-testid="home-skeleton"
		>
			<div className="h-44 rounded-3xl bg-surface-raised shadow-sm" />
			<div className="h-20 rounded-2xl bg-surface-raised" />
			<div className="h-20 rounded-2xl bg-surface-raised" />
		</div>
	);
}

export function failureKey(failure: Failure): string {
	switch (failure) {
		case "network":
			return "customer.error.network";
		case "session":
			return "customer.error.session";
		case "not-member":
			return "customer.error.notMember";
		default:
			return "customer.error.unknown";
	}
}

export function Failed({
	failure,
	onRetry,
	detail,
}: {
	readonly failure: Failure;
	readonly onRetry: () => void;
	readonly detail?: string | undefined;
}) {
	const { t } = useI18n();
	const showDetail =
		detail !== undefined &&
		import.meta.env.VITE_MINI_APP_STAGE === "development";
	return (
		<div className="px-4 py-2" data-testid="failed">
			<div className="flex flex-col items-center gap-3 rounded-3xl border border-line/60 bg-surface-raised px-5 py-6 text-center shadow-sm">
				<span
					aria-hidden="true"
					className="flex size-12 items-center justify-center rounded-full bg-warning-soft text-ink"
				>
					<AlertIcon />
				</span>
				<p role="alert" className="text-base text-ink">
					{t(failureKey(failure))}
				</p>
				{showDetail ? (
					<p
						className="rounded-lg bg-surface-sunken px-2 py-1 font-mono text-sm text-ink"
						data-testid="failed-detail"
					>
						{detail}
					</p>
				) : null}
				<button type="button" className={primaryButton} onClick={onRetry}>
					{t("customer.retry")}
				</button>
			</div>
		</div>
	);
}

export function NoStores() {
	const { t } = useI18n();
	return (
		<p
			className="rounded-2xl bg-neutral-soft px-4 py-3 text-base text-ink"
			data-testid="no-stores"
		>
			{t("customer.noStores")}
		</p>
	);
}

export function BackButton({ to }: { readonly to?: string }) {
	const { t } = useI18n();
	const navigate = useNavigate();
	return (
		<button
			type="button"
			onClick={() => (to === undefined ? navigate(-1) : navigate(to))}
			className={`-ml-3 inline-flex min-h-11 min-w-11 items-center gap-1 self-start rounded-xl px-3 text-base text-ink ${focusRing}`}
		>
			<svg
				aria-hidden="true"
				width="20"
				height="20"
				viewBox="0 0 20 20"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.8"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M12.5 4.5L7 10l5.5 5.5" />
			</svg>
			{t("customer.back")}
		</button>
	);
}

export function Badge({
	tone,
	children,
}: {
	readonly tone: "pending" | "positive" | "neutral" | "negative";
	readonly children: ReactNode;
}) {
	const tones = {
		pending: "bg-warning-soft text-ink",
		positive: "bg-positive-soft text-ink",
		neutral: "bg-neutral-soft text-ink",
		negative: "bg-negative-soft text-ink",
	} as const;
	return (
		<span
			className={`inline-flex items-center rounded-full px-2 py-0.5 text-sm ${tones[tone]}`}
		>
			{children}
		</span>
	);
}

export function CheckControl({
	id,
	kind,
	checked,
	disabled,
	describedBy,
	testId,
	onChange,
}: {
	readonly id: string;
	readonly kind: "checkbox" | "switch";
	readonly checked: boolean;
	readonly disabled: boolean;
	readonly describedBy?: string;
	readonly testId: string;
	readonly onChange: (checked: boolean) => void;
}) {
	return (
		<span className="relative -m-1 flex size-11 shrink-0 items-center justify-center">
			<input
				id={id}
				type="checkbox"
				role={kind === "switch" ? "switch" : undefined}
				checked={checked}
				disabled={disabled}
				aria-describedby={describedBy}
				onChange={(event) => onChange(event.target.checked)}
				data-testid={testId}
				className="peer absolute inset-0 m-0 size-11 cursor-pointer appearance-none rounded-xl opacity-0 disabled:cursor-default"
			/>
			{kind === "checkbox" ? (
				<span
					aria-hidden="true"
					className={`pointer-events-none flex size-6 items-center justify-center rounded-md border-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus peer-disabled:opacity-60 ${checked ? "border-accent bg-accent text-accent-ink" : "border-ink-muted bg-surface-raised"}`}
				>
					{checked ? (
						<svg
							aria-hidden="true"
							width="16"
							height="16"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M3.5 8.5l3 3 6-7" />
						</svg>
					) : null}
				</span>
			) : (
				<span
					aria-hidden="true"
					className={`pointer-events-none flex h-6 w-10 items-center rounded-full p-0.5 transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus peer-disabled:opacity-60 ${checked ? "justify-end bg-accent" : "justify-start bg-line"}`}
				>
					<span className="size-5 rounded-full bg-surface-raised shadow" />
				</span>
			)}
		</span>
	);
}
