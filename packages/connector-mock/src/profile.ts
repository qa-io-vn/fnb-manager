import type { Channel, PaymentKind } from "@fnb/core";

export interface ShiftTemplate {
	name: string;
	startMinutes: number;
	endMinutes: number;
}

export interface MockProfile {
	timezone: string;
	dayStartMinutes: number;
	currency: string;
	averageSalesPerDay: number;
	hourlyWeights: readonly number[];
	weekdayWeights: readonly number[];
	linesPerSaleWeights: readonly number[];
	largeSizeShare: number;
	doubleQuantityRate: number;
	modifierRate: number;
	toppingRate: number;
	freeToppingRate: number;
	snackRate: number;
	itemDiscountRate: number;
	billDiscountRate: number;
	voucherRate: number;
	voucherAmounts: readonly number[];
	paymentMix: Readonly<Partial<Record<PaymentKind, number>>>;
	splitBillRate: number;
	sameMethodSplitRate: number;
	boundarySales: boolean;
	channelMix: Readonly<Partial<Record<Channel, number>>>;
	customerCaptureRate: number;
	guestCountRate: number;
	shifts: readonly ShiftTemplate[];
	openingFloatAmount: number;
	drawerVarianceRate: number;
	voidRate: number;
	editRate: number;
}

export const DEFAULT_MOCK_PROFILE: MockProfile = {
	timezone: "Asia/Ho_Chi_Minh",
	dayStartMinutes: 0,
	currency: "VND",
	averageSalesPerDay: 100,
	hourlyWeights: [
		0, 0, 0, 0, 0, 0, 0, 3, 18, 23, 15, 10, 14, 15, 14, 9, 9, 6, 4, 16, 58, 28,
		5, 0,
	],
	weekdayWeights: [55, 25, 27, 27, 30, 41, 41],
	linesPerSaleWeights: [0.45, 0.35, 0.2],
	largeSizeShare: 0.4,
	doubleQuantityRate: 0.08,
	modifierRate: 0.2,
	toppingRate: 0.12,
	freeToppingRate: 0.03,
	snackRate: 0.1,
	itemDiscountRate: 0.03,
	billDiscountRate: 0.02,
	voucherRate: 0.1,
	voucherAmounts: [10_000, 15_000, 20_000],
	paymentMix: { ewallet: 0.55, cash: 0.25, bank_transfer: 0.2 },
	splitBillRate: 0.03,
	sameMethodSplitRate: 0.3,
	boundarySales: true,
	channelMix: { dine_in: 0.96, take_away: 0.03, delivery: 0.01 },
	customerCaptureRate: 0,
	guestCountRate: 0,
	shifts: [
		{ name: "Ca sáng", startMinutes: 6 * 60 + 30, endMinutes: 12 * 60 },
		{ name: "Ca chiều", startMinutes: 12 * 60, endMinutes: 17 * 60 + 30 },
		{ name: "Ca tối", startMinutes: 17 * 60 + 30, endMinutes: 23 * 60 },
	],
	openingFloatAmount: 1_500_000,
	drawerVarianceRate: 0.1,
	voidRate: 0.01,
	editRate: 0.01,
};

export function resolveProfile(
	overrides: Partial<MockProfile> = {},
): MockProfile {
	return { ...DEFAULT_MOCK_PROFILE, ...overrides };
}
