import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { renderWithLanguage, vndFormatters } from "../../test/render";
import type { ItemTypeEntry } from "../source";
import { RolesForm, type RolesFormProps } from "./roles-form";

const ENTRIES: readonly ItemTypeEntry[] = [
	{
		posAccountId: "A",
		posAccountName: "POS trà",
		itemTypeExternalId: "T1",
		name: "Trà sữa",
		role: "drink",
		audit: null,
	},
	{
		posAccountId: "A",
		posAccountName: "POS trà",
		itemTypeExternalId: "T2",
		name: "Topping",
		role: "topping",
		audit: null,
	},
	{
		posAccountId: "A",
		posAccountName: "POS trà",
		itemTypeExternalId: "T3",
		name: "Bánh ngọt",
		role: null,
		audit: null,
	},
	{
		posAccountId: "A",
		posAccountName: "POS trà",
		itemTypeExternalId: "T4",
		name: "Phụ thu",
		role: null,
		audit: null,
	},
];

function propsWith(overrides: Partial<RolesFormProps> = {}): RolesFormProps {
	return {
		entries: ENTRIES,
		usage: {
			loading: false,
			failed: false,
			failedAccounts: new Set(),
			byKey: new Map([["A|T1", { items: 14, share: 0.345 }]]),
		},
		formatters: vndFormatters(),
		canWrite: true,
		saving: false,
		outcome: { kind: "idle" },
		onSave: vi.fn(),
		onEdit: vi.fn(),
		...overrides,
	};
}

function renderForm(overrides: Partial<RolesFormProps> = {}) {
	const props = propsWith(overrides);
	return { props, ...renderWithLanguage(<RolesForm {...props} />) };
}

function select(name: string): HTMLElement {
	return screen.getByRole("combobox", { name });
}

describe("RolesForm", () => {
	it("lists each item type under its POS account with its role and its 28-day sales", () => {
		renderForm();
		const account = screen.getByRole("region", { name: "POS trà" });
		expect(within(account).getAllByTestId("role-row")).toHaveLength(4);
		expect(select("Trà sữa")).toHaveValue("drink");
		expect(select("Bánh ngọt")).toHaveValue("");
		expect(select("Trà sữa")).toHaveAccessibleDescription(
			"14 món đã bán · 34,5% doanh thu món trong 28 ngày",
		);
		expect(select("Phụ thu")).toHaveAccessibleDescription(
			"Không bán món nào trong 28 ngày",
		);
		expect(
			within(select("Trà sữa"))
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["Chưa gán", "Đồ uống", "Đồ ăn", "Đồ ăn nhẹ", "Topping", "Khác"]);
	});

	it("shows a suggestion next to an unassigned type and fills it only on request", async () => {
		const user = userEvent.setup();
		const { props } = renderForm();
		expect(select("Bánh ngọt")).toHaveAccessibleDescription(/Gợi ý: Đồ ăn nhẹ/);
		expect(screen.getAllByTestId("role-suggestion")).toHaveLength(1);
		expect(select("Bánh ngọt")).toHaveValue("");
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"Chưa có thay đổi.",
		);
		await user.click(
			screen.getByRole("button", { name: "Áp dụng gợi ý cho 1 nhóm chưa gán" }),
		);
		expect(select("Bánh ngọt")).toHaveValue("snack");
		expect(select("Phụ thu")).toHaveValue("");
		expect(screen.queryByTestId("roles-apply-suggestions")).toBeNull();
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			"bấm Lưu để giữ",
		);
		expect(props.onSave).not.toHaveBeenCalled();
	});

	it("saves only the changed rows, with Chưa gán sent as a cleared role", async () => {
		const user = userEvent.setup();
		const { props } = renderForm();
		await user.selectOptions(select("Topping"), "Chưa gán");
		await user.selectOptions(select("Phụ thu"), "Khác");
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"2 thay đổi chưa lưu",
		);
		await user.click(screen.getByRole("button", { name: "Lưu" }));
		expect(props.onSave).toHaveBeenCalledExactlyOnceWith([
			{ posAccountId: "A", itemTypeExternalId: "T2", role: null },
			{ posAccountId: "A", itemTypeExternalId: "T4", role: "other" },
		]);
	});

	it("discards the pending changes back to the saved roles", async () => {
		const user = userEvent.setup();
		renderForm();
		await user.selectOptions(select("Trà sữa"), "Đồ ăn");
		await user.click(screen.getByRole("button", { name: "Hủy thay đổi" }));
		expect(select("Trà sữa")).toHaveValue("drink");
	});

	it("takes the saved roles again after a save and says it is saved", async () => {
		const user = userEvent.setup();
		const { props, rerender } = renderForm();
		await user.selectOptions(select("Phụ thu"), "Khác");
		rerender(
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<RolesForm
					{...props}
					entries={ENTRIES.map((type) =>
						type.itemTypeExternalId === "T4"
							? { ...type, role: "other" }
							: type,
					)}
					outcome={{ kind: "saved" }}
				/>
			</I18nProvider>,
		);
		expect(select("Phụ thu")).toHaveValue("other");
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"Chưa có thay đổi.",
		);
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			"Đã lưu.",
		);
	});

	it("keeps an edit in progress when the saved roles change elsewhere, and takes the rest", async () => {
		const user = userEvent.setup();
		const { props, rerender } = renderForm();
		await user.selectOptions(select("Phụ thu"), "Khác");
		rerender(
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<RolesForm
					{...props}
					entries={ENTRIES.map((type) =>
						type.itemTypeExternalId === "T1" ? { ...type, role: "food" } : type,
					)}
				/>
			</I18nProvider>,
		);
		expect(select("Phụ thu")).toHaveValue("other");
		expect(select("Trà sữa")).toHaveValue("food");
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"1 thay đổi chưa lưu",
		);
	});

	it("keeps the selects in place while a save runs and takes no change", async () => {
		const user = userEvent.setup();
		const { props } = renderForm({ saving: true });
		await user.selectOptions(select("Phụ thu"), "Khác");
		expect(select("Phụ thu")).toHaveValue("");
		expect(props.onEdit).not.toHaveBeenCalled();
	});

	it("says why a save was refused", () => {
		renderForm({ outcome: { kind: "refused", code: "forbidden" } });
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			"không có quyền sửa mục này",
		);
	});

	it("is read-only, without suggestions to apply or a save bar, for a member who may not write", () => {
		renderForm({ canWrite: false });
		expect(screen.queryByRole("combobox")).toBeNull();
		const field = screen.getByRole("textbox", { name: "Trà sữa" });
		expect(field).toHaveValue("Đồ uống");
		expect(field).toHaveAttribute("readonly");
		expect(screen.getByRole("textbox", { name: "Bánh ngọt" })).toHaveValue(
			"Chưa gán",
		);
		expect(screen.queryByTestId("roles-apply-suggestions")).toBeNull();
		expect(screen.queryByTestId("settings-save-bar")).toBeNull();
	});

	it("says when the sales could not be read and when there is no item type yet", () => {
		const { unmount } = renderForm({
			usage: {
				loading: false,
				failed: false,
				failedAccounts: new Set(["A"]),
				byKey: new Map(),
			},
		});
		expect(select("Trà sữa")).toHaveAccessibleDescription(
			"Chưa đọc được số bán 28 ngày.",
		);
		unmount();
		renderForm({ entries: [] });
		expect(screen.getByTestId("roles-empty")).toHaveTextContent(
			"nhóm món đến từ POS sau lần đồng bộ đầu tiên",
		);
	});

	it("reads in English", () => {
		renderWithLanguage(<RolesForm {...propsWith()} />, "en");
		expect(select("Trà sữa")).toHaveAccessibleDescription(
			"14 items sold · 34,5% of item revenue over 28 days",
		);
		expect(
			screen.getByRole("button", {
				name: "Apply the suggestion to 1 unassigned type",
			}),
		).toBeInTheDocument();
	});
});
