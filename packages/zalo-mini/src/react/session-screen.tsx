import { type FormEvent, type ReactNode, useId, useState } from "react";
import type { MemberProfile, StaffNotice } from "../session/types";
import { BINDING_CODE_PATTERN } from "../session/zalo-session-client";
import { useI18n } from "./i18n";
import { useSession } from "./session";

const primaryButton =
	"min-h-11 w-full rounded-xl bg-accent px-4 text-base font-semibold text-accent-ink disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

function Section({
	status,
	children,
}: {
	readonly status: string;
	readonly children: ReactNode;
}) {
	return (
		<section
			data-testid="session-state"
			data-status={status}
			className="flex flex-col gap-4 px-4 py-6"
		>
			{children}
		</section>
	);
}

function Connecting() {
	const { t } = useI18n();
	return (
		<Section status="connecting">
			<div
				role="status"
				aria-live="polite"
				className="flex items-center gap-3 text-base text-ink"
			>
				<span
					aria-hidden="true"
					className="size-5 animate-spin rounded-full border-2 border-line border-t-accent"
				/>
				{t("session.connecting")}
			</div>
		</Section>
	);
}

function SignedIn({ member }: { readonly member: MemberProfile }) {
	const { t } = useI18n();
	return (
		<Section status="signed-in">
			<h1 className="text-xl font-semibold text-ink">
				{t("session.greeting", { name: member.displayName })}
			</h1>
			<dl className="flex flex-col gap-3 rounded-xl bg-surface-raised p-4">
				<div>
					<dt className="text-sm text-ink-muted">{t("session.role")}</dt>
					<dd className="text-base text-ink" data-testid="member-role">
						{t(`role.${member.role}`)}
					</dd>
				</div>
				<div>
					<dt className="text-sm text-ink-muted">{t("session.stores")}</dt>
					<dd className="text-base text-ink" data-testid="member-stores">
						{member.stores.length === 0 ? (
							t("session.noStores")
						) : (
							<ul className="flex flex-col gap-1">
								{member.stores.map((store) => (
									<li key={store}>{store}</li>
								))}
							</ul>
						)}
					</dd>
				</div>
			</dl>
		</Section>
	);
}

function Unpaired({ codeRejected }: { readonly codeRejected: boolean }) {
	const { t } = useI18n();
	const { bind, busy } = useSession();
	const [code, setCode] = useState("");
	const inputId = useId();
	const errorId = useId();
	const complete = BINDING_CODE_PATTERN.test(code);
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (complete && !busy) bind(code);
	};
	return (
		<Section status="unpaired">
			<h1 className="text-xl font-semibold text-ink">
				{t("session.unpairedTitle")}
			</h1>
			<p className="text-base text-ink">{t("session.unpairedBody")}</p>
			<ol className="list-decimal flex flex-col gap-1 pl-5 text-base text-ink">
				<li>{t("session.unpairedStep1")}</li>
				<li>{t("session.unpairedStep2")}</li>
				<li>{t("session.unpairedStep3")}</li>
			</ol>
			<form className="flex flex-col gap-3" onSubmit={submit} noValidate>
				<label htmlFor={inputId} className="text-sm text-ink-muted">
					{t("session.codeLabel")}
				</label>
				<input
					id={inputId}
					value={code}
					onChange={(event) =>
						setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
					}
					inputMode="numeric"
					autoComplete="one-time-code"
					maxLength={6}
					aria-invalid={codeRejected}
					aria-describedby={codeRejected ? errorId : undefined}
					className="min-h-11 rounded-xl border border-line bg-surface-raised px-4 text-lg tracking-widest text-ink"
				/>
				{codeRejected ? (
					<p id={errorId} role="alert" className="text-sm text-negative">
						{t("session.codeRejected")}
					</p>
				) : null}
				<button
					type="submit"
					className={primaryButton}
					disabled={!complete || busy}
					aria-busy={busy}
				>
					{busy ? t("session.linking") : t("session.link")}
				</button>
			</form>
		</Section>
	);
}

function NoticeRequired({ notice }: { readonly notice: StaffNotice | null }) {
	const { t } = useI18n();
	const { acceptNotice, busy, retry } = useSession();
	const [shownAt] = useState(() => Date.now());
	if (notice === null) {
		return (
			<Section status="notice-required">
				<p className="text-base text-ink">{t("session.noticeUnavailable")}</p>
				<button type="button" className={primaryButton} onClick={retry}>
					{t("session.retry")}
				</button>
			</Section>
		);
	}
	return (
		<Section status="notice-required">
			<h1 className="text-xl font-semibold text-ink">{notice.title}</h1>
			<p
				className="whitespace-pre-line text-base text-ink"
				data-testid="staff-notice"
			>
				{notice.bodyMarkdown}
			</p>
			<button
				type="button"
				className={primaryButton}
				disabled={busy}
				aria-busy={busy}
				onClick={() => acceptNotice({ version: notice.version, shownAt })}
			>
				{busy ? t("session.noticeAccepting") : t("session.noticeAccept")}
			</button>
		</Section>
	);
}

function Failed() {
	const { t } = useI18n();
	const { retry } = useSession();
	return (
		<Section status="failed">
			<h1 className="text-xl font-semibold text-ink">
				{t("session.failedTitle")}
			</h1>
			<p className="text-base text-ink">{t("session.failedBody")}</p>
			<button type="button" className={primaryButton} onClick={retry}>
				{t("session.retry")}
			</button>
		</Section>
	);
}

export function SessionScreen() {
	const { state } = useSession();
	switch (state.status) {
		case "connecting":
			return <Connecting />;
		case "signed-in":
			return <SignedIn member={state.session.member} />;
		case "unpaired":
			return <Unpaired codeRejected={state.codeRejected} />;
		case "notice-required":
			return <NoticeRequired notice={state.notice} />;
		case "failed":
			return <Failed />;
	}
}
