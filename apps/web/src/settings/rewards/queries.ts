import { useQuery } from "@tanstack/react-query";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { settingsQueryKey } from "../queries";
import { useSettingsSourceState } from "../settings-source-context";
import type { RewardsSource } from "./source";

export function useRewardsSource(): RewardsSource | null {
	const state = useSettingsSourceState();
	return state.status === "ready" ? (state.rewards ?? null) : null;
}

function useRewardsRead<T>(
	read: "rewards" | "rewardRails" | "rewardDiscountDays",
	parts: readonly (string | number)[],
	load: (source: RewardsSource, tenantId: string) => Promise<T>,
	enabled = true,
) {
	const state = useSettingsSourceState();
	const { tenant } = useReadyTenantScope();
	const ready = state.status === "ready" ? state : null;
	const rewards = ready?.rewards ?? null;
	return useQuery({
		queryKey: settingsQueryKey(
			ready?.source.kind ?? "demo",
			tenant.id,
			read,
			...parts,
		),
		queryFn: () => {
			if (rewards === null) throw new Error("no rewards data in this mode");
			return load(rewards, tenant.id);
		},
		enabled: ready !== null && enabled,
	});
}

export function useRewards() {
	return useRewardsRead("rewards", [], (source, tenantId) =>
		source.rewards(tenantId),
	);
}

export function useRewardRails() {
	return useRewardsRead("rewardRails", [], (source, tenantId) =>
		source.rails(tenantId),
	);
}

export function useRewardDiscountDays(
	rewardId: string | null,
	year: number,
	enabled: boolean,
) {
	return useRewardsRead(
		"rewardDiscountDays",
		[rewardId ?? "", year],
		(source, tenantId) =>
			rewardId === null
				? Promise.resolve([])
				: source.discountDays(tenantId, rewardId, year),
		enabled && rewardId !== null,
	);
}
