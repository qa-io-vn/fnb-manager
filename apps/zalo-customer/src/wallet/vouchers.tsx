import type {
	CustomerStore,
	LoyaltyClient,
	Reward,
	Voucher,
} from "@fnb/zalo-mini/loyalty";
import { Popup, useI18n } from "@fnb/zalo-mini/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useCustomerData, useLoad } from "../data/customer-data";
import { shownInstant } from "../data/dates";
import { useStoreLink } from "../data/store-link";
import { useNow } from "../data/use-now";
import { storeOrOnly } from "../home/model";
import {
	BackButton,
	Badge,
	Card,
	Failed,
	failureKey,
	Loading,
	NoStores,
	primaryButton,
	Screen,
	Spinner,
	secondaryButton,
} from "../ui";
import { StorePicker } from "./member-code-screen";
import { QrCode } from "./qr";
import {
	costText,
	holdAnnouncement,
	reasonText,
	refusalText,
	rewardCost,
	rewardKindText,
	storeNames,
	timeLeft,
	VOUCHER_POLL_MS,
	VOUCHER_TONES,
} from "./rewards";
import { MemberOnly } from "./wallet-screen";

export const REWARDS_PATH = "/doi-qua";
export const VOUCHERS_PATH = "/vi-voucher";

export function voucherPath(id: string): string {
	return `/voucher/${encodeURIComponent(id)}`;
}

function useVouchers() {
	const load = useCallback((client: LoyaltyClient) => client.vouchers(), []);
	const result = useLoad(load);
	const { reload } = result;
	useEffect(() => {
		const onVisible = () => {
			if (document.visibilityState === "visible") reload();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => document.removeEventListener("visibilitychange", onVisible);
	}, [reload]);
	return result;
}

function RewardItem({
	reward,
	stores,
	onRedeem,
}: {
	readonly reward: Reward;
	readonly stores: readonly CustomerStore[];
	readonly onRedeem: (reward: Reward) => void;
}) {
	const { t, language } = useI18n();
	const navigate = useNavigate();
	const titleId = useId();
	const reason = reasonText(reward, t);
	const onlyAt = storeNames(reward.storeCodes, stores);
	return (
		<li>
			<Card labelledBy={titleId} testId="reward">
				<div className="flex items-start justify-between gap-3">
					<h2 id={titleId} className="text-lg font-semibold text-ink">
						{reward.name}
					</h2>
					<span
						className="shrink-0 rounded-full bg-neutral-soft px-2 py-0.5 text-sm text-ink"
						data-testid="reward-cost"
					>
						{costText(rewardCost(reward), t)}
					</span>
				</div>
				<p className="text-base text-ink" data-testid="reward-kind">
					{rewardKindText(reward, t, language)}
				</p>
				{reward.description === null ? null : (
					<p className="text-sm text-ink-muted">{reward.description}</p>
				)}
				{onlyAt === null ? null : (
					<p className="text-sm text-ink-muted">
						{t("reward.onlyAt", { stores: onlyAt })}
					</p>
				)}
				<p
					className={`text-sm ${reward.available ? "text-positive" : "text-ink"}`}
					data-testid="reward-state"
					data-available={reward.available}
				>
					{reason ?? t("reward.ready")}
				</p>
				{reward.liveRedemptionId === null ? (
					<button
						type="button"
						className={secondaryButton}
						disabled={!reward.available}
						onClick={() => onRedeem(reward)}
					>
						{t("reward.redeem")}
					</button>
				) : (
					<button
						type="button"
						className={secondaryButton}
						onClick={() => navigate(voucherPath(reward.liveRedemptionId ?? ""))}
					>
						{t("voucher.show")}
					</button>
				)}
			</Card>
		</li>
	);
}

function RewardList({
	store,
	stores,
}: {
	readonly store: CustomerStore;
	readonly stores: readonly CustomerStore[];
}) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { client, recover } = useCustomerData();
	const load = useCallback(
		(active: LoyaltyClient) => active.rewards(store.code),
		[store.code],
	);
	const { state, reload } = useLoad(load);
	const [confirming, setConfirming] = useState<Reward | null>(null);
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const redeem = async () => {
		if (confirming === null || client === null || busy) return;
		setBusy(true);
		setProblem(null);
		try {
			const result = await client.redeem(confirming.id, store.code);
			if (!mounted.current) return;
			if (result.outcome === "held") {
				navigate(voucherPath(result.voucher.redemptionId), { replace: true });
				return;
			}
			setProblem(refusalText(result.refusal, t));
			setConfirming(null);
			reload();
		} catch (error) {
			if (!mounted.current) return;
			setProblem(t(failureKey(recover(error))));
		} finally {
			if (mounted.current) setBusy(false);
		}
	};

	if (state.status === "loading") return <Loading />;
	if (state.status === "failed")
		return <Failed failure={state.failure} onRetry={reload} />;
	return (
		<>
			{problem === null || confirming !== null ? null : (
				<p
					role="alert"
					className="rounded-xl bg-negative-soft px-4 py-3 text-base text-ink"
					data-testid="redeem-problem"
				>
					{problem}
				</p>
			)}
			{state.data.length === 0 ? (
				<p className="text-base text-ink" data-testid="rewards-empty">
					{t("reward.empty")}
				</p>
			) : (
				<ul className="flex flex-col gap-3" data-testid="rewards">
					{state.data.map((reward) => (
						<RewardItem
							key={reward.id}
							reward={reward}
							stores={stores}
							onRedeem={(chosen) => {
								setProblem(null);
								setConfirming(chosen);
							}}
						/>
					))}
				</ul>
			)}
			{confirming === null ? null : (
				<Popup
					title={t("reward.confirm.title", { name: confirming.name })}
					onClose={() => {
						if (!busy) setConfirming(null);
					}}
					testId="redeem-confirm"
					footer={
						<div className="flex flex-col gap-2">
							<button
								type="button"
								className={primaryButton}
								disabled={busy}
								aria-busy={busy}
								onClick={redeem}
							>
								{busy ? <Spinner /> : null}
								{busy ? t("reward.confirm.busy") : t("reward.confirm.action")}
							</button>
							<button
								type="button"
								className={secondaryButton}
								disabled={busy}
								onClick={() => setConfirming(null)}
							>
								{t("reward.confirm.cancel")}
							</button>
						</div>
					}
				>
					<div className="flex flex-col gap-2">
						{problem === null ? null : (
							<p
								role="alert"
								className="rounded-xl bg-negative-soft px-4 py-3 text-base text-ink"
								data-testid="redeem-problem"
							>
								{problem}
							</p>
						)}
						<p className="text-base text-ink" data-testid="redeem-cost">
							{t("reward.confirm.body", {
								cost: costText(rewardCost(confirming), t),
								store: store.name,
							})}
						</p>
						<p className="text-sm text-ink-muted">
							{t("reward.confirm.hold", { hours: confirming.holdHours })}
						</p>
					</div>
				</Popup>
			)}
		</>
	);
}

function RewardsView() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { home, reloadHome } = useCustomerData();
	const { currentStore, chooseStore } = useStoreLink();
	if (home.status === "loading") return <Loading />;
	if (home.status === "failed")
		return <Failed failure={home.failure} onRetry={reloadHome} />;
	const stores = home.data.stores;
	const store = storeOrOnly(stores, currentStore);
	return (
		<Screen testId="rewards-screen">
			<BackButton />
			<h1 className="text-xl font-semibold text-ink">{t("reward.title")}</h1>
			<p className="text-base text-ink">{t("reward.intro")}</p>
			{stores.length === 0 ? (
				<NoStores />
			) : (
				<StorePicker
					stores={stores}
					value={store?.code ?? null}
					onChange={chooseStore}
					label={t("reward.storeLabel")}
					testId="reward-store-picker"
				/>
			)}
			{stores.length === 0 ? null : store === null ? (
				<p className="text-base text-ink" data-testid="reward-pick-first">
					{t("reward.pickFirst")}
				</p>
			) : (
				<RewardList key={store.code} store={store} stores={stores} />
			)}
			<button
				type="button"
				className={secondaryButton}
				onClick={() => navigate(VOUCHERS_PATH)}
			>
				{t("voucher.wallet")}
			</button>
		</Screen>
	);
}

export function RewardsScreen() {
	return (
		<MemberOnly next="card">
			<RewardsView />
		</MemberOnly>
	);
}

function VoucherFacts({
	voucher,
	now,
}: {
	readonly voucher: Voucher;
	readonly now: number;
}) {
	const { t } = useI18n();
	const cost = costText(
		{ stamps: voucher.stampsSpent, points: voucher.pointsSpent },
		t,
	);
	switch (voucher.state) {
		case "held":
			return voucher.holdExpiresAt === null ? null : (
				<p className="text-base text-ink" data-testid="voucher-time-left">
					{t("voucher.timeLeft", {
						time: timeLeft(voucher.holdExpiresAt, now),
					})}
				</p>
			);
		case "used":
			return (
				<p className="text-base text-ink" data-testid="voucher-used">
					{voucher.confirmedAt === null
						? t("voucher.state.used")
						: t("voucher.usedAt", {
								time: shownInstant(new Date(voucher.confirmedAt).toISOString()),
							})}
				</p>
			);
		case "returned":
			return (
				<p className="text-base text-ink" data-testid="voucher-returned">
					{t("voucher.returnedBody", { cost })}
				</p>
			);
		case "expired":
			return (
				<p className="text-base text-ink">
					{t("voucher.expiredBody", { cost })}
				</p>
			);
		case "cancelled":
			return <p className="text-base text-ink">{t("voucher.cancelledBody")}</p>;
	}
}

function VoucherItem({
	voucher,
	now,
}: {
	readonly voucher: Voucher;
	readonly now: number;
}) {
	const { t } = useI18n();
	const navigate = useNavigate();
	return (
		<li
			className="flex flex-col gap-2 rounded-xl bg-surface-raised px-4 py-3"
			data-testid="voucher-item"
			data-state={voucher.state}
		>
			<div className="flex items-start justify-between gap-3">
				<span className="text-base font-semibold text-ink">{voucher.name}</span>
				<Badge tone={VOUCHER_TONES[voucher.state]}>
					{t(`voucher.state.${voucher.state}`)}
				</Badge>
			</div>
			{voucher.storeName === null ? null : (
				<span className="text-sm text-ink-muted">
					{t("voucher.at", { store: voucher.storeName })}
				</span>
			)}
			<VoucherFacts voucher={voucher} now={now} />
			{voucher.state === "held" ? (
				<button
					type="button"
					className={secondaryButton}
					onClick={() => navigate(voucherPath(voucher.redemptionId))}
				>
					{t("voucher.show")}
				</button>
			) : null}
		</li>
	);
}

function VoucherList() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { state, reload } = useVouchers();
	const now = useNow();
	const ended =
		state.status === "ready"
			? state.data.filter(
					(voucher) =>
						voucher.state === "held" &&
						voucher.holdExpiresAt !== null &&
						now >= voucher.holdExpiresAt,
				).length
			: 0;
	useEffect(() => {
		if (ended > 0) reload();
	}, [ended, reload]);
	return (
		<Screen testId="vouchers-screen">
			<BackButton />
			<h1 className="text-xl font-semibold text-ink">{t("voucher.title")}</h1>
			{state.status === "loading" ? (
				<Loading />
			) : state.status === "failed" ? (
				<Failed failure={state.failure} onRetry={reload} />
			) : state.data.length === 0 ? (
				<p className="text-base text-ink" data-testid="vouchers-empty">
					{t("voucher.empty")}
				</p>
			) : (
				<ul className="flex flex-col gap-2" data-testid="vouchers">
					{state.data.map((voucher) => (
						<VoucherItem
							key={voucher.redemptionId}
							voucher={voucher}
							now={now}
						/>
					))}
				</ul>
			)}
			<button
				type="button"
				className={primaryButton}
				onClick={() => navigate(REWARDS_PATH)}
			>
				{t("reward.open")}
			</button>
		</Screen>
	);
}

export function VouchersScreen() {
	return (
		<MemberOnly next="card">
			<VoucherList />
		</MemberOnly>
	);
}

function HeldCode({
	voucher,
	now,
}: {
	readonly voucher: Voucher;
	readonly now: number;
}) {
	const { t } = useI18n();
	const instructionId = useId();
	if (voucher.code === null || voucher.qrPayload === null) return null;
	return (
		<Card testId="voucher-code-card">
			<p className="text-base text-ink" id={instructionId}>
				{t("voucher.instruction")}
			</p>
			<div className="flex justify-center">
				<QrCode
					payload={voucher.qrPayload}
					label={t("voucher.qrLabel", { name: voucher.name })}
					dimmed={false}
					testId="voucher-qr"
				/>
			</div>
			<p
				className="text-center font-mono text-3xl font-semibold tracking-widest text-ink"
				aria-describedby={instructionId}
				data-testid="voucher-code"
			>
				{voucher.code}
			</p>
			{voucher.holdExpiresAt === null ? null : (
				<>
					<p
						className="text-center text-base text-ink"
						role="timer"
						aria-live="off"
						data-testid="voucher-countdown"
					>
						{t("voucher.timeLeft", {
							time: timeLeft(voucher.holdExpiresAt, now),
						})}
					</p>
					<p className="text-center text-sm text-ink-muted">
						{t("voucher.until", {
							time: shownInstant(new Date(voucher.holdExpiresAt).toISOString()),
						})}
					</p>
				</>
			)}
			{voucher.verified ? (
				<p className="text-sm text-ink" data-testid="voucher-verified">
					{t("voucher.verified")}
				</p>
			) : null}
		</Card>
	);
}

/**
 * The one place a screen reader hears the hold: polite, in whole minutes, and
 * kept in the page after the hold ends so that the end is announced once. The
 * seconds counter above stays silent.
 */
function HoldAnnouncement({
	voucher,
	now,
}: {
	readonly voucher: Voucher;
	readonly now: number;
}) {
	const { t } = useI18n();
	return (
		<p
			className="sr-only"
			role="status"
			aria-live="polite"
			aria-atomic="true"
			data-testid="voucher-announce"
		>
			{holdAnnouncement(voucher, now, t)}
		</p>
	);
}

function VoucherView() {
	const { t, language } = useI18n();
	const navigate = useNavigate();
	const { id } = useParams();
	const { state, reload } = useVouchers();
	const now = useNow();
	const voucher =
		state.status === "ready"
			? (state.data.find((entry) => entry.redemptionId === id) ?? null)
			: null;
	const held = voucher?.state === "held";
	const expiresAt = voucher?.holdExpiresAt ?? null;
	useEffect(() => {
		if (!held) return;
		const timer = setInterval(reload, VOUCHER_POLL_MS);
		return () => clearInterval(timer);
	}, [held, reload]);
	const ended = held && expiresAt !== null && now >= expiresAt;
	useEffect(() => {
		if (ended) reload();
	}, [ended, reload]);
	if (state.status === "loading") return <Loading />;
	if (state.status === "failed")
		return <Failed failure={state.failure} onRetry={reload} />;
	return (
		<Screen testId="voucher-screen">
			<BackButton to={VOUCHERS_PATH} />
			{voucher === null ? (
				<p className="text-base text-ink" data-testid="voucher-missing">
					{t("voucher.missing")}
				</p>
			) : (
				<>
					<div className="flex items-start justify-between gap-3">
						<h1 className="text-xl font-semibold text-ink">{voucher.name}</h1>
						<Badge tone={VOUCHER_TONES[voucher.state]}>
							<span data-testid="voucher-state" data-state={voucher.state}>
								{t(`voucher.state.${voucher.state}`)}
							</span>
						</Badge>
					</div>
					<p className="text-base text-ink">
						{rewardKindText(voucher, t, language)}
					</p>
					{voucher.storeName === null ? null : (
						<p className="text-base text-ink">
							{t("voucher.at", { store: voucher.storeName })}
						</p>
					)}
					<HoldAnnouncement voucher={voucher} now={now} />
					{voucher.state === "held" && !ended ? (
						<HeldCode voucher={voucher} now={now} />
					) : (
						<VoucherFacts voucher={voucher} now={now} />
					)}
				</>
			)}
			<button
				type="button"
				className={secondaryButton}
				onClick={() => navigate(VOUCHERS_PATH)}
			>
				{t("voucher.wallet")}
			</button>
		</Screen>
	);
}

export function VoucherScreen() {
	return (
		<MemberOnly next="card">
			<VoucherView />
		</MemberOnly>
	);
}
