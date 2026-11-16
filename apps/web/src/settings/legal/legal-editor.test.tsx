import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { renderWithLanguage, vndFormatters } from "../../test/render";
import type { LegalDocumentRow } from "../manual/source";
import { LegalEditor, type LegalEditorProps } from "./legal-editor";
import { LegalGroupBlock, type LegalGroupBlockProps } from "./legal-group";
import { LEGAL_SKELETON_HEADINGS, legalGroupsOf } from "./legal-rules";

const SUGGESTED = "privacy-notice-2026-11";

function row(overrides: Partial<LegalDocumentRow>): LegalDocumentRow {
	return {
		id: "draft-1",
		kind: "privacy_notice",
		language: "vi",
		version: "privacy-notice-2026-11.2",
		title: "Thông báo bảo mật",
		bodyMarkdown: "## Liên hệ\n\nNội dung do chủ soạn.",
		status: "draft",
		publishedAt: null,
		retiredAt: null,
		audit: null,
		...overrides,
	};
}

const PUBLISHED = row({
	id: "published-1",
	version: "privacy-notice-2026-10",
	status: "published",
	publishedAt: "2026-10-05T02:15:00Z",
});

const RETIRED = row({
	id: "retired-1",
	version: "privacy-notice-2026-09",
	status: "retired",
	publishedAt: "2026-09-01T02:00:00Z",
	retiredAt: "2026-10-05T02:15:00Z",
});

const DRAFT = row({});

function editorProps(
	overrides: Partial<LegalEditorProps> = {},
): LegalEditorProps {
	return {
		id: "editor",
		language: "vi",
		draft: null,
		taken: new Set([PUBLISHED.version]),
		suggestedVersion: SUGGESTED,
		formatters: vndFormatters(),
		saving: false,
		outcome: { kind: "idle" },
		onSave: vi.fn(),
		onRetry: vi.fn(),
		onEdit: vi.fn(),
		onClose: vi.fn(),
		...overrides,
	};
}

function renderEditor(overrides: Partial<LegalEditorProps> = {}) {
	const props = editorProps(overrides);
	const view = renderWithLanguage(<LegalEditor {...props} />, props.language);
	const rerender = (next: Partial<LegalEditorProps>) =>
		view.rerender(
			<I18nProvider
				language={props.language}
				onLanguageChange={() => undefined}
			>
				<LegalEditor {...props} {...next} />
			</I18nProvider>,
		);
	return { props, rerender };
}

function groupProps(
	rows: readonly LegalDocumentRow[],
	overrides: Partial<LegalGroupBlockProps> = {},
): LegalGroupBlockProps {
	const [group] = legalGroupsOf(rows);
	if (group === undefined) throw new Error("no group");
	return {
		group,
		canWrite: true,
		editor: null,
		editingId: null,
		editorOpen: false,
		busy: false,
		status: null,
		formatters: vndFormatters(),
		timeZone: "Asia/Ho_Chi_Minh",
		onNew: vi.fn(),
		onEdit: vi.fn(),
		onAction: vi.fn(async () => true),
		onRetry: vi.fn(),
		...overrides,
	};
}

function renderGroup(
	rows: readonly LegalDocumentRow[],
	overrides: Partial<LegalGroupBlockProps> = {},
) {
	const props = groupProps(rows, overrides);
	return { props, ...renderWithLanguage(<LegalGroupBlock {...props} />) };
}

function replaceText(field: HTMLElement, text: string) {
	fireEvent.change(field, { target: { value: text } });
}

function versionItem(version: string): HTMLElement {
	const item = screen
		.getAllByTestId("legal-version")
		.find((element) => element.getAttribute("data-version") === version);
	if (item === undefined) throw new Error(`no version ${version}`);
	return item;
}

describe("the legal editor", () => {
	it("suggests <kind>-YYYY-MM and refuses a label the database would refuse or the list already holds", async () => {
		const user = userEvent.setup();
		const { props } = renderEditor();
		const version = screen.getByLabelText("Mã phiên bản");
		expect(version).toHaveValue(SUGGESTED);
		expect(screen.getByText(/Gợi ý: privacy-notice-2026-11\./)).toBeVisible();
		expect(screen.getByLabelText("Tiêu đề")).toHaveFocus();
		replaceText(version, "Thông-báo");
		expect(version).toHaveAccessibleDescription(
			/chỉ gồm chữ thường không dấu, chữ số, dấu chấm, dấu gạch ngang, tối đa 40 ký tự/,
		);
		replaceText(version, PUBLISHED.version);
		expect(version).toHaveAccessibleDescription(/đã có phiên bản mang mã này/);
		replaceText(version, "privacy-notice-2026-11.b");
		expect(version).not.toHaveAccessibleDescription(/đã có|chỉ gồm/);
		await user.click(screen.getByRole("button", { name: "Lưu bản nháp" }));
		expect(props.onSave).not.toHaveBeenCalled();
		expect(screen.getByLabelText("Tiêu đề")).toHaveFocus();
		expect(screen.getByLabelText("Tiêu đề")).toHaveAccessibleDescription(
			"Ô này không được để trống.",
		);
		expect(screen.getByTestId("legal-editor-status")).toHaveTextContent(
			"Sửa các ô đang báo lỗi rồi lưu.",
		);
	});

	it("fills the skeleton with headings only, in the text's language, and only into an empty text", async () => {
		const user = userEvent.setup();
		const { props } = renderEditor();
		replaceText(screen.getByLabelText("Tiêu đề"), "Thông báo bảo mật");
		const skeleton = screen.getByRole("button", {
			name: "Tạo bản nháp từ khung",
		});
		expect(skeleton).toHaveAccessibleDescription(/không có lời văn pháp lý/);
		await user.click(skeleton);
		const body = screen.getByLabelText("Nội dung (Markdown)");
		const lines = (body as HTMLTextAreaElement).value
			.split("\n")
			.filter((line) => line !== "");
		expect(lines).toEqual(
			LEGAL_SKELETON_HEADINGS.vi.map((heading) => `## ${heading}`),
		);
		expect(skeleton).toHaveAttribute("aria-disabled", "true");
		expect(skeleton).toHaveAccessibleDescription(
			/chỉ dùng được khi ô nội dung còn trống/,
		);
		await user.click(screen.getByRole("button", { name: "Lưu bản nháp" }));
		expect(props.onSave).toHaveBeenCalledWith({
			title: "Thông báo bảo mật",
			version: SUGGESTED,
			bodyMarkdown: lines.join("\n\n"),
		});
	});

	it("writes the English skeleton for an English text", async () => {
		const user = userEvent.setup();
		renderEditor({ language: "en" });
		await user.click(
			screen.getByRole("button", { name: "Start from the skeleton" }),
		);
		expect(screen.getByLabelText("Text (Markdown)")).toHaveValue(
			LEGAL_SKELETON_HEADINGS.en.map((heading) => `## ${heading}`).join("\n\n"),
		);
	});

	it("previews the Markdown with its headings under the editor's own", async () => {
		const user = userEvent.setup();
		renderEditor({ draft: DRAFT, taken: new Set() });
		expect(
			screen.getByRole("heading", {
				level: 5,
				name: "Sửa bản nháp privacy-notice-2026-11.2",
			}),
		).toBeVisible();
		await user.click(screen.getByRole("button", { name: "Xem trước" }));
		expect(screen.getByRole("button", { name: "Xem trước" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		const preview = screen.getByRole("region", { name: "Xem trước nội dung" });
		expect(
			within(preview).getByRole("heading", { level: 6, name: "Liên hệ" }),
		).toBeVisible();
		expect(within(preview).getByText("Nội dung do chủ soạn.")).toBeVisible();
		expect(screen.queryByLabelText("Nội dung (Markdown)")).toBeNull();
		await user.click(screen.getByRole("button", { name: "Soạn" }));
		expect(screen.getByLabelText("Nội dung (Markdown)")).toHaveValue(
			DRAFT.bodyMarkdown,
		);
	});

	it("sends only a changed draft and says when it is saved", async () => {
		const user = userEvent.setup();
		const { props, rerender } = renderEditor({
			draft: DRAFT,
			taken: new Set(),
		});
		const save = screen.getByRole("button", { name: "Lưu bản nháp" });
		expect(save).toHaveAttribute("aria-disabled", "true");
		await user.type(screen.getByLabelText("Tiêu đề"), " mới");
		expect(props.onEdit).toHaveBeenCalled();
		await user.click(save);
		expect(props.onSave).toHaveBeenCalledWith({
			title: "Thông báo bảo mật mới",
			version: DRAFT.version,
			bodyMarkdown: DRAFT.bodyMarkdown,
		});
		const saved = { ...DRAFT, title: "Thông báo bảo mật mới" };
		rerender({ draft: saved, outcome: { kind: "saved" } });
		expect(screen.getByTestId("legal-editor-status")).toHaveTextContent(
			"Đã lưu bản nháp.",
		);
		expect(save).toHaveAttribute("aria-disabled", "true");
	});

	it("shows the database's refusals: a frozen text, a label taken meanwhile and a lost connection", async () => {
		const user = userEvent.setup();
		const { props, rerender } = renderEditor({
			draft: DRAFT,
			taken: new Set(),
			outcome: {
				kind: "refused",
				code: "frozen",
				messageKey: "settings.legal.frozen",
				canRetry: false,
			},
		});
		expect(screen.getByTestId("legal-editor-status")).toHaveTextContent(
			"văn bản đã công bố hoặc đã ngừng áp dụng thì không sửa hay xóa được",
		);
		rerender({
			outcome: {
				kind: "refused",
				code: "duplicate",
				messageKey: "settings.error.duplicate",
				canRetry: false,
			},
		});
		expect(screen.getByLabelText("Mã phiên bản")).toHaveAccessibleDescription(
			/đã có phiên bản mang mã này/,
		);
		rerender({
			outcome: {
				kind: "refused",
				code: "network",
				messageKey: "settings.error.network",
				canRetry: true,
			},
		});
		await user.click(screen.getByRole("button", { name: "Thử lại" }));
		expect(props.onRetry).toHaveBeenCalledOnce();
	});
});

describe("a list of versions", () => {
	it("shows each version's label and the database's dates, and the one in force", () => {
		renderGroup([DRAFT, PUBLISHED, RETIRED]);
		expect(screen.getByTestId("legal-current")).toHaveTextContent(
			"Đang áp dụng: privacy-notice-2026-10, công bố 05/10/2026 lúc 09:15.",
		);
		expect(
			screen
				.getAllByTestId("legal-version")
				.map((item) => item.getAttribute("data-status")),
		).toEqual(["published", "draft", "retired"]);
		for (const item of screen.getAllByTestId("legal-version")) {
			expect(
				within(item).getByText("Mã phiên bản ghi khi đồng ý"),
			).toBeVisible();
			expect(within(item).getByTestId("legal-label")).toHaveTextContent(
				item.getAttribute("data-version") ?? "",
			);
		}
		expect(
			within(versionItem(RETIRED.version)).getByTestId("legal-retired-at"),
		).toHaveTextContent("05/10/2026 lúc 09:15");
	});

	it("asks before publishing, names the version it retires, and publishes only once confirmed", async () => {
		const user = userEvent.setup();
		const { props } = renderGroup([DRAFT, PUBLISHED]);
		const draft = versionItem(DRAFT.version);
		const publish = within(draft).getByRole("button", {
			name: `Công bố ${DRAFT.version}`,
		});
		await user.click(publish);
		const confirm = within(draft).getByTestId("legal-confirm");
		expect(confirm).toHaveTextContent(
			`Công bố ${DRAFT.version}? Văn bản đã công bố không sửa hay xóa được nữa`,
		);
		expect(confirm).toHaveTextContent(
			`Bản đang áp dụng ${PUBLISHED.version} sẽ ngừng áp dụng cùng lúc.`,
		);
		expect(
			within(confirm).getByRole("button", { name: "Công bố" }),
		).toHaveFocus();
		expect(props.onAction).not.toHaveBeenCalled();
		await user.click(within(confirm).getByRole("button", { name: "Quay lại" }));
		expect(within(draft).queryByTestId("legal-confirm")).toBeNull();
		expect(publish).toHaveFocus();
		await user.click(publish);
		await user.keyboard("{Escape}");
		expect(within(draft).queryByTestId("legal-confirm")).toBeNull();
		await user.click(publish);
		await user.click(
			within(within(draft).getByTestId("legal-confirm")).getByRole("button", {
				name: "Công bố",
			}),
		);
		expect(props.onAction).toHaveBeenCalledWith("publish", DRAFT);
	});

	it("asks before retiring or deleting, since neither can be undone", async () => {
		const user = userEvent.setup();
		const { props } = renderGroup([DRAFT, PUBLISHED]);
		const published = versionItem(PUBLISHED.version);
		await user.click(
			within(published).getByRole("button", {
				name: `Ngừng áp dụng ${PUBLISHED.version}`,
			}),
		);
		const confirmRetire = within(published).getByTestId("legal-confirm");
		expect(confirmRetire).toHaveTextContent(
			"không áp dụng lại được, và Thông báo bảo mật (Tiếng Việt) sẽ không có bản nào đang áp dụng",
		);
		await user.click(
			within(confirmRetire).getByRole("button", { name: "Ngừng áp dụng" }),
		);
		expect(props.onAction).toHaveBeenCalledWith("retire", PUBLISHED);
		const draft = versionItem(DRAFT.version);
		await user.click(
			within(draft).getByRole("button", {
				name: `Xóa bản nháp ${DRAFT.version}`,
			}),
		);
		await user.click(
			within(within(draft).getByTestId("legal-confirm")).getByRole("button", {
				name: "Xóa bản nháp",
			}),
		);
		expect(props.onAction).toHaveBeenCalledWith("delete", DRAFT);
	});

	it("gives a published or retired version no edit control, and a draft its edit, publish and delete", async () => {
		const user = userEvent.setup();
		const { props } = renderGroup([DRAFT, PUBLISHED, RETIRED]);
		const published = versionItem(PUBLISHED.version);
		const retired = versionItem(RETIRED.version);
		for (const frozen of [published, retired]) {
			expect(within(frozen).queryByTestId("legal-edit")).toBeNull();
			expect(within(frozen).queryByTestId("legal-delete")).toBeNull();
			expect(within(frozen).queryByTestId("legal-publish")).toBeNull();
			expect(within(frozen).queryByRole("textbox")).toBeNull();
		}
		expect(within(retired).getAllByRole("button")).toHaveLength(1);
		expect(within(published).getByTestId("legal-retire")).toBeVisible();
		await user.click(
			within(retired).getByRole("button", {
				name: `Xem nội dung ${RETIRED.version}`,
			}),
		);
		const text = within(retired).getByRole("region", {
			name: RETIRED.title,
		});
		expect(within(text).getByRole("heading", { level: 5 })).toHaveTextContent(
			"Liên hệ",
		);
		await user.click(
			within(versionItem(DRAFT.version)).getByRole("button", {
				name: `Sửa bản nháp ${DRAFT.version}`,
			}),
		);
		expect(props.onEdit).toHaveBeenCalledWith(DRAFT);
		await user.click(
			screen.getByRole("button", {
				name: "Tạo bản nháp Thông báo bảo mật, Tiếng Việt",
			}),
		);
		expect(props.onNew).toHaveBeenCalledOnce();
	});

	it("hides a draft's own actions while it is being edited, and opens no second editor", () => {
		renderGroup([DRAFT], {
			editingId: DRAFT.id,
			editorOpen: true,
			editor: <p>editor</p>,
		});
		const draft = versionItem(DRAFT.version);
		expect(within(draft).getAllByRole("button")).toHaveLength(1);
		expect(screen.queryByTestId("legal-new")).toBeNull();
	});

	it("is read-only for a member who may not write: only the texts can be shown", () => {
		renderGroup([DRAFT, PUBLISHED, RETIRED], { canWrite: false });
		for (const item of screen.getAllByTestId("legal-version")) {
			const buttons = within(item).getAllByRole("button");
			expect(buttons).toHaveLength(1);
			expect(buttons[0]).toHaveTextContent("Xem nội dung");
		}
		expect(screen.queryByTestId("legal-new")).toBeNull();
	});

	it("says what the last action did, with a retry after a lost connection", async () => {
		const user = userEvent.setup();
		const { props } = renderGroup([], {
			status: {
				tone: "error",
				text: "Không lưu được vì mất kết nối; kiểm tra mạng rồi thử lại.",
				canRetry: true,
			},
		});
		expect(screen.getByText("Chưa có phiên bản nào.")).toBeVisible();
		expect(screen.getByTestId("legal-current")).toHaveTextContent(
			"Chưa có bản đang áp dụng.",
		);
		expect(screen.getByRole("status")).toHaveTextContent("mất kết nối");
		await user.click(screen.getByRole("button", { name: "Thử lại" }));
		expect(props.onRetry).toHaveBeenCalledOnce();
	});
});
