import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import vi from "../i18n/vi.json";
import {
	answersFor,
	inboxOrder,
	inOpenTab,
	isAcceptedUnseen,
	isOpen,
	needsReading,
	type StoreRequest,
	unreadCount,
} from "./requests";

// counter:unit/requests-accepted (M01 with native-till.md 18.2: the customer accepts the time proposed in the app,
// customer_accept_proposal, and the inbox flags it with accepted_unseen until an owner or manager opens or answers it):
// - state transitions: proposed → (the customer accepts) confirmed · accepted_unseen → (opened or answered) confirmed;
//   only the confirmed request carries the mark, and it offers "Hủy" only;
// - equivalence partitions of the mark: accepted and unseen, accepted and seen, a manager's confirmation, a new or
//   proposed request (never accepted), the flag missing from an older answer;
// - the inbox's order (new first, then the acceptances nobody saw, then the proposals, then the rest) and its tabs
//   (an unseen acceptance stays in "Chưa xử lý" until seen);
// - boundary values of the unread count shown on the tab, on Quản lý and in the inbox: unread + accepted_unseen, with
//   0, a missing count, and nonsense (negative, fractional) counted as none.

function request(overrides: Partial<StoreRequest> = {}): StoreRequest {
	return {
		id: "33333333-0000-4000-8000-000000000001",
		kind: "booking",
		status: "new",
		channel: "app",
		party_size: 4,
		requested_for: "2026-11-28T12:00:00Z",
		proposed_for: null,
		subject: null,
		note: null,
		created_at: "2026-11-28T04:50:00Z",
		answered_at: null,
		answer_message: null,
		version: 1,
		contact_name: "Khách Mẫu",
		contact_phone: "0900000000",
		answer_due_at: "2026-11-28T05:20:00Z",
		overdue: false,
		read_at: null,
		read_by: null,
		customer_accepted_at: null,
		accepted_unseen: false,
		accept_seen_at: null,
		accept_seen_by: null,
		...overrides,
	};
}

const accepted = (overrides: Partial<StoreRequest> = {}) =>
	request({
		status: "confirmed",
		proposed_for: "2026-11-28T12:30:00Z",
		requested_for: "2026-11-28T12:30:00Z",
		customer_accepted_at: "2026-11-28T05:00:00Z",
		accepted_unseen: true,
		read_at: "2026-11-28T04:55:00Z",
		version: 3,
		...overrides,
	});

describe("the customer's acceptance mark (EP)", () => {
	it("is on a confirmed request the customer accepted and nobody saw since", () => {
		expect(isAcceptedUnseen(accepted())).toBe(true);
		expect(needsReading(accepted())).toBe(true);
	});

	it("goes once an owner or manager opened or answered it", () => {
		const seen = accepted({
			accepted_unseen: false,
			accept_seen_at: "2026-11-28T05:01:00Z",
		});
		expect(isAcceptedUnseen(seen)).toBe(false);
		expect(needsReading(seen)).toBe(false);
	});

	it("is never on a manager's own confirmation, a new or a proposed request, or an older answer without the flag", () => {
		expect(isAcceptedUnseen(request({ status: "confirmed" }))).toBe(false);
		expect(isAcceptedUnseen(request())).toBe(false);
		expect(
			isAcceptedUnseen(
				request({ status: "proposed", proposed_for: "2026-11-28T12:30:00Z" }),
			),
		).toBe(false);
		const { accepted_unseen: _dropped, ...older } = accepted();
		expect(isAcceptedUnseen(older)).toBe(false);
	});

	it("trusts the server only on a confirmed request (error guessing: a flag on a cancelled one)", () => {
		expect(isAcceptedUnseen(accepted({ status: "cancelled" }))).toBe(false);
	});

	it("still needs reading a new request nobody opened (the first reading of the contact)", () => {
		expect(needsReading(request())).toBe(true);
		expect(needsReading(request({ read_at: "2026-11-28T04:55:00Z" }))).toBe(
			false,
		);
	});
});

describe("an accepted request (state transitions)", () => {
	it("is confirmed and offers only the cancel a confirmed request has", () => {
		expect(answersFor(accepted())).toEqual(["cancelled"]);
	});

	it("stays in Chưa xử lý until it is seen, then moves to Đã xử lý", () => {
		expect(isOpen(accepted())).toBe(false);
		expect(inOpenTab(accepted())).toBe(true);
		expect(inOpenTab(accepted({ accepted_unseen: false }))).toBe(false);
		expect(inOpenTab(request())).toBe(true);
		expect(inOpenTab(request({ status: "proposed" }))).toBe(true);
		expect(inOpenTab(request({ status: "declined" }))).toBe(false);
	});
});

describe("the inbox's order", () => {
	it("lists new requests first, then the acceptances nobody saw, then the proposals, then the rest newest first", () => {
		const ordered = inboxOrder([
			request({
				id: "confirmed-old",
				status: "confirmed",
				created_at: "2026-11-28T01:00:00Z",
			}),
			request({
				id: "proposed",
				status: "proposed",
				created_at: "2026-11-28T04:00:00Z",
			}),
			accepted({ id: "accepted-old", created_at: "2026-11-28T02:00:00Z" }),
			request({ id: "new", answer_due_at: "2026-11-28T06:00:00Z" }),
			accepted({ id: "accepted-new", created_at: "2026-11-28T03:00:00Z" }),
			accepted({
				id: "accepted-seen",
				accepted_unseen: false,
				created_at: "2026-11-28T03:30:00Z",
			}),
		]);
		expect(ordered.map((entry) => entry.id)).toEqual([
			"new",
			"accepted-new",
			"accepted-old",
			"proposed",
			"accepted-seen",
			"confirmed-old",
		]);
	});
});

describe("the unread count (BVA)", () => {
	it.each([
		[{ unread: 0, accepted_unseen: 0 }, 0],
		[{ unread: 1, accepted_unseen: 0 }, 1],
		[{ unread: 0, accepted_unseen: 1 }, 1],
		[{ unread: 2, accepted_unseen: 3 }, 5],
		[{ unread: 4 }, 4],
		[{ unread: -1, accepted_unseen: 1 }, 1],
		[{ unread: 1, accepted_unseen: 0.5 }, 1],
	])("%o → %d", (box, count) => {
		expect(unreadCount(box)).toBe(count);
	});

	it("is 0 before the inbox answered", () => {
		expect(unreadCount(undefined)).toBe(0);
	});
});

describe("the words", () => {
	it("are in both catalogs with the same placeholders", () => {
		const catalogs = [vi, en] as Record<string, string>[];
		for (const key of [
			"requests.accepted",
			"requests.acceptedMark",
			"requests.acceptedRow",
			"requests.customerAccepted",
			"requests.awaitingCustomerApp",
		])
			for (const catalog of catalogs) expect(catalog[key], key).toBeTruthy();
		expect(vi["requests.accepted"]).toContain("{count}");
		expect(en["requests.customerAccepted"]).toContain("{time}");
	});
});
