import {
	count,
	flag,
	type IsoInstant,
	idsOrNull,
	instant,
	instantOrNull,
	knownOrNull,
	type Row,
	ratioOrNull,
	rows,
	single,
	text,
	textOrNull,
} from "../team/read";

export const ANNOUNCEMENT_FUNCTIONS = {
	feed: "announcement_feed",
	publish: "publish_announcement",
	markRead: "mark_announcement_read",
	readRate: "announcement_read_rate",
	readers: "announcement_readers",
} as const;

export const MAX_TITLE_LENGTH = 120;
export const MAX_BODY_LENGTH = 4000;
export const PIN_DAYS = [1, 3, 7, 30] as const;
export type PinDays = (typeof PIN_DAYS)[number];

export const READER_ROLES = ["owner", "manager", "staff"] as const;
export type ReaderRole = (typeof READER_ROLES)[number];

export interface Announcement {
	readonly id: string;
	readonly storeIds: readonly string[] | null;
	readonly title: string;
	readonly body: string;
	readonly pinned: boolean;
	readonly pinnedUntil: IsoInstant | null;
	readonly publishedBy: string | null;
	readonly publishedAt: IsoInstant;
	readonly recipient: boolean;
	readonly readAt: IsoInstant | null;
}

export interface ReadRate {
	readonly recipients: number;
	readonly readers: number;
	readonly readersWithin24h: number;
	readonly rate: number | null;
}

export interface Reader {
	readonly userId: string;
	readonly name: string | null;
	readonly role: ReaderRole | null;
	readonly member: boolean;
	readonly readAt: IsoInstant | null;
}

export interface AnnouncementDraft {
	readonly title: string;
	readonly body: string;
	readonly storeIds: readonly string[];
	readonly pinnedUntil: IsoInstant | null;
}

export interface PublishReceipt {
	readonly id: string;
	readonly recipients: number;
}

export interface ReadReceipt {
	readonly id: string;
	readonly readAt: IsoInstant;
}

export interface AnnouncementsApi {
	feed(storeId: string | null): Promise<Announcement[]>;
	markRead(id: string): Promise<ReadReceipt>;
	publish(draft: AnnouncementDraft): Promise<PublishReceipt>;
	readRate(id: string): Promise<ReadRate>;
	readers(id: string): Promise<Reader[]>;
}

export function readAnnouncement(row: Row): Announcement {
	return {
		id: text(row.announcement_id, "announcement id"),
		storeIds: idsOrNull(row.store_ids, "announcement stores"),
		title: text(row.title, "announcement title"),
		body: text(row.body, "announcement body"),
		pinned: flag(row.pinned, "pin state"),
		pinnedUntil: instantOrNull(row.pinned_until, "pin end"),
		publishedBy: textOrNull(row.published_by, "author"),
		publishedAt: instant(row.published_at, "publication time"),
		recipient: flag(row.recipient, "recipient flag"),
		readAt: instantOrNull(row.read_at, "read time"),
	};
}

export function readFeed(value: unknown): Announcement[] {
	return rows(value, "announcement feed").map(readAnnouncement);
}

export function readReadRate(value: unknown): ReadRate {
	const row = single(value, "read rate");
	return {
		recipients: count(row.recipients, "recipient count"),
		readers: count(row.readers, "reader count"),
		readersWithin24h: count(row.readers_within_24h, "early reader count"),
		rate: ratioOrNull(row.read_rate, "read rate"),
	};
}

export function readReaders(value: unknown): Reader[] {
	return rows(value, "readers").map((row) => ({
		userId: text(row.user_id, "reader id"),
		name: textOrNull(row.display_name, "reader name"),
		role: knownOrNull(READER_ROLES, row.role),
		member: row.member !== false,
		readAt: instantOrNull(row.read_at, "reader read time"),
	}));
}

export function readPublishReceipt(value: unknown): PublishReceipt {
	const row = single(value, "publication");
	return {
		id: text(row.announcement_id, "published announcement"),
		recipients: count(row.recipients, "recipient count"),
	};
}

export function readReadReceipt(value: unknown): ReadReceipt {
	const row = single(value, "read receipt");
	return {
		id: text(row.announcement_id, "read announcement"),
		readAt: instant(row.read_at, "read time"),
	};
}

export function feedArgs(storeId: string | null): Row {
	return { p_store_id: storeId, p_include_expired: false };
}

export function publishArgs(tenantId: string, draft: AnnouncementDraft): Row {
	return {
		p_tenant_id: tenantId,
		p_title: draft.title.trim(),
		p_body: draft.body.trim(),
		p_store_ids: [...draft.storeIds],
		p_pinned_until: draft.pinnedUntil,
	};
}
