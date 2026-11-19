import { Popup, useI18n, useSession } from "@fnb/zalo-mini/react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getPhoneNumber } from "zmp-sdk";
import { LegalButtons } from "../legal/legal";
import { sessionRefused } from "../onboarding/account";
import { useEntry } from "../onboarding/entry-gate";
import { TEAM_PATHS } from "../team/env";
import { dangerButton, primaryButton, Spinner, secondaryButton } from "../ui";

export type PhoneTokenRequest = () => Promise<string | null>;

export async function requestPhoneToken(): Promise<string | null> {
	try {
		const result = await getPhoneNumber();
		return typeof result.token === "string" && result.token !== ""
			? result.token
			: null;
	} catch {
		return null;
	}
}

function Section({
	title,
	children,
	testId,
}: {
	readonly title: string;
	readonly children: ReactNode;
	readonly testId: string;
}) {
	const id = useId();
	return (
		<section
			aria-labelledby={id}
			data-testid={testId}
			className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-raised p-4"
		>
			<h2 id={id} className="text-base font-semibold text-ink">
				{title}
			</h2>
			{children}
		</section>
	);
}

function PhonePurpose({
	requestToken,
	onLinked,
	onBack,
}: {
	readonly requestToken: PhoneTokenRequest;
	readonly onLinked: (hint: string | null) => void;
	readonly onBack: () => void;
}) {
	const { t } = useI18n();
	const { expire } = useSession();
	const { account } = useEntry();
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const headingRef = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		headingRef.current?.focus({ preventScroll: true });
	}, []);
	const link = async () => {
		if (account === null) return;
		setBusy(true);
		setFailed(false);
		const token = await requestToken();
		if (token === null) {
			setBusy(false);
			onBack();
			return;
		}
		try {
			const hint = await account.linkPhone(token);
			setBusy(false);
			onLinked(hint);
		} catch (error) {
			setBusy(false);
			if (sessionRefused(error)) expire();
			else setFailed(true);
		}
	};
	return (
		<section
			className="flex flex-col gap-4 px-4 pt-6 pb-8"
			data-testid="phone-purpose"
		>
			<h1
				ref={headingRef}
				tabIndex={-1}
				className="text-xl font-semibold text-ink outline-none"
			>
				{t("phone.title")}
			</h1>
			<p className="text-base text-ink">{t("phone.purpose")}</p>
			<p className="text-base text-ink">{t("phone.optional")}</p>
			<p className="text-base text-ink">{t("phone.prompt")}</p>
			{failed ? (
				<p role="alert" className="text-base text-negative">
					{t("phone.failed")}
				</p>
			) : null}
			<button
				type="button"
				className={primaryButton}
				data-action="primary"
				disabled={busy}
				aria-busy={busy}
				onClick={link}
			>
				{busy ? <Spinner /> : null}
				{busy ? t("phone.working") : t("phone.continue")}
			</button>
			<button
				type="button"
				className={secondaryButton}
				disabled={busy}
				onClick={onBack}
			>
				{t("phone.later")}
			</button>
		</section>
	);
}

function WithdrawPopup({ onClose }: { readonly onClose: () => void }) {
	const { t } = useI18n();
	const { expire } = useSession();
	const { account, showResult } = useEntry();
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const withdraw = () => {
		if (account === null) return;
		setBusy(true);
		setFailed(false);
		account.withdraw().then(
			() => {
				showResult("withdrawn");
				expire();
			},
			(error: unknown) => {
				setBusy(false);
				if (sessionRefused(error)) expire();
				else setFailed(true);
			},
		);
	};
	return (
		<Popup
			title={t("profile.withdraw.title")}
			onClose={busy ? () => undefined : onClose}
			testId="withdraw-popup"
			footer={
				<>
					<button
						type="button"
						className={primaryButton}
						data-action="primary"
						disabled={busy}
						aria-busy={busy}
						onClick={withdraw}
					>
						{busy ? <Spinner /> : null}
						{busy
							? t("profile.withdraw.working")
							: t("profile.withdraw.confirm")}
					</button>
					<button
						type="button"
						className={secondaryButton}
						disabled={busy}
						onClick={onClose}
					>
						{t("profile.withdraw.cancel")}
					</button>
				</>
			}
		>
			<div className="flex flex-col gap-3">
				<p className="text-base text-ink">{t("profile.withdraw.body")}</p>
				{failed ? (
					<p role="alert" className="text-base text-negative">
						{t("profile.withdraw.failed")}
					</p>
				) : null}
			</div>
		</Popup>
	);
}

export function ProfileScreen({
	requestToken = requestPhoneToken,
}: {
	readonly requestToken?: PhoneTokenRequest;
}) {
	const { t } = useI18n();
	const { state } = useSession();
	const { check, loadLegal, showResult } = useEntry();
	const navigate = useNavigate();
	const headingId = useId();
	const [view, setView] = useState<"tab" | "phone">("tab");
	const [linkedHint, setLinkedHint] = useState<string | null>(null);
	const [linked, setLinked] = useState(false);
	const [withdrawing, setWithdrawing] = useState(false);
	if (state.status !== "signed-in") return null;
	const member = state.session.member;
	const onRoster = check !== null && check.consent !== "not_required";
	const phoneHint = linked ? linkedHint : (check?.phoneHint ?? null);
	const phoneLinked = linked || phoneHint !== null;
	if (view === "phone") {
		return (
			<PhonePurpose
				requestToken={requestToken}
				onBack={() => setView("tab")}
				onLinked={(hint) => {
					setLinked(true);
					setLinkedHint(hint);
					setView("tab");
					showResult("phone-linked");
				}}
			/>
		);
	}
	return (
		<section
			aria-labelledby={headingId}
			className="flex flex-col gap-4 px-4 pt-5 pb-8"
			data-testid="profile"
		>
			<header className="flex flex-col gap-0.5">
				<h1 id={headingId} className="text-xl font-semibold text-ink">
					{member.displayName}
				</h1>
				<p className="text-sm text-ink-muted" data-testid="profile-role">
					{t(`role.${member.role}`)}
				</p>
			</header>
			{onRoster ? (
				<Section title={t("profile.phone.title")} testId="profile-phone">
					<p className="text-base text-ink" data-testid="profile-phone-state">
						{phoneLinked
							? t("profile.phone.linked", { hint: phoneHint ?? "" })
							: t("profile.phone.none")}
					</p>
					<button
						type="button"
						className={primaryButton}
						data-action="primary"
						onClick={() => setView("phone")}
					>
						{t("profile.phone.link")}
					</button>
				</Section>
			) : null}
			<Section title={t("notify.title")} testId="profile-notifications">
				<p className="text-base text-ink">{t("notify.profileBody")}</p>
				<button
					type="button"
					className={secondaryButton}
					onClick={() => navigate(TEAM_PATHS.notifications)}
				>
					{t("notify.open")}
				</button>
			</Section>
			<Section title={t("profile.legal.title")} testId="profile-legal">
				<LegalButtons load={loadLegal} />
			</Section>
			{onRoster ? (
				<Section title={t("profile.consent.title")} testId="profile-consent">
					<p className="text-base text-ink">{t("profile.consent.body")}</p>
					<button
						type="button"
						className={dangerButton}
						onClick={() => setWithdrawing(true)}
					>
						{t("profile.withdraw")}
					</button>
				</Section>
			) : null}
			{withdrawing ? (
				<WithdrawPopup onClose={() => setWithdrawing(false)} />
			) : null}
		</section>
	);
}
