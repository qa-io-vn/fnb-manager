import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChecklistTemplate } from "../../operations/source";
import { renderWithLanguage } from "../../test/render";
import { ChecklistEditor } from "./checklist-editor";
import { ALL_STORES, type ChecklistStoreChoice } from "./checklist-rules";

const STORE_1 = "11111111-1111-4111-8111-111111111111";

const CHOICES: readonly ChecklistStoreChoice[] = [
	{ value: ALL_STORES, storeId: null, name: null },
	{ value: STORE_1, storeId: STORE_1, name: "Cửa hàng 1" },
];

const SAVED: ChecklistTemplate = {
	id: "template-1",
	storeId: STORE_1,
	phase: "opening",
	title: "Mở ca",
	active: true,
	version: 2,
	items: [
		{
			id: "i1",
			position: 1,
			label: "Mở ca trên POS",
			requiresPhoto: false,
			numberUnit: null,
		},
		{
			id: "i2",
			position: 2,
			label: "Lau quầy",
			requiresPhoto: true,
			numberUnit: null,
		},
	],
	createdAt: "2026-11-01T00:00:00Z",
	audit: null,
};

function renderEditor(template: ChecklistTemplate | null = null) {
	const onSubmit = vi.fn();
	const onClose = vi.fn();
	renderWithLanguage(
		<ChecklistEditor
			template={template}
			storeChoices={CHOICES}
			storeName={template === null ? null : "Cửa hàng 1"}
			busy={false}
			status={null}
			onRetry={null}
			onSubmit={onSubmit}
			onEdit={() => undefined}
			onClose={onClose}
		/>,
	);
	return { onSubmit, onClose };
}

function items() {
	return screen.getAllByTestId("checklist-item");
}

describe("the checklist editor", () => {
	it("starts a new checklist on the store choice, the shift and the title, with one empty item", () => {
		renderEditor();
		expect(screen.getByLabelText("Tên checklist")).toHaveFocus();
		expect(screen.getByTestId("checklist-form-store")).toHaveValue(ALL_STORES);
		expect(
			within(screen.getByTestId("checklist-form-store"))
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["Mọi cửa hàng", "Cửa hàng 1"]);
		expect(
			within(screen.getByTestId("checklist-form-phase"))
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["Mở ca", "Giữa ca", "Đóng ca"]);
		expect(items()).toHaveLength(1);
		expect(screen.getByTestId("checklist-next-run")).toHaveTextContent(
			"áp dụng từ lần làm tiếp theo",
		);
	});

	it("shows what is missing after a submit and sends nothing", async () => {
		const user = userEvent.setup();
		const { onSubmit } = renderEditor();
		await user.click(screen.getByRole("button", { name: "Tạo checklist" }));
		expect(onSubmit).not.toHaveBeenCalled();
		expect(screen.getByText("Nhập tên checklist.")).toBeVisible();
		expect(screen.getByText("Nhập nội dung mục.")).toBeVisible();
	});

	it("fills the outline of the chosen shift, then orders, marks photos and readings and sends the items in order", async () => {
		const user = userEvent.setup();
		const { onSubmit } = renderEditor();
		await user.selectOptions(
			screen.getByTestId("checklist-form-store"),
			STORE_1,
		);
		await user.selectOptions(
			screen.getByTestId("checklist-form-phase"),
			"midshift",
		);
		await user.click(screen.getByRole("button", { name: "Tạo từ khung" }));
		expect(screen.getByLabelText("Tên checklist")).toHaveValue(
			"Checklist giữa ca",
		);
		expect(items()).toHaveLength(3);
		expect(
			screen.getByRole("button", { name: "Tạo từ khung" }),
		).toHaveAttribute("aria-disabled", "true");
		await user.click(screen.getByRole("button", { name: "Đưa mục 1 xuống" }));
		expect(
			screen.getByRole("button", { name: "Đưa mục 1 lên" }),
		).toHaveAttribute("aria-disabled", "true");
		expect(
			screen.getByRole("button", { name: "Đưa mục 3 xuống" }),
		).toHaveAttribute("aria-disabled", "true");
		const third = items()[2];
		if (third === undefined) throw new Error("no third item");
		await user.click(within(third).getByLabelText("Cần ảnh"));
		await user.click(screen.getByRole("button", { name: "Thêm mục" }));
		const added = items()[3];
		if (added === undefined) throw new Error("no added item");
		await user.type(within(added).getByLabelText("Mục 4"), "Đổ rác");
		await user.click(within(added).getByLabelText("Có số đo"));
		await user.type(within(added).getByLabelText("Đơn vị của mục 4"), "túi");
		await user.click(screen.getByRole("button", { name: "Tạo checklist" }));
		expect(onSubmit).toHaveBeenCalledWith({
			templateId: null,
			storeId: STORE_1,
			phase: "midshift",
			title: "Checklist giữa ca",
			items: [
				{ label: "Nhiệt độ tủ mát", requiresPhoto: false, numberUnit: "°C" },
				{
					label: "Vệ sinh quầy và bàn khách",
					requiresPhoto: true,
					numberUnit: null,
				},
				{
					label: "Báo sự cố hoặc món hết nếu có",
					requiresPhoto: true,
					numberUnit: null,
				},
				{ label: "Đổ rác", requiresPhoto: false, numberUnit: "túi" },
			],
		});
	});

	it("asks for the unit of a reading", async () => {
		const user = userEvent.setup();
		const { onSubmit } = renderEditor(SAVED);
		const first = items()[0];
		if (first === undefined) throw new Error("no item");
		await user.click(within(first).getByLabelText("Có số đo"));
		await user.click(screen.getByRole("button", { name: "Lưu phiên bản mới" }));
		expect(onSubmit).not.toHaveBeenCalled();
		expect(screen.getByText("Nhập đơn vị của số đo.")).toBeVisible();
	});

	it("keeps the store and shift of a saved checklist, saves a new version of the same template and refuses an unchanged one", async () => {
		const user = userEvent.setup();
		const { onSubmit, onClose } = renderEditor(SAVED);
		expect(screen.queryByTestId("checklist-form-store")).toBeNull();
		expect(screen.getByTestId("checklist-form-fixed")).toHaveTextContent(
			"Cửa hàng 1 · Mở ca",
		);
		const submit = screen.getByRole("button", { name: "Lưu phiên bản mới" });
		expect(submit).toHaveAttribute("aria-disabled", "true");
		await user.click(screen.getByRole("button", { name: "Xóa mục 2" }));
		expect(screen.getByRole("button", { name: "Xóa mục 1" })).toHaveAttribute(
			"aria-disabled",
			"true",
		);
		await user.click(submit);
		expect(onSubmit).toHaveBeenCalledWith({
			templateId: "template-1",
			storeId: STORE_1,
			phase: "opening",
			title: "Mở ca",
			items: [
				{ label: "Mở ca trên POS", requiresPhoto: false, numberUnit: null },
			],
		});
		await user.keyboard("{Escape}");
		expect(onClose).toHaveBeenCalled();
	});

	it("speaks English with key parity", () => {
		renderWithLanguage(
			<ChecklistEditor
				template={null}
				storeChoices={CHOICES}
				storeName={null}
				busy={false}
				status={null}
				onRetry={null}
				onSubmit={() => undefined}
				onEdit={() => undefined}
				onClose={() => undefined}
			/>,
			"en",
		);
		expect(
			screen.getByRole("button", { name: "Start from the outline" }),
		).toBeVisible();
		expect(screen.getByLabelText("Checklist name")).toBeVisible();
	});
});

describe("the checklist editor's title check", () => {
	it("waits for a typed title before showing its error on blur, so a click right after opening the form lands where it was aimed", async () => {
		const user = userEvent.setup();
		renderEditor();
		expect(screen.getByLabelText("Tên checklist")).toHaveFocus();
		await user.tab();
		expect(screen.queryByText("Nhập tên checklist.")).toBeNull();
		await user.type(screen.getByLabelText("Tên checklist"), "x");
		await user.clear(screen.getByLabelText("Tên checklist"));
		await user.tab();
		expect(screen.getByText("Nhập tên checklist.")).toBeVisible();
	});
});
