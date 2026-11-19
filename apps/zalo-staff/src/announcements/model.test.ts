import { describe, expect, it } from "vitest";
import {
	type Announcement,
	feedArgs,
	publishArgs,
	readFeed,
	readPublishReceipt,
	readReaders,
	readReadRate,
} from "./contract";
import {
	draftProblems,
	isUnread,
	orderFeed,
	percent,
	pinEnd,
	pinnedNow,
	unreadCount,
} from "./model";

const NOW = new Date("2026-11-19T05:00:00Z");
const ME = "00000000-0000-4000-8000-00000000a001";

function notice(patch: Partial<Announcement>): Announcement {
	return {
		id: "a",
		storeIds: null,
		title: "Tiêu đề",
		body: "Nội dung",
		pinned: false,
		pinnedUntil: null,
		publishedBy: "someone",
		publishedAt: "2026-11-18T05:00:00Z",
		recipient: true,
		readAt: null,
		...patch,
	};
}

describe("the announcement order", () => {
	it("puts the notices pinned now first, then the newest", () => {
		const old = notice({ id: "old", publishedAt: "2026-11-10T00:00:00Z" });
		const fresh = notice({ id: "fresh", publishedAt: "2026-11-19T04:00:00Z" });
		const pinned = notice({
			id: "pinned",
			publishedAt: "2026-11-01T00:00:00Z",
			pinnedUntil: "2026-11-20T00:00:00Z",
		});
		const pinEnded = notice({
			id: "ended",
			publishedAt: "2026-11-18T00:00:00Z",
			pinnedUntil: "2026-11-19T04:59:00Z",
		});
		expect(
			orderFeed([old, pinEnded, fresh, pinned], NOW).map((a) => a.id),
		).toEqual(["pinned", "fresh", "ended", "old"]);
		expect(
			pinnedNow([old, pinEnded, fresh, pinned], NOW).map((a) => a.id),
		).toEqual(["pinned"]);
	});

	it("marks unread only what the member has not read and did not publish", () => {
		const unread = notice({ id: "u" });
		const read = notice({ id: "r", readAt: "2026-11-18T06:00:00Z" });
		const own = notice({ id: "o", publishedBy: ME });
		expect(isUnread(unread, ME)).toBe(true);
		expect(isUnread(read, ME)).toBe(false);
		expect(isUnread(own, ME)).toBe(false);
		expect(unreadCount([unread, read, own], ME)).toBe(1);
	});
});

describe("a draft", () => {
	it("needs a title, a text and a store, within the limits", () => {
		expect(
			draftProblems({
				title: "  ",
				body: "",
				storeIds: [],
				pinnedUntil: null,
			}),
		).toEqual([
			{ field: "title", problem: "empty" },
			{ field: "body", problem: "empty" },
			{ field: "stores", problem: "empty" },
		]);
		expect(
			draftProblems({
				title: "x".repeat(121),
				body: "y".repeat(4001),
				storeIds: ["s"],
				pinnedUntil: null,
			}),
		).toEqual([
			{ field: "title", problem: "long" },
			{ field: "body", problem: "long" },
		]);
		expect(
			draftProblems({
				title: "Họp",
				body: "Họp lúc 8 giờ",
				storeIds: ["s"],
				pinnedUntil: null,
			}),
		).toEqual([]);
	});

	it("pins for whole days from now and sends trimmed text with the stores", () => {
		expect(pinEnd(null, NOW)).toBeNull();
		expect(pinEnd(3, NOW)).toBe("2026-11-22T05:00:00.000Z");
		expect(
			publishArgs("tenant", {
				title: " Họp ",
				body: "\nNội dung\n",
				storeIds: ["s1", "s2"],
				pinnedUntil: "2026-11-22T05:00:00.000Z",
			}),
		).toEqual({
			p_tenant_id: "tenant",
			p_title: "Họp",
			p_body: "Nội dung",
			p_store_ids: ["s1", "s2"],
			p_pinned_until: "2026-11-22T05:00:00.000Z",
		});
		expect(feedArgs(null)).toEqual({
			p_store_id: null,
			p_include_expired: false,
		});
	});
});

describe("the announcement answers", () => {
	it("read the feed, the rate, the readers and a publication", () => {
		expect(
			readFeed([
				{
					announcement_id: "a1",
					tenant_id: "t",
					store_ids: ["s1"],
					audience: ["manager", "staff"],
					title: "Tiêu đề",
					body: "Nội dung",
					pinned: true,
					pinned_until: "2026-11-20T00:00:00+00:00",
					published_by: "u",
					published_at: "2026-11-18T00:00:00+00:00",
					expires_at: null,
					recipient: true,
					read_at: null,
				},
			]),
		).toEqual([
			{
				id: "a1",
				storeIds: ["s1"],
				title: "Tiêu đề",
				body: "Nội dung",
				pinned: true,
				pinnedUntil: "2026-11-20T00:00:00+00:00",
				publishedBy: "u",
				publishedAt: "2026-11-18T00:00:00+00:00",
				recipient: true,
				readAt: null,
			},
		]);
		expect(
			readReadRate([
				{
					announcement_id: "a1",
					published_at: "2026-11-18T00:00:00+00:00",
					recipients: 5,
					readers: 4,
					readers_within_24h: 3,
					read_rate: 0.8,
					read_rate_24h: 0.6,
				},
			]),
		).toEqual({ recipients: 5, readers: 4, readersWithin24h: 3, rate: 0.8 });
		expect(percent(0.8)).toBe(80);
		expect(percent(0.3333)).toBe(33);
		expect(
			readReaders([
				{
					user_id: "u1",
					display_name: null,
					role: "staff",
					store_ids: ["s1"],
					member: false,
					read_at: null,
				},
			]),
		).toEqual([
			{ userId: "u1", name: null, role: "staff", member: false, readAt: null },
		]);
		expect(
			readPublishReceipt({
				announcement_id: "a2",
				published_at: "2026-11-19T00:00:00+00:00",
				recipients: 7,
				messages: 3,
			}),
		).toEqual({ id: "a2", recipients: 7 });
		expect(() => readFeed({ rows: [] })).toThrow();
	});
});
