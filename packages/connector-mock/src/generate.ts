import {
	type CanonicalAdjustment,
	type CanonicalDailyTotal,
	type CanonicalLine,
	type CanonicalPayment,
	type CanonicalSale,
	type CanonicalShift,
	type CanonicalStore,
	type Channel,
	instantOnBusinessDate,
	isoDatesBetween,
	MINUTES_PER_DAY,
	type PaymentKind,
	parseIsoDate,
	roundMoney,
	sumMoney,
} from "@fnb/core";
import { MENU, type Menu, type MenuItem } from "./menu.js";
import { hashSeed, mulberry32, type Rng } from "./prng.js";
import type { MockProfile, ShiftTemplate } from "./profile.js";

export interface GeneratedDay {
	date: string;
	sales: CanonicalSale[];
	shifts: CanonicalShift[];
	adjustments: CanonicalAdjustment[];
	dailyTotal: CanonicalDailyTotal;
}

export interface GeneratedData {
	sales: CanonicalSale[];
	shifts: CanonicalShift[];
	adjustments: CanonicalAdjustment[];
	dailyTotals: CanonicalDailyTotal[];
}

const CHANNEL_SOURCES: Record<Channel, { id: string; name: string }> = {
	dine_in: { id: "SRC-01", name: "TẠI CHỖ" },
	take_away: { id: "SRC-02", name: "MANG VỀ" },
	delivery: { id: "SRC-03", name: "GIAO HÀNG" },
	other: { id: "SRC-01", name: "TẠI CHỖ" },
};

const ITEM_DISCOUNT_PROMOTION = { id: "PROMO-04", name: "Giảm giá món" };
const BILL_DISCOUNT_NAME = "Giảm giá hoá đơn";
const CASHIER = { id: "E-01", name: "Thu ngân" };
const MINUTE_MS = 60_000;

export function mockStore(index: number, profile: MockProfile): CanonicalStore {
	return {
		externalId: `MOCK-S${index}`,
		name: `Cửa hàng mẫu ${index}`,
		address: `${index} Đường Mẫu`,
		timezone: profile.timezone,
		dayStartMinutes: profile.dayStartMinutes,
		currency: profile.currency,
		openedOn: "2024-01-01",
	};
}

function weekdayIndex(date: string): number {
	const { year, month, day } = parseIsoDate(date);
	return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

const weightedKeysByMix = new WeakMap<
	object,
	{ readonly keys: readonly string[]; readonly weights: readonly number[] }
>();

function weightedKeys<K extends string>(
	mix: Readonly<Partial<Record<K, number>>>,
): { readonly keys: readonly K[]; readonly weights: readonly number[] } {
	const cached = weightedKeysByMix.get(mix);
	if (cached !== undefined) {
		return cached as { keys: readonly K[]; weights: readonly number[] };
	}
	const entries = Object.entries(mix) as [K, number | undefined][];
	const keys = entries.map(([key]) => key);
	const weights = entries.map(([, weight]) => weight ?? 0);
	const computed = { keys, weights };
	weightedKeysByMix.set(mix, computed);
	return computed;
}

function pickKey<K extends string>(
	rng: Rng,
	mix: Readonly<Partial<Record<K, number>>>,
	fallback: K,
): K {
	const { keys, weights } = weightedKeys(mix);
	return keys[rng.weightedIndex(weights)] ?? fallback;
}

function toThousands(value: number): number {
	return Math.round(value / 1_000) * 1_000;
}

function groupDrinksByBase(menu: Menu): MenuItem[][] {
	const groups = new Map<string, MenuItem[]>();
	for (const drink of menu.drinks) {
		const group = groups.get(drink.baseName) ?? [];
		group.push(drink);
		groups.set(drink.baseName, group);
	}
	return [...groups.values()];
}

interface LineFactory {
	next(item: MenuItem, overrides: Partial<CanonicalLine>): CanonicalLine;
}

function lineFactory(saleId: string): LineFactory {
	let sequence = 0;
	return {
		next(item, overrides) {
			sequence += 1;
			const quantity = overrides.quantity ?? 1;
			const unitPrice = overrides.unitPrice ?? item.listPrice;
			const grossAmount = roundMoney(unitPrice * quantity);
			const discountAmount = overrides.discountAmount ?? 0;
			return {
				externalId: `${saleId}-L${sequence}`,
				lineKind: item.isModifier ? "modifier" : "item",
				itemExternalId: item.externalId,
				itemName: item.name,
				baseName: item.baseName,
				sizeLabel: item.sizeLabel,
				itemTypeExternalId: item.itemTypeExternalId,
				itemTypeName: item.itemTypeName,
				itemClassName: item.itemClassName,
				unitName: "Ly",
				quantity,
				unitPrice,
				grossAmount,
				discountAmount,
				netAmount: roundMoney(grossAmount - discountAmount),
				raw: { itemExternalId: item.externalId },
				...overrides,
			};
		},
	};
}

function buildLines(
	rng: Rng,
	profile: MockProfile,
	menu: Menu,
	drinkGroups: readonly MenuItem[][],
	saleId: string,
): CanonicalLine[] {
	const lines: CanonicalLine[] = [];
	const factory = lineFactory(saleId);
	const itemCount = rng.weightedIndex(profile.linesPerSaleWeights) + 1;
	for (let index = 0; index < itemCount; index += 1) {
		const group = rng.pick(drinkGroups);
		const large = group.find((item) => item.sizeLabel === "L");
		const medium = group.find((item) => item.sizeLabel !== "L") ?? group[0];
		const drink =
			large && rng.chance(profile.largeSizeShare) ? large : (medium ?? large);
		if (!drink) {
			continue;
		}
		const quantity = rng.chance(profile.doubleQuantityRate) ? 2 : 1;
		const gross = drink.listPrice * quantity;
		const discounted = rng.chance(profile.itemDiscountRate);
		const drinkLine = factory.next(drink, {
			quantity,
			discountAmount: discounted ? toThousands(gross * 0.1) : 0,
			...(discounted
				? {
						promotionExternalId: ITEM_DISCOUNT_PROMOTION.id,
						promotionName: ITEM_DISCOUNT_PROMOTION.name,
					}
				: {}),
		});
		lines.push(drinkLine);
		if (rng.chance(profile.modifierRate)) {
			const group = rng.pick(menu.modifierGroups);
			lines.push(
				factory.next(rng.pick(group.options), {
					parentLineExternalId: drinkLine.externalId,
					unitName: undefined,
				}),
			);
		}
		if (rng.chance(profile.toppingRate)) {
			lines.push(
				factory.next(rng.pick(menu.toppings), {
					parentLineExternalId: drinkLine.externalId,
					unitName: "Phần",
				}),
			);
		}
		if (rng.chance(profile.freeToppingRate)) {
			lines.push(
				factory.next(rng.pick(menu.freeToppings), {
					parentLineExternalId: drinkLine.externalId,
					unitName: "Phần",
				}),
			);
		}
	}
	if (rng.chance(profile.snackRate)) {
		lines.push(factory.next(rng.pick(menu.snacks), { unitName: "Phần" }));
	}
	return lines;
}

function buildPayments(
	rng: Rng,
	profile: MockProfile,
	menu: Menu,
	netAmount: number,
): CanonicalPayment[] {
	const methodFor = (kind: PaymentKind) => {
		const method = menu.catalog.paymentMethods.find(
			(candidate) => candidate.kind === kind,
		);
		if (!method) {
			throw new Error(`mock menu has no payment method of kind ${kind}`);
		}
		return method;
	};
	const payment = (kind: PaymentKind, amount: number): CanonicalPayment => {
		const method = methodFor(kind);
		return {
			methodExternalId: method.externalId,
			methodName: method.name,
			kind,
			amount,
			feeAmount: 0,
			raw: null,
		};
	};
	const firstKind = pickKey(rng, profile.paymentMix, "cash");
	if (netAmount >= 20_000 && rng.chance(profile.splitBillRate)) {
		const otherKinds = (
			Object.keys(profile.paymentMix) as PaymentKind[]
		).filter((kind) => kind !== firstKind);
		const sameMethod =
			otherKinds.length === 0 || rng.chance(profile.sameMethodSplitRate);
		const secondKind = sameMethod ? firstKind : rng.pick(otherKinds);
		const firstAmount = toThousands(netAmount / 2);
		return [
			payment(firstKind, firstAmount),
			payment(secondKind, roundMoney(netAmount - firstAmount)),
		];
	}
	return [payment(firstKind, netAmount)];
}

function shiftIndexFor(
	minutesOfDay: number,
	shifts: readonly ShiftTemplate[],
): number {
	const index = shifts.findIndex(
		(shift) =>
			minutesOfDay >= shift.startMinutes && minutesOfDay < shift.endMinutes,
	);
	if (index >= 0) {
		return index;
	}
	return minutesOfDay < (shifts[0]?.startMinutes ?? 0) ? 0 : shifts.length - 1;
}

function shiftId(store: CanonicalStore, date: string, index: number): string {
	return `${store.externalId}-${date}-S${index + 1}`;
}

interface SaleDraft {
	sale: CanonicalSale;
	minutesOfDay: number;
	adjustment: CanonicalAdjustment | null;
}

function boundaryMinute(
	profile: MockProfile,
	sequence: number,
	count: number,
): number | undefined {
	if (!profile.boundarySales) {
		return undefined;
	}
	if (sequence === 1) {
		return profile.dayStartMinutes;
	}
	if (sequence === 2 && count >= 2) {
		return (profile.dayStartMinutes + MINUTES_PER_DAY - 1) % MINUTES_PER_DAY;
	}
	return undefined;
}

function buildSale(
	rng: Rng,
	profile: MockProfile,
	menu: Menu,
	drinkGroups: readonly MenuItem[][],
	store: CanonicalStore,
	date: string,
	sequence: number,
	forcedMinute: number | undefined,
): SaleDraft {
	const hour = rng.weightedIndex(profile.hourlyWeights);
	const minutesOfDay = forcedMinute ?? hour * 60 + rng.int(0, 59);
	const soldAt = instantOnBusinessDate(
		date,
		minutesOfDay,
		store.timezone,
		store.dayStartMinutes,
	);
	soldAt.setUTCSeconds(rng.int(0, 59), 0);
	const saleId = `${store.externalId}-${date.replaceAll("-", "")}-${String(sequence).padStart(4, "0")}`;
	const lines = buildLines(rng, profile, menu, drinkGroups, saleId);
	const grossAmount = sumMoney(lines.map((line) => line.grossAmount));
	const itemDiscountAmount = sumMoney(lines.map((line) => line.discountAmount));
	const linesNet = sumMoney(lines.map((line) => line.netAmount));
	const billDiscountAmount = rng.chance(profile.billDiscountRate)
		? toThousands(linesNet * 0.05)
		: 0;
	const voucherCandidate = rng.chance(profile.voucherRate)
		? rng.pick(profile.voucherAmounts)
		: 0;
	const voucherAmount = Math.min(
		voucherCandidate,
		linesNet - billDiscountAmount,
	);
	const netAmount = roundMoney(linesNet - billDiscountAmount - voucherAmount);
	const payments = buildPayments(rng, profile, menu, netAmount);
	const channel = pickKey(rng, profile.channelMix, "dine_in");
	const source = CHANNEL_SOURCES[channel];
	const shiftIndex = shiftIndexFor(minutesOfDay, profile.shifts);
	const captured = rng.chance(profile.customerCaptureRate);
	const guestCount = rng.chance(profile.guestCountRate) ? rng.int(1, 4) : 0;
	const voided = rng.chance(profile.voidRate);
	const edited = !voided && rng.chance(profile.editRate);
	const status = voided ? "voided" : edited ? "edited" : "completed";
	const sale: CanonicalSale = {
		externalId: saleId,
		receiptNo: `HD${date.replaceAll("-", "").slice(2)}${String(sequence).padStart(4, "0")}`,
		soldAt,
		businessDate: date,
		openedAt: new Date(soldAt.getTime() - rng.int(1, 3) * MINUTE_MS),
		closedAt: soldAt,
		channel,
		sourceExternalId: source.id,
		sourceName: source.name,
		tableName: `BÀN ${rng.int(1, 30)}`,
		areaName: "Tầng 1",
		shiftExternalId: shiftId(store, date, shiftIndex),
		employeeExternalId: CASHIER.id,
		employeeName: CASHIER.name,
		guestCount,
		...(captured
			? {
					customerPhone: `09${rng.int(10_000_000, 99_999_999)}`,
					customerName: "Khách quen",
				}
			: {}),
		grossAmount,
		itemDiscountAmount,
		billDiscountAmount,
		...(billDiscountAmount > 0 ? { billDiscountName: BILL_DISCOUNT_NAME } : {}),
		...(voucherAmount > 0
			? {
					voucherCode: `VC-${voucherCandidate / 1_000}K`,
					voucherName: `Voucher ${voucherCandidate / 1_000}k`,
				}
			: {}),
		voucherAmount,
		partnerMarketingAmount: 0,
		serviceChargeAmount: 0,
		shippingFeeAmount: 0,
		vatAmount: 0,
		netAmount,
		paidAmount: netAmount,
		status,
		lines,
		payments,
		raw: { generator: "mock", sequence },
	};
	const adjustment: CanonicalAdjustment | null = voided
		? {
				kind: "voided",
				saleExternalId: saleId,
				occurredAt: new Date(soldAt.getTime() + 5 * MINUTE_MS),
				amount: netAmount,
				reason: "Khách huỷ đơn",
				raw: null,
			}
		: edited
			? buildEditAdjustment(rng, sale)
			: null;
	return { sale, minutesOfDay, adjustment };
}

const EDIT_REASON = "Sửa hoá đơn sau khi in tạm tính";

function buildEditAdjustment(
	rng: Rng,
	sale: CanonicalSale,
): CanonicalAdjustment {
	const occurredAt = new Date(sale.soldAt.getTime() + 10 * MINUTE_MS);
	const removedLine =
		sale.lines.find((line) => line.lineKind === "item") ?? sale.lines[0];
	if (rng.chance(0.5) || !removedLine) {
		return {
			kind: "edited",
			saleExternalId: sale.externalId,
			relatedSaleExternalId: `${sale.externalId}-ORIGIN`,
			occurredAt,
			amount: removedLine?.netAmount ?? sale.netAmount,
			reason: EDIT_REASON,
			raw: null,
		};
	}
	return {
		kind: "line_removed",
		saleExternalId: sale.externalId,
		lineExternalId: removedLine.externalId,
		itemExternalId: removedLine.itemExternalId,
		itemName: removedLine.itemName,
		quantity: removedLine.quantity,
		occurredAt,
		amount: removedLine.grossAmount,
		reason: EDIT_REASON,
		raw: null,
	};
}

function buildShifts(
	rng: Rng,
	profile: MockProfile,
	store: CanonicalStore,
	date: string,
	drafts: readonly SaleDraft[],
): CanonicalShift[] {
	return profile.shifts.map((template, index) => {
		const inShift = drafts.filter(
			(draft) =>
				draft.sale.status !== "voided" &&
				shiftIndexFor(draft.minutesOfDay, profile.shifts) === index,
		);
		const salesAmount = sumMoney(inShift.map((draft) => draft.sale.netAmount));
		const cashAmount = sumMoney(
			inShift.flatMap((draft) =>
				draft.sale.payments
					.filter((payment) => payment.kind === "cash")
					.map((payment) => payment.amount),
			),
		);
		const variance = rng.chance(profile.drawerVarianceRate)
			? rng.pick([-20_000, -10_000, -5_000, 5_000, 10_000])
			: 0;
		return {
			externalId: shiftId(store, date, index),
			name: template.name,
			cashierExternalId: CASHIER.id,
			cashierName: CASHIER.name,
			openedAt: instantOnBusinessDate(
				date,
				template.startMinutes,
				store.timezone,
				store.dayStartMinutes,
			),
			closedAt: instantOnBusinessDate(
				date,
				template.endMinutes,
				store.timezone,
				store.dayStartMinutes,
			),
			salesAmount,
			ordersCount: inShift.length,
			cashDrawerAmount: roundMoney(
				profile.openingFloatAmount + cashAmount + variance,
			),
			openingFloatAmount: profile.openingFloatAmount,
			changedAfterClose: rng.chance(0.05),
			status: "closed",
			deviceCode: "POS-01",
			raw: { variance },
		};
	});
}

function buildDailyTotal(
	date: string,
	sales: readonly CanonicalSale[],
): CanonicalDailyTotal {
	const counted = sales.filter((sale) => sale.status !== "voided");
	return {
		businessDate: date,
		invoiceCount: counted.length,
		grossAmount: sumMoney(counted.map((sale) => sale.grossAmount)),
		discountAmount: sumMoney(
			counted.map((sale) => sale.itemDiscountAmount + sale.billDiscountAmount),
		),
		voucherAmount: sumMoney(counted.map((sale) => sale.voucherAmount)),
		netAmount: sumMoney(counted.map((sale) => sale.netAmount)),
		raw: { generator: "mock" },
	};
}

export function generateDay(
	seed: number,
	profile: MockProfile,
	store: CanonicalStore,
	date: string,
	menu: Menu = MENU,
): GeneratedDay {
	const rng = mulberry32(hashSeed(seed, store.externalId, date));
	const meanWeight =
		profile.weekdayWeights.reduce((sum, weight) => sum + weight, 0) /
		Math.max(1, profile.weekdayWeights.length);
	const weekdayWeight =
		profile.weekdayWeights[weekdayIndex(date)] ?? meanWeight;
	const jitter = 0.9 + rng.next() * 0.2;
	const count = Math.max(
		1,
		Math.round(
			(profile.averageSalesPerDay * weekdayWeight * jitter) / meanWeight,
		),
	);
	const drinkGroups = groupDrinksByBase(menu);
	const drafts: SaleDraft[] = [];
	for (let sequence = 1; sequence <= count; sequence += 1) {
		drafts.push(
			buildSale(
				rng,
				profile,
				menu,
				drinkGroups,
				store,
				date,
				sequence,
				boundaryMinute(profile, sequence, count),
			),
		);
	}
	drafts.sort(
		(left, right) =>
			left.sale.soldAt.getTime() - right.sale.soldAt.getTime() ||
			left.sale.externalId.localeCompare(right.sale.externalId),
	);
	const sales = drafts.map((draft) => draft.sale);
	return {
		date,
		sales,
		shifts: buildShifts(rng, profile, store, date, drafts),
		adjustments: drafts.flatMap((draft) =>
			draft.adjustment ? [draft.adjustment] : [],
		),
		dailyTotal: buildDailyTotal(date, sales),
	};
}

export function generateDays(
	seed: number,
	profile: MockProfile,
	fromDate: string,
	toDate: string,
	store: CanonicalStore = mockStore(1, profile),
	menu: Menu = MENU,
): GeneratedData {
	const days = isoDatesBetween(fromDate, toDate).map((date) =>
		generateDay(seed, profile, store, date, menu),
	);
	return {
		sales: days.flatMap((day) => day.sales),
		shifts: days.flatMap((day) => day.shifts),
		adjustments: days.flatMap((day) => day.adjustments),
		dailyTotals: days.map((day) => day.dailyTotal),
	};
}
