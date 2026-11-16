import {
	DISCOUNT_DAYS_FIRST_YEAR,
	type IsoDate,
	storeBusinessDate,
	type ThemeRow,
} from "@fnb/reports";
import { byteOrder } from "../text-order.js";
import {
	discountedInvoiceKey,
	discountedInvoices,
	discountRows,
} from "./discount-rows.js";
import { analyticsAsOf } from "./month-pace.js";
import {
	invalidTheme,
	requireThemeRows,
	requireThemeStoreIds,
	type ThemeHandler,
} from "./theme-support.js";

type Row = ThemeRow<"item_discount_days">;

type DayKind = "line" | "bill" | "gift" | "voucher";

interface ItemDays {
	readonly key: string;
	readonly days: Record<DayKind, Set<IsoDate>>;
}

function currentYear(timeZones: readonly string[], now: Date): number {
	if (timeZones.length === 0) return now.getUTCFullYear();
	return Math.max(
		...timeZones.map((timeZone) =>
			Number(
				storeBusinessDate({ timeZone, businessDayStartMinutes: 0 }, now).slice(
					0,
					4,
				),
			),
		),
	);
}

function firstOf(dates: Iterable<IsoDate>): IsoDate | null {
	let first: IsoDate | null = null;
	for (const date of dates) if (first === null || date < first) first = date;
	return first;
}

function lastOf(dates: Iterable<IsoDate>): IsoDate | null {
	let last: IsoDate | null = null;
	for (const date of dates) if (last === null || date > last) last = date;
	return last;
}

export const itemDiscountDays: ThemeHandler<"item_discount_days"> = (
	store,
	args,
	context,
) => {
	requireThemeStoreIds("item_discount_days", args.store_ids);
	const known = args.store_ids.flatMap((id) => {
		const definition = store.store(id);
		return definition === undefined ? [] : [definition.timeZone];
	});
	const year = args.calendar_year;
	if (
		year < DISCOUNT_DAYS_FIRST_YEAR ||
		year > currentYear(known, context.now)
	) {
		invalidTheme(
			"item_discount_days",
			`item_discount_days needs a calendar_year from ${DISCOUNT_DAYS_FIRST_YEAR} to the current year`,
		);
	}
	const visibleIds = store
		.visibleStores(args.store_ids)
		.map((definition) => definition.id);
	const from = `${year}-01-01`;
	const yearEnd = `${year}-12-31`;
	const asOf = args.as_of_date ?? analyticsAsOf(store, visibleIds, context.now);
	const to = asOf < yearEnd ? asOf : yearEnd;
	if (from > to) {
		requireThemeRows("item_discount_days", 0);
		return [];
	}

	const invoices = discountedInvoices(store, visibleIds, from, to);
	const items = new Map<string, ItemDays>();
	const names = new Map<string, string>();
	const dayOf = (key: string) => {
		let entry = items.get(key);
		if (entry === undefined) {
			entry = {
				key,
				days: {
					line: new Set(),
					bill: new Set(),
					gift: new Set(),
					voucher: new Set(),
				},
			};
			items.set(key, entry);
		}
		return entry;
	};
	for (const invoice of invoices.values()) {
		for (const item of invoice.items) {
			const known = names.get(item.itemKey);
			if (known === undefined || byteOrder(item.itemName, known) > 0) {
				names.set(item.itemKey, item.itemName);
			}
		}
	}
	for (const row of discountRows(store, visibleIds, from, to)) {
		const full = row.discountMinor >= row.baseMinor;
		if (row.kind === "item") {
			if (row.itemKey === null) continue;
			dayOf(row.itemKey).days[full ? "gift" : "line"].add(row.businessDate);
			continue;
		}
		if (row.kind === "bill" && full) continue;
		const invoice = invoices.get(
			discountedInvoiceKey(row.storeId, row.invoiceExternalId),
		);
		for (const item of invoice?.items ?? []) {
			dayOf(item.itemKey).days[row.kind === "bill" ? "bill" : "voucher"].add(
				row.businessDate,
			);
		}
	}

	const rows = [...items.values()]
		.map((entry): Row => {
			const priceDays = new Set([...entry.days.line, ...entry.days.bill]);
			return {
				item_external_id: entry.key,
				item_name: names.get(entry.key) ?? null,
				price_discount_days: priceDays.size,
				line_price_discount_days: entry.days.line.size,
				bill_discount_days: entry.days.bill.size,
				gift_days: entry.days.gift.size,
				voucher_days: entry.days.voucher.size,
				first_price_discount_on: firstOf(priceDays),
				last_price_discount_on: lastOf(priceDays),
			};
		})
		.sort(
			(left, right) =>
				right.price_discount_days - left.price_discount_days ||
				right.gift_days - left.gift_days ||
				byteOrder(left.item_external_id, right.item_external_id),
		);
	requireThemeRows("item_discount_days", rows.length);
	return rows;
};
