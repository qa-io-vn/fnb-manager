// The weekly cap of promotional Zalo messages (GA-065, ADR-073): "Tối đa 2 tin mỗi tuần", the promise of the C12
// opt-in text. The decision itself is taken in SQL when the dispatcher claims a message (app.customer_cap_release under
// app.customer_message_route, ADR-030); this module is its TypeScript statement, kept equal to the SQL by the unit tests
// and used as the oracle of the integration test that sends through the mock ZBS. It never decides a send.

/** At most two promotions a week on Zalo: what the opt-in text promises and the floor of every Zalo promotion row. */
export const PROMOTION_WEEKLY_CAP = 2;

/** The rolling window of the weekly cap: a message sent exactly this long before no longer counts. */
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Why the send decision held a customer message, as `outbound_messages.hold_reason` records it. */
export const CUSTOMER_HOLD_REASONS = [
	"outside_hours",
	"daily_cap",
	"weekly_cap",
	"monthly_cap",
	"zbs_quota",
] as const;

export type CustomerHoldReason = (typeof CUSTOMER_HOLD_REASONS)[number];

/** The channels whose promotion rows the weekly floor binds. */
export const WEEKLY_CAPPED_CHANNELS = ["zalo_oa", "zalo_zbs"] as const;

export interface WeeklyCapRow {
	readonly channelKind: string;
	readonly messageClass: "operational" | "transactional" | "advertising";
	readonly allowed: boolean;
	readonly maxPerWeek: number | null;
}

/**
 * When the next message may go under a rolling 7-day cap: null when one may go at `at`, otherwise the instant the
 * oldest message that keeps the count at the cap leaves the window. `sentAt` are the times the customer's earlier
 * messages of the class on the channel were sent (or claimed); a message counts while it was sent at or before `at`
 * and less than 7 days before it. With no cap (null), nothing is held.
 */
export function weeklyCapRelease(
	sentAt: readonly Date[],
	at: Date,
	maxPerWeek: number | null,
): Date | null {
	if (maxPerWeek === null) return null;
	if (!Number.isInteger(maxPerWeek) || maxPerWeek < 1)
		throw new RangeError("a weekly cap is a whole number of at least 1");
	const now = at.getTime();
	const counted = sentAt
		.map((instant) => instant.getTime())
		.filter((time) => time <= now && time > now - WEEK_MS)
		.sort((a, b) => a - b);
	if (counted.length < maxPerWeek) return null;
	const keeping = counted[counted.length - maxPerWeek];
	return keeping === undefined ? null : new Date(keeping + WEEK_MS);
}

/** The weekly cap a policy row ends up with: a Zalo promotion row written without one takes the promised 2. */
export function effectiveWeeklyCap(row: WeeklyCapRow): number | null {
	if (
		row.maxPerWeek === null &&
		row.messageClass === "advertising" &&
		(WEEKLY_CAPPED_CHANNELS as readonly string[]).includes(row.channelKind)
	)
		return PROMOTION_WEEKLY_CAP;
	return row.maxPerWeek;
}

/** Whether a policy row passes the weekly floor (channel_policies_advertising_weekly): a Zalo promotion row that may send holds 1 or 2. */
export function weeklyFloorHolds(row: WeeklyCapRow): boolean {
	if (
		row.messageClass !== "advertising" ||
		!(WEEKLY_CAPPED_CHANNELS as readonly string[]).includes(row.channelKind) ||
		!row.allowed
	)
		return true;
	const cap = effectiveWeeklyCap(row);
	return cap !== null && cap >= 1 && cap <= PROMOTION_WEEKLY_CAP;
}
