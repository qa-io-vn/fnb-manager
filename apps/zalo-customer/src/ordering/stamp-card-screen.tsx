import type { NativeStampCard } from "@fnb/zalo-mini/ordering";
import { kitButton, useI18n } from "@fnb/zalo-mini/react";
import { useNavigate } from "react-router-dom";
import { useCustomerData } from "../data/customer-data";
import { isoDateIn, shownDate } from "../data/dates";
import { Failed, Loading } from "../ui";
import { ChevronRight, kicker } from "./parts";
import { StampSlots, useStampCard } from "./stamp-card";

// C07 Tích điểm (design spec 6.2; native-till.md 10): the stamp card of the customer's Zalo account, no phone needed:
// one stamp per drink of a completed order, a gift for every full card. The slots are drawn and stated in words; the
// gifts are used at the counter (owner decision D9 keeps the discount out of the basket). The member code and the
// receipt claim of the points programme stay reachable from here.

function entryKey(kind: string): string {
	return [
		"order_earned",
		"order_reversed",
		"reward_issued",
		"reward_used",
		"reward_returned",
		"reward_voided",
	].includes(kind)
		? `stamps.entry.${kind}`
		: "stamps.entry.other";
}

function signed(delta: number): string {
	return delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : "0";
}

function CardView({ card }: { readonly card: NativeStampCard }) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { home } = useCustomerData();
	const programme = home.status === "ready" ? home.data.programme : null;
	const left = Math.max(0, card.stampsPerReward - card.stamps);
	return (
		<section
			className="flex flex-col gap-4 px-4 py-5"
			data-testid="stamp-screen"
		>
			<section
				data-testid="stamp-card"
				className="flex flex-col gap-3 rounded-card bg-tone-1-soft p-4 shadow-card"
			>
				<div className="flex items-center justify-between gap-3">
					<h1 className="text-[19px] font-bold text-ink">
						{t("stamps.title")}
					</h1>
					<span
						className="text-[13px] font-bold text-ink"
						data-testid="stamp-count"
					>
						{t("stamps.count", {
							stamps: card.stamps,
							total: card.stampsPerReward,
						})}
					</span>
				</div>
				<StampSlots stamps={card.stamps} perReward={card.stampsPerReward} />
				<p className="sr-only">
					{t("stamps.words", {
						stamps: card.stamps,
						total: card.stampsPerReward,
						gift: card.stampsPerReward + 1,
					})}
				</p>
				<p className="text-body font-bold text-ink" data-testid="stamp-left">
					{card.rewards.length > 0
						? t("stamps.full", { reward: card.rewardName })
						: t("stamps.left", { left, reward: card.rewardName })}
				</p>
				<p className="text-[13px] text-ink">{t("stamps.rule")}</p>
			</section>
			<div className="grid grid-cols-2 gap-2">
				<button
					type="button"
					className={kitButton.secondary}
					onClick={() => navigate("/ma-thanh-vien")}
					data-testid="wallet-code"
				>
					{t("stamps.code")}
				</button>
				{programme === null ? null : (
					<button
						type="button"
						className={kitButton.secondary}
						onClick={() => navigate("/nhan-diem")}
						data-testid="wallet-claim"
					>
						{t("stamps.claim")}
					</button>
				)}
			</div>
			<section
				aria-labelledby="stamp-offers"
				className="flex flex-col gap-2"
				data-testid="offers-preview"
			>
				<h2 id="stamp-offers" className={kicker}>
					{t("stamps.offers")}
				</h2>
				{card.rewards.length === 0 ? (
					<p className="text-body text-ink-muted">{t("stamps.noOffers")}</p>
				) : (
					<ul className="flex flex-col gap-2">
						{card.rewards.map((reward) => (
							<li
								key={reward.id}
								className="flex flex-col gap-1 rounded-card-2xl border-card border-line/60 bg-surface-raised p-4"
								data-testid="offer-row"
								data-kind="reward"
							>
								<span className="text-[15px] font-bold text-ink">
									{card.rewardName}
								</span>
								<span className="text-[13px] text-ink-muted">
									{t("stamps.offerSince", {
										date: shownDate(isoDateIn(Date.parse(reward.issuedAt))),
									})}
								</span>
								<span className="text-[13px] text-ink">
									{t("stamps.offerUse")}
								</span>
							</li>
						))}
					</ul>
				)}
			</section>
			<section
				aria-labelledby="stamp-history"
				className="flex flex-col gap-2"
				data-testid="wallet-history"
			>
				<h2 id="stamp-history" className={kicker}>
					{t("stamps.history")}
				</h2>
				{card.history.length === 0 ? (
					<p className="text-body text-ink-muted">{t("stamps.noHistory")}</p>
				) : (
					<ul className="flex flex-col divide-y divide-line rounded-card-2xl border-card border-line/60 bg-surface-raised">
						{card.history.map((entry) => (
							<li
								key={`${entry.at}-${entry.kind}-${entry.balanceAfter}`}
								className="flex items-center justify-between gap-3 px-4 py-3"
								data-testid="stamp-entry"
								data-kind={entry.kind}
							>
								<span className="flex flex-col">
									<span className="text-[15px] text-ink">
										{t(entryKey(entry.kind))}
									</span>
									<span className="text-[13px] text-ink-muted">
										{[
											entry.orderNo === null
												? null
												: t("stamps.entryOrder", { number: entry.orderNo }),
											shownDate(isoDateIn(Date.parse(entry.at))),
										]
											.filter((part) => part !== null)
											.join(" · ")}
									</span>
								</span>
								<span className="text-[15px] font-bold text-ink">
									{t("stamps.delta", { delta: signed(entry.delta) })}
								</span>
							</li>
						))}
					</ul>
				)}
			</section>
			{programme === null ? null : (
				<button
					type="button"
					className="flex min-h-14 items-center gap-3 rounded-card-2xl border-card border-line/60 bg-surface-raised px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
					onClick={() => navigate("/the-thanh-vien/diem")}
					data-testid="programme-card-link"
				>
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="text-[15px] font-bold text-ink">
							{t("stamps.programmeCard")}
						</span>
						<span className="text-[13px] text-ink-muted">
							{t("stamps.programmeCardSub")}
						</span>
					</span>
					<ChevronRight />
				</button>
			)}
		</section>
	);
}

export function StampCardScreen() {
	const { t } = useI18n();
	const { load, reload } = useStampCard();
	if (load.status === "loading") return <Loading />;
	if (load.status === "failed")
		return <Failed failure="network" onRetry={reload} />;
	if (!load.card.enabled)
		return (
			<section className="px-4 py-5" data-testid="stamp-screen">
				<p className="text-body text-ink">{t("stamps.off")}</p>
			</section>
		);
	return <CardView card={load.card} />;
}
