import type {
	DeletionRequest,
	DeletionStatus,
	LoyaltyClient,
	Wallet,
} from "@fnb/zalo-mini/loyalty";
import { Popup, ResultModal, useI18n } from "@fnb/zalo-mini/react";
import { useCallback, useId, useState } from "react";
import { useCustomerData, useLoad } from "../data/customer-data";
import { isoDateIn, shownDate, shownInstant } from "../data/dates";
import type { Failure } from "../data/source";
import { JoinActions } from "../home/join-actions";
import { LegalButtons } from "../legal/legal-popups";
import {
	Badge,
	Card,
	CheckControl,
	dangerButton,
	Failed,
	failureKey,
	Loading,
	primaryButton,
	Screen,
	Spinner,
	secondaryButton,
} from "../ui";

type Confirm = "stop-marketing" | "delete" | null;

const DELETION_TONES: Readonly<
	Record<DeletionStatus, "pending" | "positive" | "negative">
> = {
	received: "pending",
	in_progress: "pending",
	completed: "positive",
	rejected: "negative",
};

export function deletionReference(request: DeletionRequest): string {
	return request.requestId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function deletionOpen(request: DeletionRequest): boolean {
	return request.status === "received" || request.status === "in_progress";
}

export function shownDeletion(
	fromWallet: DeletionRequest | null,
	remembered: DeletionRequest | null,
): DeletionRequest | null {
	if (remembered === null) return fromWallet;
	if (fromWallet === null) return remembered;
	if (fromWallet.requestId === remembered.requestId) return fromWallet;
	return Date.parse(remembered.requestedAt) > Date.parse(fromWallet.requestedAt)
		? remembered
		: fromWallet;
}

function dueDate(iso: string): string {
	return shownDate(isoDateIn(Date.parse(iso)));
}

function DeletionDeadlines({ request }: { readonly request: DeletionRequest }) {
	const { t } = useI18n();
	const { firstResponseDueAt, completionDueAt } = request;
	if (completionDueAt === null)
		return (
			<p className="text-body text-ink" data-testid="deletion-deadline">
				{t("settings.deleteDeadline")}
			</p>
		);
	return (
		<div className="flex flex-col gap-1" data-testid="deletion-deadline">
			{request.status === "received" && firstResponseDueAt !== null ? (
				<p className="text-body text-ink" data-testid="deletion-reply-by">
					{t("settings.deleteReplyBy", { date: dueDate(firstResponseDueAt) })}
				</p>
			) : null}
			<p className="text-body text-ink" data-testid="deletion-done-by">
				{t("settings.deleteDoneBy", { date: dueDate(completionDueAt) })}
			</p>
		</div>
	);
}

export function DeletionState({
	request,
}: {
	readonly request: DeletionRequest;
}) {
	const { t } = useI18n();
	return (
		<div className="flex flex-col gap-2" data-testid="deletion-state">
			<div className="flex flex-wrap items-center gap-2">
				<Badge tone={DELETION_TONES[request.status]}>
					<span data-testid="deletion-status" data-status={request.status}>
						{t(`settings.deleteState.${request.status}`)}
					</span>
				</Badge>
			</div>
			<p className="text-sm text-ink-muted" data-testid="deletion-requested">
				{t("settings.deleteRequested", {
					time: shownInstant(request.requestedAt),
				})}
				{" · "}
				{t("settings.deleteReference", {
					code: deletionReference(request),
				})}
			</p>
			{deletionOpen(request) ? (
				<>
					<DeletionDeadlines request={request} />
					<p className="text-body text-ink">{t("settings.deleteUntil")}</p>
				</>
			) : (
				<p className="text-body text-ink">
					{t(`settings.deleteStateBody.${request.status}`)}
				</p>
			)}
		</div>
	);
}

function MemberSettings({
	wallet,
	onChanged,
}: {
	readonly wallet: Wallet;
	readonly onChanged: () => void;
}) {
	const { t } = useI18n();
	const {
		client,
		recover,
		deletion: remembered,
		rememberDeletion,
	} = useCustomerData();
	const deletion = shownDeletion(wallet.deletionRequest, remembered);
	const [confirm, setConfirm] = useState<Confirm>(null);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<Failure | null>(null);
	const [result, setResult] = useState<string | null>(null);
	const [understood, setUnderstood] = useState(false);
	const marketingId = useId();
	const deleteId = useId();
	const ackId = useId();
	const close = useCallback(() => {
		setConfirm(null);
		setFailure(null);
		setUnderstood(false);
	}, []);

	const run = async (
		work: (active: LoyaltyClient) => Promise<void>,
		done: () => void,
	) => {
		if (client === null) return;
		setBusy(true);
		setFailure(null);
		try {
			await work(client);
			close();
			done();
		} catch (error) {
			setFailure(recover(error));
		} finally {
			setBusy(false);
		}
	};

	const stopMarketing = () =>
		run(
			async (active) => {
				await active.stopMarketing();
			},
			() => {
				setResult(t("settings.stopped"));
				onChanged();
			},
		);

	const requestDeletion = () =>
		run(
			async (active) => {
				rememberDeletion(await active.requestDeletion());
			},
			() => {
				setResult(t("settings.deleteSent"));
				onChanged();
			},
		);

	const deleting = confirm === "delete";
	return (
		<>
			<Card testId="settings-member">
				<p className="text-body font-semibold text-ink">
					{wallet.card.displayName}
				</p>
				<p className="text-body text-ink">{wallet.card.phoneMasked}</p>
			</Card>
			<Card labelledBy={marketingId} testId="settings-marketing">
				<h2 id={marketingId} className="text-lg font-semibold text-ink">
					{t("settings.marketing")}
				</h2>
				<p className="text-body text-ink" data-testid="marketing-state">
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
			<Card labelledBy={deleteId} testId="settings-delete">
				<h2 id={deleteId} className="text-lg font-semibold text-ink">
					{t("settings.delete")}
				</h2>
				{deletion !== null && deletionOpen(deletion) ? (
					<DeletionState request={deletion} />
				) : (
					<>
						{deletion === null ? null : <DeletionState request={deletion} />}
						<p className="text-body text-ink">{t("settings.deleteBody")}</p>
						<button
							type="button"
							className={dangerButton}
							onClick={() => setConfirm("delete")}
						>
							{t("settings.deleteAction")}
						</button>
					</>
				)}
			</Card>
			{confirm === null ? null : (
				<Popup
					title={
						deleting
							? t("settings.deleteConfirmTitle")
							: t("settings.stopConfirmTitle")
					}
					onClose={close}
					testId={deleting ? "delete-confirm" : "settings-confirm"}
					footer={
						<>
							<button
								type="button"
								className={deleting ? dangerButton : primaryButton}
								disabled={busy || (deleting && !understood)}
								aria-busy={busy}
								onClick={deleting ? requestDeletion : stopMarketing}
							>
								{busy ? <Spinner /> : null}
								{deleting
									? t("settings.deleteConfirm")
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
					{deleting ? (
						<div className="flex flex-col gap-3">
							<p className="text-body text-ink">
								{t("settings.deleteConfirmBody")}
							</p>
							<p className="text-body text-ink">
								{t("settings.deleteDeadline")}
							</p>
							<p className="text-body text-ink">{t("settings.deleteUntil")}</p>
							<div className="flex items-start gap-3">
								<CheckControl
									id={ackId}
									kind="checkbox"
									checked={understood}
									disabled={busy}
									testId="delete-understood"
									onChange={setUnderstood}
								/>
								<label htmlFor={ackId} className="pt-2 text-body text-ink">
									{t("settings.deleteAck")}
								</label>
							</div>
						</div>
					) : (
						<p className="text-body text-ink">
							{t("settings.stopConfirmBody")}
						</p>
					)}
					{failure === null ? null : (
						<p role="alert" className="pt-3 text-body text-negative">
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

function AccountPart() {
	const { t } = useI18n();
	const { member, session, sessionState, retrySession } = useCustomerData();
	if (sessionState.status === "failed")
		return (
			<Failed
				failure={sessionState.reason === "network" ? "network" : "unknown"}
				onRetry={retrySession}
			/>
		);
	if (session === null) return <Loading />;
	if (member) return <MemberPart />;
	return (
		<Card testId="settings-visitor">
			<p className="text-body text-ink">{t("settings.notMember")}</p>
			<JoinActions claim={false} />
		</Card>
	);
}

export function SettingsScreen() {
	const { t } = useI18n();
	return (
		<Screen testId="settings">
			<h1 className="text-xl font-semibold text-ink">{t("settings.title")}</h1>
			<AccountPart />
			<p className="text-sm text-ink-muted">{t("settings.language")}</p>
			<LegalButtons />
		</Screen>
	);
}
