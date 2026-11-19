import type { TenantRole } from "../settings/source";

export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 4000;
export const ANNOUNCEMENT_STORES_MAX = 50;
export const ANNOUNCEMENT_PIN_MAX_DAYS = 365;

export const ANNOUNCEMENT_ROLES = ["owner", "manager", "staff"] as const;

export type AnnouncementRole = Extract<
	TenantRole,
	(typeof ANNOUNCEMENT_ROLES)[number]
>;

export interface Announcement {
	readonly id: string;
	readonly tenantId: string;
	readonly storeIds: readonly string[] | null;
	readonly audience: readonly AnnouncementRole[];
	readonly title: string;
	readonly body: string;
	readonly pinned: boolean;
	readonly pinnedUntil: string | null;
	readonly publishedBy: string | null;
	readonly publishedAt: string;
	readonly expiresAt: string | null;
	readonly recipient: boolean;
	readonly readAt: string | null;
}

export interface AnnouncementReadRate {
	readonly announcementId: string;
	readonly recipients: number;
	readonly readers: number;
	readonly readersWithin24h: number;
	readonly readRate: number | null;
	readonly readRate24h: number | null;
}

export interface AnnouncementReader {
	readonly userId: string;
	readonly displayName: string | null;
	readonly role: AnnouncementRole;
	readonly storeIds: readonly string[] | null;
	readonly member: boolean;
	readonly readAt: string | null;
}

export interface AnnouncementDraft {
	readonly title: string;
	readonly body: string;
	readonly storeIds: readonly string[] | null;
	readonly pinnedUntil: string | null;
}

export interface PublishedAnnouncement {
	readonly announcementId: string;
	readonly publishedAt: string;
	readonly recipients: number;
}

export interface AnnouncementPin {
	readonly announcementId: string;
	readonly pinnedUntil: string | null;
	readonly pinned: boolean;
}

export interface AnnouncementsSource {
	announcements(): Promise<Announcement[]>;
	announcementReadRate(
		announcementId: string,
	): Promise<AnnouncementReadRate | null>;
	announcementReaders(announcementId: string): Promise<AnnouncementReader[]>;
	publishAnnouncement(
		tenantId: string,
		draft: AnnouncementDraft,
	): Promise<PublishedAnnouncement>;
	setAnnouncementPin(
		announcementId: string,
		pinnedUntil: string | null,
	): Promise<AnnouncementPin>;
}
