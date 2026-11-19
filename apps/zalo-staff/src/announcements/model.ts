import {
	type Announcement,
	type AnnouncementDraft,
	MAX_BODY_LENGTH,
	MAX_TITLE_LENGTH,
	type PinDays,
} from "./contract";

const DAY_MS = 24 * 60 * 60 * 1000;

export function isPinned(announcement: Announcement, now: Date): boolean {
	return (
		announcement.pinnedUntil !== null &&
		Date.parse(announcement.pinnedUntil) > now.getTime()
	);
}

export function isUnread(
	announcement: Announcement,
	memberId: string | null,
): boolean {
	return (
		announcement.readAt === null &&
		(memberId === null || announcement.publishedBy !== memberId)
	);
}

export function isOwn(
	announcement: Announcement,
	memberId: string | null,
): boolean {
	return memberId !== null && announcement.publishedBy === memberId;
}

export function orderFeed(
	announcements: readonly Announcement[],
	now: Date,
): Announcement[] {
	return [...announcements].sort((a, b) => {
		const pinned = Number(isPinned(b, now)) - Number(isPinned(a, now));
		if (pinned !== 0) return pinned;
		if (a.publishedAt !== b.publishedAt)
			return b.publishedAt.localeCompare(a.publishedAt);
		return a.id.localeCompare(b.id);
	});
}

export function pinnedNow(
	announcements: readonly Announcement[],
	now: Date,
): Announcement[] {
	return orderFeed(
		announcements.filter((announcement) => isPinned(announcement, now)),
		now,
	);
}

export function unreadCount(
	announcements: readonly Announcement[],
	memberId: string | null,
): number {
	return announcements.filter((announcement) =>
		isUnread(announcement, memberId),
	).length;
}

export function pinEnd(days: PinDays | null, now: Date): string | null {
	return days === null
		? null
		: new Date(now.getTime() + days * DAY_MS).toISOString();
}

export type DraftField = "title" | "body" | "stores";
export type DraftProblem = {
	readonly field: DraftField;
	readonly problem: "empty" | "long";
};

export function draftProblems(draft: AnnouncementDraft): DraftProblem[] {
	const problems: DraftProblem[] = [];
	const title = draft.title.trim();
	const body = draft.body.trim();
	if (title === "") problems.push({ field: "title", problem: "empty" });
	else if (title.length > MAX_TITLE_LENGTH)
		problems.push({ field: "title", problem: "long" });
	if (body === "") problems.push({ field: "body", problem: "empty" });
	else if (body.length > MAX_BODY_LENGTH)
		problems.push({ field: "body", problem: "long" });
	if (draft.storeIds.length === 0)
		problems.push({ field: "stores", problem: "empty" });
	return problems;
}

export function percent(rate: number | null): number | null {
	return rate === null ? null : Math.round(rate * 100);
}
