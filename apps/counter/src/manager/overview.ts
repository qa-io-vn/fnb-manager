// Tổng quan ngày: the day's revenue, orders, by hour and best sellers, from the sales facts (native orders are invoices of
// the store once completed, native-till.md section 11), read under RLS by the store's owners and managers.

export interface InvoiceRow {
	readonly id: string;
	readonly sold_at: string;
	readonly net_amount: number | string;
	readonly status: string;
}

export interface LineRow {
	readonly invoice_id: string;
	readonly item_name: string;
	readonly base_name: string | null;
	readonly quantity: number | string;
	readonly line_kind: string;
}

export interface DaySummary {
	readonly revenue: number;
	readonly orders: number;
	readonly average: number;
	readonly byHour: readonly {
		readonly hour: number;
		readonly revenue: number;
		readonly orders: number;
	}[];
	readonly best: readonly {
		readonly name: string;
		readonly quantity: number;
	}[];
}

const VIETNAM_OFFSET_HOURS = 7;

export function hourOf(soldAt: string): number {
	const time = Date.parse(soldAt);
	return Number.isFinite(time)
		? (new Date(time).getUTCHours() + VIETNAM_OFFSET_HOURS) % 24
		: 0;
}

/**
 * A refund handed back on a later business day than its order's is a negative document of that day (status `refund`,
 * ADR-071): it lowers the day's revenue and is never an order.
 */
export function isOrder(invoice: InvoiceRow): boolean {
	return invoice.status !== "voided" && invoice.status !== "refund";
}

/**
 * The day in numbers: voided invoices are left out (as Hôm nay counts them); refund documents count in the revenue,
 * in the hour they were handed back, and never as an order; amounts in whole đồng.
 */
export function summarizeDay(
	invoices: readonly InvoiceRow[],
	lines: readonly LineRow[],
	top = 5,
): DaySummary {
	const kept = invoices.filter((invoice) => invoice.status !== "voided");
	const orders = kept.filter(isOrder).length;
	const keptIds = new Set(kept.map((invoice) => invoice.id));
	const revenue = kept.reduce(
		(sum, invoice) => sum + Math.round(Number(invoice.net_amount)),
		0,
	);
	const hours = new Map<number, { revenue: number; orders: number }>();
	for (const invoice of kept) {
		const hour = hourOf(invoice.sold_at);
		const held = hours.get(hour) ?? { revenue: 0, orders: 0 };
		hours.set(hour, {
			revenue: held.revenue + Math.round(Number(invoice.net_amount)),
			orders: held.orders + (isOrder(invoice) ? 1 : 0),
		});
	}
	const quantities = new Map<string, number>();
	for (const line of lines) {
		if (line.line_kind !== "item" || !keptIds.has(line.invoice_id)) continue;
		const name = line.base_name ?? line.item_name;
		quantities.set(name, (quantities.get(name) ?? 0) + Number(line.quantity));
	}
	return {
		revenue,
		orders,
		average: orders === 0 ? 0 : Math.round(revenue / orders),
		byHour: [...hours.entries()]
			.sort(([a], [b]) => a - b)
			.map(([hour, value]) => ({ hour, ...value })),
		best: [...quantities.entries()]
			.map(([name, quantity]) => ({ name, quantity }))
			.sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name))
			.slice(0, top),
	};
}
