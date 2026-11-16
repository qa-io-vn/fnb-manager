import type { IsoDate, PromotionKind, ThemeRow } from "@fnb/reports";
import { money } from "../pg-numeric.js";
import { byteOrder } from "../text-order.js";
import { discountRows } from "./discount-rows.js";
import {
	requireThemeDateRange,
	requireThemeRows,
	requireThemeStoreIds,
	type ThemeHandler,
} from "./theme-support.js";

export const PROMOTION_DAYS_MAX_DAYS = 400;

type Row = ThemeRow<"promotion_days">;

interface DayUse {
	readonly storeId: string;
	readonly position: number;
	readonly date: IsoDate;
	readonly kind: PromotionKind;
	readonly key: string;
	namedOther: string | null;
	named: string | null;
	readonly invoices: Set<string>;
	lines: number;
	discountMinor: number;
}

function maxName(known: string | null, name: string): string {
	return known === null || byteOrder(name, known) > 0 ? name : known;
}

export const promotionDays: ThemeHandler<"promotion_days"> = (store, args) => {
	requireThemeStoreIds("promotion_days", args.store_ids);
	requireThemeDateRange(
		"promotion_days",
		args.from_date,
		args.to_date,
		PROMOTION_DAYS_MAX_DAYS,
	);
	const kindFilter = args.kind_filter ?? null;
	const keyFilter = args.key_filter ?? null;
	const visible = store.visibleStores(args.store_ids);
	const position = new Map<string, number>(
		visible.map((definition, index) => [definition.id, index]),
	);
	const uses = new Map<string, DayUse>();
	for (const row of discountRows(
		store,
		visible.map((definition) => definition.id),
		args.from_date,
		args.to_date,
	)) {
		if (kindFilter !== null && row.kind !== kindFilter) continue;
		if (keyFilter !== null && row.key !== keyFilter) continue;
		const mapKey = [row.storeId, row.businessDate, row.kind, row.key].join(
			"\u0000",
		);
		let use = uses.get(mapKey);
		if (use === undefined) {
			use = {
				storeId: row.storeId,
				position: position.get(row.storeId) ?? 0,
				date: row.businessDate,
				kind: row.kind,
				key: row.key,
				namedOther: null,
				named: null,
				invoices: new Set(),
				lines: 0,
				discountMinor: 0,
			};
			uses.set(mapKey, use);
		}
		use.named = maxName(use.named, row.name);
		if (row.name !== row.key)
			use.namedOther = maxName(use.namedOther, row.name);
		use.invoices.add(row.invoiceExternalId);
		use.lines += 1;
		use.discountMinor += row.discountMinor;
	}
	const rows = [...uses.values()]
		.sort(
			(left, right) =>
				byteOrder(left.date, right.date) ||
				left.position - right.position ||
				byteOrder(left.kind, right.kind) ||
				byteOrder(left.key, right.key),
		)
		.map(
			(use): Row => ({
				store_id: use.storeId,
				business_date: use.date,
				promotion_kind: use.kind,
				promotion_key: use.key,
				promotion_name: use.namedOther ?? use.named ?? use.key,
				invoices: use.invoices.size,
				lines: use.kind === "item" ? use.lines : null,
				discount_amount: money(use.discountMinor).toNumber(),
			}),
		);
	requireThemeRows("promotion_days", rows.length);
	return rows;
};
