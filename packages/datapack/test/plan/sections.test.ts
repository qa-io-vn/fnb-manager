import { describe, expect, it } from "vitest";
import {
	INITIATIVE_FIELDS,
	lintPlan,
	PLAN_SECTIONS,
	parsePlan,
} from "../../src/index.js";
import {
	fieldLine,
	headingOf,
	initiativeHeading,
	sectionHeading,
} from "../../src/plan/sections.js";
import { cleanPlan, lintPack, replacing } from "./support.js";

describe("headingOf", () => {
	it("reads ATX headings with their level and text", () => {
		expect(headingOf("## 1. Tóm tắt tình hình")).toEqual({
			level: 2,
			text: "1. Tóm tắt tình hình",
		});
		expect(headingOf("   ### Sáng kiến 1: X ###")).toEqual({
			level: 3,
			text: "Sáng kiến 1: X",
		});
		expect(headingOf("#")).toEqual({ level: 1, text: "" });
		expect(headingOf("#hashtag")).toBeNull();
		expect(headingOf("    ## indented code")).toBeNull();
		expect(headingOf("Doanh thu ## không phải tiêu đề")).toBeNull();
	});
});

describe("sectionHeading", () => {
	it("recognises the ten sections by their Vietnamese or English title", () => {
		for (const section of PLAN_SECTIONS) {
			expect(sectionHeading(section.title.vi).section?.id).toBe(section.id);
			expect(sectionHeading(section.title.en).section?.id).toBe(section.id);
		}
	});

	it("accepts an optional leading number, bold, any case and a trailing colon", () => {
		expect(sectionHeading("1. Tóm tắt tình hình")).toMatchObject({
			number: 1,
			section: { id: "summary" },
		});
		expect(sectionHeading("7) Lịch khuyến mãi")).toMatchObject({
			number: 7,
			section: { id: "promotions" },
		});
		expect(sectionHeading("8 - Risks")).toMatchObject({
			number: 8,
			section: { id: "risks" },
		});
		expect(sectionHeading("10 Giả định")).toMatchObject({
			number: 10,
			section: { id: "assumptions" },
		});
		expect(sectionHeading("**4. Kế hoạch 30/60/90 ngày**").section?.id).toBe(
			"plan_30_60_90",
		);
		expect(sectionHeading("4. **30/60/90-day plan**").section?.id).toBe(
			"plan_30_60_90",
		);
		expect(sectionHeading("RỦI RO").section?.id).toBe("risks");
		expect(sectionHeading("Data  to   collect:").section?.id).toBe(
			"data_to_collect",
		);
		expect(sectionHeading("30/60/90-day plan").number).toBeNull();
	});

	it("leaves other headings unrecognised", () => {
		expect(sectionHeading("Phụ lục")).toEqual({ section: null, number: null });
		expect(sectionHeading("3. Sáng kiến")).toEqual({
			section: null,
			number: 3,
		});
		expect(sectionHeading("Rủi ro và cơ hội").section).toBeNull();
	});
});

describe("initiativeHeading", () => {
	it("reads the number and title in both languages", () => {
		expect(initiativeHeading("Sáng kiến 1: Gợi ý nâng size")).toEqual({
			number: 1,
			title: "Gợi ý nâng size",
		});
		expect(initiativeHeading("Initiative 12 — Morning traffic")).toEqual({
			number: 12,
			title: "Morning traffic",
		});
		expect(initiativeHeading("**Sáng kiến 3:** Topping")).toEqual({
			number: 3,
			title: "Topping",
		});
		expect(initiativeHeading("SÁNG KIẾN 4")).toEqual({ number: 4, title: "" });
	});

	it("refuses other headings", () => {
		expect(initiativeHeading("Sáng kiến ưu tiên")).toBeNull();
		expect(initiativeHeading("Initiative one: x")).toBeNull();
		expect(initiativeHeading("Sáng kiến 123: x")).toBeNull();
		expect(initiativeHeading("Các sáng kiến 1: x")).toBeNull();
	});
});

describe("fieldLine", () => {
	it("recognises the seven fields by either label, with or without bold", () => {
		for (const field of INITIATIVE_FIELDS) {
			for (const label of [field.label.vi, field.label.en]) {
				for (const line of [
					`- **${label}:** nội dung`,
					`- **${label}**: nội dung`,
					`${label}: nội dung`,
					`* __${label}__ : nội dung`,
					`1. *${label}*: nội dung`,
				]) {
					expect(fieldLine(line)).toEqual({ id: field.id, text: "nội dung" });
				}
			}
		}
	});

	it("tells the KPI field from the field about reading it", () => {
		expect(fieldLine("- **KPI:** avg_ticket")?.id).toBe("kpi");
		expect(
			fieldLine("- **Cách đọc KPI trên ứng dụng:** Báo cáo Tuần")?.id,
		).toBe("read");
		expect(fieldLine("- **kpi:** avg_ticket")?.id).toBe("kpi");
	});

	it("refuses lines that are not field labels", () => {
		expect(fieldLine("- Căn cứ vào bảng KPI")).toBeNull();
		expect(fieldLine("- **Ghi chú:** x")).toBeNull();
		expect(fieldLine("Doanh thu: 1,2 tỷ")).toBeNull();
	});
});

describe("parsePlan structure", () => {
	it("splits the clean plan into its ten sections, five initiatives and seven fields each", () => {
		const plan = parsePlan(cleanPlan());
		expect(
			plan.sections
				.filter((section) => section.id !== null)
				.map((section) => [section.id, section.number]),
		).toEqual(PLAN_SECTIONS.map((section) => [section.id, section.number]));
		expect(plan.sections[0]).toMatchObject({
			id: null,
			number: null,
			heading: "Kế hoạch 90 ngày cho hai cửa hàng",
		});
		expect(plan.initiatives.map((initiative) => initiative.number)).toEqual([
			1, 2, 3, 4, 5,
		]);
		for (const initiative of plan.initiatives) {
			expect(Object.keys(initiative.fields).sort()).toEqual(
				INITIATIVE_FIELDS.map((field) => field.id).sort(),
			);
		}
		const first = plan.initiatives[0];
		expect(first?.title).toBe("Gợi ý nâng size cho đồ uống bán chạy");
		expect(first?.fields.kpi).toEqual({
			text: "avg_ticket",
			line: (first?.line ?? 0) + 6,
		});
		const summary = plan.sections.find((section) => section.id === "summary");
		expect(summary?.body.startsWith("Doanh thu thuần")).toBe(true);
		expect(summary?.body.endsWith("[[kpi:ALL/invoices:w28]].")).toBe(true);
	});

	it("collects a field over continuation lines until the next label or heading", () => {
		const plan = parsePlan(
			replacing(
				cleanPlan(),
				"- **Căn cứ:** Trà sữa trân châu bán",
				"- **Căn cứ:**\n  - Trà sữa trân châu bán",
			),
		);
		const evidence = plan.initiatives[0]?.fields.evidence;
		expect(evidence?.text.startsWith("- Trà sữa trân châu bán 3.120 ly")).toBe(
			true,
		);
		expect(evidence?.text.includes("Hành động")).toBe(false);
	});

	it("drops an empty field and keeps the first of two equal labels", () => {
		const plan = parsePlan(
			replacing(
				replacing(cleanPlan(), "- **Công sức:** Thấp.\n", "- **Công sức:**\n"),
				"- **Bước đầu tiên:** Họp thu ngân vào thứ 2 tuần tới.",
				"- **Bước đầu tiên:** Họp thu ngân vào thứ 2 tuần tới.\n- **Bước đầu tiên:** Việc khác.",
			),
		);
		const first = plan.initiatives[0];
		expect(first?.fields.effort).toBeUndefined();
		expect(first?.fields.first_step?.text).toBe(
			"Họp thu ngân vào thứ 2 tuần tới.",
		);
	});

	it("reads English sections and fields in a Vietnamese plan", () => {
		const english = cleanPlan("en");
		const plan = parsePlan(
			replacing(english, '"language": "en"', '"language": "vi"'),
		);
		expect(plan.sections.filter((section) => section.id !== null)).toHaveLength(
			10,
		);
		expect(plan.initiatives).toHaveLength(5);
	});

	it("ends an initiative at the next level-three heading that is not an initiative", () => {
		const plan = parsePlan(
			replacing(
				cleanPlan(),
				"## 4. Kế hoạch 30/60/90 ngày",
				"### Ghi chú chung\n\n- **Công sức:** chung cho mọi sáng kiến.\n\n## 4. Kế hoạch 30/60/90 ngày",
			),
		);
		expect(plan.initiatives[4]?.fields.effort?.text).toBe("Trung bình.");
	});
});

describe("the structure checks of the lint", () => {
	const INITIATIVE_5 = "### Sáng kiến 5: Kéo khách buổi sáng cho S2";
	const SECTION_4 = "## 4. Kế hoạch 30/60/90 ngày";

	function codesOf(text: string): string[] {
		return lintPlan(text, lintPack()).issues.map((issue) => issue.code);
	}

	function initiativeBlock(text: string, number: number): string {
		const start = text.indexOf(INITIATIVE_5);
		const end = text.indexOf(SECTION_4);
		return text
			.slice(start, end)
			.replace("Sáng kiến 5:", `Sáng kiến ${number}:`);
	}

	it("accepts the sections with English titles, without numbers and in bold", () => {
		let text = cleanPlan();
		for (const section of PLAN_SECTIONS) {
			const heading = `## ${section.number}. ${section.title.vi}`;
			const replacement =
				section.number % 3 === 0
					? `## ${section.title.en}`
					: section.number % 3 === 1
						? `## **${section.number}) ${section.title.vi}**`
						: `# ${section.title.en.toUpperCase()}:`;
			text = replacing(text, heading, replacement);
		}
		expect(codesOf(text)).toEqual([]);
	});

	it("does not take a level-three heading for a section", () => {
		expect(
			codesOf(replacing(cleanPlan(), "## 8. Rủi ro", "### 8. Rủi ro")),
		).toEqual(["section_missing:8"]);
	});

	it("needs five to seven initiatives", () => {
		let six = cleanPlan();
		six = replacing(six, SECTION_4, `${initiativeBlock(six, 6)}${SECTION_4}`);
		expect(codesOf(six)).toEqual([]);
		let eight = six;
		for (const number of [7, 8]) {
			eight = replacing(
				eight,
				SECTION_4,
				`${initiativeBlock(cleanPlan(), number)}${SECTION_4}`,
			);
		}
		expect(codesOf(eight)).toEqual(["initiatives_count:8"]);
		expect(lintPlan(eight, lintPack()).issues[0]?.line).toBe(30);
	});

	it("needs the initiatives numbered from 1 without gaps", () => {
		const gap = replacing(cleanPlan(), "### Sáng kiến 4:", "### Sáng kiến 6:");
		expect(codesOf(gap)).toContain("initiative_number:6");
		expect(lintPlan(gap, lintPack()).ok).toBe(false);
		const text = replacing(
			cleanPlan(),
			"### Sáng kiến 1: Gợi ý",
			"### Initiative 2: Gợi ý",
		);
		expect(codesOf(text)).toContain("initiative_number:2");
	});

	it("names each missing field of each initiative", () => {
		const text = replacing(
			replacing(cleanPlan(), "- **KPI:** avg_ticket\n", ""),
			"- **Bước đầu tiên:** Họp thu ngân vào thứ 2 tuần tới.\n",
			"",
		);
		expect(codesOf(text)).toEqual([
			"initiative_field_missing:1:kpi",
			"initiative_field_missing:1:first_step",
		]);
	});
});
