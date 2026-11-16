import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { renderWithLanguage, vndFormatters } from "../../test/render";
import type { ItemEntry, ItemTypeEntry } from "../source";
import type { SoldUncategorisedItem } from "./categories";
import { CategoriesForm, type CategoriesFormProps } from "./categories-form";
import type { UncategorisedSales } from "./use-uncategorised-sales";

function type(account: string, id: string, name: string): ItemTypeEntry {
	return {
		posAccountId: account,
		posAccountName: account === "A" ? "POS trà" : "POS cà phê",
		itemTypeExternalId: id,
		name,
		role: null,
		audit: null,
	};
}

function item(
	id: string,
	name: string,
	fields: Partial<ItemEntry> = {},
): ItemEntry {
	return {
		posAccountId: "A",
		itemExternalId: id,
		name,
		sizeLabel: null,
		listPrice: 20000,
		isModifier: false,
		active: true,
		inCatalogue: true,
		posItemTypeExternalId: "T1",
		overrideItemTypeExternalId: null,
		audit: null,
		...fields,
	};
}

const ITEM_TYPES: readonly ItemTypeEntry[] = [
	type("A", "T1", "Trà sữa"),
	type("A", "T2", "Đồ ăn kèm"),
	type("B", "T1", "Cà phê"),
	type("B", "T3", "Bánh mì"),
];

const ENTRIES: readonly ItemEntry[] = [
	item("I1", "Trà sữa trân châu", { sizeLabel: "L" }),
	item("I2", "Hạt bí", { posItemTypeExternalId: null }),
	item("I3", "Bánh quy", { posItemTypeExternalId: "T9" }),
	item("I4", "Bánh flan", {
		posItemTypeExternalId: null,
		overrideItemTypeExternalId: "T2",
		audit: {
			changedAt: "2026-11-10T03:00:00Z",
			author: { kind: "member", role: "manager" },
		},
	}),
	item("GONE", "GONE", {
		inCatalogue: false,
		active: false,
		posItemTypeExternalId: null,
		overrideItemTypeExternalId: "T2",
	}),
	item("I7", "Bạc xỉu", { posAccountId: "B", posItemTypeExternalId: null }),
];

function sale(
	account: string,
	id: string,
	name: string | null,
	net: number,
	posType: string | null = null,
): SoldUncategorisedItem {
	return {
		posAccountId: account,
		itemExternalId: id,
		itemName: name,
		posTypeExternalId: posType,
		netAmount: net,
	};
}

const SOLD: readonly SoldUncategorisedItem[] = [
	sale("A", "I2", "Hạt bí", 900_000),
	sale("A", "I3", "Bánh quy", 500_000, "T9"),
	sale("B", "I7", "Bạc xỉu", 300_000),
];

function salesOf(
	items: readonly SoldUncategorisedItem[],
	fields: Partial<UncategorisedSales> = {},
): UncategorisedSales {
	return {
		status: "ready",
		items,
		canRetry: false,
		retry: vi.fn(),
		...fields,
	};
}

function propsWith(
	overrides: Partial<CategoriesFormProps> = {},
): CategoriesFormProps {
	return {
		entries: ENTRIES,
		itemTypes: ITEM_TYPES,
		sales: salesOf(SOLD),
		formatters: vndFormatters(),
		timeZone: "Asia/Ho_Chi_Minh",
		canWrite: true,
		saving: false,
		outcome: { kind: "idle" },
		onSave: vi.fn(),
		onRetry: vi.fn(),
		onEdit: vi.fn(),
		...overrides,
	};
}

function renderForm(overrides: Partial<CategoriesFormProps> = {}) {
	const props = propsWith(overrides);
	return { props, ...renderWithLanguage(<CategoriesForm {...props} />) };
}

function section(name: RegExp | string): HTMLElement {
	return screen.getByRole("region", { name });
}

function selectIn(scope: HTMLElement, name: string): HTMLElement {
	return within(scope).getByRole("combobox", { name });
}

function optionsOf(select: HTMLElement): (string | null)[] {
	return within(select)
		.getAllByRole("option")
		.map((option) => option.textContent);
}

describe("CategoriesForm", () => {
	it("lists the items sold without a usable type first, best sellers first, each with what its sale lines say and its account", () => {
		renderForm();
		const uncategorised = section("Chưa phân loại (3)");
		expect(
			within(uncategorised)
				.getAllByTestId("category-row")
				.map((row) => row.dataset.item),
		).toEqual(["I2", "I3", "I7"]);
		expect(selectIn(uncategorised, "Hạt bí")).toHaveValue("");
		expect(selectIn(uncategorised, "Hạt bí")).toHaveAccessibleDescription(
			"Trên POS: chưa có nhóm · POS trà",
		);
		expect(selectIn(uncategorised, "Bánh quy")).toHaveAccessibleDescription(
			"Trên POS: nhóm T9, không có trong danh mục · POS trà",
		);
		expect(
			screen.getAllByRole("region").map((region) => region.dataset.testid),
		).toEqual([
			"categories-uncategorised",
			"categories-overridden",
			"categories-search",
			"settings-save-bar",
		]);
	});

	it("offers As in the POS and the types of the item's own POS account only, never another account's", () => {
		renderForm();
		const uncategorised = section("Chưa phân loại (3)");
		expect(optionsOf(selectIn(uncategorised, "Hạt bí"))).toEqual([
			"Theo POS",
			"Đồ ăn kèm",
			"Trà sữa",
		]);
		expect(optionsOf(selectIn(uncategorised, "Bạc xỉu"))).toEqual([
			"Theo POS",
			"Bánh mì",
			"Cà phê",
		]);
	});

	it("lists the saved overrides with their audit line, an override whose item left the catalogue included", () => {
		renderForm();
		const overridden = section("Đã chọn nhóm tại đây (2)");
		expect(selectIn(overridden, "Bánh flan")).toHaveValue("T2");
		expect(selectIn(overridden, "GONE")).toHaveAccessibleDescription(
			"Trên POS: chưa có nhóm · POS trà · Không có trong danh mục POS",
		);
		expect(
			within(overridden).getAllByTestId("settings-audit-line"),
		).toHaveLength(1);
		expect(
			within(overridden).getAllByTestId("settings-audit-line")[0],
		).toHaveTextContent("quản lý");
	});

	it("hides the overridden list when there is none and says when every item sold has a type", () => {
		renderForm({ entries: [item("I1", "Trà sữa")], sales: salesOf([]) });
		expect(
			screen.getByTestId("categories-uncategorised-none"),
		).toHaveTextContent("Món nào bán trong 90 ngày qua cũng đã có nhóm.");
		expect(screen.queryByTestId("categories-overridden")).toBeNull();
	});

	it("searches every item without Vietnamese marks, uncategorised first, and says when nothing matches", async () => {
		const user = userEvent.setup();
		renderForm();
		const search = section("Tất cả món");
		const box = within(search).getByRole("searchbox", { name: "Tìm món" });
		expect(box).toHaveAccessibleDescription(
			"Tìm theo tên, cỡ, mã món hoặc nhóm trong 6 món.",
		);
		expect(within(search).queryAllByTestId("category-row")).toHaveLength(0);
		expect(within(search).getByRole("status")).toBeEmptyDOMElement();
		await user.type(box, "banh");
		expect(
			within(search)
				.getAllByTestId("category-row")
				.map((row) => row.dataset.item),
		).toEqual(["I3", "I4"]);
		expect(within(search).getByRole("status")).toHaveTextContent(
			"Số món khớp: 2.",
		);
		await user.clear(box);
		await user.type(box, "tra l");
		expect(
			within(search).getByRole("combobox", {
				name: "Trà sữa trân châu (cỡ L)",
			}),
		).toHaveValue("");
		await user.clear(box);
		await user.type(box, "khong co");
		expect(within(search).getByRole("status")).toHaveTextContent(
			"Không có món nào khớp.",
		);
	});

	it("saves only the changed items, with As in the POS sent as a deleted override", async () => {
		const user = userEvent.setup();
		const { props } = renderForm();
		await user.selectOptions(
			selectIn(section("Chưa phân loại (3)"), "Hạt bí"),
			"Đồ ăn kèm",
		);
		await user.selectOptions(
			selectIn(section("Đã chọn nhóm tại đây (2)"), "Bánh flan"),
			"Theo POS",
		);
		expect(props.onEdit).toHaveBeenCalledTimes(2);
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"2 thay đổi chưa lưu",
		);
		await user.click(screen.getByRole("button", { name: "Lưu" }));
		expect(props.onSave).toHaveBeenCalledExactlyOnceWith([
			{ posAccountId: "A", itemExternalId: "I2", itemTypeExternalId: "T2" },
			{ posAccountId: "A", itemExternalId: "I4", itemTypeExternalId: null },
		]);
	});

	it("shows an edit made in the search in the list above too, and cancels back to the saved types", async () => {
		const user = userEvent.setup();
		renderForm();
		const search = section("Tất cả món");
		await user.type(
			within(search).getByRole("searchbox", { name: "Tìm món" }),
			"hat",
		);
		await user.selectOptions(selectIn(search, "Hạt bí"), "Trà sữa");
		expect(selectIn(section("Chưa phân loại (3)"), "Hạt bí")).toHaveValue("T1");
		await user.click(screen.getByRole("button", { name: "Hủy thay đổi" }));
		expect(selectIn(section("Chưa phân loại (3)"), "Hạt bí")).toHaveValue("");
	});

	it("takes the saved overrides after a save, moves the item out of Chưa phân loại and says it is saved", async () => {
		const user = userEvent.setup();
		const { props, rerender } = renderForm();
		await user.selectOptions(
			selectIn(section("Chưa phân loại (3)"), "Hạt bí"),
			"Đồ ăn kèm",
		);
		const savedEntries = ENTRIES.map((entry) =>
			entry.itemExternalId === "I2"
				? { ...entry, overrideItemTypeExternalId: "T2" }
				: entry,
		);
		rerender(
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<CategoriesForm
					{...props}
					entries={savedEntries}
					outcome={{ kind: "saved" }}
				/>
			</I18nProvider>,
		);
		expect(
			within(section("Chưa phân loại (2)")).queryByRole("combobox", {
				name: "Hạt bí",
			}),
		).toBeNull();
		expect(selectIn(section("Đã chọn nhóm tại đây (3)"), "Hạt bí")).toHaveValue(
			"T2",
		);
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			"Đã lưu.",
		);
	});

	it("keeps an override to a type the POS no longer has as a choice of its own", () => {
		renderForm({
			entries: [
				item("I9", "Sinh tố", {
					posItemTypeExternalId: null,
					overrideItemTypeExternalId: "T8",
				}),
			],
			sales: salesOf([]),
		});
		const select = selectIn(section("Đã chọn nhóm tại đây (1)"), "Sinh tố");
		expect(select).toHaveValue("T8");
		expect(optionsOf(select)).toContain("T8 (không còn trên POS)");
	});

	it("shows the refusal's message from its key and offers a retry after a lost connection", async () => {
		const user = userEvent.setup();
		const { props } = renderForm({
			outcome: {
				kind: "refused",
				messageKey: "settings.error.network",
				canRetry: true,
			},
		});
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			"Không lưu được vì mất kết nối; kiểm tra mạng rồi thử lại.",
		);
		await user.click(screen.getByRole("button", { name: "Thử lại" }));
		expect(props.onRetry).toHaveBeenCalledOnce();
	});

	it("offers no retry after a refusal that a retry would not change", () => {
		renderForm({
			outcome: {
				kind: "refused",
				messageKey: "settings.error.forbidden",
				canRetry: false,
			},
		});
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			"Không lưu được: tài khoản của bạn không có quyền sửa mục này.",
		);
		expect(screen.queryByTestId("settings-retry-save")).toBeNull();
	});

	it("shows the categories as text with no save bar to a member who may not write", () => {
		renderForm({ canWrite: false });
		const uncategorised = section("Chưa phân loại (3)");
		expect(
			within(uncategorised).getByRole("textbox", { name: "Hạt bí" }),
		).toHaveValue("Theo POS");
		expect(
			within(section("Đã chọn nhóm tại đây (2)")).getByRole("textbox", {
				name: "Bánh flan",
			}),
		).toHaveValue("Đồ ăn kèm");
		expect(screen.queryByRole("combobox")).toBeNull();
		expect(screen.queryByTestId("settings-save-bar")).toBeNull();
	});

	it("says where items come from when there are none", () => {
		renderForm({ entries: [], sales: salesOf([]) });
		expect(screen.getByTestId("categories-empty")).toHaveTextContent(
			"món đến từ POS sau lần đồng bộ đầu tiên",
		);
	});

	it("lists an item sold by name only, outside the catalogue, finds it in the search and saves its override under that name", async () => {
		const user = userEvent.setup();
		const { props } = renderForm({
			sales: salesOf([
				sale("A", "Bánh mì que", "Bánh mì que", 950_000),
				...SOLD,
			]),
		});
		const uncategorised = section("Chưa phân loại (4)");
		expect(
			within(uncategorised)
				.getAllByTestId("category-row")
				.map((row) => row.dataset.item),
		).toEqual(["Bánh mì que", "I2", "I3", "I7"]);
		expect(selectIn(uncategorised, "Bánh mì que")).toHaveAccessibleDescription(
			"Trên POS: chưa có nhóm · POS trà · Không có trong danh mục POS",
		);
		const search = section("Tất cả món");
		const box = within(search).getByRole("searchbox", { name: "Tìm món" });
		expect(box).toHaveAccessibleDescription(
			"Tìm theo tên, cỡ, mã món hoặc nhóm trong 7 món.",
		);
		await user.type(box, "mi que");
		expect(selectIn(search, "Bánh mì que")).toHaveValue("");
		await user.selectOptions(
			selectIn(uncategorised, "Bánh mì que"),
			"Đồ ăn kèm",
		);
		await user.click(screen.getByRole("button", { name: "Lưu" }));
		expect(props.onSave).toHaveBeenCalledExactlyOnceWith([
			{
				posAccountId: "A",
				itemExternalId: "Bánh mì que",
				itemTypeExternalId: "T2",
			},
		]);
	});

	it("says while the sales are read, and offers a retry when they could not be", async () => {
		const user = userEvent.setup();
		const { unmount } = renderForm({
			sales: salesOf([], { status: "loading" }),
		});
		expect(
			within(section("Chưa phân loại")).getByRole("status"),
		).toHaveTextContent("Đang tải…");
		expect(section("Tất cả món")).toBeVisible();
		unmount();
		const retry = vi.fn();
		renderForm({
			sales: salesOf([], { status: "failed", canRetry: true, retry }),
		});
		const failed = within(section("Chưa phân loại")).getByRole("alert");
		expect(failed).toHaveTextContent(
			"Chưa đọc được các món đã bán trong 90 ngày qua.",
		);
		await user.click(within(failed).getByRole("button", { name: "Thử lại" }));
		expect(retry).toHaveBeenCalledOnce();
	});

	it("gives every row a control of its own, even for names that differ only by their marks", async () => {
		const user = userEvent.setup();
		const { props } = renderForm({
			sales: salesOf([
				sale("A", "Trà sữa", "Trà sữa", 2),
				sale("A", "Trứ sửa", "Trứ sửa", 1),
			]),
		});
		const uncategorised = section("Chưa phân loại (2)");
		const first = selectIn(uncategorised, "Trà sữa");
		const second = selectIn(uncategorised, "Trứ sửa");
		expect(first.id).not.toBe(second.id);
		await user.selectOptions(second, "Đồ ăn kèm");
		expect(first).toHaveValue("");
		await user.click(screen.getByRole("button", { name: "Lưu" }));
		expect(props.onSave).toHaveBeenCalledExactlyOnceWith([
			{
				posAccountId: "A",
				itemExternalId: "Trứ sửa",
				itemTypeExternalId: "T2",
			},
		]);
	});

	it("reads in English", () => {
		renderWithLanguage(<CategoriesForm {...propsWith()} />, "en");
		expect(
			screen.getByRole("region", { name: "Uncategorised (3)" }),
		).toBeVisible();
		expect(
			optionsOf(
				screen.getAllByRole("combobox", { name: "Hạt bí" })[0] as HTMLElement,
			)[0],
		).toBe("As in the POS");
	});
});
