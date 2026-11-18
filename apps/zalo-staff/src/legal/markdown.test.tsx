import { STAND_IN_LEGAL_DOCUMENTS } from "@fnb/zalo-mini";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { pickDocument } from "./legal";
import { MarkdownText, markdownBlocks } from "./markdown";

const LEGAL = [
	"# Chính sách",
	"",
	"Đoạn **một** dòng một",
	"dòng hai",
	"",
	"## Dữ liệu",
	"- Mã định danh",
	"- Tên hiển thị",
	"1. Bước một",
	"2. Bước hai",
	"",
	"Xem [trang của công ty](https://example.com) hoặc gọi 0900 000 000.",
].join("\n");

describe("the published texts as plain blocks", () => {
	it("splits headings, paragraphs and lists", () => {
		expect(
			markdownBlocks(LEGAL).map((block) =>
				block.kind === "list"
					? `${block.ordered ? "ol" : "ul"}:${block.items.map((item) => item.text).join("/")}`
					: `${block.kind}:${block.text}`,
			),
		).toEqual([
			"heading:Chính sách",
			"paragraph:Đoạn **một** dòng một\ndòng hai",
			"heading:Dữ liệu",
			"ul:Mã định danh/Tên hiển thị",
			"ol:Bước một/Bước hai",
			"paragraph:Xem [trang của công ty](https://example.com) hoặc gọi 0900 000 000.",
		]);
	});

	it("renders links and phone numbers as text, never as links", () => {
		render(<MarkdownText markdown={LEGAL} />);
		expect(screen.queryByRole("link")).not.toBeInTheDocument();
		expect(document.querySelector("a")).toBeNull();
		expect(
			screen.getByText("Xem trang của công ty hoặc gọi 0900 000 000."),
		).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { level: 2, name: "Chính sách" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { level: 3, name: "Dữ liệu" }),
		).toBeInTheDocument();
		expect(screen.getByText("một").tagName).toBe("STRONG");
		expect(screen.getAllByRole("list")).toHaveLength(2);
	});

	it("picks the document in the app's language, else the Vietnamese one", () => {
		expect(
			pickDocument(STAND_IN_LEGAL_DOCUMENTS, "privacy_notice", "en")?.title,
		).toBe("Privacy notice (stand-in)");
		const vietnameseOnly = STAND_IN_LEGAL_DOCUMENTS.filter(
			(document) => document.language === "vi",
		);
		expect(pickDocument(vietnameseOnly, "mini_app_terms", "en")?.title).toBe(
			"Điều khoản sử dụng (bản thử)",
		);
		expect(pickDocument([], "mini_app_terms", "vi")).toBeNull();
	});
});
