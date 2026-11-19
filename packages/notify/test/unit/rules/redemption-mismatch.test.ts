import { describe, expect, it } from "vitest";
import { BREVO_LIMITS, ZALO_BOT_LIMITS } from "../../../src/index.js";
import {
	type AlertFacts,
	alertTemplateRef,
	EN_MESSAGES,
	fitSubject,
	fitToUnits,
	renderAlert,
	renderQueuedMessage,
} from "../../../src/render/index.js";

const ZONE = "Asia/Ho_Chi_Minh";
const AT = new Date("2026-11-19T03:05:00.000Z");
const FOOTER = "Tắt hoặc đổi kênh nhận: Cài đặt → Cảnh báo.";
const AMOUNT = /₫|\d{1,3}([.,]\d{3})+/;
const LINK = /https?:|www\.|\/\//;
const ACTION =
	"Đối chiếu với POS rồi xử lý các mục này trong hàng chờ đối soát.";

const FACTS = {
	rule_key: "redemption_mismatch",
	severity: "warning",
	store_id: "11111111-1111-4111-8111-111111111111",
	account_id: null,
	business_date: "2026-11-19",
	occurrences: 1,
	opened_at: 1_763_521_500,
	open_items: 4,
	verified_without_invoice: 1,
	discount_without_redemption: 2,
	amount_mismatch: 1,
};

function facts(
	params: Record<string, unknown>,
	overrides: Partial<AlertFacts> = {},
): AlertFacts {
	return {
		kind: "alert",
		ruleKey: "redemption_mismatch",
		templateRef: alertTemplateRef("redemption_mismatch", "alert"),
		params,
		storeName: "Cửa hàng thử",
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

describe("redemption_mismatch", () => {
	it("names the store and counts each kind of mismatch, with no amount and no link", () => {
		const text = body(FACTS);
		expect(text).toBe(
			`Cảnh báo: Cửa hàng thử có 4 mục đổi thưởng chưa khớp với hóa đơn POS: 1 mã đã xác nhận tại quầy nhưng chưa có hóa đơn, 2 hóa đơn có giảm giá đổi thưởng nhưng không có lượt đổi nào và 1 hóa đơn có mức giảm khác với phần thưởng. ${ACTION}`,
		);
		expect(text).not.toMatch(AMOUNT);
		expect(text).not.toMatch(LINK);
		expect(text).not.toContain("Cảnh báo vận hành:");
		expect(alertTemplateRef("redemption_mismatch", "alert")).toBe(
			"alert.redemption_mismatch.v1",
		);
	});

	it("lists only the kinds that have open items", () => {
		expect(
			body({
				...FACTS,
				open_items: 3,
				verified_without_invoice: 0,
				discount_without_redemption: 3,
				amount_mismatch: 0,
			}),
		).toBe(
			`Cảnh báo: Cửa hàng thử có 3 mục đổi thưởng chưa khớp với hóa đơn POS: 3 hóa đơn có giảm giá đổi thưởng nhưng không có lượt đổi nào. ${ACTION}`,
		);
		expect(
			body({
				open_items: 2,
				verified_without_invoice: "1",
				amount_mismatch: 1,
			}),
		).toContain(
			"có 2 mục đổi thưởng chưa khớp với hóa đơn POS: 1 mã đã xác nhận tại quầy nhưng chưa có hóa đơn và 1 hóa đơn có mức giảm khác với phần thưởng.",
		);
	});

	it("adds the kinds up when the total is missing and falls back when no kind is known", () => {
		expect(body({ verified_without_invoice: 2, amount_mismatch: 1 })).toContain(
			"Cửa hàng thử có 3 mục đổi thưởng chưa khớp với hóa đơn POS: ",
		);
		expect(body({ open_items: 5 })).toBe(
			`Cảnh báo: Cửa hàng thử có 5 mục đổi thưởng chưa khớp với hóa đơn POS. ${ACTION}`,
		);
		expect(
			body(
				{ verified_without_invoice: -1, amount_mismatch: 1.5 },
				{
					storeName: null,
				},
			),
		).toBe(
			`Cảnh báo: cửa hàng có ? mục đổi thưởng chưa khớp với hóa đơn POS. ${ACTION}`,
		);
	});

	it("takes nothing from codes, invoices, members or amounts that reach the parameters", () => {
		const text = body({
			...FACTS,
			code: "AB12CD34",
			voucher_code: "AB12CD34",
			receipt_no: "0042",
			invoice_id: "22222222-2222-4222-8222-222222222222",
			membership_id: "33333333-3333-4333-8333-333333333333",
			phone: "0900000123",
			discount_amount: 25_000,
			expected_discount: 20_000,
		});
		expect(text).toBe(body(FACTS));
		for (const leaked of [
			"AB12CD34",
			"0042",
			"2222",
			"3333",
			"0900000123",
			"25.000",
			"20.000",
			"25000",
		]) {
			expect(text).not.toContain(leaked);
		}
	});

	it("repeats the opening text as a reminder and has an English wording", () => {
		expect(body(FACTS, { kind: "alert_reminder" })).toBe(body(FACTS));
		expect(EN_MESSAGES["alert.redemption_mismatch"]).toBe(
			"Alert: {store} has {count} reward redemption items that do not match the POS invoices: {kinds}. Check them against the POS, then settle them in the reconciliation queue.",
		);
		for (const key of [
			"alert.redemption_mismatch",
			"alert.redemption_mismatch.unsorted",
			"alert.redemption_mismatch.verified_without_invoice",
			"alert.redemption_mismatch.discount_without_redemption",
			"alert.redemption_mismatch.amount_mismatch",
		] as const) {
			expect(EN_MESSAGES[key]).not.toMatch(LINK);
			expect(EN_MESSAGES[key]).not.toMatch(AMOUNT);
		}
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
			templateRef: "alert.redemption_mismatch.v1",
			params: FACTS,
			storeName: "Cửa hàng thử",
			accountName: null,
		});
		expect(
			queued.text.startsWith("Cảnh báo: Cửa hàng thử có 4 mục đổi thưởng"),
		).toBe(true);
		expect(queued.title).toBe("Cảnh báo vận hành từ FNB Manager");
		const longest = renderAlert(
			facts(
				{
					open_items: 99_999,
					verified_without_invoice: 33_333,
					discount_without_redemption: 33_333,
					amount_mismatch: 33_333,
				},
				{ storeName: "Cửa hàng ".repeat(12).trim() },
			),
		);
		expect(fitToUnits(longest.text, ZALO_BOT_LIMITS.maxTextUnits)).toBe(
			longest.text,
		);
		expect(fitSubject(longest.title, BREVO_LIMITS.maxSubjectChars)).toBe(
			longest.title,
		);
	});
});
