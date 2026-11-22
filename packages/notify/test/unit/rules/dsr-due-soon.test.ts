import { describe, expect, it } from "vitest";
import { BREVO_LIMITS, ZALO_BOT_LIMITS } from "../../../src/index.js";
import {
	type AlertFacts,
	alertTemplateRef,
	EN_MESSAGES,
	fitSubject,
	fitToUnits,
	placeholdersOf,
	renderAlert,
	renderQueuedMessage,
	VI_MESSAGES,
} from "../../../src/render/index.js";

// Test design (ISTQB): boundary values of the two counts and of the days (0, 1, 2 and a thousand; 1 and 10 days),
// equivalence classes of a fact that is present, missing, a numeric string or garbage, a decision table over the three
// message kinds, and security cases: the text carries counts only, whatever else the stored parameters hold.
// Component tests with a fixed clock; the end-to-end episode is notify:integration/digests-and-alerts.

const ZONE = "Asia/Ho_Chi_Minh";
const AT = new Date("2026-11-22T03:00:00.000Z");
const FOOTER = "Tắt hoặc đổi kênh nhận: Cài đặt → Cảnh báo.";
const AMOUNT = /₫|\d{1,3}([.,]\d{3})+/;
const LINK = /https?:|www\.|\/\//;
const LEFTOVER = /\{[^{}\n]+\}/;
const ACTION = "Mở Khách hàng → Yêu cầu dữ liệu để xử lý.";

function facts(
	params: Record<string, unknown>,
	overrides: Partial<AlertFacts> = {},
): AlertFacts {
	return {
		kind: "alert",
		ruleKey: "dsr_due_soon",
		templateRef: alertTemplateRef("dsr_due_soon", "alert"),
		params,
		storeName: null,
		accountName: null,
		readerTimezone: ZONE,
		at: AT,
		...overrides,
	};
}

function body(
	params: Record<string, unknown>,
	overrides: Partial<AlertFacts> = {},
): string {
	const rendered = renderAlert(facts(params, overrides));
	const lines = rendered.text.split("\n");
	expect(lines.at(-1)).toBe(FOOTER);
	return lines.slice(0, -1).join("\n");
}

function sentence(overdue: string, dueSoon: string, days: string): string {
	return `Cảnh báo: ${overdue} yêu cầu về dữ liệu cá nhân đã quá hạn trả lời và ${dueSoon} yêu cầu đến hạn trong ${days} ngày tới. ${ACTION}`;
}

describe("dsr_due_soon alert wording", () => {
	it("is a template of its own, not the generic alert, and links to no page", () => {
		const text = body({ overdue: 2, due_soon: 1, days: 3 });
		expect(text).toBe(sentence("2", "1", "3"));
		expect(text).not.toContain("dsr_due_soon");
		expect(text).not.toMatch(LINK);
		expect(text).not.toMatch(LEFTOVER);
		expect(alertTemplateRef("dsr_due_soon", "alert")).toBe(
			"alert.dsr_due_soon.v1",
		);
	});

	it("takes the two counts and the days from the facts, at the edges of each", () => {
		// boundary values: none, one, two, and a thousand (thousands separator); 1 and 10 days are the rule's limits
		const cases: [Record<string, unknown>, string][] = [
			[{ overdue: 0, due_soon: 0, days: 3 }, sentence("0", "0", "3")],
			[{ overdue: 1, due_soon: 0, days: 1 }, sentence("1", "0", "1")],
			[{ overdue: 0, due_soon: 1, days: 10 }, sentence("0", "1", "10")],
			[{ overdue: 2, due_soon: 2, days: 3 }, sentence("2", "2", "3")],
			[
				{ overdue: 1000, due_soon: 999, days: 3 },
				sentence("1.000", "999", "3"),
			],
		];
		for (const [params, expected] of cases) {
			expect(body(params)).toBe(expected);
		}
	});

	it("reads each fact as a class: present, numeric string, missing, or garbage", () => {
		expect(body({ overdue: "4", due_soon: "5", days: "7" })).toBe(
			sentence("4", "5", "7"),
		);
		expect(body({})).toBe(sentence("0", "0", "3"));
		expect(body({ overdue: 1 })).toBe(sentence("1", "0", "3"));
		expect(body({ due_soon: 1 })).toBe(sentence("0", "1", "3"));
		expect(
			body({ overdue: "many", due_soon: null, days: { nested: true } }),
		).toBe(sentence("0", "0", "3"));
		expect(
			body({
				overdue: Number.NaN,
				due_soon: Number.POSITIVE_INFINITY,
				days: "3 ngày",
			}),
		).toBe(sentence("0", "0", "3"));
	});

	it("carries counts only, whatever else the stored parameters hold", () => {
		const leaking = {
			overdue: 1,
			due_soon: 2,
			days: 3,
			phone: "0901234567",
			contact: "subject@example.com",
			email: "subject@example.com",
			name: "Nguyễn Khách Thử",
			request_id: "11111111-2222-4333-8444-555555555555",
			subject_id: "66666666-7777-4888-8999-000000000000",
			notes: "ghi chú riêng",
			store_id: "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
		};
		for (const kind of ["alert", "alert_reminder"] as const) {
			const rendered = renderAlert(facts(leaking, { kind }));
			expect(rendered.text).not.toMatch(
				/0901234567|example\.com|Nguyễn|1111|6666|7777|ghi chú/,
			);
			expect(rendered.text).not.toMatch(LEFTOVER);
			expect(rendered.text).not.toMatch(AMOUNT);
		}
	});

	it("shows no store or account name, since the rule belongs to the tenant", () => {
		const withNames = body(
			{ overdue: 1, due_soon: 1, days: 3 },
			{ storeName: "Cửa hàng thử", accountName: "Tài khoản thử" },
		);
		expect(withNames).toBe(sentence("1", "1", "3"));
		expect(withNames).not.toContain("Cửa hàng thử");
		expect(withNames).not.toContain("Tài khoản thử");
	});

	it("decision table over the three message kinds: the reminder is the overdue wording (ADR-045), a recovery is the generic one", () => {
		const params = { overdue: 1, due_soon: 1, days: 3, days_late: 2 };
		expect(body(params, { kind: "alert_reminder" })).toBe(
			"Nhắc lại: 1 yêu cầu về dữ liệu cá nhân đã quá hạn trả lời, yêu cầu cũ nhất trễ 2 ngày. Mở Khách hàng → Yêu cầu dữ liệu để xử lý.",
		);
		expect(body(params, { kind: "alert_reminder" })).not.toBe(body(params));
		const resolved = renderAlert(facts(params, { kind: "alert_resolved" }));
		expect(resolved.text).not.toMatch(LEFTOVER);
		expect(resolved.text).not.toContain("quá hạn trả lời");
	});

	it("renders through the queue from the stored template reference and fits every channel", () => {
		const queued = renderQueuedMessage({
			kind: "alert",
			channelKind: "zalo_bot",
			provider: "zalo_bot",
			channelLabel: "Zalo Bot",
			readerTimezone: ZONE,
			tenantName: "Quán thử",
			at: AT,
			ruleKey: null,
			templateRef: "alert.dsr_due_soon.v1",
			params: {
				rule_key: "dsr_due_soon",
				severity: "warning",
				store_id: null,
				account_id: null,
				business_date: null,
				occurrences: 1,
				opened_at: 1_763_780_400,
				overdue: 0,
				due_soon: 1,
				days: 3,
			},
			storeName: null,
			accountName: null,
		});
		expect(queued.text).toBe(`${sentence("0", "1", "3")}\n${FOOTER}`);
		expect(queued.title).toBe("Cảnh báo vận hành từ FNB Manager");
		const longest = renderAlert(
			facts({ overdue: 999_999, due_soon: 999_999, days: 10 }),
		);
		expect(fitToUnits(longest.text, ZALO_BOT_LIMITS.maxTextUnits)).toBe(
			longest.text,
		);
		expect(fitSubject(longest.title, BREVO_LIMITS.maxSubjectChars)).toBe(
			longest.title,
		);
	});
});

describe("dsr_due_soon alert English wording", () => {
	it("keeps the same three placeholders as the Vietnamese text and a fixed wording", () => {
		expect(EN_MESSAGES["alert.dsr_due_soon"]).toBe(
			"Warning: {overdue} personal-data requests are past their deadline and {due_soon} fall due within the next {days} days. Open Customers → Data requests to handle them.",
		);
		expect(placeholdersOf(EN_MESSAGES["alert.dsr_due_soon"]).sort()).toEqual([
			"days",
			"due_soon",
			"overdue",
		]);
		expect(placeholdersOf(VI_MESSAGES["alert.dsr_due_soon"]).sort()).toEqual(
			placeholdersOf(EN_MESSAGES["alert.dsr_due_soon"]).sort(),
		);
	});

	it("names no person, contact, link or amount", () => {
		for (const text of [
			EN_MESSAGES["alert.dsr_due_soon"],
			VI_MESSAGES["alert.dsr_due_soon"],
		]) {
			expect(text).not.toMatch(LINK);
			expect(text).not.toMatch(AMOUNT);
			expect(text).not.toMatch(/@|\bphone\b|\bemail\b|số điện thoại/i);
		}
	});
});
