import { describe, expect, it } from "vitest";
import { BREVO_LIMITS, ZALO_BOT_LIMITS } from "../../../src/index.js";
import {
	type AlertFacts,
	alertTemplateRef,
	fitSubject,
	fitToUnits,
	renderAlert,
	renderQueuedMessage,
} from "../../../src/render/index.js";

const ZONE = "Asia/Ho_Chi_Minh";
const AT = new Date("2026-11-09T02:05:00.000Z");
const FOOTER = "Tắt hoặc đổi kênh nhận: Cài đặt → Cảnh báo.";
const AMOUNT = /₫|\d{1,3}([.,]\d{3})+/;

const COUNTED = {
	rule_key: "cash_count_variance",
	severity: "warning",
	store_id: "11111111-1111-4111-8111-111111111111",
	account_id: null,
	business_date: "2026-11-08",
	occurrences: 1,
	opened_at: 1_762_653_600,
	shift_number: 2,
	over_abs: true,
	over_rel: false,
	over_z: true,
	shortfall: true,
	recounts: 0,
};

function facts(params: Record<string, unknown>): AlertFacts {
	return {
		kind: "alert",
		ruleKey: "cash_count_variance",
		templateRef: alertTemplateRef("cash_count_variance", "alert"),
		params,
		storeName: "Cửa hàng thử",
		accountName: null,
		readerTimezone: ZONE,
		at: AT,
	};
}

function body(params: Record<string, unknown>): string {
	const rendered = renderAlert(facts(params));
	const lines = rendered.text.split("\n");
	expect(lines.at(-1)).toBe(FOOTER);
	return lines.slice(0, -1).join("\n");
}

describe("cash_count_variance", () => {
	it("names the shift Ca {n} of its business date and carries no amount", () => {
		const text = body(COUNTED);
		expect(text).toBe(
			"Cảnh báo: Cửa hàng thử, Ca 2 ngày 08/11/2026: tiền mặt đếm khi đóng ca thiếu so với POS, vượt ngưỡng tuyệt đối và điểm z. Kiểm tra két; quản lý có thể mở lại lượt đếm để đếm lại.",
		);
		expect(text).not.toMatch(AMOUNT);
		expect(alertTemplateRef("cash_count_variance", "alert")).toBe(
			"alert.cash_count_variance.v1",
		);
	});

	it("says whether the drawer was short or over and which tests tripped", () => {
		expect(
			body({ ...COUNTED, shortfall: false, over_z: false, over_rel: true }),
		).toContain(
			"tiền mặt đếm khi đóng ca dư so với POS, vượt ngưỡng tuyệt đối và tương đối.",
		);
		expect(
			body({ ...COUNTED, over_abs: true, over_rel: true, over_z: true }),
		).toContain("vượt ngưỡng tuyệt đối, tương đối và điểm z.");
		expect(
			body({ ...COUNTED, over_abs: false, over_rel: "true", over_z: "false" }),
		).toContain("vượt ngưỡng tương đối.");
		const unknown = body({
			business_date: "2026-11-08",
			shift_number: 1,
		});
		expect(unknown).toContain(
			"Ca 1 ngày 08/11/2026: tiền mặt đếm khi đóng ca lệch so với POS, vượt ngưỡng đã đặt.",
		);
	});

	it("tells a recount apart from the first count", () => {
		expect(body({ ...COUNTED, recounts: 2 })).toBe(
			"Cảnh báo: Cửa hàng thử, Ca 2 ngày 08/11/2026: sau 2 lần đếm lại, tiền mặt vẫn thiếu so với POS, vượt ngưỡng tuyệt đối và điểm z. Kiểm tra két và các khoản thu chi trong ca.",
		);
	});

	it("takes nothing from cashier, shift-name or amount fields that reach the parameters", () => {
		const text = body({
			...COUNTED,
			cashier_name: "cashier-name@example.com",
			cashier_external_id: "cashier-ext-1",
			shift_name: "Ca chiều POS",
			name: "Ca chiều POS",
			counted_amount: 1_940_000,
			expected_cash_amount: 2_000_000,
			variance_amount: -60_000,
		});
		expect(text).toBe(body(COUNTED));
		for (const leaked of [
			"cashier",
			"example.com",
			"chiều",
			"1.940.000",
			"2.000.000",
			"60.000",
			"60000",
		]) {
			expect(text).not.toContain(leaked);
		}
	});

	it("falls back to a neutral shift and date when the facts lack them", () => {
		expect(
			body({ ...COUNTED, shift_number: null, business_date: null }),
		).toContain("Cảnh báo: Cửa hàng thử, một ca ngày ?: ");
		expect(body({ ...COUNTED, shift_number: 0 })).toContain(
			"Cửa hàng thử, một ca ngày 08/11/2026",
		);
		expect(body({ ...COUNTED, business_date: "08/11/2026" })).toContain(
			"Ca 2 ngày ?:",
		);
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
			templateRef: "alert.cash_count_variance.v1",
			params: COUNTED,
			storeName: "Cửa hàng thử",
			accountName: null,
		});
		expect(queued.text.startsWith("Cảnh báo: Cửa hàng thử, Ca 2 ")).toBe(true);
		expect(queued.title).toBe("Cảnh báo vận hành từ FNB Manager");
		const longest = renderAlert({
			...facts({ ...COUNTED, recounts: 99, over_rel: true }),
			storeName: "Cửa hàng ".repeat(12).trim(),
		});
		expect(fitToUnits(longest.text, ZALO_BOT_LIMITS.maxTextUnits)).toBe(
			longest.text,
		);
		expect(fitSubject(longest.title, BREVO_LIMITS.maxSubjectChars)).toBe(
			longest.title,
		);
		expect(longest.text.split("\n")[0]).not.toMatch(AMOUNT);
	});
});
