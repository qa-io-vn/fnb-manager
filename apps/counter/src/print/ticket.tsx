import { formatVnd } from "@fnb/zalo-mini/format";
import { dayAndClock } from "../lib/time";
import { isScheduled } from "../orders/board-model";
import { lineDetails, timeOn } from "../orders/order-bits";
import type { Order } from "../orders/types";

/**
 * The 80 mm ticket as plain lines (the model an ESC/POS printer would take as well): a big heading with the table or
 * "Mang đi" and the number, each line with its quantity and details, the note, the total and whether it is paid. Text
 * only, so a name or a note with markup prints as written and never as markup.
 */
export interface TicketLine {
	readonly text: string;
	readonly size: "big" | "normal" | "small";
	readonly align?: "left" | "right" | "center";
}

export interface Ticket {
	readonly lines: readonly TicketLine[];
}

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * The pick-up line of a takeaway (C17): "Hẹn 07:30 · bắt đầu pha 07:15" while its preparation start is ahead at `now`,
 * "Mang đi · lấy 15:30" otherwise; the date is added when it is not the day of `now`. Null for a table order or a
 * takeaway "as soon as possible". The ticket and the order's detail say the same.
 */
export function pickupLine(order: Order, now: number, t: T): string | null {
	if (order.type !== "takeaway" || order.pickup_at === null) return null;
	const time = timeOn(order.pickup_at, now);
	return isScheduled(order, now) && order.start_at
		? t("order.scheduledLine", { time, start: timeOn(order.start_at, now) })
		: t("order.pickupLine", { time });
}

export function ticketOf(
	order: Order,
	context: {
		readonly brand: string;
		readonly store: string;
		readonly printedAt: Date;
	},
	t: T,
): Ticket {
	const place = order.table === null ? t("order.takeaway") : order.table.label;
	const lines: TicketLine[] = [
		{ text: context.brand, size: "normal", align: "center" },
		{ text: context.store, size: "small", align: "center" },
		{
			text: `${place} ${order.display_no ?? ""}`.trim(),
			size: "big",
			align: "center",
		},
		{ text: dayAndClock(order.placed_at), size: "small", align: "center" },
	];
	const pickup = pickupLine(order, context.printedAt.getTime(), t);
	if (pickup !== null)
		lines.push({ text: pickup, size: "normal", align: "center" });
	lines.push({ text: "--------------------------------", size: "small" });
	for (const line of order.lines) {
		lines.push({ text: `${line.quantity}× ${line.item_name}`, size: "big" });
		const details = lineDetails(line);
		if (details !== "") lines.push({ text: `   ${details}`, size: "normal" });
		lines.push({
			text: formatVnd(line.line_total),
			size: "small",
			align: "right",
		});
	}
	lines.push({ text: "--------------------------------", size: "small" });
	if (order.note !== null && order.note !== "")
		lines.push({
			text: `${t("order.customerNote")} ${order.note}`,
			size: "normal",
		});
	lines.push({
		text: `${t("order.total")}: ${formatVnd(order.total)}`,
		size: "big",
		align: "right",
	});
	lines.push({
		text: t(`order.payment.${order.payment_status}`),
		size: "normal",
		align: "right",
	});
	lines.push({
		text: t("print.printedAt", { time: dayAndClock(context.printedAt) }),
		size: "small",
		align: "center",
	});
	return { lines };
}

const SIZE = {
	big: "text-[16pt] font-bold",
	normal: "text-[11pt]",
	small: "text-[9pt]",
} as const;
const ALIGN = {
	left: "text-left",
	right: "text-right",
	center: "text-center",
} as const;

/** The ticket on paper: shown only when printing (the rest of the app is hidden then). */
export function TicketView({ ticket }: { readonly ticket: Ticket }) {
	return (
		<div
			className="print-only w-[74mm] font-mono leading-tight text-black"
			data-testid="print-ticket-view"
		>
			{ticket.lines
				.map((line, position) => ({ ...line, id: `${position}` }))
				.map((line) => (
					<p
						key={line.id}
						className={`${SIZE[line.size]} ${ALIGN[line.align ?? "left"]} whitespace-pre-wrap`}
					>
						{line.text}
					</p>
				))}
		</div>
	);
}
