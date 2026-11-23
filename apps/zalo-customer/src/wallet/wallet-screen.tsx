import type {
	ClaimRecord,
	ClaimState,
	LedgerEntry,
	LedgerState,
	LoyaltyClient,
	Wallet,
} from "@fnb/zalo-mini/loyalty";
import { useI18n } from "@fnb/zalo-mini/react";
import { type ReactNode, useCallback, useEffect, useId, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { BillsToConfirmCard } from "../bills/bill-confirm";
import { claimReasonKey } from "../claim/model";
import { useCustomerData, useLoad } from "../data/customer-data";
import { shownDate, shownInstant } from "../data/dates";
import { useNow } from "../data/use-now";
import { JoinActions } from "../home/join-actions";
import { programmeTexts } from "../home/programme";
import {
	Badge,
	Card,
	Failed,
	Loading,
	primaryButton,
	rowButton,
	Screen,
	secondaryButton,
} from "../ui";
import { StampsRing } from "./stamps-ring";

/**
 * ADR-047: a credit is spendable until the instant it ends (the midnight that
 * closes its last valid day), not until the nightly run. While the wallet is
 * open past that instant the notice of it is stale, so it is hidden and the
 * wallet is read again once, and the balance then follows the server.
 */
export function creditStillValid(
	expiresAt: number | null,
	now: number,
): boolean {
	return expiresAt === null || now < expiresAt;
}

function useReloadWhenEnded(
	instants: readonly (number | null)[],
	now: number,
	onChanged: () => void,
): void {
	const ended = instants.some(
		(instant) => instant !== null && !creditStillValid(instant, now),
	);
	const reloaded = useRef(false);
	useEffect(() => {
		if (ended && !reloaded.current) {
			reloaded.current = true;
			onChanged();
		}
	}, [ended, onChanged]);
}

const STATE_TONES: Readonly<
	Record<LedgerState, "pending" | "positive" | "negative">
> = {
	pending: "pending",
	confirmed: "positive",
	reversed: "negative",
};

const CLAIM_TONES: Readonly<
	Record<ClaimState, "pending" | "positive" | "negative" | "neutral">
> = {
	pending: "pending",
	matched: "positive",
	queued: "pending",
	rejected: "negative",
	expired: "neutral",
};

function signed(value: number): string {
	return value > 0 ? `+${value}` : String(value);
}

export const RELEASED_REASON = "redemption_released";

export function entryTitleKey(entry: LedgerEntry): string {
	if (entry.kind === "adjust" && entry.reason === RELEASED_REASON)
		return "wallet.kind.returned";
	if (entry.kind === "earn")
		return entry.storeName === null ? "wallet.kind.earn" : "wallet.kind.earnAt";
	return `wallet.kind.${entry.kind}`;
}

function HistoryItem({ entry }: { readonly entry: LedgerEntry }) {
	const { t } = useI18n();
	const amounts = [
		entry.stamps === 0
			? null
			: t("wallet.stampsDelta", { count: signed(entry.stamps) }),
		entry.points === 0
			? null
			: t("wallet.pointsDelta", { count: signed(entry.points) }),
	].filter((part): part is string => part !== null);
	return (
		<li
			className="flex flex-col gap-1 rounded-xl bg-surface-raised px-4 py-3"
			data-testid="history-item"
			data-state={entry.state}
		>
			<div className="flex items-start justify-between gap-3">
				<span className="text-base font-semibold text-ink">
					{t(entryTitleKey(entry), { store: entry.storeName ?? "" })}
				</span>
				<Badge tone={STATE_TONES[entry.state]}>
					{t(`wallet.state.${entry.state}`)}
				</Badge>
			</div>
			<span className="text-base text-ink">{amounts.join(" · ")}</span>
			<span className="text-sm text-ink-muted">
				{[
					shownInstant(entry.at),
					entry.matchedPath === null || entry.reason === RELEASED_REASON
						? null
						: t(`wallet.path.${entry.matchedPath}`),
					entry.receiptNo === null
						? null
						: t("wallet.receipt", { receipt: entry.receiptNo }),
				]
					.filter((part): part is string => part !== null && part !== "")
					.join(" · ")}
			</span>
		</li>
	);
}

function ClaimItem({ claim }: { readonly claim: ClaimRecord }) {
	const { t } = useI18n();
	return (
		<li
			className="flex flex-col gap-1 rounded-xl bg-surface-raised px-4 py-3"
			data-testid="claim-item"
			data-state={claim.state}
		>
			<div className="flex items-start justify-between gap-3">
				<span className="text-base font-semibold text-ink">
					{t("wallet.receipt", { receipt: claim.receiptNo })}
				</span>
				<Badge tone={CLAIM_TONES[claim.state]}>
					{t(`claim.state.${claim.state}`)}
				</Badge>
			</div>
			<span className="text-sm text-ink-muted">
				{t("wallet.claimMeta", {
					store: claim.storeName,
					date: shownDate(claim.businessDate),
				})}
			</span>
			{claim.reason === null ? null : (
				<span className="text-sm text-ink-muted">
					{t(claimReasonKey(claim.reason))}
				</span>
			)}
		</li>
	);
}

export function MemberCardView({ wallet }: { readonly wallet: Wallet }) {
	const { t } = useI18n();
	const card = wallet.card;
	return (
		<section
			className="flex flex-col gap-2 rounded-2xl bg-accent p-4 text-accent-ink"
			data-testid="member-card"
			aria-label={t("wallet.cardLabel")}
		>
			<p className="text-sm" data-testid="card-programme">
				{card.programmeName}
			</p>
			<p className="text-xl font-semibold" data-testid="card-name">
				{card.displayName}
			</p>
			<p className="text-base" data-testid="card-phone">
				{card.phoneMasked}
			</p>
			<div className="flex flex-wrap justify-between gap-2 text-sm">
				<span>
					{t("wallet.memberSince", { date: shownDate(card.memberSince) })}
				</span>
				<span data-testid="card-purchases">
					{t("wallet.purchases", { count: card.purchases })}
				</span>
			</div>
		</section>
	);
}

function WalletView({
	wallet,
	onChanged,
}: {
	readonly wallet: Wallet;
	readonly onChanged: () => void;
}) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const historyId = useId();
	const claimsId = useId();
	const rewardsId = useId();
	const now = useNow(30_000);
	useReloadWhenEnded(
		[
			...wallet.stampCards.map((card) => card.expiresAt),
			wallet.points.expiring?.expiresAt ?? null,
		],
		now,
		onChanged,
	);
	const expiring =
		wallet.points.expiring !== null &&
		creditStillValid(wallet.points.expiring.expiresAt, now)
			? wallet.points.expiring
			: null;
	return (
		<Screen testId="wallet">
			<h1 className="text-xl font-semibold text-ink">{t("wallet.title")}</h1>
			<MemberCardView wallet={wallet} />
			<BillsToConfirmCard
				bills={wallet.billsToConfirm}
				onAnswered={onChanged}
			/>
			{wallet.stampCards.map((card) => (
				<Card key={card.id} testId="stamp-card">
					<div className="flex items-center gap-4">
						<StampsRing
							stamps={card.stamps}
							pending={card.pending}
							perCard={card.stampsPerCard}
						/>
						<div className="flex min-w-0 flex-col gap-1">
							<p
								className="text-base font-semibold text-ink"
								data-testid="stamp-count"
							>
								{t("wallet.stamps", {
									stamps: card.stamps,
									total: card.stampsPerCard,
								})}
							</p>
							<p className="text-sm text-ink">{card.name}</p>
							{card.pending > 0 ? (
								<p className="text-sm text-ink" data-testid="stamps-pending">
									{t("wallet.stampsPending", { count: card.pending })}
								</p>
							) : null}
							{card.validThrough === null ||
							!creditStillValid(card.expiresAt, now) ? null : (
								<p
									className="text-sm text-ink-muted"
									data-testid="stamps-valid-through"
								>
									{t("wallet.stampsValidThrough", {
										date: shownDate(card.validThrough),
									})}
								</p>
							)}
						</div>
					</div>
				</Card>
			))}
			<Card testId="points">
				<div className="flex items-baseline justify-between gap-3">
					<span className="text-base text-ink">{t("wallet.points")}</span>
					<span
						className="text-2xl font-semibold text-ink"
						data-testid="points-balance"
					>
						{wallet.points.balance}
					</span>
				</div>
				{wallet.points.pending > 0 ? (
					<p className="text-sm text-ink" data-testid="points-pending">
						{t("wallet.pointsPending", { count: wallet.points.pending })}
					</p>
				) : null}
				{expiring === null ? null : (
					<p className="text-sm text-ink-muted" data-testid="points-expiring">
						{t("wallet.pointsValidThrough", {
							count: expiring.points,
							date: shownDate(expiring.validThrough),
						})}
					</p>
				)}
				{wallet.tier === null ? null : (
					<p className="text-base text-ink" data-testid="tier">
						{wallet.tier.nextName === null || wallet.tier.pointsToNext === null
							? t("wallet.tierTop", { tier: wallet.tier.name })
							: t("wallet.tier", {
									tier: wallet.tier.name,
									next: wallet.tier.nextName,
									count: wallet.tier.pointsToNext,
								})}
					</p>
				)}
			</Card>
			<div className="flex flex-col gap-2">
				<button
					type="button"
					className={primaryButton}
					onClick={() => navigate("/ma-thanh-vien")}
				>
					{t("wallet.showCode")}
				</button>
				<button
					type="button"
					className={secondaryButton}
					onClick={() => navigate("/nhan-diem")}
				>
					{t("home.claim")}
				</button>
			</div>
			<section
				aria-labelledby={rewardsId}
				className="flex flex-col gap-2"
				data-testid="rewards-entry"
			>
				<h2 id={rewardsId} className="text-lg font-semibold text-ink">
					{t("reward.section")}
				</h2>
				<button
					type="button"
					className={rowButton}
					onClick={() => navigate("/doi-qua")}
				>
					{t("reward.open")}
				</button>
				<button
					type="button"
					className={rowButton}
					onClick={() => navigate("/vi-voucher")}
				>
					{t("voucher.wallet")}
				</button>
			</section>
			{wallet.claims.length === 0 ? null : (
				<section aria-labelledby={claimsId} className="flex flex-col gap-2">
					<h2 id={claimsId} className="text-lg font-semibold text-ink">
						{t("wallet.claims")}
					</h2>
					<ul className="flex flex-col gap-2">
						{wallet.claims.map((claim) => (
							<ClaimItem key={claim.id} claim={claim} />
						))}
					</ul>
				</section>
			)}
			<section aria-labelledby={historyId} className="flex flex-col gap-2">
				<h2 id={historyId} className="text-lg font-semibold text-ink">
					{t("wallet.history")}
				</h2>
				{wallet.history.length === 0 ? (
					<p className="text-base text-ink-muted">{t("wallet.noHistory")}</p>
				) : (
					<ul className="flex flex-col gap-2" data-testid="history">
						{wallet.history.map((entry) => (
							<HistoryItem key={entry.id} entry={entry} />
						))}
					</ul>
				)}
			</section>
		</Screen>
	);
}

export function JoinPrompt({ next }: { readonly next: "card" | "claim" }) {
	const { t } = useI18n();
	const { home } = useCustomerData();
	const programme = home.status === "ready" ? home.data.programme : null;
	return (
		<Screen testId="join-prompt">
			<h1 className="text-xl font-semibold text-ink">
				{t("wallet.notMemberTitle")}
			</h1>
			<p className="text-base text-ink">
				{programme === null
					? t("wallet.notMemberBody")
					: programmeTexts(programme, t).summary}
			</p>
			<JoinActions next={next} claim={false} />
		</Screen>
	);
}

function MemberWallet() {
	const load = useCallback((client: LoyaltyClient) => client.wallet(), []);
	const { state, reload } = useLoad(load);
	if (state.status === "loading") return <Loading />;
	if (state.status === "failed")
		return <Failed failure={state.failure} onRetry={reload} />;
	return <WalletView wallet={state.data} onChanged={reload} />;
}

export function MemberOnly({
	next,
	children,
}: {
	readonly next: "card" | "claim";
	readonly children: ReactNode;
}) {
	const { member, session, sessionState, retrySession } = useCustomerData();
	if (sessionState.status === "failed")
		return (
			<Failed
				failure={sessionState.reason === "network" ? "network" : "unknown"}
				onRetry={retrySession}
			/>
		);
	if (session === null) return <Loading />;
	return member ? children : <JoinPrompt next={next} />;
}

export function WalletScreen() {
	return (
		<MemberOnly next="card">
			<MemberWallet />
		</MemberOnly>
	);
}
