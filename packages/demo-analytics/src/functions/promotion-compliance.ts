import type { IsoDate, ThemeRow } from "@fnb/reports";
import { money, PgDecimal } from "../pg-numeric.js";
import { byteOrder } from "../text-order.js";
import {
	discountedInvoiceKey,
	discountedInvoices,
	discountRows,
	type StoreDiscountRow,
} from "./discount-rows.js";
import {
	requireThemeDateRange,
	requireThemeRows,
	requireThemeStoreIds,
	type ThemeHandler,
} from "./theme-support.js";

export const PROMOTION_COMPLIANCE_MAX_DAYS = 400;

const DEFAULT_CAP_RATE = 0.5;
const ONE = PgDecimal.integer(1);

type Row = ThemeRow<"promotion_compliance">;

interface Check {
	checked: number;
	maxPartial: PgDecimal | null;
	overRows: number;
	overMinor: number;
	overFirst: IsoDate | null;
	overLast: IsoDate | null;
	fullRows: number;
	fullMinor: number;
	fullFirst: IsoDate | null;
	fullLast: IsoDate | null;
}

function emptyCheck(): Check {
	return {
		checked: 0,
		maxPartial: null,
		overRows: 0,
		overMinor: 0,
		overFirst: null,
		overLast: null,
		fullRows: 0,
		fullMinor: 0,
		fullFirst: null,
		fullLast: null,
	};
}

function widen(
	first: IsoDate | null,
	last: IsoDate | null,
	date: IsoDate,
): [IsoDate, IsoDate] {
	return [
		first === null || date < first ? date : first,
		last === null || date > last ? date : last,
	];
}

function greater(known: PgDecimal | null, value: PgDecimal): PgDecimal {
	return known === null || value.compare(known) > 0 ? value : known;
}

function maxText(known: string | null, text: string): string {
	return known === null || byteOrder(text, known) > 0 ? text : known;
}

function checkRow(
	check: Check,
	date: IsoDate,
	amountMinor: number,
	rate: PgDecimal | null,
	full: boolean,
	cap: PgDecimal,
): void {
	check.checked += 1;
	if (full) {
		check.fullRows += 1;
		check.fullMinor += amountMinor;
		[check.fullFirst, check.fullLast] = widen(
			check.fullFirst,
			check.fullLast,
			date,
		);
		return;
	}
	if (rate === null) return;
	check.maxPartial = greater(check.maxPartial, rate);
	if (rate.compare(cap) > 0) {
		check.overRows += 1;
		check.overMinor += amountMinor;
		[check.overFirst, check.overLast] = widen(
			check.overFirst,
			check.overLast,
			date,
		);
	}
}

function rowOf(
	kind: Row["promotion_kind"],
	key: string,
	name: string | null,
	check: Check,
): Row {
	return {
		promotion_kind: kind,
		promotion_key: key,
		promotion_name: name,
		checked_rows: check.checked,
		max_partial_rate: check.maxPartial?.toNumber() ?? null,
		over_cap_rows: check.overRows,
		over_cap_discount_amount: money(check.overMinor).toNumber(),
		first_over_cap_on: check.overFirst,
		last_over_cap_on: check.overLast,
		full_discount_rows: check.fullRows,
		full_discount_amount: money(check.fullMinor).toNumber(),
		first_full_discount_on: check.fullFirst,
		last_full_discount_on: check.fullLast,
	};
}

export const promotionCompliance: ThemeHandler<"promotion_compliance"> = (
	store,
	args,
) => {
	requireThemeStoreIds("promotion_compliance", args.store_ids);
	requireThemeDateRange(
		"promotion_compliance",
		args.from_date,
		args.to_date,
		PROMOTION_COMPLIANCE_MAX_DAYS,
	);
	if (args.store_ids.length === 0) return [];
	const cap = PgDecimal.parse(String(args.cap_rate ?? DEFAULT_CAP_RATE));
	const visibleIds = store
		.visibleStores(args.store_ids)
		.map((definition) => definition.id);
	const rows = discountRows(store, visibleIds, args.from_date, args.to_date);
	const invoices = discountedInvoices(
		store,
		visibleIds,
		args.from_date,
		args.to_date,
	);

	const byPromotion = new Map<
		string,
		{
			kind: StoreDiscountRow["kind"];
			key: string;
			namedOther: string | null;
			named: string | null;
			check: Check;
		}
	>();
	const byInvoice = new Map<
		string,
		{
			date: IsoDate;
			partialMinor: number | null;
			fullItemBaseMinor: number;
			grossMinor: number;
		}
	>();
	for (const row of rows) {
		const full = row.discountMinor >= row.baseMinor;
		const mapKey = `${row.kind}\u0000${row.key}`;
		let promotion = byPromotion.get(mapKey);
		if (promotion === undefined) {
			promotion = {
				kind: row.kind,
				key: row.key,
				namedOther: null,
				named: null,
				check: emptyCheck(),
			};
			byPromotion.set(mapKey, promotion);
		}
		promotion.named = maxText(promotion.named, row.name);
		if (row.name !== row.key) {
			promotion.namedOther = maxText(promotion.namedOther, row.name);
		}
		checkRow(
			promotion.check,
			row.businessDate,
			row.discountMinor,
			row.rate,
			full,
			cap,
		);

		const invoiceKey = discountedInvoiceKey(row.storeId, row.invoiceExternalId);
		let invoice = byInvoice.get(invoiceKey);
		if (invoice === undefined) {
			invoice = {
				date: row.businessDate,
				partialMinor: null,
				fullItemBaseMinor: 0,
				grossMinor: invoices.get(invoiceKey)?.grossMinor ?? 0,
			};
			byInvoice.set(invoiceKey, invoice);
		}
		if (row.businessDate < invoice.date) invoice.date = row.businessDate;
		if (row.kind === "item" && full) {
			invoice.fullItemBaseMinor += row.baseMinor;
		} else {
			invoice.partialMinor = (invoice.partialMinor ?? 0) + row.discountMinor;
		}
	}

	const result = [...byPromotion.values()]
		.map((promotion) =>
			rowOf(
				promotion.kind,
				promotion.key,
				promotion.namedOther ?? promotion.named ?? promotion.key,
				promotion.check,
			),
		)
		.sort(
			(left, right) =>
				right.over_cap_rows - left.over_cap_rows ||
				byteOrder(left.promotion_kind, right.promotion_kind) ||
				byteOrder(left.promotion_key, right.promotion_key),
		);

	const total = emptyCheck();
	for (const invoice of byInvoice.values()) {
		const baseMinor = invoice.grossMinor - invoice.fullItemBaseMinor;
		if (baseMinor <= 0) continue;
		const partialMinor = invoice.partialMinor ?? 0;
		const rate = money(partialMinor).div(money(baseMinor)).round(6);
		total.checked += 1;
		if (rate.compare(ONE) >= 0) {
			total.fullRows += 1;
			total.fullMinor += partialMinor;
			[total.fullFirst, total.fullLast] = widen(
				total.fullFirst,
				total.fullLast,
				invoice.date,
			);
			continue;
		}
		total.maxPartial = greater(total.maxPartial, rate);
		if (rate.compare(cap) > 0) {
			total.overRows += 1;
			total.overMinor += partialMinor;
			[total.overFirst, total.overLast] = widen(
				total.overFirst,
				total.overLast,
				invoice.date,
			);
		}
	}
	if (total.checked > 0) {
		result.push(rowOf("invoice_total", "all", null, total));
	}
	requireThemeRows("promotion_compliance", result.length);
	return result;
};
