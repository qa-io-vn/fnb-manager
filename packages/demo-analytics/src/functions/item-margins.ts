import type { ThemeRow } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { money, PgDecimal, quantity } from "../pg-numeric.js";
import { CostBook, effectiveItemTypes } from "./menu-support.js";
import {
	requireThemeDateRange,
	requireThemeRows,
	requireThemeStoreIds,
	type ThemeHandlerArgs,
	type ThemeHandlerContext,
} from "./theme-support.js";

type Row = ThemeRow<"item_margins">;

export const ITEM_MARGINS_MAX_DAYS = 400;

interface Totals {
	name: string | null;
	base: string | null;
	size: string | null;
	quantity: PgDecimal;
	net: PgDecimal;
	costedDays: number;
	costedQuantity: PgDecimal;
	costedNet: PgDecimal;
	cost: PgDecimal | null;
}

function maxText(left: string | null, right: string | null): string | null {
	if (left === null) return right;
	if (right === null) return left;
	return right > left ? right : left;
}

export function itemMargins(
	store: AggregateStore,
	args: ThemeHandlerArgs<"item_margins">,
	context: ThemeHandlerContext,
): Row[] {
	requireThemeStoreIds("item_margins", args.store_ids);
	requireThemeDateRange(
		"item_margins",
		args.from_date,
		args.to_date,
		ITEM_MARGINS_MAX_DAYS,
	);
	if (args.store_ids.length === 0) return [];
	const visible = store.visibleStores(args.store_ids);
	const costs = new CostBook(context.settings.costs());
	const totals = new Map<string, Totals>();
	for (const entry of visible) {
		for (const day of store.daysOf(entry, args.from_date, args.to_date)) {
			for (const item of day.items) {
				const key = item.itemExternalId;
				const known: Totals = totals.get(key) ?? {
					name: null,
					base: null,
					size: null,
					quantity: PgDecimal.zero(3),
					net: PgDecimal.zero(2),
					costedDays: 0,
					costedQuantity: PgDecimal.zero(3),
					costedNet: PgDecimal.zero(2),
					cost: null,
				};
				known.name = maxText(known.name, item.itemName);
				known.base = maxText(known.base, item.baseName);
				known.size = maxText(known.size, item.sizeLabel);
				const dayQuantity = quantity(item.quantityMilli);
				const dayNet = money(item.netMinor);
				known.quantity = known.quantity.add(dayQuantity);
				known.net = known.net.add(dayNet);
				const cost = costs.costOn(entry.id, key, day.date);
				if (cost !== null) {
					known.costedDays += 1;
					known.costedQuantity = known.costedQuantity.add(dayQuantity);
					known.costedNet = known.costedNet.add(dayNet);
					const dayCost = dayQuantity.mul(cost);
					known.cost = known.cost === null ? dayCost : known.cost.add(dayCost);
				}
				totals.set(key, known);
			}
		}
	}
	const types = effectiveItemTypes(
		store,
		args.store_ids,
		args.from_date,
		args.to_date,
	);
	const rows = [...totals.entries()]
		.map(([key, item]) => {
			const type = types.get(key);
			const cost = item.cost?.round(2) ?? null;
			const margin =
				item.costedDays > 0 && cost !== null ? item.costedNet.sub(cost) : null;
			let latest: PgDecimal | null = null;
			for (const entry of visible) {
				latest = costs.costOn(entry.id, key, args.to_date);
				if (latest !== null) break;
			}
			return {
				net: item.net,
				row: {
					item_external_id: key,
					item_name: item.name,
					base_name: item.base,
					size_label: item.size,
					item_type_external_id: type?.typeId ?? null,
					item_type_name: type?.typeName ?? null,
					role: type?.role ?? null,
					quantity: item.quantity.toNumber(),
					net_amount: item.net.toNumber(),
					costed_quantity: item.costedQuantity.toNumber(),
					costed_net_amount: item.costedNet.toNumber(),
					cost_amount: cost?.toNumber() ?? null,
					unit_cost_latest: latest?.toNumber() ?? null,
					margin_amount: margin?.toNumber() ?? null,
					margin_rate:
						margin === null
							? null
							: (margin.divOrNull(item.costedNet)?.round(6).toNumber() ?? null),
					cost_coverage:
						item.costedNet.divOrNull(item.net)?.round(6).toNumber() ?? null,
				} satisfies Row,
			};
		})
		.sort(
			(left, right) =>
				right.net.compare(left.net) ||
				(left.row.item_external_id < right.row.item_external_id
					? -1
					: left.row.item_external_id > right.row.item_external_id
						? 1
						: 0),
		)
		.map(({ row }) => row);
	requireThemeRows("item_margins", rows.length);
	return rows;
}
