import type {
	CanonicalDailyTotal,
	CanonicalLine,
	CanonicalPayment,
	CanonicalSale,
} from "@fnb/core";

export function itemLine(
	externalId: string,
	overrides: Partial<CanonicalLine> = {},
): CanonicalLine {
	return {
		externalId,
		lineKind: "item",
		itemExternalId: "ITEM-1",
		itemName: "Trà đào (M)",
		baseName: "Trà đào",
		sizeLabel: "M",
		itemTypeExternalId: "TYPE-1",
		itemTypeName: "Trà trái cây",
		itemClassName: "Đồ uống",
		unitName: "Ly",
		quantity: 1,
		unitPrice: 45_000,
		grossAmount: 45_000,
		discountAmount: 0,
		netAmount: 45_000,
		raw: { line: externalId },
		...overrides,
	};
}

export function cashPayment(
	amount: number,
	overrides: Partial<CanonicalPayment> = {},
): CanonicalPayment {
	return {
		methodExternalId: "PM-CASH",
		methodName: "Tiền mặt",
		kind: "cash",
		amount,
		feeAmount: 0,
		raw: null,
		...overrides,
	};
}

export function sale(
	externalId: string,
	soldAt: string,
	businessDate: string,
	overrides: Partial<CanonicalSale> = {},
): CanonicalSale {
	const net = overrides.netAmount ?? 45_000;
	return {
		externalId,
		receiptNo: `R-${externalId}`,
		soldAt: new Date(soldAt),
		businessDate,
		channel: "dine_in",
		guestCount: 0,
		grossAmount: net,
		itemDiscountAmount: 0,
		billDiscountAmount: 0,
		voucherAmount: 0,
		partnerMarketingAmount: 0,
		serviceChargeAmount: 0,
		shippingFeeAmount: 0,
		vatAmount: 0,
		netAmount: net,
		paidAmount: net,
		status: "completed",
		lines: [
			itemLine(`${externalId}-L1`, {
				unitPrice: net,
				grossAmount: net,
				netAmount: net,
			}),
		],
		payments: [cashPayment(net)],
		raw: { id: externalId },
		...overrides,
	};
}

export function totalsFor(
	sales: readonly CanonicalSale[],
): CanonicalDailyTotal[] {
	const byDate = new Map<string, { count: number; net: number }>();
	for (const entry of sales) {
		if (entry.status === "voided") {
			continue;
		}
		const total = byDate.get(entry.businessDate) ?? { count: 0, net: 0 };
		total.count += 1;
		total.net += entry.netAmount;
		byDate.set(entry.businessDate, total);
	}
	return [...byDate.entries()].map(([businessDate, total]) => ({
		businessDate,
		invoiceCount: total.count,
		netAmount: total.net,
		raw: null,
	}));
}
