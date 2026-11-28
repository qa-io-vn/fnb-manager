import type { Translate } from "@fnb/zalo-mini";
import type { IsoDate } from "@fnb/zalo-mini/loyalty";
import type {
	Order,
	OrderingState,
	PaymentMethod,
	TakeawaySlot,
} from "@fnb/zalo-mini/ordering";
import { addDays, isoDateIn, shownDate, weekdayOf } from "../data/dates";
import { clock } from "./parts";

// Takeaway with a chosen pick-up time (C17, ADR-072): which way of receiving the order the app offers, whether a closed
// store still books the next morning, and how the server's slots are shown. The server decides every time (its clock,
// the store's zone, full and passed); these helpers only arrange its answer for the screen.

/** How the customer receives the order (C05 "Nhận món"). */
export type Fulfilment = "table" | "takeaway";

/** The pick-up the customer chose on C17: "Càng sớm có thể" or one slot (its start, an ISO instant). */
export type PickupChoice =
	| { readonly kind: "asap" }
	| { readonly kind: "slot"; readonly at: string };

const ONLINE_METHODS: readonly PaymentMethod[] = ["zalo_checkout", "vietqr"];

/** The reasons a closed store still books a takeaway for its next opening (the server's rule). */
const PRE_ORDER_REASONS: readonly string[] = [
	"closed_now",
	"last_orders_passed",
	"closed_today",
];

/**
 * The store offers takeaway to this build: the type is offered and, takeaway being prepaid, the build pays online and
 * the store has an online way to pay switched on.
 */
export function takeawayOffered(
	ordering: OrderingState,
	onlinePayment: boolean,
): boolean {
	return (
		onlinePayment &&
		ordering.orderTypes.includes("takeaway") &&
		ordering.paymentMethods.some((method) => ONLINE_METHODS.includes(method))
	);
}

/** A closed store (C15) that still books a takeaway for its next opening ("Hẹn lấy món sáng mai"). */
export function preOrderOpen(
	ordering: OrderingState,
	onlinePayment: boolean,
): boolean {
	return (
		!ordering.accepting &&
		ordering.reason !== null &&
		PRE_ORDER_REASONS.includes(ordering.reason) &&
		takeawayOffered(ordering, onlinePayment)
	);
}

/** Whether items can be added and an order placed: the store takes orders, or it books a takeaway while closed. */
export function orderingOpen(
	ordering: OrderingState,
	fulfilment: Fulfilment,
	onlinePayment: boolean,
): boolean {
	return (
		ordering.accepting ||
		(fulfilment === "takeaway" && preOrderOpen(ordering, onlinePayment))
	);
}

/** The ways to pay a takeaway order: online only (the server refuses "Trả tại quầy"). */
export function takeawayMethods(
	methods: readonly PaymentMethod[],
): readonly PaymentMethod[] {
	return methods.filter((method) => method !== "counter");
}

export type SlotPeriod = "night" | "morning" | "afternoon" | "evening";

/** The part of the day a slot starts in, on the shop's clock: sáng before 12:00, chiều to 18:00, tối after. */
export function slotPeriod(iso: string): SlotPeriod {
	const hour = Number(clock(iso).slice(0, 2));
	if (hour < 4) return "night";
	if (hour < 12) return "morning";
	if (hour < 18) return "afternoon";
	return "evening";
}

/** How many slots C17 shows before "Xem giờ muộn hơn". */
export const SLOTS_SHOWN = 12;

/**
 * The slots C17 lists: the ones not passed (a passed slot is not shown at all), the first SLOTS_SHOWN unless the
 * customer asked for the later ones; a full slot stays in its place, marked.
 */
export function shownSlots(
	slots: readonly TakeawaySlot[],
	expanded: boolean,
): readonly TakeawaySlot[] {
	const ahead = slots.filter((slot) => slot.reason !== "passed");
	return expanded ? ahead : ahead.slice(0, SLOTS_SHOWN);
}

/** Slots grouped by the part of the day, in order. */
export function groupSlots(slots: readonly TakeawaySlot[]): readonly {
	readonly period: SlotPeriod;
	readonly slots: readonly TakeawaySlot[];
}[] {
	const groups: { period: SlotPeriod; slots: TakeawaySlot[] }[] = [];
	for (const slot of slots) {
		const period = slotPeriod(slot.start);
		const last = groups.at(-1);
		if (last !== undefined && last.period === period) last.slots.push(slot);
		else groups.push({ period, slots: [slot] });
	}
	return groups;
}

/** The nearest free slots after a time (the full notice: "Giờ gần nhất còn chỗ là 15:30 và 15:45"). */
export function nearestFree(
	slots: readonly TakeawaySlot[],
	after: string,
	count = 2,
): readonly string[] {
	const from = Date.parse(after);
	return slots
		.filter((slot) => slot.available && Date.parse(slot.start) > from)
		.slice(0, count)
		.map((slot) => slot.start);
}

/** Whether a chosen pick-up is still one the server offers free (a full or passed slot is no longer a choice). */
export function choiceStillFree(
	choice: PickupChoice | null,
	slots: readonly TakeawaySlot[],
	asapAt: string | null,
): boolean {
	if (choice === null) return false;
	if (choice.kind === "asap") return asapAt !== null;
	return slots.some(
		(slot) =>
			slot.available && Date.parse(slot.start) === Date.parse(choice.at),
	);
}

export type RelativeDay = "today" | "tomorrow" | "later";

/** A date against today on the shop's clock. */
export function relativeDay(date: IsoDate, now: number): RelativeDay {
	const today = isoDateIn(now);
	if (date === today) return "today";
	if (date === addDays(today, 1)) return "tomorrow";
	return "later";
}

const WEEKDAY_NAMES = {
	mon: "Thứ Hai",
	tue: "Thứ Ba",
	wed: "Thứ Tư",
	thu: "Thứ Năm",
	fri: "Thứ Sáu",
	sat: "Thứ Bảy",
	sun: "Chủ Nhật",
} as const;

/** The Vietnamese name of a date's weekday: "Thứ Bảy", "Chủ Nhật". */
export function vietnameseWeekday(date: IsoDate): string {
	return WEEKDAY_NAMES[weekdayOf(date)];
}

/** C17's date line: "Hôm nay, 27/11/2026" for today, else "Thứ Bảy, 28/11/2026". */
export function dateLine(t: Translate, date: IsoDate, now: number): string {
	return relativeDay(date, now) === "today"
		? t("pickup.dateToday", { date: shownDate(date) })
		: `${vietnameseWeekday(date)}, ${shownDate(date)}`;
}

/**
 * A pick-up time in words for the bar and the confirmation: "15:00 hôm nay", "07:30 sáng mai", "19:00 ngày mai",
 * "08:00 Thứ Hai, 30/11".
 */
export function pickupWords(t: Translate, at: string, now: number): string {
	const time = clock(at);
	const date = isoDateIn(Date.parse(at));
	switch (relativeDay(date, now)) {
		case "today":
			return t("pickup.whenToday", { time });
		case "tomorrow":
			return slotPeriod(at) === "morning"
				? t("pickup.whenTomorrowMorning", { time })
				: t("pickup.whenTomorrow", { time });
		default:
			return t("pickup.whenLater", {
				time,
				day: `${vietnameseWeekday(date)}, ${shownDate(date).slice(0, 5)}`,
			});
	}
}

/** Whole minutes from now to an instant, never below 1 ("khoảng 15 phút nữa"). */
export function minutesUntil(at: string, now: number): number {
	return Math.max(1, Math.round((Date.parse(at) - now) / 60_000));
}

/**
 * A booked takeaway whose time can no longer be prepared for while its payment is open: its preparation start
 * (the pick-up less the preparation time, the server's start_at) has come. The customer may choose another time.
 */
export function pickupPassed(order: Order, now: number): boolean {
	return (
		order.type === "takeaway" &&
		order.status === "awaiting_payment" &&
		order.pickupAt !== null &&
		order.startAt !== null &&
		now >= Date.parse(order.startAt)
	);
}

/** The refusals of a placement that send the customer back to C17 to choose another time. */
export function slotRefusal(refusal: string | null): boolean {
	return (
		refusal === "slot_full" ||
		refusal === "slot_passed" ||
		refusal === "closed" ||
		refusal === "pickup_time_invalid"
	);
}
