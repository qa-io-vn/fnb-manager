import type { PaymentKind } from "@fnb/core";
import type { ThemeRow } from "@fnb/reports";
import { money } from "../pg-numeric.js";
import { byteOrder } from "../text-order.js";
import { demoPaymentCatalogue } from "./catalogue.js";
import {
	requireThemeDateRange,
	requireThemeRows,
	requireThemeStoreIds,
	type ThemeHandler,
} from "./theme-support.js";

export const DATA_QUALITY_PAYMENTS_MAX_DAYS = 400;

type Row = ThemeRow<"data_quality_payments">;

interface Paid {
	readonly account: string;
	readonly method: string;
	name: string | null;
	kind: PaymentKind;
	invoices: number;
	amountMinor: number;
}

function maxText(left: string | null, right: string | null): string | null {
	if (left === null) return right;
	if (right === null) return left;
	return byteOrder(right, left) > 0 ? right : left;
}

function nullsLast(left: unknown, right: unknown): number {
	return (left === null ? 1 : 0) - (right === null ? 1 : 0);
}

function pairKey(account: string, method: string): string {
	return `${account}\u0000${method}`;
}

export const dataQualityPayments: ThemeHandler<"data_quality_payments"> = (
	store,
	args,
) => {
	requireThemeStoreIds("data_quality_payments", args.store_ids);
	requireThemeDateRange(
		"data_quality_payments",
		args.from_date,
		args.to_date,
		DATA_QUALITY_PAYMENTS_MAX_DAYS,
	);
	const mappings = store.mappings();
	const visible = store.visibleStores(args.store_ids);
	const paid = new Map<string, Paid>();
	for (const definition of visible) {
		const account = mappings.accountOf(definition.id);
		for (const day of store.daysOf(definition, args.from_date, args.to_date)) {
			for (const payment of day.payments) {
				const key = pairKey(account, payment.methodExternalId);
				const known = paid.get(key);
				if (known === undefined) {
					paid.set(key, {
						account,
						method: payment.methodExternalId,
						name: payment.methodName,
						kind: payment.kind,
						invoices: payment.invoices,
						amountMinor: payment.amountMinor,
					});
					continue;
				}
				known.name = maxText(known.name, payment.methodName);
				if (byteOrder(payment.kind, known.kind) > 0) known.kind = payment.kind;
				known.invoices += payment.invoices;
				known.amountMinor += payment.amountMinor;
			}
		}
	}
	const accounts = [
		...new Set(visible.map((definition) => mappings.accountOf(definition.id))),
	];
	const rows: Row[] = [];
	const listed = new Set<string>();
	for (const account of accounts) {
		for (const method of demoPaymentCatalogue(account)) {
			const key = pairKey(account, method.externalId);
			listed.add(key);
			const override = mappings.paymentKindOverrideOf(
				account,
				method.externalId,
			);
			const use = paid.get(key);
			rows.push({
				pos_account_id: account,
				payment_method_external_id: method.externalId,
				payment_method_name: method.name,
				kind: override ?? method.kind,
				pos_kind: method.kind,
				override_kind: override,
				in_catalogue: true,
				invoices: use?.invoices ?? null,
				amount: use === undefined ? null : money(use.amountMinor).toNumber(),
			});
		}
	}
	for (const [key, use] of paid) {
		if (listed.has(key)) continue;
		rows.push({
			pos_account_id: use.account,
			payment_method_external_id: use.method,
			payment_method_name: use.name,
			kind: use.kind,
			pos_kind: null,
			override_kind: null,
			in_catalogue: false,
			invoices: use.invoices,
			amount: money(use.amountMinor).toNumber(),
		});
	}
	const accountPosition = new Map<string | null, number>(
		accounts.map((account, position) => [account, position]),
	);
	rows.sort(
		(left, right) =>
			nullsLast(left.amount, right.amount) ||
			(right.amount ?? 0) - (left.amount ?? 0) ||
			nullsLast(left.payment_method_name, right.payment_method_name) ||
			byteOrder(
				left.payment_method_name ?? "",
				right.payment_method_name ?? "",
			) ||
			byteOrder(
				left.payment_method_external_id,
				right.payment_method_external_id,
			) ||
			(accountPosition.get(left.pos_account_id) ?? 0) -
				(accountPosition.get(right.pos_account_id) ?? 0),
	);
	requireThemeRows("data_quality_payments", rows.length);
	return rows;
};
