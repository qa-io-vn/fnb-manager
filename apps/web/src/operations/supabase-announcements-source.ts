import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { SettingsWriteError } from "../settings/source";
import {
	nullableNumeric,
	numeric,
	type PostgrestFailure,
	writeErrorOf,
} from "../settings/supabase-common";
import {
	ANNOUNCEMENT_ROLES,
	type Announcement,
	type AnnouncementReader,
	type AnnouncementsSource,
} from "./announcements-source";

const role = z.enum(ANNOUNCEMENT_ROLES);

const feedRow = z.object({
	announcement_id: z.string(),
	tenant_id: z.string(),
	store_ids: z.array(z.string()).nullable(),
	audience: z.array(role),
	title: z.string(),
	body: z.string(),
	pinned: z.boolean(),
	pinned_until: z.string().nullable(),
	published_by: z.string().nullable(),
	published_at: z.string(),
	expires_at: z.string().nullable(),
	recipient: z.boolean(),
	read_at: z.string().nullable(),
});

const readRateRow = z.object({
	announcement_id: z.string(),
	recipients: numeric,
	readers: numeric,
	readers_within_24h: numeric,
	read_rate: nullableNumeric,
	read_rate_24h: nullableNumeric,
});

const readerRow = z.object({
	user_id: z.string(),
	display_name: z.string().nullable(),
	role,
	store_ids: z.array(z.string()).nullable(),
	member: z.boolean(),
	read_at: z.string().nullable(),
});

const published = z.object({
	announcement_id: z.string(),
	published_at: z.string(),
	recipients: numeric,
});

const pinned = z.object({
	announcement_id: z.string(),
	pinned_until: z.string().nullable(),
	pinned: z.boolean(),
});

type Reply = PromiseLike<{ data: unknown; error: PostgrestFailure | null }>;

/** Rows per call of announcement_feed_page (its maximum). */
export const FEED_PAGE_ROWS = 200;
/** Pages read for one list: 2,000 announcements of one tenant at most. */
export const FEED_MAX_PAGES = 10;
/** Ids per call of announcement_read_counts (its maximum). */
export const READ_COUNTS_MAX_IDS = 200;

type ReadRateRow = z.infer<typeof readRateRow>;

interface Waiter {
	resolve(row: ReadRateRow | null): void;
	reject(error: unknown): void;
}

/**
 * Collects the read rates asked for in the same tick (every item of the
 * list mounts at once) and answers them with one announcement_read_counts
 * call per 200 ids, instead of one call per announcement.
 */
function readCountsBatcher(
	client: SupabaseClient,
): (announcementId: string) => Promise<ReadRateRow | null> {
	let pending: Map<string, Waiter[]> | null = null;
	const flush = async (batch: Map<string, Waiter[]>): Promise<void> => {
		const ids = [...batch.keys()];
		for (let start = 0; start < ids.length; start += READ_COUNTS_MAX_IDS) {
			const chunk = ids.slice(start, start + READ_COUNTS_MAX_IDS);
			const settle = (answer: (waiter: Waiter, id: string) => void) => {
				for (const id of chunk) {
					for (const waiter of batch.get(id) ?? []) answer(waiter, id);
				}
			};
			try {
				const rows = await read(
					z.array(readRateRow),
					client.rpc("announcement_read_counts", {
						p_announcement_ids: chunk,
					}),
				);
				const byId = new Map(rows.map((row) => [row.announcement_id, row]));
				settle((waiter, id) => waiter.resolve(byId.get(id) ?? null));
			} catch (error) {
				settle((waiter) => waiter.reject(error));
			}
		}
	};
	return (announcementId) =>
		new Promise((resolve, reject) => {
			if (pending === null) {
				const batch = new Map<string, Waiter[]>();
				pending = batch;
				queueMicrotask(() => {
					pending = null;
					void flush(batch);
				});
			}
			const waiters = pending.get(announcementId) ?? [];
			waiters.push({ resolve, reject });
			pending.set(announcementId, waiters);
		});
}

async function read<Value>(
	schema: z.ZodType<Value>,
	request: Reply,
): Promise<Value> {
	const result = await request;
	if (result.error !== null) {
		throw Object.assign(new Error(result.error.message ?? "read failed"), {
			code: result.error.code,
		});
	}
	return schema.parse(result.data ?? []);
}

async function written<Value>(
	schema: z.ZodType<Value>,
	request: Reply,
): Promise<Value> {
	let result: { data: unknown; error: PostgrestFailure | null };
	try {
		result = await request;
	} catch {
		throw new SettingsWriteError("network");
	}
	if (result.error !== null) throw writeErrorOf(result.error);
	return schema.parse(result.data);
}

export function createSupabaseAnnouncements(
	client: SupabaseClient,
): AnnouncementsSource {
	const readCounts = readCountsBatcher(client);
	return {
		async announcements(tenantId): Promise<Announcement[]> {
			const rows: z.infer<typeof feedRow>[] = [];
			for (let page = 0; page < FEED_MAX_PAGES; page += 1) {
				const last = rows.at(-1);
				const next = await read(
					z.array(feedRow),
					client.rpc("announcement_feed_page", {
						p_tenant_id: tenantId,
						p_store_id: null,
						p_include_expired: true,
						p_after_pinned: last?.pinned ?? null,
						p_after_published_at: last?.published_at ?? null,
						p_after_id: last?.announcement_id ?? null,
						p_limit: FEED_PAGE_ROWS,
					}),
				);
				rows.push(...next);
				if (next.length < FEED_PAGE_ROWS) break;
			}
			return rows.map((row) => ({
				id: row.announcement_id,
				tenantId: row.tenant_id,
				storeIds: row.store_ids,
				audience: row.audience,
				title: row.title,
				body: row.body,
				pinned: row.pinned,
				pinnedUntil: row.pinned_until,
				publishedBy: row.published_by,
				publishedAt: row.published_at,
				expiresAt: row.expires_at,
				recipient: row.recipient,
				readAt: row.read_at,
			}));
		},

		async announcementReadRate(announcementId) {
			const row = await readCounts(announcementId);
			if (row === null) return null;
			return {
				announcementId: row.announcement_id,
				recipients: row.recipients,
				readers: row.readers,
				readersWithin24h: row.readers_within_24h,
				readRate: row.read_rate,
				readRate24h: row.read_rate_24h,
			};
		},

		async announcementReaders(announcementId): Promise<AnnouncementReader[]> {
			const rows = await read(
				z.array(readerRow),
				client.rpc("announcement_readers", {
					p_announcement_id: announcementId,
				}),
			);
			return rows.map((row) => ({
				userId: row.user_id,
				displayName: row.display_name,
				role: row.role,
				storeIds: row.store_ids,
				member: row.member,
				readAt: row.read_at,
			}));
		},

		async publishAnnouncement(tenantId, draft) {
			const saved = await written(
				published,
				client.rpc("publish_announcement", {
					p_tenant_id: tenantId,
					p_title: draft.title,
					p_body: draft.body,
					p_store_ids: draft.storeIds === null ? null : [...draft.storeIds],
					p_pinned_until: draft.pinnedUntil,
				}),
			);
			return {
				announcementId: saved.announcement_id,
				publishedAt: saved.published_at,
				recipients: saved.recipients,
			};
		},

		async setAnnouncementPin(announcementId, pinnedUntil) {
			const saved = await written(
				pinned,
				client.rpc("set_announcement_pin", {
					p_announcement_id: announcementId,
					p_pinned_until: pinnedUntil,
				}),
			);
			return {
				announcementId: saved.announcement_id,
				pinnedUntil: saved.pinned_until,
				pinned: saved.pinned,
			};
		},
	};
}
