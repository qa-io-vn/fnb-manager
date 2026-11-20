import { miniPack } from "@fnb/datapack/testing";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { vndFormatters } from "../test/render";
import {
	citationView,
	PlanMarkdown,
	planBody,
	splitCitations,
} from "./cite-plugin";

const pack = miniPack();
const formatters = vndFormatters();

function renderPlan(content: string) {
	return render(
		<I18nProvider language="vi" onLanguageChange={() => undefined}>
			<PlanMarkdown content={content} pack={pack} formatters={formatters} />
		</I18nProvider>,
	);
}

const front = '---\n{"format": "fnb-plan/1"}\n---\n';

describe("the citation plugin", () => {
	it("splits text around each [[table:row:column]]", () => {
		expect(
			splitCitations("a [[kpi:ALL/avg_ticket:w28]] b").map((node) => node.type),
		).toEqual(["text", "planCite", "text"]);
	});

	it("drops the front matter before rendering", () => {
		expect(planBody(`${front}## 1. Tóm tắt\n`)).toBe("## 1. Tóm tắt\n");
		expect(planBody("no front matter")).toBe("no front matter");
	});

	it("draws a citation as a chip holding the cell's value from the stored pack", () => {
		renderPlan(`${front}Giá trị [[kpi:ALL/avg_ticket:w28]] mỗi hóa đơn.\n`);
		const chip = screen.getByTestId("plan-cite");
		expect(chip.tagName).toBe("CITE");
		expect(chip).toHaveAttribute("data-resolved", "true");
		const view = citationView(pack, formatters, "kpi:ALL/avg_ticket:w28");
		expect(view.text).not.toBeNull();
		expect(chip.textContent).toBe(view.text);
		expect(chip.getAttribute("aria-label")).toContain(
			pack.tables.kpi?.title ?? "kpi",
		);
	});

	it("outlines a reference that points nowhere", () => {
		renderPlan(`${front}Sai [[kpi:ALL/khong_co:w28]].\n`);
		const chip = screen.getByTestId("plan-cite");
		expect(chip).toHaveAttribute("data-resolved", "false");
		expect(chip.className).toContain("border-negative");
	});

	it("produces no element for a <cite> typed into the plan", () => {
		const { container } = renderPlan(
			`${front}Chữ <cite data-plan-ref="kpi:ALL/avg_ticket:w28">giả</cite> ở đây.\n`,
		);
		expect(container.querySelector("cite")).toBeNull();
		expect(screen.queryByTestId("plan-cite")).toBeNull();
	});

	it("shows injected HTML, a javascript: link and an image as plain text without elements", () => {
		const { container } = renderPlan(
			`${front}<img src=x onerror="alert(1)">\n\n<script>alert(1)</script>\n\n[bấm](javascript:alert(1)) và ![ảnh](https://example.com/a.png)\n`,
		);
		expect(container.querySelector("img")).toBeNull();
		expect(container.querySelector("script")).toBeNull();
		expect(container.querySelector("a")).toBeNull();
		expect(container.innerHTML).not.toContain("javascript:");
		expect(container).toHaveTextContent("bấm");
	});

	it("keeps the allowed elements: headings, lists, tables and emphasis", () => {
		const { container } = renderPlan(
			`${front}## Mục\n\n- **đậm** và *nghiêng*\n\n| a | b |\n|---|---|\n| 1 | 2 |\n`,
		);
		for (const tag of ["h2", "ul", "li", "strong", "em", "table", "td"]) {
			expect(container.querySelector(tag)).not.toBeNull();
		}
	});
});
