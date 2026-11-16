import { describe, expect, it } from "vitest";
import {
	MARKUP_HEAVY_MARKDOWN,
	PATHOLOGICAL_MARKDOWN,
} from "../../test/pathological-markdown";
import {
	headingLevelsOf,
	inlinesOf,
	markdownBlocksOf,
	safeHrefOf,
} from "./markdown";

const BUDGET_MS = 1_000;

function texts(markdown: string) {
	return markdownBlocksOf(markdown).map((block) =>
		block.kind === "list"
			? {
					kind: block.kind,
					ordered: block.ordered,
					start: block.start,
					items: block.items.map((item) =>
						item.inlines.map((inline) => inline.text).join(""),
					),
				}
			: {
					kind: block.kind,
					...(block.kind === "heading" ? { level: block.level } : {}),
					text: block.inlines.map((inline) => inline.text).join(""),
				},
	);
}

describe("the Markdown preview's reading", () => {
	it("reads headings, paragraphs joined across lines, and bullet and numbered lists", () => {
		expect(
			texts(
				"# Tiêu đề\n\nDòng một\ndòng hai\n\n- Tên\n* Số điện thoại\n1. Hỏi\n2) Trả lời\n### Liên hệ ###\nCuối",
			),
		).toEqual([
			{ kind: "heading", level: 1, text: "Tiêu đề" },
			{ kind: "paragraph", text: "Dòng một dòng hai" },
			{
				kind: "list",
				ordered: false,
				start: 1,
				items: ["Tên", "Số điện thoại"],
			},
			{ kind: "list", ordered: true, start: 1, items: ["Hỏi", "Trả lời"] },
			{ kind: "heading", level: 3, text: "Liên hệ" },
			{ kind: "paragraph", text: "Cuối" },
		]);
		expect(markdownBlocksOf("  \r\n\r\n")).toEqual([]);
		expect(texts("#Không phải đề mục")).toEqual([
			{ kind: "paragraph", text: "#Không phải đề mục" },
		]);
	});

	it("keeps a numbered list across blank lines and its first number after a paragraph", () => {
		expect(
			texts("1. Một\n\n2. Hai\n\nGiữa hai danh sách\n\n3. Ba\n4. Bốn"),
		).toEqual([
			{ kind: "list", ordered: true, start: 1, items: ["Một", "Hai"] },
			{ kind: "paragraph", text: "Giữa hai danh sách" },
			{ kind: "list", ordered: true, start: 3, items: ["Ba", "Bốn"] },
		]);
		expect(texts("12) Mười hai")).toEqual([
			{ kind: "list", ordered: true, start: 12, items: ["Mười hai"] },
		]);
		expect(texts("1234567890. Quá dài")).toEqual([
			{ kind: "paragraph", text: "1234567890. Quá dài" },
		]);
	});

	it("strips only a closing run of hashes that stands apart, and drops an empty heading", () => {
		expect(texts("# C#\n## Liên hệ ##\n### Mục #3 ###\n#\t#")).toEqual([
			{ kind: "heading", level: 1, text: "C#" },
			{ kind: "heading", level: 2, text: "Liên hệ" },
			{ kind: "heading", level: 3, text: "Mục #3" },
		]);
		expect(texts("####### Bảy")).toEqual([
			{ kind: "paragraph", text: "####### Bảy" },
		]);
	});

	it.each([
		"javascript:alert(1)",
		"JAVASCRIPT:alert(1)",
		"data:text/html,x",
		"//example.com",
		"vbscript:x",
		"/cai-dat",
	])("opens no link to %s", (href) => {
		expect(safeHrefOf(href)).toBeNull();
	});

	it.each([...PATHOLOGICAL_MARKDOWN, ...MARKUP_HEAVY_MARKDOWN])(
		"reads %s of 100,000 characters within the time budget",
		(_name, markdown) => {
			const started = performance.now();
			const blocks = markdownBlocksOf(markdown);
			expect(performance.now() - started).toBeLessThan(BUDGET_MS);
			expect(blocks.length).toBeGreaterThan(0);
		},
	);

	it("marks bold, italic and code, and keeps only web and mail links", () => {
		expect(
			inlinesOf(
				"**Đậm** và *nghiêng* và _nghiêng_ và `mã` [trang](https://example.com) [lạ](javascript:void) [thư](mailto:a@example.com) snake_case_name",
			).map((inline) =>
				inline.kind === "link"
					? [inline.kind, inline.text, inline.href]
					: [inline.kind, inline.text],
			),
		).toEqual([
			["strong", "Đậm"],
			["text", " và "],
			["emphasis", "nghiêng"],
			["text", " và "],
			["emphasis", "nghiêng"],
			["text", " và "],
			["code", "mã"],
			["text", " "],
			["link", "trang", "https://example.com"],
			["text", " "],
			["link", "lạ", null],
			["text", " "],
			["link", "thư", "mailto:a@example.com"],
			["text", " snake_case_name"],
		]);
	});

	it("places the document's top heading at the level given and never below h6", () => {
		const blocks = markdownBlocksOf("## Một\n\n### Hai\n\n###### Sáu");
		expect([...headingLevelsOf(blocks, 5).entries()]).toEqual([
			[2, 5],
			[3, 6],
			[6, 6],
		]);
	});
});
