import type { MessageKey } from "../../i18n";
import type {
	CouponRail,
	RailRewardMapping,
	RewardRails,
	StoreRail,
} from "./source";

export interface RewardStore {
	readonly id: string;
	readonly name: string;
}

export type ReadinessGap = "noRail" | "noMapping";

export interface StoreReadiness {
	readonly storeId: string;
	readonly name: string;
	readonly rail: StoreRail | null;
	readonly mapping: RailRewardMapping | null;
	readonly gap: ReadinessGap | null;
}

export const RAIL_KEYS: Readonly<Record<CouponRail, MessageKey>> = {
	pos_payment_discount: "settings.rewards.rails.pos_payment_discount",
	crm_code_pool: "settings.rewards.rails.crm_code_pool",
	crm_callback: "settings.rewards.rails.crm_callback",
};

export function storesInScope(
	storeIds: readonly string[] | null,
	stores: readonly RewardStore[],
): RewardStore[] {
	if (storeIds === null) return [...stores];
	return storeIds.map(
		(id) =>
			stores.find((store) => store.id === id) ?? {
				id,
				name: id,
			},
	);
}

export function readinessOf(
	storeIds: readonly string[] | null,
	rewardKey: string,
	stores: readonly RewardStore[],
	rails: RewardRails,
): StoreReadiness[] {
	return storesInScope(storeIds, stores).map((store) => {
		const rail = rails.rails.find((row) => row.storeId === store.id) ?? null;
		const mapping =
			rails.mappings.find(
				(row) => row.storeId === store.id && row.rewardKey === rewardKey,
			) ?? null;
		return {
			storeId: store.id,
			name: store.name,
			rail,
			mapping,
			gap: rail === null ? "noRail" : mapping === null ? "noMapping" : null,
		};
	});
}

export function notReady(rows: readonly StoreReadiness[]): StoreReadiness[] {
	return rows.filter((row) => row.gap !== null);
}
