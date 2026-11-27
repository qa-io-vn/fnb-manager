import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import vi from "../i18n/vi.json";
import {
	answersFor,
	inboxOrder,
	isOpen,
	isUnread,
	needsMessage,
	oneLine,
	PROPOSAL_MAX_MS,
	PROPOSAL_MIN_MS,
	proposalProblem,
	type RequestStatus,
	replyText,
	type StoreRequest,
	vietnamInstant,
} from "./requests";

// counter:unit/requests-proposal (M01 "Đề xuất giờ khác", mark as read, unread; native-till.md 16.8):
// - state transitions of a request as the inbox offers them: new → confirmed | proposed | declined; proposed →
//   confirmed (the customer agreed) | proposed again | declined; confirmed → cancelled; declined and cancelled: none;
// - BVA of the proposed time: 30 minutes ahead (29:59 refused, 30:00 taken), 60 days ahead (taken, one minute more
//   refused), the time asked refused, a malformed date or clock refused;
// - EP of unread: a new request nobody opened, a new one opened, an answered one;
// - the reply text of a proposal names both times; a message is sent on one line.

const NOW = Date.parse("2026-11-28T05:00:00Z"); // 12:00 in Vietnam

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
		...overrides,
	};
}

describe("the answers offered (state transitions)", () => {
	const rows: readonly [RequestStatus, Partial<StoreRequest>, string[]][] = [
		["new", {}, ["confirmed", "proposed", "declined"]],
		[
			"new",
			{ kind: "application", requested_for: null },
			["confirmed", "declined"],
		],
		["proposed", {}, ["confirmed", "proposed", "declined"]],
		["confirmed", {}, ["cancelled"]],
		["declined", {}, []],
		["cancelled", {}, []],
	];
	it.each(rows)("%s %o → %o", (status, extra, offered) => {
		expect(answersFor(request({ status, ...extra }))).toEqual(offered);
	});

	it("asks a message for declining, cancelling and proposing, not for accepting", () => {
		expect(needsMessage("confirmed")).toBe(false);
		expect(needsMessage(null)).toBe(false);
		expect(needsMessage("declined")).toBe(true);
		expect(needsMessage("cancelled")).toBe(true);
		expect(needsMessage("proposed")).toBe(true);
	});

	it("keeps new and proposed requests open, the answered ones done", () => {
		expect(isOpen(request())).toBe(true);
		expect(isOpen(request({ status: "proposed" }))).toBe(true);
		expect(isOpen(request({ status: "confirmed" }))).toBe(false);
		expect(isOpen(request({ status: "declined" }))).toBe(false);
	});

	it("orders new first, then proposals waiting for the customer, then the rest newest first", () => {
		const ordered = inboxOrder([
			request({
				id: "a",
				status: "confirmed",
				created_at: "2026-11-28T01:00:00Z",
			}),
			request({
				id: "b",
				status: "proposed",
				created_at: "2026-11-28T02:00:00Z",
			}),
			request({
				id: "c",
				status: "new",
				answer_due_at: "2026-11-28T06:00:00Z",
			}),
			request({
				id: "d",
				status: "new",
				answer_due_at: "2026-11-28T05:10:00Z",
			}),
			request({
				id: "e",
				status: "declined",
				created_at: "2026-11-28T03:00:00Z",
			}),
		]);
		expect(ordered.map((entry) => entry.id)).toEqual(["d", "c", "b", "e", "a"]);
	});
});

describe("unread (EP)", () => {
	it("is a new request nobody opened yet", () => {
		expect(isUnread(request())).toBe(true);
		const { read_at: _omitted, ...withoutReadAt } = request();
		expect(isUnread(withoutReadAt)).toBe(true);
		expect(isUnread(request({ read_at: "2026-11-28T04:55:00Z" }))).toBe(false);
		expect(isUnread(request({ status: "proposed" }))).toBe(false);
		expect(isUnread(request({ status: "confirmed" }))).toBe(false);
	});
});

describe("the proposed time (BVA)", () => {
	const at = (ms: number) => new Date(NOW + ms).toISOString();
	it("must be at least 30 minutes ahead", () => {
		expect(proposalProblem(at(PROPOSAL_MIN_MS - 1000), request(), NOW)).toBe(
			"too_soon",
		);
		expect(proposalProblem(at(PROPOSAL_MIN_MS), request(), NOW)).toBeNull();
	});

	it("must be at most 60 days ahead", () => {
		expect(proposalProblem(at(PROPOSAL_MAX_MS), request(), NOW)).toBeNull();
		expect(proposalProblem(at(PROPOSAL_MAX_MS + 60_000), request(), NOW)).toBe(
			"too_far",
		);
	});

	it("must differ from the time asked, and be a time at all", () => {
		expect(proposalProblem("2026-11-28T12:00:00.000Z", request(), NOW)).toBe(
			"same_time",
		);
		expect(proposalProblem(null, request(), NOW)).toBe("invalid");
		expect(proposalProblem("not a time", request(), NOW)).toBe("invalid");
	});

	it("is read from a date and a clock in Vietnam time", () => {
		expect(vietnamInstant("2026-11-28", "19:30")).toBe(
			"2026-11-28T12:30:00.000Z",
		);
		expect(vietnamInstant("2026-11-29", "00:15")).toBe(
			"2026-11-28T17:15:00.000Z",
		);
		expect(vietnamInstant("", "19:30")).toBeNull();
		expect(vietnamInstant("2026-11-28", "")).toBeNull();
		expect(vietnamInstant("2026-02-30", "10:00")).toBeNull();
		expect(vietnamInstant("28/11/2026", "19:30")).toBeNull();
	});
});

describe("the reply of a proposal", () => {
	const t = (key: string, params: Record<string, string | number> = {}) => {
		let text = (vi as Record<string, string>)[key] ?? key;
		for (const [name, value] of Object.entries(params))
			text = text.replaceAll(`{${name}}`, String(value));
		return text;
	};

	it("names the time asked, the time proposed and the facts, as plain text", () => {
		const text = replyText(
			request({ contact_name: "Khách <b>Mẫu</b>" }),
			"proposed",
			"Giờ đó đã kín\nbàn.",
			"Cửa hàng A",
			t,
			"2026-11-28T12:30:00.000Z",
		);
		expect(text).toBe(
			"Cửa hàng A chưa giữ được chỗ cho Khách <b>Mẫu</b> lúc 19:00 ngày 28/11/2026. Quán đề xuất 19:30 ngày 28/11/2026 (4 người). Bạn nhắn lại để quán chốt. Giờ đó đã kín bàn.",
		);
	});

	it("names the new time when the customer agreed to the proposal", () => {
		const text = replyText(
			request({
				status: "proposed",
				proposed_for: "2026-11-28T12:30:00Z",
			}),
			"confirmed",
			"",
			"Cửa hàng A",
			t,
		);
		expect(text).toContain("19:30 ngày 28/11/2026");
		expect(text).not.toContain("19:00");
	});

	it("puts a message on one line for the database", () => {
		expect(oneLine("  một\r\n  hai \n ba ")).toBe("một hai ba");
		expect(oneLine("   ")).toBe("");
	});

	it("has its words in both catalogs with the same placeholders", () => {
		for (const key of [
			"reply.proposed",
			"requests.answer.proposed",
			"requests.answer.agreed",
			"requests.unread",
			"requests.status.proposed",
		]) {
			expect((vi as Record<string, string>)[key], key).toBeTruthy();
			expect((en as Record<string, string>)[key], key).toBeTruthy();
		}
	});
});
