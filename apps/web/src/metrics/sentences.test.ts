import { describe, expect, it } from "vitest";
import { translate } from "../i18n";
import { addDays } from "../lib/business-dates";
import { vndFormatters } from "../test/render";
import { daySentence, paymentsSentence } from "./sentences";
import { localInstant, payment, rowsOf, sale, testStore } from "./test-rows";
import { computeToday } from "./today";

const formatters = vndFormatters();
const storeA = testStore("A", { name: "Quán Một" });
const storeB = testStore("B", { name: "Quán Hai" });
const YESTERDAY = "2026-11-07";
const now = localInstant(storeA, "2026-11-08", "20:00");
const render = (parts: ReturnType<typeof daySentence>) =>
	parts
		.map((part) => translate("vi", part.key, part.params))
		.join(" ")
		.replace(/ /g, " ");

describe("sentence generator", () => {
	it("names the direction against the baseline and the store that moved the most", () => {
		const invoices = [
			sale(storeA, addDays(YESTERDAY, -7), "10:00", 1_000_000),
			sale(storeB, addDays(YESTERDAY, -7), "10:00", 1_000_000),
			sale(storeA, YESTERDAY, "10:00", 1_100_000),
			sale(storeB, YESTERDAY, "10:00", 1_500_000),
		];
		const report = computeToday([storeA, storeB], rowsOf({ invoices }), now);
		expect(
			render(
				daySentence("net_revenue", report.yesterday, "Hôm qua", formatters),
			),
		).toBe(
			"Hôm qua, doanh thu thuần cao hơn mức nền cùng thứ 30,0%. Quán Hai thay đổi nhiều nhất (+500.000 ₫ so với mức nền).",
		);
	});

	it("says when there is no baseline yet and names the peak hour of net revenue for one store", () => {
		const invoices = [
			sale(storeA, YESTERDAY, "09:10", 40_000),
			sale(storeA, YESTERDAY, "20:05", 90_000),
		];
		const report = computeToday([storeA], rowsOf({ invoices }), now);
		expect(
			render(
				daySentence("net_revenue", report.yesterday, "Hôm qua", formatters),
			),
		).toBe(
			"Hôm qua, doanh thu thuần đạt 130.000 ₫; chưa đủ dữ liệu 8 tuần trước để so sánh. Khung 20h bán nhiều nhất (90.000 ₫).",
		);
	});

	it("does not name a revenue hour as the driver of the invoice count", () => {
		const invoices = [
			sale(storeA, YESTERDAY, "09:10", 40_000),
			sale(storeA, YESTERDAY, "20:05", 90_000),
		];
		const report = computeToday([storeA], rowsOf({ invoices }), now);
		expect(
			render(daySentence("invoices", report.yesterday, "Hôm qua", formatters)),
		).toBe("Hôm qua có 2 hoá đơn; chưa đủ dữ liệu 8 tuần trước để so sánh.");
	});

	it("says a day without invoices plainly", () => {
		const report = computeToday([storeA], rowsOf({}), now);
		expect(
			render(daySentence("avg_ticket", report.today, "Hôm nay", formatters)),
		).toBe("Hôm nay chưa có hoá đơn nào.");
	});

	it("names the leading payment kind and the cash to count", () => {
		const invoice = sale(storeA, "2026-11-08", "10:00", 300_000);
		const report = computeToday(
			[storeA],
			rowsOf({
				invoices: [invoice],
				payments: [
					payment(invoice, "QR", 200_000),
					payment(invoice, "CASH", 100_000),
				],
			}),
			now,
		);
		const parts = paymentsSentence(report.payments, (kind) => kind, formatters);
		expect(render(parts)).toBe(
			"ewallet chiếm 66,7% tiền thu. Tiền mặt cần đếm: 100.000 ₫.",
		);
	});
});
