import type { AnalyticsRow } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import {
	type HandlerArgs,
	type HandlerContext,
	requireStoreIds,
} from "./support.js";

type Row = AnalyticsRow<"store_targets">;

export function storeTargets(
	store: AggregateStore,
	args: HandlerArgs<"store_targets">,
	_context: HandlerContext,
): Row[] {
	requireStoreIds("store_targets", args.store_ids);
	return store.visibleStores(args.store_ids).flatMap((visible) => {
		const target = store.days.target(
			visible,
			args.period_kind,
			args.period_start,
		);
		return target === null
			? []
			: [{ store_id: visible.id, net_target_amount: target }];
	});
}
