import { type GeneratedDay, MENU } from "@fnb/connector-mock";
import {
	businessDate,
	type CanonicalLine,
	type CanonicalSale,
	type PaymentKind,
	roundMoney,
} from "@fnb/core";
import type { IsoDate, PromotionKind } from "@fnb/reports";
import { toDbLineKind } from "@fnb/sync";
import type { DemoStoreDefinition } from "./calendar.js";
import { DEFAULT_INGEST_MAPPINGS, type IngestMappings } from "./mappings.js";
import { PgDecimal } from "./pg-numeric.js";

export interface DailyAggregate {
	readonly invoices: number;
	readonly grossMinor: number;
	readonly itemDiscountMinor: number;
	readonly billDiscountMinor: number;
	readonly voucherMinor: number;
	readonly netMinor: number;
	readonly paidMinor: number;
	readonly cashMinor: number;
	readonly itemsMilli: number;
	readonly modifierLines: number;
	readonly voucherInvoices: number;
	readonly memberInvoices: number;
	readonly identifiedInvoices: number;
	readonly voidedInvoices: number;
	readonly voidedMinor: number;
	readonly editedInvoices: number;
}

export interface HourlyAggregate {
	readonly hour: number;
	readonly invoices: number;
	readonly netMinor: number;
	readonly itemsMilli: number;
}

export interface ItemAggregate {
	readonly itemExternalId: string;
	readonly itemName: string;
	readonly baseName: string | null;
	readonly sizeLabel: string | null;
	readonly itemTypeExternalId: string | null;
	readonly itemTypeName: string | null;
	readonly quantityMilli: number;
	readonly netMinor: number;
	readonly invoices: number;
}

export interface PaymentAggregate {
	readonly methodExternalId: string;
	readonly methodName: string | null;
	readonly kind: PaymentKind;
	readonly invoices: number;
	readonly amountMinor: number;
	readonly feeMinor: number;
	readonly feeEstimateMinor: number;
}

export interface SizeAggregate {
	readonly baseName: string;
	readonly sizeLabel: string;
	readonly quantityMilli: number;
	readonly netMinor: number;
}

export interface AttachAggregate {
	readonly drinkInvoices: number;
	readonly toppingInvoices: number;
	readonly snackInvoices: number;
	readonly toppingLines: number;
	readonly snackLines: number;
	readonly attachRateTopping: PgDecimal | null;
	readonly attachRateSnack: PgDecimal | null;
}

export interface ShiftAggregate {
	readonly shiftId: string;
	readonly shiftExternalId: string;
	readonly shiftName: string | null;
	readonly businessDate: IsoDate;
	readonly cashierName: string | null;
	readonly openedAt: string;
	readonly closedAt: string | null;
	readonly orders: number;
	readonly salesMinor: number;
	readonly cashSalesMinor: number;
	readonly openingFloatMinor: number | null;
	readonly expectedCashMinor: number | null;
	readonly drawerMinor: number | null;
	readonly varianceMinor: number | null;
}

export interface PromotionUsage {
	readonly kind: PromotionKind;
	readonly key: string;
	readonly name: string | null;
	readonly invoices: number;
	readonly lines: number;
	readonly discountMinor: number;
}

export interface DrinkAttach {
	readonly itemExternalId: string;
	readonly itemName: string;
	readonly drinkInvoices: number;
	readonly toppingInvoices: number;
	readonly snackInvoices: number;
}

export interface StoreDayAggregates {
	readonly storeId: string;
	readonly date: IsoDate;
	readonly daily: DailyAggregate | null;
	readonly hourly: readonly HourlyAggregate[];
	readonly items: readonly ItemAggregate[];
	readonly payments: readonly PaymentAggregate[];
	readonly sizes: readonly SizeAggregate[];
	readonly attach: AttachAggregate | null;
	readonly drinks: readonly DrinkAttach[];
	readonly pairs: ReadonlyMap<string, number>;
	readonly invoicesWithItems: number;
	readonly shifts: readonly ShiftAggregate[];
	readonly promotions: readonly PromotionUsage[];
	readonly itemLines: number;
	readonly removedLinesByDate: ReadonlyMap<IsoDate, number>;
}

export function minorUnits(value: number): number {
	return Math.round(roundMoney(value, 2) * 100);
}

export function thousandths(value: number): number {
	return Math.round(roundMoney(value, 3) * 1000);
}

export function textOrNull(value: string | null | undefined): string | null {
	if (value === undefined || value === null) return null;
	const cleaned = value.includes("\u0000")
		? value.replaceAll("\u0000", "")
		: value;
	if (startsWithVisibleAscii(cleaned)) return cleaned;
	return cleaned.trim() === "" ? null : cleaned;
}

function startsWithVisibleAscii(text: string): boolean {
	const code = text.charCodeAt(0);
	return code > 32 && code < 127;
}

function maxText(left: string | null, right: string | null): string | null {
	if (left === null) return right;
	if (right === null) return left;
	return right > left ? right : left;
}

interface PaymentMethodInfo {
	readonly name: string;
	readonly kind: PaymentKind;
}

const paymentMethods: ReadonlyMap<string, PaymentMethodInfo> = new Map(
	MENU.catalog.paymentMethods.map((method) => [
		method.externalId,
		{ name: method.name, kind: method.kind },
	]),
);

export function paymentMethodOf(
	externalId: string | null,
): PaymentMethodInfo | undefined {
	return externalId === null ? undefined : paymentMethods.get(externalId);
}

const hourOffsets = new Map<string, Map<number, number>>();
const hourFormatters = new Map<string, Intl.DateTimeFormat>();

function hourOffsetsIn(timeZone: string): Map<number, number> {
	let offsets = hourOffsets.get(timeZone);
	if (offsets === undefined) {
		offsets = new Map();
		hourOffsets.set(timeZone, offsets);
	}
	return offsets;
}

function hourFormatter(timeZone: string): Intl.DateTimeFormat {
	let formatter = hourFormatters.get(timeZone);
	if (formatter === undefined) {
		formatter = new Intl.DateTimeFormat("en-GB", {
			timeZone,
			hourCycle: "h23",
			hour: "2-digit",
			minute: "2-digit",
		});
		hourFormatters.set(timeZone, formatter);
	}
	return formatter;
}

export function localHour(instant: Date, timeZone: string): number {
	const time = instant.getTime();
	const offsets = hourOffsetsIn(timeZone);
	const hourKey = Math.floor(time / 3_600_000);
	let offset = offsets.get(hourKey);
	if (offset === undefined) {
		const parts = hourFormatter(timeZone).formatToParts(instant);
		const hour = Number(parts.find((part) => part.type === "hour")?.value);
		const minute = Number(parts.find((part) => part.type === "minute")?.value);
		offset =
			(hour * 60 +
				minute -
				(instant.getUTCHours() * 60 + instant.getUTCMinutes()) +
				2880) %
			1440;
		offsets.set(hourKey, offset);
	}
	return new Date(time + offset * 60_000).getUTCHours();
}

function isItemLine(line: CanonicalLine): boolean {
	return toDbLineKind(line.lineKind) === "item";
}

function hasVoucher(sale: CanonicalSale): boolean {
	return (
		minorUnits(sale.voucherAmount) > 0 || textOrNull(sale.voucherCode) !== null
	);
}

function emptyDaily(): {
	-readonly [Key in keyof DailyAggregate]: DailyAggregate[Key];
} {
	return {
		invoices: 0,
		grossMinor: 0,
		itemDiscountMinor: 0,
		billDiscountMinor: 0,
		voucherMinor: 0,
		netMinor: 0,
		paidMinor: 0,
		cashMinor: 0,
		itemsMilli: 0,
		modifierLines: 0,
		voucherInvoices: 0,
		memberInvoices: 0,
		identifiedInvoices: 0,
		voidedInvoices: 0,
		voidedMinor: 0,
		editedInvoices: 0,
	};
}

function attachRate(
	numerator: number,
	denominator: number,
	mapped: boolean,
): PgDecimal | null {
	if (!mapped || denominator === 0) return null;
	return PgDecimal.integer(numerator)
		.div(PgDecimal.integer(denominator))
		.round(6);
}

export const PAIR_SEPARATOR = "\u0000";

export function pairKey(left: string, right: string): string {
	return left < right
		? `${left}${PAIR_SEPARATOR}${right}`
		: `${right}${PAIR_SEPARATOR}${left}`;
}

type Writable<T> = { -readonly [Key in keyof T]: T[Key] };
type Accumulating<T> = Writable<T> & { invoiceIds: Set<string> };

export function aggregateStoreDay(
	store: DemoStoreDefinition,
	day: GeneratedDay,
	mappings: IngestMappings = DEFAULT_INGEST_MAPPINGS,
): StoreDayAggregates {
	const date = day.date;
	const account = mappings.accountOf(store.id);
	const drinks = new Map<string, Writable<DrinkAttach>>();
	const pairs = new Map<string, number>();
	const daily = emptyDaily();
	const hourly = new Map<
		number,
		{ invoices: number; netMinor: number; itemsMilli: number }
	>();
	const items = new Map<string, Accumulating<ItemAggregate>>();
	const payments = new Map<string, Accumulating<PaymentAggregate>>();
	const sizes = new Map<string, Writable<SizeAggregate>>();
	const promotions = new Map<string, Accumulating<PromotionUsage>>();
	let itemLines = 0;
	let drinkInvoices = 0;
	let toppingInvoices = 0;
	let snackInvoices = 0;
	let toppingLines = 0;
	let snackLines = 0;
	let invoicesWithItems = 0;

	const usePromotion = (
		kind: PromotionKind,
		key: string,
		name: string | null,
		saleId: string,
		discountMinor: number,
		lines: number,
	) => {
		const mapKey = `${kind}|${key}`;
		const known = promotions.get(mapKey);
		if (known === undefined) {
			promotions.set(mapKey, {
				kind,
				key,
				name,
				invoices: 0,
				lines,
				discountMinor,
				invoiceIds: new Set([saleId]),
			});
			return;
		}
		known.name = maxText(known.name, name);
		known.lines += lines;
		known.discountMinor += discountMinor;
		known.invoiceIds.add(saleId);
	};

	for (const sale of day.sales) {
		if (sale.status === "voided") {
			daily.voidedInvoices += 1;
			daily.voidedMinor += minorUnits(sale.netAmount);
			continue;
		}
		let itemMilli = 0;
		let modifierLines = 0;
		for (const line of sale.lines) {
			const kind = toDbLineKind(line.lineKind);
			if (kind === "item") itemMilli += thousandths(line.quantity);
			else if (kind === "modifier") modifierLines += 1;
		}
		const cashMinor = sale.payments
			.filter(
				(payment) =>
					paymentMethodOf(textOrNull(payment.methodExternalId))?.kind ===
					"cash",
			)
			.reduce((total, payment) => total + minorUnits(payment.amount), 0);
		daily.invoices += 1;
		daily.grossMinor += minorUnits(sale.grossAmount);
		daily.itemDiscountMinor += minorUnits(sale.itemDiscountAmount);
		daily.billDiscountMinor += minorUnits(sale.billDiscountAmount);
		daily.voucherMinor += minorUnits(sale.voucherAmount);
		daily.netMinor += minorUnits(sale.netAmount);
		daily.paidMinor += minorUnits(sale.paidAmount);
		daily.cashMinor += cashMinor;
		daily.itemsMilli += itemMilli;
		daily.modifierLines += modifierLines;
		if (hasVoucher(sale)) daily.voucherInvoices += 1;
		const phone = textOrNull(sale.customerPhone);
		if (phone !== null) {
			daily.memberInvoices += 1;
			daily.identifiedInvoices += 1;
		}
		if (sale.status === "edited") daily.editedInvoices += 1;

		const hour = localHour(sale.soldAt, store.timeZone);
		const hourRow = hourly.get(hour) ?? {
			invoices: 0,
			netMinor: 0,
			itemsMilli: 0,
		};
		hourRow.invoices += 1;
		hourRow.netMinor += minorUnits(sale.netAmount);
		hourRow.itemsMilli += itemMilli;
		hourly.set(hour, hourRow);

		let hasDrink = false;
		let hasTopping = false;
		let hasSnack = false;
		let saleToppingLines = 0;
		let saleSnackLines = 0;
		let saleItemLines = 0;
		const saleKeys = new Set<string>();
		const saleDrinks = new Map<string, string>();
		for (const line of sale.lines) {
			if (!isItemLine(line)) continue;
			saleItemLines += 1;
			const itemName = line.itemName;
			const itemId = textOrNull(line.itemExternalId) ?? itemName;
			const known = items.get(itemId);
			const quantityMilli = thousandths(line.quantity);
			const netMinor = minorUnits(line.netAmount);
			if (known === undefined) {
				items.set(itemId, {
					itemExternalId: itemId,
					itemName,
					baseName: textOrNull(line.baseName),
					sizeLabel: textOrNull(line.sizeLabel),
					itemTypeExternalId: textOrNull(line.itemTypeExternalId),
					itemTypeName: textOrNull(line.itemTypeName),
					quantityMilli,
					netMinor,
					invoices: 0,
					invoiceIds: new Set([sale.externalId]),
				});
			} else {
				known.itemName = maxText(known.itemName, itemName) ?? itemName;
				known.baseName = maxText(known.baseName, textOrNull(line.baseName));
				known.sizeLabel = maxText(known.sizeLabel, textOrNull(line.sizeLabel));
				known.itemTypeExternalId = maxText(
					known.itemTypeExternalId,
					textOrNull(line.itemTypeExternalId),
				);
				known.itemTypeName = maxText(
					known.itemTypeName,
					textOrNull(line.itemTypeName),
				);
				known.quantityMilli += quantityMilli;
				known.netMinor += netMinor;
				known.invoiceIds.add(sale.externalId);
			}
			const sizeLabel = textOrNull(line.sizeLabel);
			if (sizeLabel !== null) {
				const baseName = textOrNull(line.baseName) ?? itemName;
				const sizeKey = `${baseName}\u0000${sizeLabel}`;
				const size = sizes.get(sizeKey);
				if (size === undefined) {
					sizes.set(sizeKey, {
						baseName,
						sizeLabel,
						quantityMilli,
						netMinor,
					});
				} else {
					size.baseName = baseName;
					size.sizeLabel = sizeLabel;
					size.quantityMilli += quantityMilli;
					size.netMinor += netMinor;
				}
			}
			const override = mappings.overrideOf(account, itemId);
			const role =
				mappings.roleOf(
					account,
					override?.itemTypeExternalId ?? textOrNull(line.itemTypeExternalId),
				) ?? "other";
			saleKeys.add(itemId);
			if (role === "drink") {
				hasDrink = true;
				saleDrinks.set(
					itemId,
					maxText(saleDrinks.get(itemId) ?? null, itemName) ?? itemName,
				);
			}
			if (role === "topping") {
				hasTopping = true;
				saleToppingLines += 1;
			}
			if (role === "snack") {
				hasSnack = true;
				saleSnackLines += 1;
			}
			const lineDiscount = minorUnits(line.discountAmount);
			if (lineDiscount > 0) {
				usePromotion(
					"item",
					textOrNull(line.promotionExternalId) ??
						textOrNull(line.promotionName) ??
						"unnamed",
					textOrNull(line.promotionName),
					sale.externalId,
					lineDiscount,
					1,
				);
			}
		}
		itemLines += saleItemLines;
		if (saleItemLines > 0) {
			invoicesWithItems += 1;
			const keys = [...saleKeys].sort((left, right) =>
				left < right ? -1 : left > right ? 1 : 0,
			);
			for (let first = 0; first < keys.length; first += 1) {
				for (let second = first + 1; second < keys.length; second += 1) {
					const key = `${keys[first]}${PAIR_SEPARATOR}${keys[second]}`;
					pairs.set(key, (pairs.get(key) ?? 0) + 1);
				}
			}
			if (hasDrink) {
				drinkInvoices += 1;
				if (hasTopping) toppingInvoices += 1;
				if (hasSnack) snackInvoices += 1;
				toppingLines += saleToppingLines;
				snackLines += saleSnackLines;
				for (const [key, name] of saleDrinks) {
					const known = drinks.get(key);
					if (known === undefined) {
						drinks.set(key, {
							itemExternalId: key,
							itemName: name,
							drinkInvoices: 1,
							toppingInvoices: hasTopping ? 1 : 0,
							snackInvoices: hasSnack ? 1 : 0,
						});
					} else {
						known.itemName = maxText(known.itemName, name) ?? name;
						known.drinkInvoices += 1;
						if (hasTopping) known.toppingInvoices += 1;
						if (hasSnack) known.snackInvoices += 1;
					}
				}
			}
		}

		const billMinor = minorUnits(sale.billDiscountAmount);
		if (billMinor > 0) {
			const name = textOrNull(sale.billDiscountName);
			usePromotion(
				"bill",
				name ?? "unnamed",
				name,
				sale.externalId,
				billMinor,
				0,
			);
		}
		if (hasVoucher(sale)) {
			const name = textOrNull(sale.voucherName);
			usePromotion(
				"voucher",
				name ?? textOrNull(sale.voucherCode) ?? "unnamed",
				name,
				sale.externalId,
				minorUnits(sale.voucherAmount),
				0,
			);
		}

		for (const payment of sale.payments) {
			const methodId = textOrNull(payment.methodExternalId) ?? "unknown";
			const method = paymentMethodOf(textOrNull(payment.methodExternalId));
			const known = payments.get(methodId);
			const amountMinor = minorUnits(payment.amount);
			const feeMinor = minorUnits(payment.feeAmount);
			if (known === undefined) {
				payments.set(methodId, {
					methodExternalId: methodId,
					methodName: method?.name ?? textOrNull(payment.methodName),
					kind: method?.kind ?? "other",
					invoices: 0,
					amountMinor,
					feeMinor,
					feeEstimateMinor: 0,
					invoiceIds: new Set([sale.externalId]),
				});
			} else {
				known.amountMinor += amountMinor;
				known.feeMinor += feeMinor;
				known.invoiceIds.add(sale.externalId);
			}
		}
	}

	const cashByShift = new Map<string, number>();
	for (const sale of day.sales) {
		if (sale.status === "voided") continue;
		const shiftId = textOrNull(sale.shiftExternalId);
		if (shiftId === null) continue;
		for (const payment of sale.payments) {
			if (
				paymentMethodOf(textOrNull(payment.methodExternalId))?.kind !== "cash"
			)
				continue;
			cashByShift.set(
				shiftId,
				(cashByShift.get(shiftId) ?? 0) + minorUnits(payment.amount),
			);
		}
	}

	const shifts: ShiftAggregate[] = day.shifts.map((shift) => {
		const shiftDate = businessDate(
			shift.openedAt,
			store.timeZone,
			store.businessDayStartMinutes,
		);
		const cashSalesMinor = cashByShift.get(shift.externalId) ?? 0;
		const openingFloatMinor =
			shift.openingFloatAmount === undefined
				? null
				: minorUnits(shift.openingFloatAmount);
		const expectedCashMinor =
			openingFloatMinor === null ? null : openingFloatMinor + cashSalesMinor;
		const drawerMinor =
			shift.cashDrawerAmount === undefined
				? null
				: minorUnits(shift.cashDrawerAmount);
		return {
			shiftId: `${store.id}:${shift.externalId}`,
			shiftExternalId: shift.externalId,
			shiftName: textOrNull(shift.name),
			businessDate: shiftDate,
			cashierName: textOrNull(shift.cashierName),
			openedAt: shift.openedAt.toISOString(),
			closedAt:
				shift.closedAt === undefined ? null : shift.closedAt.toISOString(),
			orders: shift.ordersCount,
			salesMinor: minorUnits(shift.salesAmount),
			cashSalesMinor,
			openingFloatMinor,
			expectedCashMinor,
			drawerMinor,
			varianceMinor:
				drawerMinor === null || expectedCashMinor === null
					? null
					: drawerMinor - expectedCashMinor,
		};
	});

	const removedLinesByDate = new Map<IsoDate, number>();
	for (const adjustment of day.adjustments) {
		if (adjustment.kind !== "line_removed") continue;
		const eventDate = businessDate(
			adjustment.occurredAt,
			store.timeZone,
			store.businessDayStartMinutes,
		);
		removedLinesByDate.set(
			eventDate,
			(removedLinesByDate.get(eventDate) ?? 0) + 1,
		);
	}

	const hasToppingRole = mappings.mapsRole(account, "topping");
	const hasSnackRole = mappings.mapsRole(account, "snack");

	return {
		storeId: store.id,
		date,
		daily: day.sales.length > 0 ? { ...daily } : null,
		hourly: [...hourly.entries()]
			.sort(([left], [right]) => left - right)
			.map(([hour, row]) => ({ hour, ...row })),
		items: [...items.values()].map(({ invoiceIds, ...item }) => ({
			...item,
			invoices: invoiceIds.size,
		})),
		payments: [...payments.values()].map(({ invoiceIds, ...payment }) => ({
			...payment,
			invoices: invoiceIds.size,
		})),
		sizes: [...sizes.values()],
		attach:
			invoicesWithItems > 0
				? {
						drinkInvoices,
						toppingInvoices,
						snackInvoices,
						toppingLines,
						snackLines,
						attachRateTopping: attachRate(
							toppingInvoices,
							drinkInvoices,
							hasToppingRole,
						),
						attachRateSnack: attachRate(
							snackInvoices,
							drinkInvoices,
							hasSnackRole,
						),
					}
				: null,
		drinks: [...drinks.values()],
		pairs,
		invoicesWithItems,
		shifts,
		promotions: [...promotions.values()].map(({ invoiceIds, ...usage }) => ({
			...usage,
			invoices: invoiceIds.size,
		})),
		itemLines,
		removedLinesByDate,
	};
}
