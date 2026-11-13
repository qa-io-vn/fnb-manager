import type { IsoDate } from "@fnb/reports";
import {
	type DemoStoreDefinition,
	money,
	quantity,
	type StoreDayAggregates,
} from "../../src/index.js";
import type { SeededDataset } from "./harness.js";

export type EngineRow = Record<string, unknown>;

function amount(minor: number | null): number | null {
	return minor === null ? null : money(minor).toNumber();
}

function units(milli: number): number {
	return quantity(milli).toNumber();
}

export function storeDays(
	seeded: SeededDataset,
): { store: DemoStoreDefinition; date: IsoDate; day: StoreDayAggregates }[] {
	const result: {
		store: DemoStoreDefinition;
		date: IsoDate;
		day: StoreDayAggregates;
	}[] = [];
	for (const { definition } of Object.values(seeded.stores)) {
		const range = seeded.days.storeRange(definition);
		if (range === null) continue;
		for (const date of seeded.days.datesFor(definition, range.from, range.to)) {
			const day = seeded.days.aggregatesNow(definition.id, date);
			if (day !== null) result.push({ store: definition, date, day });
		}
	}
	return result;
}

export function dailyRows(seeded: SeededDataset): EngineRow[] {
	return storeDays(seeded).flatMap(({ store, date, day }) =>
		day.daily === null
			? []
			: [
					{
						store_id: store.id,
						business_date: date,
						invoices: day.daily.invoices,
						gross_amount: amount(day.daily.grossMinor),
						item_discount_amount: amount(day.daily.itemDiscountMinor),
						bill_discount_amount: amount(day.daily.billDiscountMinor),
						voucher_amount: amount(day.daily.voucherMinor),
						net_amount: amount(day.daily.netMinor),
						paid_amount: amount(day.daily.paidMinor),
						cash_amount: amount(day.daily.cashMinor),
						items_sold: units(day.daily.itemsMilli),
						modifier_lines: day.daily.modifierLines,
						voucher_invoices: day.daily.voucherInvoices,
						member_invoices: day.daily.memberInvoices,
						identified_invoices: day.daily.identifiedInvoices,
						voided_invoices: day.daily.voidedInvoices,
						voided_amount: amount(day.daily.voidedMinor),
						edited_invoices: day.daily.editedInvoices,
					},
				],
	);
}

export function hourlyRows(seeded: SeededDataset): EngineRow[] {
	return storeDays(seeded).flatMap(({ store, date, day }) =>
		day.hourly.map((hour) => ({
			store_id: store.id,
			business_date: date,
			hour_local: hour.hour,
			invoices: hour.invoices,
			net_amount: amount(hour.netMinor),
			items_sold: units(hour.itemsMilli),
		})),
	);
}

export function itemRows(seeded: SeededDataset): EngineRow[] {
	return storeDays(seeded).flatMap(({ store, date, day }) =>
		day.items.map((item) => ({
			store_id: store.id,
			business_date: date,
			item_external_id: item.itemExternalId,
			item_name: item.itemName,
			base_name: item.baseName,
			size_label: item.sizeLabel,
			item_type_external_id: item.itemTypeExternalId,
			item_type_name: item.itemTypeName,
			quantity: units(item.quantityMilli),
			net_amount: amount(item.netMinor),
			invoices: item.invoices,
		})),
	);
}

export function paymentRows(seeded: SeededDataset): EngineRow[] {
	return storeDays(seeded).flatMap(({ store, date, day }) =>
		day.payments.map((payment) => ({
			store_id: store.id,
			business_date: date,
			payment_method_external_id: payment.methodExternalId,
			payment_method_name: payment.methodName,
			kind: payment.kind,
			invoices: payment.invoices,
			amount: amount(payment.amountMinor),
			fee_amount: amount(payment.feeMinor),
			fee_estimate_amount: amount(payment.feeEstimateMinor),
		})),
	);
}

export function sizeRows(seeded: SeededDataset): EngineRow[] {
	return storeDays(seeded).flatMap(({ store, date, day }) =>
		day.sizes.map((size) => ({
			store_id: store.id,
			business_date: date,
			base_name: size.baseName,
			size_label: size.sizeLabel,
			quantity: units(size.quantityMilli),
			net_amount: amount(size.netMinor),
		})),
	);
}

export function attachRows(seeded: SeededDataset): EngineRow[] {
	return storeDays(seeded).flatMap(({ store, date, day }) =>
		day.attach === null
			? []
			: [
					{
						store_id: store.id,
						business_date: date,
						drink_invoices: day.attach.drinkInvoices,
						topping_invoices: day.attach.toppingInvoices,
						snack_invoices: day.attach.snackInvoices,
						topping_lines: day.attach.toppingLines,
						snack_lines: day.attach.snackLines,
						attach_rate_topping:
							day.attach.attachRateTopping?.toNumber() ?? null,
						attach_rate_snack: day.attach.attachRateSnack?.toNumber() ?? null,
					},
				],
	);
}

export function shiftCashRows(seeded: SeededDataset): EngineRow[] {
	return storeDays(seeded).flatMap(({ store, day }) =>
		day.shifts.map((shift) => ({
			store_id: store.id,
			shift_external_id: shift.shiftExternalId,
			business_date: shift.businessDate,
			cashier_name: shift.cashierName,
			opened_at: shift.openedAt,
			closed_at: shift.closedAt,
			orders: shift.orders,
			sales_amount: amount(shift.salesMinor),
			cash_sales_amount: amount(shift.cashSalesMinor),
			opening_float_amount: amount(shift.openingFloatMinor),
			expected_cash_amount: amount(shift.expectedCashMinor),
			drawer_amount: amount(shift.drawerMinor),
			variance_amount: amount(shift.varianceMinor),
		})),
	);
}
