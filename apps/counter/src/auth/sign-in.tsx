import config from "virtual:counter-config";
import { useI18n } from "@fnb/zalo-mini/i18n";
import { type FormEvent, useState } from "react";
import { type Blocked, useSession } from "../lib/session";
import { AlertIcon, LockIcon, UserIcon } from "../ui/icons";
import { button, card, field } from "../ui/kit";

function Brand() {
	const { language, t } = useI18n();
	const title = language === "en" ? config.title.en : config.title.vi;
	return (
		<div className="flex flex-col items-center gap-2 text-center">
			<p className="kicker text-highlight">{t("app.kicker")}</p>
			<h1 className="text-3xl font-extrabold">
				{t("signIn.title", { brand: title })}
			</h1>
		</div>
	);
}

const ERRORS: Readonly<Record<string, string>> = {
	denied: "signIn.error.denied",
	state_mismatch: "signIn.error.state",
	state_refused: "signIn.error.state",
	zalo_code_refused: "signIn.error.zalo",
	zalo_token_refused: "signIn.error.zalo",
	zalo_unavailable: "signIn.error.zaloDown",
	network: "signIn.error.network",
	expired: "signIn.error.expired",
	locked: "signIn.error.locked",
	role_not_allowed: "signIn.error.role",
	ticket_refused: "signIn.error.ticket",
};

export function errorKey(code: string | undefined): string | null {
	if (code === undefined) return null;
	return ERRORS[code] ?? "signIn.error.failed";
}

/** S09: one button, Zalo's web login; an error from the last attempt above it. */
export function SignInScreen({
	error,
}: {
	readonly error?: string | undefined;
}) {
	const { t } = useI18n();
	const { signIn } = useSession();
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const key = failure ?? errorKey(error);
	return (
		<main className="flex min-h-dvh items-center justify-center bg-surface px-4 py-10 text-ink">
			<div className={`${card} flex w-full max-w-md flex-col gap-6 p-8`}>
				<Brand />
				<p className="text-center text-body text-ink-muted">
					{t("signIn.lead")}
				</p>
				{key === null ? null : (
					<div
						className="flex gap-3 rounded-card-xl bg-negative-soft p-4"
						role="alert"
						data-testid="sign-in-error"
					>
						<AlertIcon />
						<p className="text-body">{t(key)}</p>
					</div>
				)}
				<button
					type="button"
					className={`${button.primary} w-full`}
					disabled={busy}
					data-testid="sign-in-zalo"
					onClick={() => {
						setBusy(true);
						setFailure(null);
						signIn().catch((reason: unknown) => {
							setBusy(false);
							setFailure(
								errorKey((reason as { code?: string }).code ?? "failed"),
							);
						});
					}}
				>
					<UserIcon />
					{busy ? t("signIn.opening") : t("signIn.button")}
				</button>
			</div>
		</main>
	);
}

/**
 * The person Zalo verified is not on the list (acceptance criterion 5): no session. They may type the pairing code a
 * manager gave them and accept the staff notice; a person on the roster whose consent is missing accepts the notice.
 */
export function BlockedScreen({
	answer,
	error,
}: {
	readonly answer: Blocked;
	readonly error?: string | undefined;
}) {
	const { t } = useI18n();
	const { pair, signOut } = useSession();
	const [code, setCode] = useState("");
	const [accepted, setAccepted] = useState(false);
	const [busy, setBusy] = useState(false);
	const [shownAt] = useState(() => new Date().toISOString());
	const notice = answer.notice;
	const needsCode = answer.status === "unpaired";
	const codeValid = /^[0-9]{6}$/.test(code);
	const canSubmit =
		!busy &&
		(needsCode ? codeValid : true) &&
		(notice === undefined || accepted);
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!canSubmit) return;
		setBusy(true);
		pair({
			pairingCode: needsCode ? code : null,
			noticeShownAt: notice !== undefined && accepted ? shownAt : null,
		}).finally(() => setBusy(false));
	};
	const reason =
		answer.status === "unpaired" && answer.reason === "code_refused"
			? t("blocked.codeRefused")
			: answer.status === "unpaired" && answer.reason === "wait"
				? t("blocked.wait", {
						minutes: Math.ceil((answer.retry_after ?? 900) / 60),
					})
				: answer.status === "unpaired" && answer.reason === "notice_outdated"
					? t("blocked.noticeOutdated")
					: null;
	const failure = errorKey(error);
	return (
		<main className="flex min-h-dvh items-center justify-center bg-surface px-4 py-10 text-ink">
			<form
				onSubmit={submit}
				className={`${card} flex w-full max-w-lg flex-col gap-5 p-6 sm:p-8`}
				data-testid="blocked"
			>
				<Brand />
				{needsCode ? (
					<div
						className="flex gap-3 rounded-card-xl bg-negative-soft p-4"
						role="alert"
					>
						<LockIcon />
						<div>
							<p className="font-extrabold">{t("blocked.title")}</p>
							<p className="text-body">{t("blocked.body")}</p>
						</div>
					</div>
				) : (
					<p className="text-body">{t("blocked.noticeLead")}</p>
				)}
				{answer.contact === undefined ? null : (
					<p className="rounded-card-xl bg-surface-sunken p-3 text-body whitespace-pre-line">
						{answer.contact}
					</p>
				)}
				{reason === null && failure === null ? null : (
					<p
						className="rounded-card-xl bg-warning-soft p-3 text-body"
						role="alert"
						data-testid="blocked-reason"
					>
						{reason ?? (failure === null ? "" : t(failure))}
					</p>
				)}
				{needsCode ? (
					<label className="flex flex-col gap-2">
						<span className="font-bold">{t("blocked.codeLabel")}</span>
						<input
							className={`${field} text-center text-2xl tracking-[0.4em]`}
							inputMode="numeric"
							autoComplete="one-time-code"
							maxLength={6}
							value={code}
							onChange={(event) =>
								setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
							}
							data-testid="pairing-code"
						/>
						<span className="text-sm text-ink-muted">
							{t("blocked.codeHint")}
						</span>
					</label>
				) : null}
				{notice === undefined ? null : (
					<section className="flex flex-col gap-2 rounded-card-xl border-card border-line p-4">
						<h2 className="font-extrabold">{notice.title}</h2>
						<p className="max-h-48 overflow-y-auto text-sm whitespace-pre-line text-ink-muted">
							{notice.body_markdown}
						</p>
						<label className="flex min-h-11 items-center gap-3 font-bold">
							<input
								type="checkbox"
								className="size-6"
								checked={accepted}
								onChange={(event) => setAccepted(event.target.checked)}
								data-testid="notice-accept"
							/>
							{t("blocked.noticeAccept")}
						</label>
					</section>
				)}
				<button
					type="submit"
					className={`${button.primary} w-full`}
					disabled={!canSubmit}
					data-testid="pair-submit"
				>
					{needsCode ? t("blocked.pair") : t("blocked.continue")}
				</button>
				<button
					type="button"
					className={`${button.secondary} w-full`}
					onClick={() => void signOut()}
					data-testid="blocked-back"
				>
					{t("blocked.back")}
				</button>
			</form>
		</main>
	);
}

export function NotConfigured() {
	const { t } = useI18n();
	return (
		<main className="flex min-h-dvh items-center justify-center bg-surface p-6 text-ink">
			<p className={`${card} max-w-md p-6 text-body`}>
				{t("app.notConfigured")}
			</p>
		</main>
	);
}
