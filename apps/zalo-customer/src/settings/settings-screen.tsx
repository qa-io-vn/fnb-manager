import type { LoyaltyClient, Wallet } from "@fnb/zalo-mini/loyalty";
import { Popup, ResultModal, useI18n } from "@fnb/zalo-mini/react";
import { useCallback, useId, useState } from "react";
import { useCustomerData, useLoad } from "../data/customer-data";
import type { Failure } from "../data/source";
import { JoinActions } from "../home/join-actions";
import { LegalButtons } from "../legal/legal-popups";
import {
	Card,
	dangerButton,
	Failed,
	failureKey,
	Loading,
	primaryButton,
	Screen,
	Spinner,
	secondaryButton,
} from "../ui";

type Confirm = "stop-marketing" | "leave" | null;

function MemberSettings({
	wallet,
	onChanged,
}: {
	readonly wallet: Wallet;
	readonly onChanged: () => void;
}) {
	const { t } = useI18n();
	const { client, recover } = useCustomerData();
	const [confirm, setConfirm] = useState<Confirm>(null);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<Failure | null>(null);
	const [result, setResult] = useState<string | null>(null);
	const [leaveRequested, setLeaveRequested] = useState(false);
	const marketingId = useId();
	const leaveId = useId();
	const close = useCallback(() => setConfirm(null), []);

	const run = async (
		work: (active: LoyaltyClient) => Promise<unknown>,
		done: () => void,
	) => {
		if (client === null) return;
		setBusy(true);
		setFailure(null);
		try {
			await work(client);
			setConfirm(null);
			done();
		} catch (error) {
			setFailure(recover(error));
		} finally {
			setBusy(false);
		}
	};

	const stopMarketing = () =>
		run(
			(active) => active.stopMarketing(),
			() => {
				setResult(t("settings.stopped"));
				onChanged();
			},
		);

	const leave = () =>
		run(
			(active) => active.requestDeletion(),
			() => {
				setLeaveRequested(true);
				setResult(t("settings.leaveSent"));
			},
		);

	return (
		<>
			<Card testId="settings-member">
				<p className="text-base font-semibold text-ink">
					{wallet.card.displayName}
				</p>
				<p className="text-base text-ink">{wallet.card.phoneMasked}</p>
			</Card>
			<Card labelledBy={marketingId} testId="settings-marketing">
				<h2 id={marketingId} className="text-lg font-semibold text-ink">
					{t("settings.marketing")}
				</h2>
				<p className="text-base text-ink" data-testid="marketing-state">
					{wallet.marketingConsent
						? t("settings.marketingOn")
						: t("settings.marketingOff")}
				</p>
				{wallet.marketingConsent ? (
					<button
						type="button"
						className={dangerButton}
						onClick={() => setConfirm("stop-marketing")}
					>
						{t("settings.stop")}
					</button>
				) : null}
			</Card>
			<Card labelledBy={leaveId} testId="settings-leave">
				<h2 id={leaveId} className="text-lg font-semibold text-ink">
					{t("settings.leave")}
				</h2>
				{leaveRequested ? (
					<p className="text-base text-ink" data-testid="leave-sent">
						{t("settings.leaveSent")}
					</p>
				) : (
					<>
						<p className="text-base text-ink">{t("settings.leaveBody")}</p>
						<button
							type="button"
							className={dangerButton}
							onClick={() => setConfirm("leave")}
						>
							{t("settings.leaveAction")}
						</button>
					</>
				)}
			</Card>
			{confirm === null ? null : (
				<Popup
					title={
						confirm === "leave"
							? t("settings.leaveConfirmTitle")
							: t("settings.stopConfirmTitle")
					}
					onClose={close}
					testId="settings-confirm"
					footer={
						<>
							<button
								type="button"
								className={primaryButton}
								disabled={busy}
								aria-busy={busy}
								onClick={confirm === "leave" ? leave : stopMarketing}
							>
								{busy ? <Spinner /> : null}
								{confirm === "leave"
									? t("settings.leaveConfirm")
									: t("settings.stopConfirm")}
							</button>
							<button
								type="button"
								className={secondaryButton}
								disabled={busy}
								onClick={close}
							>
								{t("settings.keep")}
							</button>
						</>
					}
				>
					<p className="text-base text-ink">
						{confirm === "leave"
							? t("settings.leaveConfirmBody")
							: t("settings.stopConfirmBody")}
					</p>
					{failure === null ? null : (
						<p role="alert" className="pt-3 text-base text-negative">
							{t(failureKey(failure))}
						</p>
					)}
				</Popup>
			)}
			{result === null ? null : (
				<ResultModal message={result} onDone={() => setResult(null)} />
			)}
		</>
	);
}

function MemberPart() {
	const load = useCallback((client: LoyaltyClient) => client.wallet(), []);
	const { state, reload } = useLoad(load);
	if (state.status === "loading") return <Loading />;
	if (state.status === "failed")
		return <Failed failure={state.failure} onRetry={reload} />;
	return <MemberSettings wallet={state.data} onChanged={reload} />;
}

export function SettingsScreen() {
	const { t } = useI18n();
	const { member, session } = useCustomerData();
	return (
		<Screen testId="settings">
			<h1 className="text-xl font-semibold text-ink">{t("settings.title")}</h1>
			{session === null ? null : member ? (
				<MemberPart />
			) : (
				<Card testId="settings-visitor">
					<p className="text-base text-ink">{t("settings.notMember")}</p>
					<JoinActions claim={false} />
				</Card>
			)}
			<p className="text-sm text-ink-muted">{t("settings.language")}</p>
			<LegalButtons />
		</Screen>
	);
}
