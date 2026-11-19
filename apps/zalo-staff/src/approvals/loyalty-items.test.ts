import { describe, expect, it } from "vitest";
import type { QueueItem } from "../loyalty/contract";
import { isOverdue, sortQueue } from "../loyalty/model";
import {
	ageHours,
	choiceKey,
	choicesOf,
	initialDraft,
	NO_INVOICE,
	needsAmount,
	outcomeKey,
	queueAction,
	queueSummary,
} from "./loyalty-items";

const NOW = new Date("2026-11-19T05:00:00Z");
const STORE = "00000000-0000-4000-8000-0000000005a1";
const INVOICE_A = "00000000-0000-4000-8000-00000000f012";
const INVOICE_B = "00000000-0000-4000-8000-00000000f013";

function hoursAgo(hours: number): string {
	return new Date(NOW.getTime() - hours * 3600_000).toISOString();
}

const match: QueueItem = {
	id: "00000000-0000-4000-8000-00000000d001",
	kind: "match",
	storeId: STORE,
	createdAt: hoursAgo(1),
	phoneMasked: "•••• ••• 234",
	requestedBy: null,
	reason: null,
	stamps: 0,
	points: 0,
	match: {
		path: "member_code",
		recordedAt: hoursAgo(1),
		amount: null,
		receiptNo: null,
		candidates: [
			{
				invoiceId: INVOICE_A,
				receiptNo: "HD-0012",
				soldAt: hoursAgo(1),
				amount: 85_000,
			},
			{
				invoiceId: INVOICE_B,
				receiptNo: "HD-0013",
				soldAt: hoursAgo(1),
				amount: 85_000,
			},
		],
	},
};

const dispute: QueueItem = {
	id: "00000000-0000-4000-8000-00000000d002",
	kind: "dispute",
	storeId: STORE,
	createdAt: hoursAgo(50),
	phoneMasked: "•••• ••• 678",
	requestedBy: "Nhân viên thử",
	reason: "Khách báo hóa đơn hôm kia chưa được tích dấu.",
	stamps: 1,
	points: 8,
	match: null,
};

const adjustment: QueueItem = {
	...dispute,
	id: "00000000-0000-4000-8000-00000000d003",
	kind: "adjustment",
	createdAt: hoursAgo(72),
	stamps: 3,
	points: 0,
};

const freshDispute: QueueItem = {
	...dispute,
	id: "00000000-0000-4000-8000-00000000d004",
	createdAt: hoursAgo(47.9),
};

describe("loyalty queue items", () => {
	it("flags a dispute older than 48 hours, and only a dispute", () => {
		expect(isOverdue(dispute, NOW)).toBe(true);
		expect(isOverdue(freshDispute, NOW)).toBe(false);
		expect(isOverdue({ ...dispute, createdAt: hoursAgo(48) }, NOW)).toBe(true);
		expect(isOverdue(adjustment, NOW)).toBe(false);
		expect(isOverdue({ ...match, createdAt: hoursAgo(100) }, NOW)).toBe(false);
		expect(ageHours(dispute, NOW)).toBe(50);
		expect(
			queueSummary([match, dispute, adjustment, freshDispute], NOW),
		).toEqual({
			open: 4,
			overdue: 1,
		});
	});

	it("puts overdue disputes first, then the oldest", () => {
		expect(
			sortQueue([match, freshDispute, adjustment, dispute], NOW).map(
				(item) => item.id,
			),
		).toEqual([dispute.id, adjustment.id, freshDispute.id, match.id]);
	});

	it("offers each candidate invoice or none for a match, approve or refuse otherwise", () => {
		expect(choicesOf(match)).toEqual([INVOICE_A, INVOICE_B, NO_INVOICE]);
		expect(choicesOf(dispute)).toEqual(["approved", "refused"]);
		expect(choiceKey("match", NO_INVOICE)).toBe("queue.match.none");
		expect(choiceKey("dispute", "approved")).toBe("queue.dispute.accept");
		expect(choiceKey("adjustment", "approved")).toBe(
			"queue.adjustment.approve",
		);
		expect(choiceKey("adjustment", "refused")).toBe("queue.refuse");
		expect(outcomeKey("dismissed")).toBe("queue.done.dismissed");
	});

	it("needs a choice and the manager's reason for every action", () => {
		expect(queueAction(match, initialDraft(match))).toEqual({
			ok: false,
			problems: [{ field: "choice" }, { field: "reason", problem: "empty" }],
		});
		expect(
			queueAction(match, {
				...initialDraft(match),
				choice: INVOICE_A,
				reason: "x".repeat(201),
			}),
		).toEqual({ ok: false, problems: [{ field: "reason", problem: "long" }] });
		expect(
			queueAction(match, {
				...initialDraft(match),
				choice: "00000000-0000-4000-8000-00000000ffff",
				reason: "Khớp giờ in hóa đơn.",
			}),
		).toEqual({ ok: false, problems: [{ field: "choice" }] });
	});

	it("resolves a match to an invoice, or to none", () => {
		expect(
			queueAction(match, {
				...initialDraft(match),
				choice: INVOICE_B,
				reason: "  Khớp giờ in hóa đơn. ",
			}),
		).toEqual({
			ok: true,
			action: {
				kind: "match",
				itemId: match.id,
				invoiceId: INVOICE_B,
				reason: "Khớp giờ in hóa đơn.",
			},
		});
		expect(
			queueAction(match, {
				...initialDraft(match),
				choice: NO_INVOICE,
				reason: "Không phải khách này.",
			}),
		).toMatchObject({ ok: true, action: { invoiceId: null } });
	});

	it("accepts a dispute with its adjustment, refuses with nothing to write", () => {
		const draft = initialDraft(dispute);
		expect(draft).toEqual({
			choice: null,
			reason: "",
			stamps: "1",
			points: "8",
		});
		expect(needsAmount(dispute, { ...draft, choice: "approved" })).toBe(true);
		expect(needsAmount(dispute, { ...draft, choice: "refused" })).toBe(false);
		expect(
			queueAction(dispute, {
				...draft,
				choice: "approved",
				stamps: "2",
				reason: "Đã đối chiếu hóa đơn.",
			}),
		).toEqual({
			ok: true,
			action: {
				kind: "decide",
				itemId: dispute.id,
				decision: "approved",
				reason: "Đã đối chiếu hóa đơn.",
				stamps: 2,
				points: 8,
			},
		});
		expect(
			queueAction(dispute, {
				...draft,
				choice: "approved",
				stamps: "0",
				points: "0",
				reason: "Đã đối chiếu.",
			}),
		).toEqual({ ok: false, problems: [{ field: "amount", problem: "zero" }] });
		expect(
			queueAction(dispute, {
				...draft,
				choice: "refused",
				stamps: "x",
				reason: "Hóa đơn đã được tích.",
			}),
		).toMatchObject({
			ok: true,
			action: { decision: "refused", stamps: 0, points: 0 },
		});
	});

	it("approves or refuses an adjustment request", () => {
		expect(
			queueAction(adjustment, {
				...initialDraft(adjustment),
				choice: "approved",
				reason: "Đúng như báo cáo ca.",
			}),
		).toMatchObject({
			ok: true,
			action: { kind: "decide", decision: "approved", stamps: 3, points: 0 },
		});
		expect(
			queueAction(adjustment, {
				...initialDraft(adjustment),
				choice: "approved",
				stamps: "1-",
				reason: "Đúng.",
			}),
		).toEqual({
			ok: false,
			problems: [{ field: "amount", problem: "number" }],
		});
	});
});
