import { MENU } from "@fnb/connector-mock";
import {
	addDays,
	type IsoDate,
	type PromotionKind,
	type ThemeRow,
} from "@fnb/reports";
import {
	DEMO_POS_ACCOUNT_ID,
	ESTABLISHED_STORE_OPENED_ON,
} from "../calendar.js";
import { money } from "../pg-numeric.js";
import { byteOrder } from "../text-order.js";
import { discountRows } from "./discount-rows.js";
import {
	requireThemeRows,
	requireThemeStoreIds,
	type ThemeHandler,
} from "./theme-support.js";

type Row = ThemeRow<"promotion_catalogue">;

const DAYS_OF_USE = 365;

export interface DemoCatalogPromotion {
	readonly externalId: string;
	readonly name: string;
	readonly active: boolean;
	readonly startsAt: string | null;
	readonly endsAt: string | null;
}

export function demoPromotionCatalogue(
	posAccountId: string,
): readonly DemoCatalogPromotion[] {
	if (posAccountId !== DEMO_POS_ACCOUNT_ID) return [];
	return MENU.catalog.promotions.map((promotion) => ({
		externalId: promotion.externalId,
		name: promotion.name,
		active: true,
		startsAt: null,
		endsAt: null,
	}));
}

interface Used {
	readonly kind: PromotionKind;
	readonly key: string;
	namedOther: string | null;
	named: string | null;
	first: IsoDate;
	last: IsoDate;
	readonly days: Set<IsoDate>;
	readonly invoices: Set<string>;
	discountMinor: number;
}

interface Listed {
	readonly key: string;
	name: string;
	active: boolean;
	startsAt: string | null;
	endsAt: string | null;
}

function maxText(known: string | null, text: string): string {
	return known === null || byteOrder(text, known) > 0 ? text : known;
}

function earlier(left: string | null, right: string | null): string | null {
	if (left === null) return right;
	if (right === null) return left;
	return Date.parse(right) < Date.parse(left) ? right : left;
}

function later(left: string | null, right: string | null): string | null {
	if (left === null) return right;
	if (right === null) return left;
	return Date.parse(right) > Date.parse(left) ? right : left;
}

export const promotionCatalogue: ThemeHandler<"promotion_catalogue"> = (
	store,
	args,
) => {
	requireThemeStoreIds("promotion_catalogue", args.store_ids);
	const asOf = args.as_of_date;
	const visible = store.visibleStores(args.store_ids);
	const visibleIds = visible.map((definition) => definition.id);
	const recentFrom = addDays(asOf, -(DAYS_OF_USE - 1));
	const used = new Map<string, Used>();
	for (const row of discountRows(
		store,
		visibleIds,
		ESTABLISHED_STORE_OPENED_ON,
		asOf,
	)) {
		const mapKey = `${row.kind}\u0000${row.key}`;
		let use = used.get(mapKey);
		if (use === undefined) {
			use = {
				kind: row.kind,
				key: row.key,
				namedOther: null,
				named: null,
				first: row.businessDate,
				last: row.businessDate,
				days: new Set(),
				invoices: new Set(),
				discountMinor: 0,
			};
			used.set(mapKey, use);
		}
		use.named = maxText(use.named, row.name);
		if (row.name !== row.key)
			use.namedOther = maxText(use.namedOther, row.name);
		if (row.businessDate < use.first) use.first = row.businessDate;
		if (row.businessDate > use.last) use.last = row.businessDate;
		if (row.businessDate >= recentFrom) {
			use.days.add(row.businessDate);
			use.invoices.add(`${row.storeId}\u0000${row.invoiceExternalId}`);
			use.discountMinor += row.discountMinor;
		}
	}

	const accounts = new Set(
		visibleIds.map((id) => store.mappings().accountOf(id)),
	);
	const listed = new Map<string, Listed>();
	for (const account of accounts) {
		for (const promotion of demoPromotionCatalogue(account)) {
			const known = listed.get(promotion.externalId);
			if (known === undefined) {
				listed.set(promotion.externalId, {
					key: promotion.externalId,
					name: promotion.name,
					active: promotion.active,
					startsAt: promotion.startsAt,
					endsAt: promotion.endsAt,
				});
				continue;
			}
			known.name = maxText(known.name, promotion.name);
			known.active = known.active || promotion.active;
			known.startsAt = earlier(known.startsAt, promotion.startsAt);
			known.endsAt = later(known.endsAt, promotion.endsAt);
		}
	}

	const rows: Row[] = [];
	for (const entry of listed.values()) {
		const use = used.get(`item\u0000${entry.key}`);
		rows.push(rowOf("item", entry.key, entry, use));
	}
	for (const use of used.values()) {
		if (use.kind === "item" && listed.has(use.key)) continue;
		rows.push(rowOf(use.kind, use.key, undefined, use));
	}
	rows.sort(
		(left, right) =>
			(left.last_used_on === null ? 1 : 0) -
				(right.last_used_on === null ? 1 : 0) ||
			byteOrder(right.last_used_on ?? "", left.last_used_on ?? "") ||
			byteOrder(left.promotion_kind, right.promotion_kind) ||
			byteOrder(left.promotion_key, right.promotion_key),
	);
	requireThemeRows("promotion_catalogue", rows.length);
	return rows;
};

function rowOf(
	kind: PromotionKind,
	key: string,
	entry: Listed | undefined,
	use: Used | undefined,
): Row {
	return {
		promotion_kind: kind,
		promotion_key: key,
		promotion_name: entry?.name ?? use?.namedOther ?? use?.named ?? key,
		in_catalogue: entry !== undefined,
		catalogue_active: entry === undefined ? null : entry.active,
		starts_at: entry?.startsAt ?? null,
		ends_at: entry?.endsAt ?? null,
		first_used_on: use?.first ?? null,
		last_used_on: use?.last ?? null,
		days_used_365: use?.days.size ?? 0,
		invoices_365: use?.invoices.size ?? 0,
		discount_365: money(use?.discountMinor ?? 0).toNumber(),
	};
}
