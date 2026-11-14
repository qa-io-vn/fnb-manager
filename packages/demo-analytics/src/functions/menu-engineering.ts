import { addDays, type ThemeRow } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import type { DemoRoleName } from "../mappings.js";
import { count, money, PgDecimal, quantity } from "../pg-numeric.js";
import { byteOrder } from "../text-order.js";
import { CostBook } from "./menu-support.js";
import {
	invalidTheme,
	requireBetween,
	requireThemeRows,
	requireThemeStoreIds,
	type ThemeHandlerArgs,
	type ThemeHandlerContext,
} from "./theme-support.js";

type Row = ThemeRow<"menu_engineering">;

const ENUM_POSITION: Readonly<Record<string, number>> = {
	drink: 0,
	topping: 1,
	food: 2,
	snack: 3,
	other: 4,
};

interface Group {
	readonly role: DemoRoleName;
	readonly key: string;
	name: string | null;
	quantity: PgDecimal;
	net: PgDecimal;
	withoutCost: boolean;
	costTotal: PgDecimal | null;
	mapped: boolean;
	firstPosition: number;
	typeId: string | null;
	typeName: string | null;
	source: "override" | "pos" | "none";
}

function maxText(left: string | null, right: string | null): string | null {
	if (left === null) return right;
	if (right === null) return left;
	return right > left ? right : left;
}

export function menuEngineering(
	store: AggregateStore,
	args: ThemeHandlerArgs<"menu_engineering">,
	context: ThemeHandlerContext,
): Row[] {
	requireThemeStoreIds("menu_engineering", args.store_ids);
	if (args.as_of_date === undefined || args.as_of_date === null) {
		invalidTheme("menu_engineering", "menu_engineering needs an as_of_date");
	}
	requireBetween("menu_engineering", "window_days", args.window_days, 7, 91);
	requireBetween(
		"menu_engineering",
		"popularity_factor",
		args.popularity_factor,
		0.1,
		1,
	);
	requireBetween(
		"menu_engineering",
		"low_sample_items",
		args.low_sample_items,
		2,
		50,
	);
	if (args.store_ids.length === 0) return [];
	const visible = store.visibleStores(args.store_ids);
	if (visible.length === 0) return [];
	const settings = context.settings.reportSettings();
	const usedWindow = args.window_days ?? settings.menuWindowDays;
	const usedFactor =
		args.popularity_factor === undefined || args.popularity_factor === null
			? PgDecimal.parse(String(settings.menuPopularityFactor)).round(3)
			: PgDecimal.parse(String(args.popularity_factor));
	const usedLow = args.low_sample_items ?? settings.menuLowSampleItems;
	const windowStart = addDays(args.as_of_date, -(usedWindow - 1));
	const mappings = store.mappings();
	const costs = new CostBook(context.settings.costs());

	const groups = new Map<string, Group>();
	visible.forEach((entry, position) => {
		const account = mappings.accountOf(entry.id);
		const days = store.daysOf(entry, windowStart, args.as_of_date);
		const posType = new Map<string, string | null>();
		const posName = new Map<string, string | null>();
		for (const day of days) {
			for (const item of day.items) {
				posType.set(
					item.itemExternalId,
					maxText(
						posType.get(item.itemExternalId) ?? null,
						item.itemTypeExternalId,
					),
				);
				posName.set(
					item.itemExternalId,
					maxText(posName.get(item.itemExternalId) ?? null, item.itemTypeName),
				);
			}
		}
		for (const day of days) {
			for (const item of day.items) {
				const key = item.itemExternalId;
				const override = mappings.overrideOf(account, key);
				const typeId = override?.itemTypeExternalId ?? posType.get(key) ?? null;
				const mappedRole = mappings.roleOf(account, typeId);
				const role: DemoRoleName = mappedRole ?? "other";
				const groupKey = `${role}\u0000${key}`;
				const group: Group = groups.get(groupKey) ?? {
					role,
					key,
					name: null,
					quantity: PgDecimal.zero(3),
					net: PgDecimal.zero(2),
					withoutCost: false,
					costTotal: null,
					mapped: true,
					firstPosition: position,
					typeId,
					typeName:
						override !== null
							? override.itemTypeName
							: (posName.get(key) ?? null),
					source:
						override !== null ? "override" : typeId === null ? "none" : "pos",
				};
				group.name = maxText(group.name, item.itemName);
				const dayQuantity = quantity(item.quantityMilli);
				group.quantity = group.quantity.add(dayQuantity);
				group.net = group.net.add(money(item.netMinor));
				if (mappedRole === null) group.mapped = false;
				const cost = costs.costOn(entry.id, key, day.date);
				if (cost === null) group.withoutCost = true;
				else {
					const dayCost = dayQuantity.mul(cost);
					group.costTotal =
						group.costTotal === null ? dayCost : group.costTotal.add(dayCost);
				}
				groups.set(groupKey, group);
			}
		}
	});

	const items = [...groups.values()];
	const roles = new Map<
		DemoRoleName,
		{
			provisional: boolean;
			count: number;
			quantity: PgDecimal;
			weighted: PgDecimal | null;
		}
	>();
	for (const item of items) {
		const role = roles.get(item.role) ?? {
			provisional: false,
			count: 0,
			quantity: PgDecimal.zero(3),
			weighted: null,
		};
		if (item.withoutCost) role.provisional = true;
		role.count += 1;
		role.quantity = role.quantity.add(item.quantity);
		roles.set(item.role, role);
	}
	const axes = new Map<Group, PgDecimal | null>();
	for (const item of items) {
		const role = roles.get(item.role);
		if (role === undefined) continue;
		const numerator =
			role.provisional || item.costTotal === null
				? item.net
				: item.net.sub(item.costTotal);
		const axis = numerator.divOrNull(item.quantity);
		axes.set(item, axis);
		if (axis !== null) {
			const product = axis.mul(item.quantity);
			role.weighted =
				role.weighted === null ? product : role.weighted.add(product);
		}
	}

	const hundred = PgDecimal.integer(100);
	const rows = items
		.map((item) => {
			const role = roles.get(item.role);
			if (role === undefined) throw new Error("role totals are missing");
			const axis = axes.get(item) ?? null;
			const threshold =
				role.weighted === null ? null : role.weighted.divOrNull(role.quantity);
			const share = item.quantity.divOrNull(role.quantity);
			const popularityLine = usedFactor.div(count(role.count));
			const popular = share !== null && share.compare(popularityLine) >= 0;
			const aboveLine =
				axis !== null && threshold !== null && axis.compare(threshold) >= 0;
			return {
				item,
				row: {
					role: item.role,
					role_mapped: item.mapped,
					item_external_id: item.key,
					item_name: item.name,
					item_type_external_id: item.typeId,
					item_type_name: item.typeName,
					category_source: item.source,
					quantity: item.quantity.toNumber(),
					net_amount: item.net.toNumber(),
					menu_mix_pct:
						hundred
							.mul(item.quantity)
							.divOrNull(role.quantity)
							?.round(3)
							.toNumber() ?? null,
					popularity_threshold_pct: hundred
						.mul(usedFactor)
						.div(count(role.count))
						.round(3)
						.toNumber(),
					avg_unit_price:
						item.net.divOrNull(item.quantity)?.round(2).toNumber() ?? null,
					unit_cost:
						item.withoutCost || item.costTotal === null
							? null
							: (item.costTotal.divOrNull(item.quantity)?.round(2).toNumber() ??
								null),
					margin_axis: axis?.round(2).toNumber() ?? null,
					margin_threshold: threshold?.round(2).toNumber() ?? null,
					provisional: role.provisional,
					low_sample: role.count < usedLow,
					menu_class: (popular && aboveLine
						? "star"
						: popular
							? "plowhorse"
							: aboveLine
								? "puzzle"
								: "dog") as Row["menu_class"],
					window_from: windowStart,
					window_days_used: usedWindow,
					popularity_factor_used: usedFactor.toNumber(),
					low_sample_items_used: usedLow,
				} satisfies Row,
			};
		})
		.sort(
			(left, right) =>
				(ENUM_POSITION[left.item.role] ?? 9) -
					(ENUM_POSITION[right.item.role] ?? 9) ||
				right.item.quantity.compare(left.item.quantity) ||
				byteOrder(left.item.key, right.item.key),
		)
		.map(({ row }) => row);
	requireThemeRows("menu_engineering", rows.length);
	return rows;
}
