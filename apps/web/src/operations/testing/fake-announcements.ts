import type {
	Announcement,
	AnnouncementReader,
	AnnouncementReadRate,
	AnnouncementsSource,
} from "../announcements-source";

export interface FakeAnnouncementsData {
	announcements: Announcement[];
	readRates: Map<string, AnnouncementReadRate>;
	readers: Map<string, AnnouncementReader[]>;
	publishRecipients: number;
}

export function emptyAnnouncementsData(): FakeAnnouncementsData {
	return {
		announcements: [],
		readRates: new Map(),
		readers: new Map(),
		publishRecipients: 0,
	};
}

export function fakeAnnouncementMethods(
	data: FakeAnnouncementsData,
	record: (method: string, args: unknown) => void,
	currentUserId: () => string | null,
): AnnouncementsSource {
	let next = 1;
	return {
		async announcements(tenantId) {
			record("announcements", tenantId);
			return data.announcements
				.filter((row) => row.tenantId === tenantId)
				.map((row) => ({ ...row }));
		},
		async announcementReadRate(announcementId) {
			record("announcementReadRate", announcementId);
			return data.readRates.get(announcementId) ?? null;
		},
		async announcementReaders(announcementId) {
			record("announcementReaders", announcementId);
			return data.readers.get(announcementId) ?? [];
		},
		async publishAnnouncement(tenant, draft) {
			record("publishAnnouncement", { tenantId: tenant, ...draft });
			const id = `announcement-new-${next++}`;
			const publishedAt = new Date().toISOString();
			data.announcements = [
				{
					id,
					tenantId: tenant,
					storeIds: draft.storeIds,
					audience: ["manager", "staff"],
					title: draft.title,
					body: draft.body,
					pinned: draft.pinnedUntil !== null,
					pinnedUntil: draft.pinnedUntil,
					publishedBy: currentUserId(),
					publishedAt,
					expiresAt: null,
					recipient: false,
					readAt: null,
				},
				...data.announcements,
			];
			data.readRates.set(id, {
				announcementId: id,
				recipients: data.publishRecipients,
				readers: 0,
				readersWithin24h: 0,
				readRate: data.publishRecipients > 0 ? 0 : null,
				readRate24h: data.publishRecipients > 0 ? 0 : null,
			});
			return {
				announcementId: id,
				publishedAt,
				recipients: data.publishRecipients,
			};
		},
		async setAnnouncementPin(announcementId, pinnedUntil) {
			record("setAnnouncementPin", { announcementId, pinnedUntil });
			data.announcements = data.announcements.map((row) =>
				row.id === announcementId
					? { ...row, pinnedUntil, pinned: pinnedUntil !== null }
					: row,
			);
			return {
				announcementId,
				pinnedUntil,
				pinned: pinnedUntil !== null,
			};
		},
	};
}
