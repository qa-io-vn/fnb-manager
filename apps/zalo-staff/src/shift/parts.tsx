import { useI18n } from "@fnb/zalo-mini/react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Spinner } from "../ui";

export const focusRing =
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export const quietAction = `inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-control-xl px-3 text-body font-semibold text-accent disabled:opacity-60 ${focusRing}`;

export const fieldClass = `min-h-11 w-full rounded-field border-field border-line-strong bg-surface-raised px-4 py-2 text-base text-ink ${focusRing}`;

function BackIcon() {
	return (
		<svg
			aria-hidden="true"
			width="22"
			height="22"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M15 5l-7 7 7 7" />
		</svg>
	);
}

export function SubScreen({
	title,
	subtitle,
	onBack,
	backDisabled = false,
	testId,
	children,
}: {
	readonly title: string;
	readonly subtitle?: string;
	readonly onBack: () => void;
	readonly backDisabled?: boolean;
	readonly testId: string;
	readonly children: ReactNode;
}) {
	const { t } = useI18n();
	const headingRef = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		headingRef.current?.focus({ preventScroll: true });
		window.scrollTo?.(0, 0);
	}, []);
	return (
		<section
			className="flex flex-col gap-4 px-4 pt-3 pb-8"
			data-testid={testId}
		>
			<div className="flex items-start gap-1">
				<button
					type="button"
					onClick={onBack}
					disabled={backDisabled}
					aria-label={t("ops.back")}
					className={`-ml-3 flex size-11 shrink-0 items-center justify-center rounded-control-xl text-ink disabled:opacity-60 ${focusRing}`}
				>
					<BackIcon />
				</button>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1.5">
					<h1
						ref={headingRef}
						tabIndex={-1}
						className="text-xl font-semibold text-ink outline-none"
					>
						{title}
					</h1>
					{subtitle === undefined ? null : (
						<p className="text-sm text-ink-muted">{subtitle}</p>
					)}
				</div>
			</div>
			{children}
		</section>
	);
}

export function Panel({
	title,
	testId,
	aside,
	children,
}: {
	readonly title: string;
	readonly testId: string;
	readonly aside?: ReactNode;
	readonly children: ReactNode;
}) {
	const id = useId();
	return (
		<section
			aria-labelledby={id}
			data-testid={testId}
			className="flex flex-col gap-3"
		>
			<div className="flex items-center justify-between gap-2">
				<h2 id={id} className="text-body font-semibold text-ink">
					{title}
				</h2>
				{aside}
			</div>
			{children}
		</section>
	);
}

export function Card({
	children,
	testId,
	state,
}: {
	readonly children: ReactNode;
	readonly testId?: string;
	readonly state?: string;
}) {
	return (
		<div
			data-testid={testId}
			data-state={state}
			className="flex min-w-0 flex-col gap-3 rounded-card-2xl border-card border-line bg-surface-raised p-4"
		>
			{children}
		</div>
	);
}

export type Tone = "positive" | "warning" | "negative" | "neutral" | "accent";

const TONES: Readonly<Record<Tone, string>> = {
	positive: "bg-positive-soft text-positive",
	warning: "bg-warning-soft text-warning",
	negative: "bg-negative-soft text-negative",
	neutral: "bg-neutral-soft text-ink",
	accent: "bg-surface-sunken text-ink",
};

export function Chip({
	tone,
	children,
	testId,
}: {
	readonly tone: Tone;
	readonly children: ReactNode;
	readonly testId?: string;
}) {
	return (
		<span
			data-testid={testId}
			className={`inline-flex w-fit shrink-0 items-center rounded-full px-3 py-1 text-sm font-semibold ${TONES[tone]}`}
		>
			{children}
		</span>
	);
}

export function Alert({
	children,
	testId,
}: {
	readonly children: ReactNode;
	readonly testId?: string;
}) {
	return (
		<p
			role="alert"
			data-testid={testId}
			className="rounded-card-xl bg-negative-soft px-3 py-2 text-body text-negative"
		>
			{children}
		</p>
	);
}

export function Hint({
	children,
	testId,
}: {
	readonly children: ReactNode;
	readonly testId?: string;
}) {
	return (
		<p data-testid={testId} className="text-sm text-ink-muted">
			{children}
		</p>
	);
}

export function Loading({ label }: { readonly label: string }) {
	return (
		<div
			role="status"
			aria-live="polite"
			className="flex items-center gap-3 py-2 text-body text-ink"
		>
			<span
				aria-hidden="true"
				className="size-5 animate-spin rounded-full border-2 border-line border-t-accent"
			/>
			{label}
		</div>
	);
}

export function BusyLabel({
	busy,
	busyText,
	children,
}: {
	readonly busy: boolean;
	readonly busyText: string;
	readonly children: ReactNode;
}) {
	return busy ? (
		<>
			<Spinner />
			{busyText}
		</>
	) : (
		children
	);
}

export function useOnline(): boolean {
	const [online, setOnline] = useState(
		typeof navigator === "undefined" ? true : navigator.onLine !== false,
	);
	useEffect(() => {
		const update = () => setOnline(navigator.onLine !== false);
		window.addEventListener("online", update);
		window.addEventListener("offline", update);
		return () => {
			window.removeEventListener("online", update);
			window.removeEventListener("offline", update);
		};
	}, []);
	return online;
}

export function OfflineBanner() {
	const { t } = useI18n();
	const online = useOnline();
	if (online) return null;
	return (
		<p
			role="alert"
			data-testid="offline"
			className="rounded-card-xl bg-warning-soft px-3 py-2 text-body text-warning"
		>
			{t("ops.offline")}
		</p>
	);
}
