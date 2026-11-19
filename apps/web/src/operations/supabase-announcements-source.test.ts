import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { writeCodeOf } from "../settings/source";
import {
	createSupabaseAnnouncements,
	FEED_MAX_PAGES,
	FEED_PAGE_ROWS,
} from "./supabase-announcements-source";

const TENANT = "33333333-3333-4333-8333-333333333333";
const STORE = "77777777-7777-4777-8777-777777777777";
const ANNOUNCEMENT = "11111111-1111-4111-8111-111111111111";
const USER = "44444444-4444-4444-8444-444444444444";
const AT = "2026-11-17T01:00:00+00:00";

type Reply = {
	data: unknown;
	error: { code?: string; message?: string } | null;
};

function fakeClient(answer: (name: string, args: unknown) => Reply | Error) {
	const calls: [string, unknown][] = [];
	const client = {
		rpc: (name: string, args: unknown) => {
			calls.push([name, args]);
			return Promise.resolve().then(() => {
				const reply = answer(name, args);
				if (reply instanceof Error) throw reply;
				return reply;
			});
		},
	};
	return { client: client as unknown as SupabaseClient, calls };
}

describe("the Supabase announcements source", () => {
	it("reads the tenant's feed with expired ones, a page at a time, and maps its rows", async () => {
		const { client, calls } = fakeClient(() => ({
			data: [
				{
					announcement_id: ANNOUNCEMENT,
					tenant_id: TENANT,
					store_ids: [STORE],
					audience: ["manager", "staff"],
					title: "Lịch trực",
					body: "Xem https://example.com",
					pinned: true,
					pinned_until: AT,
					published_by: USER,
					published_at: AT,
					expires_at: null,
					recipient: false,
					read_at: null,
				},
			],
			error: null,
		}));
		const source = createSupabaseAnnouncements(client);
		expect(await source.announcements(TENANT)).toEqual([
			{
				id: ANNOUNCEMENT,
				tenantId: TENANT,
				storeIds: [STORE],
				audience: ["manager", "staff"],
				title: "Lịch trực",
				body: "Xem https://example.com",
				pinned: true,
				pinnedUntil: AT,
				publishedBy: USER,
				publishedAt: AT,
				expiresAt: null,
				recipient: false,
				readAt: null,
			},
		]);
		expect(calls).toEqual([
			[
				"announcement_feed_page",
				{
					p_tenant_id: TENANT,
					p_store_id: null,
					p_include_expired: true,
					p_after_pinned: null,
					p_after_published_at: null,
					p_after_id: null,
					p_limit: FEED_PAGE_ROWS,
				},
			],
		]);
	});

	it("follows the keyset cursor while pages are full, and stops after the last page cap", async () => {
		const row = (index: number) => ({
			announcement_id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
			tenant_id: TENANT,
			store_ids: null,
			audience: ["manager", "staff"],
			title: `Thông báo ${index}`,
			body: "Nội dung",
			pinned: index === 0,
			pinned_until: index === 0 ? AT : null,
			published_by: USER,
			published_at: `2026-11-${String(17 - Math.floor(index / 100)).padStart(2, "0")}T01:00:00+00:00`,
			expires_at: null,
			recipient: false,
			read_at: null,
		});
		const { client, calls } = fakeClient((_name, args) => {
			const after = (args as { p_after_id: string | null }).p_after_id;
			const start = after === null ? 0 : Number(after.slice(-12)) + 1;
			const size = start < 400 ? FEED_PAGE_ROWS : 3;
			return {
				data: Array.from({ length: size }, (_, offset) => row(start + offset)),
				error: null,
			};
		});
		const source = createSupabaseAnnouncements(client);
		const feed = await source.announcements(TENANT);
		expect(feed).toHaveLength(403);
		expect(new Set(feed.map((item) => item.id)).size).toBe(403);
		expect(calls).toHaveLength(3);
		expect(calls[1]?.[1]).toMatchObject({
			p_tenant_id: TENANT,
			p_after_pinned: false,
			p_after_published_at: row(199).published_at,
			p_after_id: row(199).announcement_id,
		});
		const endless = fakeClient((_name, args) => {
			const after = (args as { p_after_id: string | null }).p_after_id;
			const start = after === null ? 0 : Number(after.slice(-12)) + 1;
			return {
				data: Array.from({ length: FEED_PAGE_ROWS }, (_, offset) =>
					row(start + offset),
				),
				error: null,
			};
		});
		expect(
			await createSupabaseAnnouncements(endless.client).announcements(TENANT),
		).toHaveLength(FEED_PAGE_ROWS * FEED_MAX_PAGES);
		expect(endless.calls).toHaveLength(FEED_MAX_PAGES);
	});

	it("reads the read rate with numeric shares and the readers with their names", async () => {
		const { client, calls } = fakeClient((name) =>
			name === "announcement_read_counts"
				? {
						data: [
							{
								announcement_id: ANNOUNCEMENT,
								published_at: AT,
								recipients: 4,
								readers: 3,
								readers_within_24h: 2,
								read_rate: "0.7500",
								read_rate_24h: 0.5,
							},
						],
						error: null,
					}
				: {
						data: [
							{
								user_id: USER,
								display_name: null,
								role: "staff",
								store_ids: null,
								member: false,
								read_at: null,
							},
						],
						error: null,
					},
		);
		const source = createSupabaseAnnouncements(client);
		expect(await source.announcementReadRate(ANNOUNCEMENT)).toEqual({
			announcementId: ANNOUNCEMENT,
			recipients: 4,
			readers: 3,
			readersWithin24h: 2,
			readRate: 0.75,
			readRate24h: 0.5,
		});
		expect(await source.announcementReaders(ANNOUNCEMENT)).toEqual([
			{
				userId: USER,
				displayName: null,
				role: "staff",
				storeIds: null,
				member: false,
				readAt: null,
			},
		]);
		expect(calls).toEqual([
			["announcement_read_counts", { p_announcement_ids: [ANNOUNCEMENT] }],
			["announcement_readers", { p_announcement_id: ANNOUNCEMENT }],
		]);
	});

	it("asks the read rates of a whole list in one call, and in calls of 200 ids at most", async () => {
		const ids = Array.from(
			{ length: 205 },
			(_, index) =>
				`11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
		);
		const { client, calls } = fakeClient((_name, args) => ({
			data: (args as { p_announcement_ids: string[] }).p_announcement_ids
				.filter((id) => id !== ids[1])
				.map((id) => ({
					announcement_id: id,
					published_at: AT,
					recipients: 2,
					readers: 1,
					readers_within_24h: 1,
					read_rate: "0.5000",
					read_rate_24h: "0.5000",
				})),
			error: null,
		}));
		const source = createSupabaseAnnouncements(client);
		const [first, second, again] = await Promise.all([
			source.announcementReadRate(ids[0] ?? ""),
			source.announcementReadRate(ids[1] ?? ""),
			source.announcementReadRate(ids[0] ?? ""),
		]);
		expect(first).toMatchObject({ announcementId: ids[0], readRate: 0.5 });
		expect(second).toBeNull();
		expect(again).toEqual(first);
		expect(calls).toEqual([
			["announcement_read_counts", { p_announcement_ids: [ids[0], ids[1]] }],
		]);
		const all = await Promise.all(
			ids.map((id) => source.announcementReadRate(id)),
		);
		expect(all.filter((rate) => rate !== null)).toHaveLength(204);
		expect(
			calls
				.slice(1)
				.map(
					([name, args]) =>
						`${name}:${(args as { p_announcement_ids: string[] }).p_announcement_ids.length}`,
				),
		).toEqual(["announcement_read_counts:200", "announcement_read_counts:5"]);
	});

	it("gives no read rate for an empty answer and passes a refused read on with its code", async () => {
		const empty = createSupabaseAnnouncements(
			fakeClient(() => ({ data: [], error: null })).client,
		);
		expect(await empty.announcementReadRate(ANNOUNCEMENT)).toBeNull();
		const refused = createSupabaseAnnouncements(
			fakeClient(() => ({
				data: null,
				error: { code: "42501", message: "the read rate is for owners" },
			})).client,
		);
		await expect(
			refused.announcementReadRate(ANNOUNCEMENT),
		).rejects.toMatchObject({ code: "42501" });
	});

	it("publishes with only the title, text, stores and pin, leaving the audience and expiry to the server", async () => {
		const { client, calls } = fakeClient(() => ({
			data: {
				announcement_id: ANNOUNCEMENT,
				published_at: AT,
				recipients: 5,
				messages: 7,
			},
			error: null,
		}));
		const source = createSupabaseAnnouncements(client);
		expect(
			await source.publishAnnouncement(TENANT, {
				title: "Họp",
				body: "Sáng mai",
				storeIds: [STORE],
				pinnedUntil: AT,
			}),
		).toEqual({ announcementId: ANNOUNCEMENT, publishedAt: AT, recipients: 5 });
		await source.publishAnnouncement(TENANT, {
			title: "Họp",
			body: "Sáng mai",
			storeIds: null,
			pinnedUntil: null,
		});
		expect(calls).toEqual([
			[
				"publish_announcement",
				{
					p_tenant_id: TENANT,
					p_title: "Họp",
					p_body: "Sáng mai",
					p_store_ids: [STORE],
					p_pinned_until: AT,
				},
			],
			[
				"publish_announcement",
				{
					p_tenant_id: TENANT,
					p_title: "Họp",
					p_body: "Sáng mai",
					p_store_ids: null,
					p_pinned_until: null,
				},
			],
		]);
	});

	it("pins and unpins, and turns refusals and a lost connection into write codes", async () => {
		const { client, calls } = fakeClient((_name, args) => {
			const until = (args as { p_pinned_until: string | null }).p_pinned_until;
			if (until === "refused") {
				return { data: null, error: { code: "42501", message: "no" } };
			}
			if (until === "invalid") {
				return { data: null, error: { code: "22023", message: "range" } };
			}
			if (until === "offline") return new TypeError("Failed to fetch");
			return {
				data: {
					announcement_id: ANNOUNCEMENT,
					pinned_until: until,
					pinned: until !== null,
				},
				error: null,
			};
		});
		const source = createSupabaseAnnouncements(client);
		expect(await source.setAnnouncementPin(ANNOUNCEMENT, null)).toEqual({
			announcementId: ANNOUNCEMENT,
			pinnedUntil: null,
			pinned: false,
		});
		expect(calls[0]).toEqual([
			"set_announcement_pin",
			{ p_announcement_id: ANNOUNCEMENT, p_pinned_until: null },
		]);
		for (const [until, code] of [
			["refused", "forbidden"],
			["invalid", "invalid"],
			["offline", "network"],
		] as const) {
			const failure = await source.setAnnouncementPin(ANNOUNCEMENT, until).then(
				() => null,
				(error: unknown) => error,
			);
			expect(writeCodeOf(failure)).toBe(code);
		}
	});
});
