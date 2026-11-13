import { type AnalyticsRow, addDays, type IsoDate } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { money, PgDecimal, quantity } from "../pg-numeric.js";
import type { HandlerArgs, HandlerContext } from "./support.js";

type Row = AnalyticsRow<"item_velocity">;

export const VELOCITY_WINDOW_DAYS = 28;
export const VELOCITY_HISTORY_DAYS = 2 * VELOCITY_WINDOW_DAYS - 1;
const CHANGE_DIGITS = 3;
const HUNDRED = PgDecimal.integer(100);

interface WindowSum {
	readonly units: number;
	readonly present: boolean;
}

interface ItemTotals {
	itemName: string | null;
	typeId: string | null;
	typeName: string | null;
	recentQuantity: WindowSum;
	priorQuantity: WindowSum;
	recentNet: WindowSum;
	priorNet: WindowSum;
}

const EMPTY_SUM: WindowSum = { units: 0, present: false };

function maxOf(left: string | null, right: string | null): string | null {
	if (left === null) return right;
	if (right === null) return left;
	return right > left ? right : left;
}

function plus(sum: WindowSum, units: number): WindowSum {
	return { units: sum.units + units, present: true };
}

function coalesced(
	sum: WindowSum,
	toDecimal: (units: number) => PgDecimal,
): PgDecimal {
	return sum.present ? toDecimal(sum.units) : PgDecimal.integer(0);
}

export function changePercent(
	recent: PgDecimal,
	prior: PgDecimal,
): number | null {
	if (prior.isZero()) return null;
	return HUNDRED.mul(recent.sub(prior))
		.div(prior)
		.round(CHANGE_DIGITS)
		.toNumber();
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function itemVelocity(
	store: AggregateStore,
	args: HandlerArgs<"item_velocity">,
	_context: HandlerContext,
): Row[] {
	const asOf: IsoDate = args.as_of_date;
	const from = addDays(asOf, -VELOCITY_HISTORY_DAYS);
	const priorTo = addDays(asOf, -VELOCITY_WINDOW_DAYS);
	const totals = new Map<string, ItemTotals>();
	for (const visible of store.visibleStores(args.store_ids)) {
		for (const day of store.daysOf(visible, from, asOf)) {
			const recent = day.date > priorTo;
			for (const item of day.items) {
				const known: ItemTotals = totals.get(item.itemExternalId) ?? {
					itemName: null,
					typeId: null,
					typeName: null,
					recentQuantity: EMPTY_SUM,
					priorQuantity: EMPTY_SUM,
					recentNet: EMPTY_SUM,
					priorNet: EMPTY_SUM,
				};
				known.itemName = maxOf(known.itemName, item.itemName);
				known.typeId = maxOf(known.typeId, item.itemTypeExternalId);
				known.typeName = maxOf(known.typeName, item.itemTypeName);
				if (recent) {
					known.recentQuantity = plus(known.recentQuantity, item.quantityMilli);
					known.recentNet = plus(known.recentNet, item.netMinor);
				} else {
					known.priorQuantity = plus(known.priorQuantity, item.quantityMilli);
					known.priorNet = plus(known.priorNet, item.netMinor);
				}
				totals.set(item.itemExternalId, known);
			}
		}
	}
	return [...totals.entries()]
		.map(([key, item]) => {
			const recentQuantity = coalesced(item.recentQuantity, quantity);
			const priorQuantity = coalesced(item.priorQuantity, quantity);
			const recentNet = coalesced(item.recentNet, money);
			const priorNet = coalesced(item.priorNet, money);
			return {
				row: {
					item_external_id: key,
					item_name: item.itemName ?? key,
					item_type_external_id: item.typeId,
					item_type_name: item.typeName,
					recent_quantity: recentQuantity.toNumber(),
					prior_quantity: priorQuantity.toNumber(),
					recent_net_amount: recentNet.toNumber(),
					prior_net_amount: priorNet.toNumber(),
					quantity_change_pct: changePercent(recentQuantity, priorQuantity),
					net_change_pct: changePercent(recentNet, priorNet),
				},
				recentNet,
			};
		})
		.sort(
			(left, right) =>
				right.recentNet.compare(left.recentNet) ||
				compareText(left.row.item_external_id, right.row.item_external_id),
		)
		.map(({ row }) => row);
}
