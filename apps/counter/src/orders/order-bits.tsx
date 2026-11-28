import { useI18n } from "@fnb/zalo-mini/i18n";
import { StatusPill, type StatusPillTone } from "@fnb/zalo-mini/ui-kit";
import { useEffect, useState } from "react";
import { clockOf, dayAndClock, vietnamDate } from "../lib/time";
import { isScheduled } from "./board-model";
import type { Order, OrderLine, OrderStatus, PaymentStatus } from "./types";

/** The current time, moving every `ms` (waiting minutes and red orders follow it). */
export function useNow(ms = 15_000): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), ms);
		return () => clearInterval(timer);
	}, [ms]);
	return now;
}

/** "Bàn 12" or "Mang đi", the way the queue names an order. */
export function placeOf(
	order: Order,
	t: (key: string, params?: Record<string, string | number>) => string,
): string {
	return order.table === null ? t("order.takeaway") : order.table.label;
}

/** "15:30", or "28/11 07:30" when it is not on the day of `now` (a booking for the next morning). */
export function timeOn(at: string, now: number): string {
	return vietnamDate(at) === vietnamDate(now) ? clockOf(at) : dayAndClock(at);
}

type Translate = (
	key: string,
	params?: Record<string, string | number>,
) => string;

/**
 * A takeaway's pick-up in words (C17): "hẹn 07:30" with "bắt đầu pha 07:15" while its preparation start is ahead,
 * "lấy 15:30" once it is in the flow; null for a table order or a takeaway "as soon as possible".
 */
export function pickupWords(
	order: Order,
	now: number,
	t: Translate,
): { readonly label: string; readonly start: string | null } | null {
	if (order.type !== "takeaway" || order.pickup_at === null) return null;
	const time = timeOn(order.pickup_at, now);
	if (isScheduled(order, now) && order.start_at)
		return {
			label: t("order.scheduledAt", { time }),
			start: t("order.startAt", { time: timeOn(order.start_at, now) }),
		};
	return { label: t("order.pickupAt", { time }), start: null };
}

/** The pick-up of a takeaway as a pill ("hẹn 07:30" in the booking's colour, "lấy 15:30" neutral), or nothing. */
export function PickupLabel({
	order,
	now,
}: {
	readonly order: Order;
	readonly now: number;
}) {
	const { t } = useI18n();
	const words = pickupWords(order, now, t);
	if (words === null) return null;
	return (
		<StatusPill
			tone={words.start === null ? "neutral" : "badge"}
			testId="pickup-time"
		>
			{words.label}
		</StatusPill>
	);
}

/** The size, the options and the note of a line, joined by middle dots ("Lớn · Ít đá · không ngọt"). */
export function lineDetails(line: OrderLine): string {
	return [
		line.size_label,
		...line.options.map((option) => option.name),
		line.note,
	]
		.filter((part): part is string => part !== null && part !== "")
		.join(" · ");
}

export function LineList({
	order,
	compact = false,
}: {
	readonly order: Order;
	readonly compact?: boolean;
}) {
	return (
		<ul className={compact ? "flex flex-col gap-1" : "flex flex-col gap-2"}>
			{order.lines.map((line) => {
				const details = lineDetails(line);
				return (
					<li key={line.line_no}>
						<p className={compact ? "font-bold" : "text-lg font-bold"}>
							<span className="text-highlight">{line.quantity}×</span>{" "}
							{line.item_name}
						</p>
						{details === "" ? null : (
							<p className="pl-6 text-sm text-ink-muted">{details}</p>
						)}
					</li>
				);
			})}
		</ul>
	);
}

const STATUS_TONE: Readonly<Record<OrderStatus, StatusPillTone>> = {
	awaiting_payment: "neutral",
	accepted: "badge",
	preparing: "warning",
	ready: "positive",
	serving: "positive",
	completed: "neutral",
	cancelled: "negative",
};

export function StatusLabel({ order }: { readonly order: Order }) {
	const { t } = useI18n();
	return (
		<StatusPill tone={STATUS_TONE[order.status]} testId="order-status">
			{t(`order.status.${order.status}`)}
		</StatusPill>
	);
}

const PAYMENT_TONE: Readonly<Record<PaymentStatus, StatusPillTone>> = {
	unpaid: "warning",
	paid: "positive",
	refund_pending: "negative",
	refunded: "neutral",
	partially_refunded: "neutral",
};

/** "Chưa thu tiền" and the other payment states, in words (never colour alone). */
export function PaymentLabel({ order }: { readonly order: Order }) {
	const { t } = useI18n();
	return (
		<StatusPill
			tone={PAYMENT_TONE[order.payment_status]}
			testId="payment-status"
		>
			{t(`order.payment.${order.payment_status}`)}
		</StatusPill>
	);
}
