import type { InboxItem } from "@fnb/zalo-mini/ordering";
import { isoDateIn } from "../data/dates";

// C12's words and places, apart from the screen so they are tested as plain functions (design spec C12): what an
// item says (its title and line, with a price where the line names one), how long ago it came, and where tapping it
// leads. Prices are never written into a message: the line carries a marker that the screen replaces with PriceText.

/** Where a price goes in a line; the screen splits the line on it and draws a PriceText. */
export const PRICE_MARK = "⁣¤⁣";

type Translate = (
	key: string,
	values?: Record<string, string | number>,
) => string;

export interface InboxText {
	readonly title: string;
	/** the line under the title, with PRICE_MARK where `price` is drawn */
	readonly line: string;
	readonly price: number | null;
}

const DAY_MS = 86_400_000;

/** "vừa xong · {minutes} phút trước · hôm nay · hôm qua · {days} ngày trước", on the shop's calendar. */
export function inboxAgo(
	createdAt: string,
	now: number,
): { readonly key: string; readonly values?: Record<string, number> } {
	const at = Date.parse(createdAt);
	const elapsed = now - at;
	if (elapsed < 60_000) return { key: "inbox.ago.now" };
	if (elapsed < 3_600_000)
		return {
			key: "inbox.ago.minutes",
			values: { minutes: Math.floor(elapsed / 60_000) },
		};
	const days = Math.round(
		(Date.parse(isoDateIn(now)) - Date.parse(isoDateIn(at))) / DAY_MS,
	);
	if (days <= 0) return { key: "inbox.ago.today" };
	if (days === 1) return { key: "inbox.ago.yesterday" };
	return { key: "inbox.ago.days", values: { days } };
}

/** Where tapping an item leads: its order (C06), the stamp card (C07), or the offers (C13 once it is built; Đổi quà until then). */
export function inboxPath(item: InboxItem): string {
	if (item.target === "order" && item.orderId !== null)
		return `/don/${item.orderId}`;
	if (item.target === "stamps") return "/the-thanh-vien";
	return "/doi-qua";
}

const REFUND_METHODS = ["cash", "card", "zalo_checkout", "vietqr"] as const;
const CANCEL_REASONS = [
	"customer_cancelled",
	"payment_timeout",
	"item_unavailable",
	"store_busy",
	"closing_soon",
] as const;

function shownDay(iso: string): string {
	const [year, month, day] = iso.split("-");
	return `${day}/${month}/${year}`;
}

/** The order's first item, and how many more, as the line names them. */
function itemsOf(item: InboxItem, t: Translate): string {
	const order = item.order;
	if (order === null || order.firstItem === null) return t("inbox.item.order");
	const more = order.items - 1;
	return more > 0
		? t("inbox.item.more", { item: order.firstItem, count: more })
		: order.firstItem;
}

/** What an item says, in the customer's language. */
export function inboxText(item: InboxItem, t: Translate): InboxText {
	const number = item.order?.displayNo ?? null;
	const params = item.params;
	switch (item.kind) {
		case "order_ready": {
			const table = item.order?.tableLabel ?? null;
			const takeaway =
				(params.orderType ?? item.order?.type) === "takeaway" || table === null;
			return {
				title: t("inbox.ready.title"),
				line: takeaway
					? number === null
						? t("inbox.ready.takeawayNoNumber")
						: t("inbox.ready.takeaway", { number })
					: t("inbox.ready.table", { item: itemsOf(item, t), table }),
				price: null,
			};
		}
		case "order_receipt": {
			const amount = params.amount ?? item.order?.total ?? null;
			return {
				title:
					number === null
						? t("inbox.receipt.titleNoNumber")
						: t("inbox.receipt.title", { number }),
				line:
					amount === null
						? t("inbox.receipt.bodyNoAmount")
						: t("inbox.receipt.body", { total: PRICE_MARK }),
				price: amount,
			};
		}
		case "order_cancelled": {
			const reason = (CANCEL_REASONS as readonly string[]).includes(
				params.reason ?? "",
			)
				? (params.reason as string)
				: "other";
			const why = t(`order.cancelReason.${reason}`);
			const due = params.refundDue;
			return {
				title:
					number === null
						? t("inbox.cancelled.titleNoNumber")
						: t("inbox.cancelled.title", { number }),
				line:
					due === null
						? why
						: `${why} ${t("inbox.cancelled.refund", { amount: PRICE_MARK })}`,
				price: due,
			};
		}
		case "order_refunded": {
			const method = (REFUND_METHODS as readonly string[]).includes(
				params.method ?? "",
			)
				? (params.method as string)
				: "other";
			const amount = params.amount ?? null;
			const date =
				params.refundedOn === null ? null : shownDay(params.refundedOn);
			return {
				title:
					number === null
						? t("inbox.refunded.titleNoNumber")
						: t("inbox.refunded.title", { number }),
				line:
					date === null
						? t(`inbox.refunded.method.${method}`, { amount: PRICE_MARK })
						: t("inbox.refunded.withDate", {
								how: t(`inbox.refunded.method.${method}`, {
									amount: PRICE_MARK,
								}),
								date,
							}),
				price: amount,
			};
		}
		case "stamp":
			return {
				title: t("inbox.stamp.title", { count: params.added ?? 1 }),
				line: t("inbox.stamp.body", {
					left: params.left ?? 0,
					reward: item.rewardName ?? t("inbox.reward.fallback"),
				}),
				price: null,
			};
		case "reward":
			return {
				title: t("inbox.reward.title"),
				line: t("inbox.reward.body", {
					reward: item.rewardName ?? t("inbox.reward.fallback"),
				}),
				price: null,
			};
		case "offer":
			if (params.offer === "birthday")
				return {
					title: t("inbox.offer.birthday.title"),
					line: t("inbox.offer.birthday.body"),
					price: null,
				};
			if (params.offer === "win_back")
				return {
					title: t("inbox.offer.winBack.title"),
					line: t("inbox.offer.winBack.body"),
					price: null,
				};
			return {
				title: item.title ?? t("inbox.offer.fallback"),
				line: item.line ?? "",
				price: null,
			};
	}
}

/** A line cut at the price marker: the text before it, and after it when the line names a price. */
export function splitAtPrice(line: string): readonly [string, string | null] {
	const at = line.indexOf(PRICE_MARK);
	if (at < 0) return [line, null];
	return [line.slice(0, at), line.slice(at + PRICE_MARK.length)];
}
