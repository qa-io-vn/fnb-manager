import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PATHOLOGICAL_MARKDOWN } from "../../test/pathological-markdown";
import { MarkdownPreview } from "./markdown-preview";

const RENDER_BUDGET_MS = 2_000;

function renderPreview(markdown: string) {
	return render(
		<MarkdownPreview
			markdown={markdown}
			headingBase={5}
			label="Xem trước"
			emptyText="Chưa có nội dung."
		/>,
	);
}

function preview(): HTMLElement {
	return screen.getByRole("region", { name: "Xem trước" });
}

describe("the Markdown preview", () => {
	it("opens web and mail links only, and shows any other link as plain text", () => {
		renderPreview(
			"[trang](https://example.com) [thư](mailto:a@example.com) [một](javascript:void) [hai](JAVASCRIPT:void) [ba](data:text/html,x) [bốn](//example.com)",
		);
		const links = within(preview()).getAllByRole("link");
		expect(links.map((link) => link.getAttribute("href"))).toEqual([
			"https://example.com",
			"mailto:a@example.com",
		]);
		for (const text of ["một", "hai", "ba", "bốn"]) {
			const shown = within(preview()).getByText(text);
			expect(shown.closest("a")).toBeNull();
		}
		expect(preview().querySelector("[href^='javascript' i]")).toBeNull();
		expect(preview().querySelector("[href^='data' i]")).toBeNull();
	});

	it("keeps a numbered list's first number and a heading's own hash", () => {
		renderPreview("# C#\n\n1. Một\n\nGiữa\n\n3. Ba\n\n4. Bốn");
		expect(
			within(preview()).getByRole("heading", { level: 5, name: "C#" }),
		).toBeVisible();
		const lists = within(preview()).getAllByRole("list");
		expect(lists.map((list) => list.getAttribute("start"))).toEqual(["1", "3"]);
		expect(
			within(lists[1] as HTMLElement).getAllByRole("listitem"),
		).toHaveLength(2);
	});

	it("never reads the text as HTML", () => {
		renderPreview("<img src=x onerror=alert(1)> **<b>đậm</b>**");
		expect(preview().querySelector("img, b")).toBeNull();
		expect(preview()).toHaveTextContent("<img src=x onerror=alert(1)>");
	});

	it.each(PATHOLOGICAL_MARKDOWN)(
		"renders %s of 100,000 characters within the time budget",
		(_name, markdown) => {
			const started = performance.now();
			const { unmount } = renderPreview(markdown);
			expect(performance.now() - started).toBeLessThan(RENDER_BUDGET_MS);
			expect(preview().textContent?.length ?? 0).toBeGreaterThan(0);
			unmount();
		},
	);
});
