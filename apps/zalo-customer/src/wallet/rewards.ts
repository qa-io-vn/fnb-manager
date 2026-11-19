import type { Language, Translate } from "@fnb/zalo-mini";
import {
	type CustomerStore,
	knownRedeemRefusal,
	type Reward,
	type RewardKind,
	type VoucherState,
} from "@fnb/zalo-mini/loyalty";

export const VOUCHER_POLL_MS = 30_000;

export const LIST_REASONS = [
	"membership_inactive",
	"already_held",
	"member_limit_reached",
	"rail_not_ready",
	"insufficient_stamps",
	"insufficient_points",
] as const;

export const VOUCHER_TONES: Readonly<
	Record<VoucherState, "pending" | "positive" | "neutral" | "negative">
> = {
	held: "pending",
	expired: "neutral",
	used: "positive",
	returned: "neutral",
	cancelled: "negative",
};

function percentText(percent: number, language: Language): string {
	return new Intl.NumberFormat(language === "en" ? "en-US" : "vi-VN", {
		maximumFractionDigits: 2,
	}).format(percent);
}

export function rewardKindText(
	reward: {
		readonly kind: RewardKind;
		readonly percent: number | null;
		readonly itemNames?: readonly string[];
	},
	t: Translate,
	language: Language,
): string {
	switch (reward.kind) {
		case "free_item":
			return reward.itemNames === undefined || reward.itemNames.length === 0
				? t("reward.kind.free_itemAny")
				: t("reward.kind.free_item", { items: reward.itemNames.join(", ") });
		case "percent_off":
			return reward.percent === null
				? t("reward.kind.amount_off")
				: t("reward.kind.percent_off", {
						percent: percentText(reward.percent, language),
					});
		case "amount_off":
			return t("reward.kind.amount_off");
		case "free_upgrade":
			return t("reward.kind.free_upgrade");
	}
}

export function costText(
	cost: { readonly stamps: number; readonly points: number },
	t: Translate,
): string {
	return [
		cost.stamps > 0 ? t("reward.cost.stamps", { count: cost.stamps }) : null,
		cost.points > 0 ? t("reward.cost.points", { count: cost.points }) : null,
	]
		.filter((part): part is string => part !== null)
		.join(" + ");
}

export function rewardCost(reward: Reward): {
	readonly stamps: number;
	readonly points: number;
} {
	return { stamps: reward.costStamps, points: reward.costPoints };
}

export function reasonText(reward: Reward, t: Translate): string | null {
	if (reward.available) return null;
	const reason = LIST_REASONS.find((name) => name === reward.unavailableReason);
	return reason === undefined
		? t("reward.reason.other")
		: t(`reward.reason.${reason}`, {
				stamps: reward.stampsShort,
				points: reward.pointsShort,
			});
}

export function refusalText(refusal: string, t: Translate): string {
	const known = knownRedeemRefusal(refusal);
	return t(`reward.refused.${known ?? "other"}`);
}

export function storeNames(
	codes: readonly string[] | null,
	stores: readonly CustomerStore[],
): string | null {
	if (codes === null) return null;
	const names = codes.map(
		(code) => stores.find((store) => store.code === code)?.name ?? code,
	);
	return names.length === 0 ? null : names.join(", ");
}

function two(value: number): string {
	return String(value).padStart(2, "0");
}

export function timeLeft(until: number, now: number): string {
	const seconds = Math.max(0, Math.ceil((until - now) / 1000));
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	return `${two(hours)}:${two(minutes)}:${two(seconds % 60)}`;
}
