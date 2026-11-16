import { DemoSettingsStore, demoSettings } from "@fnb/demo-analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { todayIn } from "../../lib/business-dates";
import { createDemoSettingsSource } from "../../settings/demo-settings-source";
import { LEGAL_SKELETON_HEADINGS } from "../../settings/legal/legal-rules";
import { createDemoManualSource } from "../../settings/manual/demo-manual-source";
import type {
	LegalDocumentRow,
	ManualSettingsSource,
} from "../../settings/manual/source";
import type { Membership, SettingsSource } from "../../settings/source";
import PhapLyPage, { actionErrorKey, withSavedLegal } from "./phap-ly-page";

const TENANT = {
	id: "44444444-4444-4444-8444-444444444444",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: "Asia/Ho_Chi_Minh",
	countryCode: "VN",
};

const AS_OF = "2026-11-03";
const READ_ONLY =
	"Chỉ chủ xem được tất cả cửa hàng mới soạn, công bố hay ngừng áp dụng được văn bản pháp lý; bạn đang xem ở chế độ chỉ đọc.";
const FROZEN =
	"Không lưu được: văn bản đã công bố hoặc đã ngừng áp dụng thì không sửa hay xóa được; hãy tạo phiên bản mới.";
const STALE =
	"Không thực hiện được: văn bản này đã được công bố hoặc thu hồi ở nơi khác; danh sách vừa được tải lại.";

const current = vi.hoisted(() => ({
	state: { status: "loading" } as unknown,
}));

vi.mock("../../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({ tenant: TENANT, stores: [] }),
}));

vi.mock("../../settings/settings-source-context", () => ({
	useSettingsSourceState: () => current.state,
	useRetrySettingsSource: () => () => undefined,
}));

vi.mock("../../settings/catch-up/catch-up-context", () => ({
	useCatchUpRunner: () => ({
		running: false,
		problem: null,
		completed: false,
		start: () => undefined,
		abort: () => undefined,
		dismiss: () => undefined,
	}),
}));

function clock(): () => Date {
	let minute = 0;
	return () => {
		minute += 1;
		return new Date(Date.UTC(2026, 10, 3, 2, minute));
	};
}

function demo(membership: Membership = { role: "owner", storeIds: null }) {
	const store = new DemoSettingsStore(demoSettings(AS_OF));
	const source: SettingsSource = {
		...createDemoSettingsSource(store),
		membership: async () => membership,
	};
	return { source, manual: createDemoManualSource(store, clock()) };
}

function renderPage(source: SettingsSource, manual: ManualSettingsSource) {
	current.state = { status: "ready", source, manual };
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<MemoryRouter>
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<QueryClientProvider client={client}>
					<PhapLyPage />
				</QueryClientProvider>
			</I18nProvider>
		</MemoryRouter>,
	);
}

async function group(kind: string, language = "vi"): Promise<HTMLElement> {
	const groups = await screen.findAllByTestId("legal-group");
	const found = groups.find(
		(element) =>
			element.getAttribute("data-kind") === kind &&
			element.getAttribute("data-language") === language,
	);
	if (found === undefined) throw new Error(`no group ${kind} ${language}`);
	return found;
}

function versionIn(block: HTMLElement, version: string): HTMLElement {
	const item = within(block)
		.getAllByTestId("legal-version")
		.find((element) => element.getAttribute("data-version") === version);
	if (item === undefined) throw new Error(`no version ${version}`);
	return item;
}

async function confirm(
	user: ReturnType<typeof userEvent.setup>,
	item: HTMLElement,
	trigger: string,
	confirmLabel: string,
) {
	await user.click(within(item).getByRole("button", { name: trigger }));
	await user.click(
		within(within(item).getByTestId("legal-confirm")).getByRole("button", {
			name: confirmLabel,
		}),
	);
}

describe("the Pháp lý page", () => {
	beforeEach(() => {
		current.state = { status: "loading" };
	});

	it("lists the six kinds in both languages, the demo's draft privacy notice with its label, and the related entries", async () => {
		const { source, manual } = demo();
		renderPage(source, manual);
		const privacy = await group("privacy_notice");
		expect(screen.getAllByTestId("legal-kind")).toHaveLength(6);
		expect(screen.getAllByTestId("legal-group")).toHaveLength(12);
		expect(
			screen
				.getAllByRole("heading", { level: 3 })
				.map((heading) => heading.textContent),
		).toEqual([
			"Thông báo bảo mật",
			"Quy định bảo vệ thông tin",
			"Điều khoản Mini App",
			"Thông báo cho nhân viên",
			"Nội dung đồng ý tích điểm",
			"Nội dung đồng ý nhận tin quảng cáo",
			"Mục liên quan",
		]);
		const draft = versionIn(privacy, "privacy-notice-2026-11");
		expect(within(draft).getByTestId("legal-status")).toHaveTextContent(
			"Bản nháp",
		);
		expect(within(privacy).getByTestId("legal-current")).toHaveTextContent(
			"Chưa có bản đang áp dụng.",
		);
		expect(screen.getByTestId("legal-slot-consent")).toHaveTextContent(
			"giai đoạn 17a",
		);
		expect(
			screen.getByRole("link", { name: "Mở trang Cửa hàng" }),
		).toHaveAttribute("href", "/cai-dat/cua-hang");
		expect(screen.queryByTestId("settings-read-only")).toBeNull();
	});

	it("lets an owner draft from the skeleton, publish after confirming and retire, with the source's dates", async () => {
		const user = userEvent.setup();
		const { source, manual } = demo();
		renderPage(source, manual);
		const staff = await group("staff_notice");
		await waitFor(() =>
			expect(within(staff).getByTestId("legal-new")).not.toHaveAttribute(
				"aria-disabled",
			),
		);
		await user.click(
			within(staff).getByRole("button", {
				name: "Tạo bản nháp Thông báo cho nhân viên, Tiếng Việt",
			}),
		);
		const editor = within(staff).getByTestId("legal-editor");
		expect(within(editor).getByLabelText("Mã phiên bản")).toHaveValue(
			`staff-notice-${todayIn(TENANT.timeZone, new Date()).slice(0, 7)}`,
		);
		fireEvent.change(within(editor).getByLabelText("Mã phiên bản"), {
			target: { value: "staff-notice-2026-11" },
		});
		fireEvent.change(within(editor).getByLabelText("Tiêu đề"), {
			target: { value: "Thông báo cho nhân viên" },
		});
		await user.click(
			within(editor).getByRole("button", { name: "Tạo bản nháp từ khung" }),
		);
		await user.click(
			within(editor).getByRole("button", { name: "Lưu bản nháp" }),
		);
		await waitFor(() =>
			expect(
				within(editor).getByTestId("legal-editor-status"),
			).toHaveTextContent("Đã lưu bản nháp."),
		);
		expect(
			within(editor).getByRole("heading", {
				level: 5,
				name: "Sửa bản nháp staff-notice-2026-11",
			}),
		).toBeVisible();
		await user.click(within(editor).getByRole("button", { name: "Đóng" }));
		expect(
			within(staff).getByRole("button", {
				name: "Tạo bản nháp Thông báo cho nhân viên, Tiếng Việt",
			}),
		).toHaveFocus();
		const saved = (await manual.legalDocuments(TENANT.id)).find(
			(row) => row.kind === "staff_notice",
		);
		expect(saved).toMatchObject({
			status: "draft",
			version: "staff-notice-2026-11",
			bodyMarkdown: LEGAL_SKELETON_HEADINGS.vi
				.map((heading) => `## ${heading}`)
				.join("\n\n"),
		});
		const draft = versionIn(staff, "staff-notice-2026-11");
		expect(within(draft).getByTestId("settings-audit-line")).toHaveTextContent(
			/^Bạn sửa lần cuối/,
		);
		await confirm(user, draft, "Công bố staff-notice-2026-11", "Công bố");
		await waitFor(() =>
			expect(within(staff).getByTestId("legal-current")).toHaveTextContent(
				"Đang áp dụng: staff-notice-2026-11, công bố 03/11/2026 lúc 09:02.",
			),
		);
		expect(within(staff).getByTestId("legal-group-status")).toHaveTextContent(
			"Đã công bố staff-notice-2026-11.",
		);
		const published = versionIn(staff, "staff-notice-2026-11");
		expect(within(published).queryByTestId("legal-edit")).toBeNull();
		await confirm(
			user,
			published,
			"Ngừng áp dụng staff-notice-2026-11",
			"Ngừng áp dụng",
		);
		await waitFor(() =>
			expect(
				within(versionIn(staff, "staff-notice-2026-11")).getByTestId(
					"legal-status",
				),
			).toHaveTextContent("Đã ngừng áp dụng"),
		);
		expect(within(staff).getByTestId("legal-current")).toHaveTextContent(
			"Chưa có bản đang áp dụng.",
		);
		expect(
			within(versionIn(staff, "staff-notice-2026-11")).getByTestId(
				"legal-retired-at",
			),
		).toHaveTextContent("03/11/2026 lúc 09:04");
	});

	it("retires the version in force when the next one is published, and deletes a draft after confirming", async () => {
		const user = userEvent.setup();
		const { source, manual } = demo();
		await manual.publishLegalDocument(
			TENANT.id,
			(await manual.legalDocuments(TENANT.id))[0]?.id ?? "",
		);
		await manual.saveLegalDraft(TENANT.id, {
			kind: "privacy_notice",
			language: "vi",
			version: "privacy-notice-2026-12",
			title: "Thông báo bảo mật",
			bodyMarkdown: "## Liên hệ",
		});
		await manual.saveLegalDraft(TENANT.id, {
			kind: "privacy_notice",
			language: "vi",
			version: "privacy-notice-nhap",
			title: "Bản thử",
			bodyMarkdown: "## Liên hệ",
		});
		renderPage(source, manual);
		const privacy = await group("privacy_notice");
		const next = versionIn(privacy, "privacy-notice-2026-12");
		await user.click(
			within(next).getByRole("button", {
				name: "Công bố privacy-notice-2026-12",
			}),
		);
		expect(within(next).getByTestId("legal-confirm")).toHaveTextContent(
			"Bản đang áp dụng privacy-notice-2026-11 sẽ ngừng áp dụng cùng lúc.",
		);
		await user.click(
			within(within(next).getByTestId("legal-confirm")).getByRole("button", {
				name: "Công bố",
			}),
		);
		await waitFor(() =>
			expect(
				within(versionIn(privacy, "privacy-notice-2026-11")).getByTestId(
					"legal-status",
				),
			).toHaveTextContent("Đã ngừng áp dụng"),
		);
		await confirm(
			user,
			versionIn(privacy, "privacy-notice-nhap"),
			"Xóa bản nháp privacy-notice-nhap",
			"Xóa bản nháp",
		);
		await waitFor(() =>
			expect(
				within(privacy).getByTestId("legal-group-status"),
			).toHaveTextContent("Đã xóa bản nháp privacy-notice-nhap."),
		);
		expect(
			(await manual.legalDocuments(TENANT.id)).map((row) => [
				row.version,
				row.status,
			]),
		).toEqual([
			["privacy-notice-2026-11", "retired"],
			["privacy-notice-2026-12", "published"],
		]);
	});

	it.each([
		["a manager", { role: "manager", storeIds: null }],
		["a store-limited owner", { role: "owner", storeIds: ["MOCK-S1"] }],
		["staff", { role: "staff", storeIds: null }],
		["a viewer", { role: "viewer", storeIds: null }],
	] as const)(
		"is read-only with the reason for %s",
		async (_who, membership) => {
			const user = userEvent.setup();
			const { source, manual } = demo(membership);
			renderPage(source, manual);
			await waitFor(() =>
				expect(screen.getByTestId("settings-read-only")).toHaveTextContent(
					READ_ONLY,
				),
			);
			expect(screen.queryByTestId("legal-new")).toBeNull();
			expect(screen.queryByTestId("legal-edit")).toBeNull();
			expect(screen.queryByTestId("legal-publish")).toBeNull();
			expect(screen.queryByRole("textbox")).toBeNull();
			const privacy = await group("privacy_notice");
			await user.click(
				within(privacy).getByRole("button", {
					name: "Xem nội dung privacy-notice-2026-11",
				}),
			);
			expect(
				within(privacy).getByRole("heading", {
					level: 5,
					name: "Mục đích xử lý dữ liệu",
				}),
			).toBeVisible();
		},
	);

	it.each([
		["published", "publish", "Công bố", STALE, "Đang áp dụng"],
		["published", "delete", "Xóa bản nháp", FROZEN, "Đang áp dụng"],
		["retired", "retire", "Ngừng áp dụng", STALE, "Đã ngừng áp dụng"],
	] as const)(
		"says the text was %s elsewhere when %s meets the source's refusal, and reads the list again",
		async (_elsewhere, action, label, message, status) => {
			const user = userEvent.setup();
			const { source, manual } = demo();
			const [draft] = await manual.legalDocuments(TENANT.id);
			if (draft === undefined) throw new Error("no demo draft");
			if (action === "retire") {
				await manual.publishLegalDocument(TENANT.id, draft.id);
			}
			renderPage(source, manual);
			const privacy = await group("privacy_notice");
			const trigger = `${label} ${draft.version}`;
			await waitFor(() =>
				expect(
					within(versionIn(privacy, draft.version)).getByRole("button", {
						name: trigger,
					}),
				).not.toHaveAttribute("aria-disabled"),
			);
			if (action === "retire") {
				await manual.retireLegalDocument(TENANT.id, draft.id);
			} else {
				await manual.publishLegalDocument(TENANT.id, draft.id);
			}
			await confirm(user, versionIn(privacy, draft.version), trigger, label);
			await waitFor(() =>
				expect(
					within(privacy).getByTestId("legal-group-status"),
				).toHaveTextContent(message),
			);
			await waitFor(() =>
				expect(
					within(versionIn(privacy, draft.version)).getByTestId("legal-status"),
				).toHaveTextContent(status),
			);
		},
	);

	it("maps only a refused publication or retirement to the message about a change made elsewhere", () => {
		expect(actionErrorKey("publish", "invalid", "settings.error.invalid")).toBe(
			"settings.legal.stale",
		);
		expect(actionErrorKey("retire", "invalid", "settings.error.invalid")).toBe(
			"settings.legal.stale",
		);
		expect(actionErrorKey("delete", "frozen", "settings.legal.frozen")).toBe(
			"settings.legal.frozen",
		);
		expect(
			actionErrorKey("publish", "forbidden", "settings.error.forbidden"),
		).toBe("settings.error.forbidden");
	});

	it("returns the focus to Sửa when the editor of a draft closes", async () => {
		const user = userEvent.setup();
		const { source, manual } = demo();
		renderPage(source, manual);
		const privacy = await group("privacy_notice");
		const edit = await within(privacy).findByRole("button", {
			name: "Sửa bản nháp privacy-notice-2026-11",
		});
		await waitFor(() => expect(edit).not.toHaveAttribute("aria-disabled"));
		await user.click(edit);
		const editor = within(privacy).getByTestId("legal-editor");
		expect(within(editor).getByLabelText("Tiêu đề")).toHaveFocus();
		await user.click(within(editor).getByRole("button", { name: "Đóng" }));
		expect(
			within(privacy).getByRole("button", {
				name: "Sửa bản nháp privacy-notice-2026-11",
			}),
		).toHaveFocus();
	});

	it("offers a retry when the texts cannot be read", async () => {
		const user = userEvent.setup();
		const { source, manual } = demo();
		let calls = 0;
		const failing: ManualSettingsSource = {
			...manual,
			legalDocuments: async (tenantId) => {
				calls += 1;
				if (calls === 1) throw new Error("offline");
				return manual.legalDocuments(tenantId);
			},
		};
		renderPage(source, failing);
		const failed = await screen.findByTestId("legal-load-failed");
		await user.click(within(failed).getByRole("button", { name: "Thử lại" }));
		expect(await group("privacy_notice")).toBeVisible();
	});
});

describe("withSavedLegal", () => {
	it("replaces a draft saved under a new id and adds a new one", () => {
		const draft = {
			id: "legal:privacy_notice:vi:a",
			version: "a",
		} as LegalDocumentRow;
		const renamed = {
			id: "legal:privacy_notice:vi:b",
			version: "b",
		} as LegalDocumentRow;
		expect(withSavedLegal([draft], renamed, draft.id)).toEqual([renamed]);
		expect(withSavedLegal([draft], renamed, null)).toEqual([draft, renamed]);
		expect(withSavedLegal(undefined, renamed, null)).toBeUndefined();
	});
});
