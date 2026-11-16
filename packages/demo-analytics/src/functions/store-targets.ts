import type { AnalyticsRow, IsoDate } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import type { DemoSettingsStore } from "../settings.js";
import {
	type HandlerArgs,
	type HandlerContext,
	requireStoreIds,
} from "./support.js";

type Row = AnalyticsRow<"store_targets">;

export function savedTarget(
	settings: DemoSettingsStore,
	storeId: string,
	periodKind: string,
	periodStart: IsoDate,
): number | null {
	return (
		settings
			.targets()
			.find(
				(target) =>
					target.storeId === storeId &&
					target.periodKind === periodKind &&
					target.periodStart === periodStart,
			)?.netTargetAmount ?? null
	);
}

export function storeTargets(
	store: AggregateStore,
	args: HandlerArgs<"store_targets">,
	context: HandlerContext,
): Row[] {
	requireStoreIds("store_targets", args.store_ids);
	return store.visibleStores(args.store_ids).flatMap((visible) => {
		const target = savedTarget(
			context.settings,
			visible.id,
			args.period_kind,
			args.period_start,
		);
		return target === null
			? []
			: [{ store_id: visible.id, net_target_amount: target }];
	});
}
