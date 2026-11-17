import { describe, expect, it } from "vitest";
import { lintPlan, type PlanLintResult } from "../../src/index.js";
import { cleanPlan, lintPack, replacing, withLine } from "./support.js";

const SECTION_2 = "## 2. Điểm mạnh và điểm yếu";
const SECTION_3 = "## 3. Sáng kiến ưu tiên";
const SECTION_5 = "## 5. Thực đơn";
const SECTION_10_LINE = "Lượng khách giữ ổn định trong mùa lễ.";
const EVIDENCE_3 =
	"- **Căn cứ:** Tỷ lệ giảm giá bốn tuần qua là 4,25% [[kpi:ALL/discount_rate:w28]], cao hơn mức 3,98% [[kpi:ALL/discount_rate:p28]] của bốn tuần trước.";
const ACTION_3 =
	"- **Hành động:** Chỉ quản lý được duyệt giảm giá ngoài chương trình.";
const IMPACT_3 = "- **Tác động dự kiến:** Ước tính tỷ lệ giảm giá về 3,8%.";

function lint(text: string): PlanLintResult {
	return lintPlan(text, lintPack());
}

function uncited(result: PlanLintResult): string | null {
	const issue = result.issues.find((entry) =>
		entry.code.startsWith("uncited_numbers:"),
	);
	if (issue === undefined) {
		expect(result.summary.uncitedNumbers).toBe(0);
		return null;
	}
	expect(issue.code).toBe(`uncited_numbers:${result.summary.uncitedNumbers}`);
	expect(issue.level).toBe("warning");
	return issue.detail;
}

function inSummary(line: string): string | null {
	return uncited(lint(withLine(cleanPlan(), SECTION_2, line)));
}

describe("uncited_numbers", () => {
	it("counts each uncited number of section 1 with its line and text, as a warning", () => {
		const result = lint(
			withLine(
				cleanPlan(),
				SECTION_2,
				"Mỗi ngày quán phục vụ khoảng 850 khách, giờ cao điểm có 120 khách.",
			),
		);
		expect(result.ok).toBe(true);
		expect(result.issues.map((issue) => issue.code)).toEqual([
			"uncited_numbers:2",
		]);
		expect(uncited(result)).toBe("25:850; 25:120");
	});

	it("looks at section 2 and at the Evidence field of each initiative", () => {
		expect(
			uncited(
				lint(withLine(cleanPlan(), SECTION_3, "- Khách quen chiếm 40%.")),
			),
		).toBe("30:40%");
		expect(
			uncited(
				lint(
					replacing(
						cleanPlan(),
						EVIDENCE_3,
						`${EVIDENCE_3}\n  Có 1.200 hóa đơn giảm giá.`,
					),
				),
			),
		).toBe("55:1.200");
	});

	it("ignores every other section and the other initiative fields", () => {
		const text = replacing(
			replacing(
				replacing(
					withLine(cleanPlan(), SECTION_5, "- 45 ngày: thêm 120 ghế."),
					SECTION_10_LINE,
					`${SECTION_10_LINE} Lượng khách tăng 7%.`,
				),
				ACTION_3,
				"- **Hành động:** Giảm 2 chương trình, chỉ giữ 1.",
			),
			IMPACT_3,
			"- **Tác động dự kiến:** Tỷ lệ giảm giá về 3,5% trong 60 ngày.",
		);
		expect(uncited(lint(text))).toBeNull();
	});

	it("does not count a number cited on the same line", () => {
		expect(
			inSummary("Đạt 52.314 đ [[kpi:ALL/avg_ticket:w28]] với 850 khách."),
		).toBe("25:850");
		expect(
			inSummary("Đạt **52.314 đ** [[kpi:ALL/avg_ticket:w28]]."),
		).toBeNull();
	});

	it("ignores the assistant's own arithmetic after ước tính or estimate", () => {
		expect(
			inSummary("Ước tính 52.314 × 1,05 ≈ 54.930 đ mỗi hóa đơn."),
		).toBeNull();
		expect(inSummary("Với 3 ca, doanh thu ước tính đạt 1,5 tỷ đồng.")).toBe(
			"25:3",
		);
		expect(inSummary("An estimated 1.5 billion VND over 90 days.")).toBeNull();
		expect(inSummary("Estimated: 12% more invoices.")).toBeNull();
	});

	it("ignores the KPI targets of the front matter", () => {
		expect(
			inSummary(
				"Mục tiêu: 55.000 đ mỗi hóa đơn, 34% gọi thêm topping, 3,8% giảm giá và 11.000 hóa đơn ở S2.",
			),
		).toBeNull();
		expect(inSummary("Mục tiêu 56.000 đ mỗi hóa đơn.")).toBe("25:56.000 đ");
	});

	it("ignores dates, times, hour ranges, 30/60/90, list numbering and store labels", () => {
		for (const line of [
			"Từ 2026-11-12 đến 15/12/2026, tuần 2026-W46 và tháng 2026-12.",
			"Mở cửa lúc 6:30, đóng lúc 22h, cao điểm 20h30 hoặc 5pm.",
			"Khung 17–19h, 17h-19h, 17-19 giờ và 6:30-9:00 đông khách.",
			"Theo kế hoạch 30/60/90 ngày.",
			"1. Doanh thu ổn định.",
			"- 2) Khách quen quay lại.",
			"S1 và S2 dẫn đầu ở w28 và ly28.",
			"Năm 2026, tháng 10, tuần 45, thứ 7 và sáng kiến 2.",
		]) {
			expect(inSummary(line), line).toBeNull();
		}
	});

	it("still counts numbers that only look like those forms", () => {
		expect(inSummary("Có 5-7 món mới.")).toBe("25:5; 25:7");
		expect(inSummary("Có 2.026 khách.")).toBe("25:2.026");
		expect(inSummary("Lượng khách tăng 12% so với 28 ngày trước.")).toBe(
			"25:12%; 25:28",
		);
	});
});
