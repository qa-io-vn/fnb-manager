import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { writeCodeOf } from "../settings/source";
import { createSupabaseAnnouncements } from "./supabase-announcements-source";

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
	it("reads the whole feed with expired ones and maps its rows", async () => {
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
		expect(await source.announcements()).toEqual([
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
			["announcement_feed", { p_store_id: null, p_include_expired: true }],
		]);
	});

	it("reads the read rate with numeric shares and the readers with their names", async () => {
		const { client, calls } = fakeClient((name) =>
			name === "announcement_read_rate"
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
			["announcement_read_rate", { p_announcement_id: ANNOUNCEMENT }],
			["announcement_readers", { p_announcement_id: ANNOUNCEMENT }],
		]);
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
