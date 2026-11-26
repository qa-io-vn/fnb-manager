import type { NoticeAcceptance, StaffNotice } from "@fnb/zalo-mini";
import { useI18n } from "@fnb/zalo-mini/react";
import {
	type FormEvent,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { LegalButtons, type LegalLoader } from "../legal/legal";
import { MarkdownText } from "../legal/markdown";
import { primaryButton, Spinner, secondaryButton, shownDate } from "../ui";
import {
	codeFrom,
	type NoticeVia,
	PAIRING_CODE_LENGTH,
	waitText,
} from "./model";

function Screen({
	name,
	title,
	children,
}: {
	readonly name: string;
	readonly title: string;
	readonly children: ReactNode;
}) {
	const headingRef = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		headingRef.current?.focus({ preventScroll: true });
	}, []);
	return (
		<section
			data-testid="entry-screen"
			data-screen={name}
			className="flex flex-col gap-4 px-4 pt-6 pb-8"
		>
			<h1
				ref={headingRef}
				tabIndex={-1}
				className="text-xl font-semibold text-ink outline-none"
			>
				{title}
			</h1>
			{children}
		</section>
	);
}

function PrimaryButton({
	children,
	busy = false,
	disabled = false,
	onClick,
	type = "button",
}: {
	readonly children: ReactNode;
	readonly busy?: boolean;
	readonly disabled?: boolean;
	readonly onClick?: () => void;
	readonly type?: "button" | "submit";
}) {
	return (
		<button
			type={type}
			className={primaryButton}
			data-action="primary"
			disabled={disabled || busy}
			aria-busy={busy}
			onClick={onClick}
		>
			{busy ? <Spinner /> : null}
			{children}
		</button>
	);
}

export function OnboardingScreen({
	appName,
	onContinue,
	loadLegal,
}: {
	readonly appName: string;
	readonly onContinue: () => void;
	readonly loadLegal: LegalLoader;
}) {
	const { t } = useI18n();
	return (
		<Screen name="onboarding" title={t("entry.onboarding.title")}>
			<p className="text-body text-ink">
				{t("entry.onboarding.intro", { app: appName })}
			</p>
			<div className="flex flex-col gap-1">
				<h2 className="text-body font-semibold text-ink">
					{t("entry.onboarding.whyTitle")}
				</h2>
				<p className="text-body text-ink">{t("entry.onboarding.why")}</p>
			</div>
			<div className="flex flex-col gap-1">
				<h2 className="text-body font-semibold text-ink">
					{t("entry.onboarding.keptTitle")}
				</h2>
				<ul className="flex list-disc flex-col gap-1 pl-5 text-body text-ink">
					<li>{t("entry.onboarding.keptId")}</li>
					<li>{t("entry.onboarding.keptPhone")}</li>
				</ul>
			</div>
			<PrimaryButton onClick={onContinue}>{t("entry.continue")}</PrimaryButton>
			<LegalButtons load={loadLegal} />
		</Screen>
	);
}

export function ConnectingScreen() {
	const { t } = useI18n();
	return (
		<section
			data-testid="entry-screen"
			data-screen="connecting"
			className="flex flex-col gap-4 px-4 py-6"
		>
			<div
				role="status"
				aria-live="polite"
				className="flex items-center gap-3 text-body text-ink"
			>
				<span
					aria-hidden="true"
					className="size-5 animate-spin rounded-full border-2 border-line border-t-accent"
				/>
				{t("entry.connecting")}
			</div>
		</section>
	);
}

export function FailedScreen({ onRetry }: { readonly onRetry: () => void }) {
	const { t } = useI18n();
	return (
		<Screen name="failed" title={t("entry.failed.title")}>
			<p className="text-body text-ink">{t("entry.failed.body")}</p>
			<PrimaryButton onClick={onRetry}>{t("entry.retry")}</PrimaryButton>
		</Screen>
	);
}

export function NoNoticeScreen({ onRetry }: { readonly onRetry: () => void }) {
	const { t } = useI18n();
	return (
		<Screen name="no-notice" title={t("entry.noNotice.title")}>
			<p className="text-body text-ink">{t("entry.noNotice.body")}</p>
			<PrimaryButton onClick={onRetry}>{t("entry.retry")}</PrimaryButton>
		</Screen>
	);
}

export function NoticeScreen({
	notice,
	updated,
	via,
	busy,
	failed,
	onAgree,
	onDecline,
}: {
	readonly notice: StaffNotice;
	readonly updated: boolean;
	readonly via: NoticeVia;
	readonly busy: boolean;
	readonly failed: boolean;
	readonly onAgree: (acceptance: NoticeAcceptance) => void;
	readonly onDecline: () => void;
}) {
	const { t } = useI18n();
	const [shownAt] = useState(() => Date.now());
	const hint = updated
		? t("entry.notice.updated")
		: via === "pairing"
			? t("entry.notice.intro")
			: t("entry.notice.again");
	return (
		<Screen name="notice" title={notice.title}>
			<p
				className={
					updated
						? "rounded-card-xl bg-warning-soft px-4 py-3 text-body text-ink"
						: "text-body text-ink"
				}
				data-testid="notice-hint"
				role={updated ? "status" : undefined}
			>
				{hint}
			</p>
			<p className="text-sm text-ink-muted" data-testid="notice-version">
				{t("entry.notice.version", {
					version: notice.version,
					date: shownDate(notice.publishedAt),
				})}
			</p>
			<div
				className="rounded-card-xl border-card border-line bg-surface-raised p-4"
				data-testid="staff-notice"
			>
				<MarkdownText markdown={notice.bodyMarkdown} />
			</div>
			{failed ? (
				<p role="alert" className="text-body text-negative">
					{t("entry.notice.failed")}
				</p>
			) : null}
			<PrimaryButton
				busy={busy}
				onClick={() => onAgree({ version: notice.version, shownAt })}
			>
				{busy ? t("entry.notice.agreeing") : t("entry.notice.agree")}
			</PrimaryButton>
			<button
				type="button"
				className={secondaryButton}
				disabled={busy}
				onClick={onDecline}
			>
				{t("entry.notice.decline")}
			</button>
		</Screen>
	);
}

function useNow(until: number | null): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (until === null) return;
		setNow(Date.now());
		const timer = setInterval(() => {
			const current = Date.now();
			setNow(current);
			if (current >= until) clearInterval(timer);
		}, 1000);
		return () => clearInterval(timer);
	}, [until]);
	return now;
}

export function PairingScreen({
	code,
	refused,
	waitUntil,
	busy,
	onCode,
	onSubmit,
	onBack,
}: {
	readonly code: string;
	readonly refused: boolean;
	readonly waitUntil: number | null;
	readonly busy: boolean;
	readonly onCode: (code: string) => void;
	readonly onSubmit: (code: string) => void;
	readonly onBack: () => void;
}) {
	const { t } = useI18n();
	const inputId = useId();
	const messageId = useId();
	const now = useNow(waitUntil);
	const waiting = waitUntil !== null && now < waitUntil;
	const complete = code.length === PAIRING_CODE_LENGTH;
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (complete && !busy && !waiting) onSubmit(code);
	};
	const message = waiting ? (
		<p id={messageId} role="timer" className="text-body text-negative">
			{t("entry.pairing.wait", { time: waitText((waitUntil ?? now) - now) })}
		</p>
	) : waitUntil !== null ? (
		<p id={messageId} role="status" className="text-body text-ink">
			{t("entry.pairing.waitOver")}
		</p>
	) : refused ? (
		<p id={messageId} role="alert" className="text-body text-negative">
			{t("entry.pairing.refused")}
		</p>
	) : null;
	return (
		<Screen name="pairing" title={t("entry.pairing.title")}>
			<p className="text-body text-ink">{t("entry.pairing.body")}</p>
			<form className="flex flex-col gap-3" onSubmit={submit} noValidate>
				<label htmlFor={inputId} className="text-sm text-ink-muted">
					{t("entry.pairing.label")}
				</label>
				<input
					id={inputId}
					value={code}
					onChange={(event) => onCode(codeFrom(event.target.value))}
					inputMode="numeric"
					pattern="[0-9]*"
					enterKeyHint="done"
					autoComplete="one-time-code"
					maxLength={PAIRING_CODE_LENGTH}
					aria-invalid={refused && !waiting && waitUntil === null}
					aria-describedby={message === null ? undefined : messageId}
					className="min-h-12 rounded-field border-field border-line-strong bg-surface-raised px-4 text-center text-2xl tracking-[0.4em] text-ink tabular-nums"
				/>
				{message}
				<PrimaryButton
					type="submit"
					busy={busy}
					disabled={!complete || waiting}
				>
					{busy ? t("entry.pairing.submitting") : t("entry.pairing.submit")}
				</PrimaryButton>
			</form>
			<button
				type="button"
				className={secondaryButton}
				disabled={busy}
				onClick={onBack}
			>
				{t("entry.pairing.back")}
			</button>
		</Screen>
	);
}

export function RefusalScreen({
	contact,
	onReview,
}: {
	readonly contact: string | null;
	readonly onReview: () => void;
}) {
	const { t } = useI18n();
	return (
		<Screen name="refused" title={t("entry.refused.title")}>
			<p className="text-body text-ink">{t("entry.refused.body")}</p>
			<div className="flex flex-col gap-1 rounded-card-xl border-card border-line bg-surface-raised p-4">
				<h2 className="text-body font-semibold text-ink">
					{t("entry.refused.contactTitle")}
				</h2>
				<p
					className="whitespace-pre-line text-body text-ink"
					data-testid="refusal-contact"
				>
					{contact ?? t("entry.refused.contactFallback")}
				</p>
			</div>
			<PrimaryButton onClick={onReview}>
				{t("entry.refused.review")}
			</PrimaryButton>
		</Screen>
	);
}
