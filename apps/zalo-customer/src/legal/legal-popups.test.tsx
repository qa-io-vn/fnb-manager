import type { LegalDocument } from "@fnb/zalo-mini";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderCustomerApp } from "../test/render-app";
import { legalTitle, pickDocument } from "./legal-popups";
import { MarkdownText, markdownBlocks } from "./markdown";

const DOCUMENTS: readonly LegalDocument[] = [
	{
		kind: "privacy_notice",
		language: "vi",
		version: "p-1",
		title: "Chính sách",
		bodyMarkdown: "x",
		publishedAt: "2026-11-01T00:00:00Z",
	},
	{
		kind: "mini_app_terms",
		language: "en",
		version: "t-1",
		title: "Terms",
		bodyMarkdown: "y",
		publishedAt: "2026-11-01T00:00:00Z",
	},
];

describe("Privacy and Terms popups", () => {
	it("are titled with the Mini App's name in both languages", () => {
		const t = (
			key: string,
			params?: Readonly<Record<string, string | number>>,
		) => `${key}:${String(params?.app)}`;
		expect(legalTitle(t, "privacy_notice", "Thành viên Mẫu")).toBe(
			"legal.privacyTitle:Thành viên Mẫu",
		);
		expect(legalTitle(t, "mini_app_terms", "Thành viên Mẫu")).toBe(
			"legal.termsTitle:Thành viên Mẫu",
		);
	});

	it("pick the document in the app's language, else Vietnamese, else any", () => {
		expect(pickDocument(DOCUMENTS, "privacy_notice", "en")?.version).toBe(
			"p-1",
		);
		expect(pickDocument(DOCUMENTS, "mini_app_terms", "vi")?.version).toBe(
			"t-1",
		);
		expect(pickDocument([], "mini_app_terms", "vi")).toBeNull();
	});

	it("name the legal entity and the version, in English too", async () => {
		renderCustomerApp({ language: "en" });
		await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
		fireEvent.click(screen.getByRole("button", { name: "Privacy policy" }));
		const dialog = await screen.findByRole("dialog");
		expect(dialog).toHaveAccessibleName(
			"Privacy policy of the Mini App Thành viên Quán Mẫu Một",
		);
		expect(within(dialog).getByTestId("legal-entity")).toHaveTextContent(
			"Responsible business: Hộ kinh doanh Quán Mẫu Một",
		);
		expect(within(dialog).getByTestId("legal-version")).toHaveTextContent(
			"Version privacy-demo-1, published on 01/11/2026",
		);
		expect(
			within(dialog).getByRole("heading", { name: "Placeholder" }),
		).toBeInTheDocument();
	});

	it("render links in the text as words, never as links", () => {
		render(
			<MarkdownText
				markdown={
					"See [the site](https://example.com) or **call**.\n\n- one\n- two"
				}
			/>,
		);
		expect(screen.queryByRole("link")).not.toBeInTheDocument();
		expect(screen.getByText(/See the site or/)).toBeInTheDocument();
		expect(
			screen.getAllByRole("listitem").map((item) => item.textContent),
		).toEqual(["one", "two"]);
		expect(markdownBlocks("# A\ntext").map((block) => block.kind)).toEqual([
			"heading",
			"paragraph",
		]);
	});
});
