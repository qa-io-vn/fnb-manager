import { DEMO_POS_ACCOUNT_ID, DemoSettingsStore } from "@fnb/demo-analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { SoldUncategorisedItem } from "../../settings/categories/categories";
import { createDemoSettingsSource } from "../../settings/demo-settings-source";
import {
	type ItemEntry,
	type ItemTypeEntry,
	type Membership,
	type SettingsSource,
	SettingsWriteError,
} from "../../settings/source";
import PhanLoaiPage, { mappingTabOf, withRoleChanges } from "./phan-loai-page";

const TENANT = {
	id: "33333333-3333-4333-8333-333333333333",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: "Asia/Ho_Chi_Minh",
	countryCode: "VN",
};

const current = vi.hoisted(() => ({
	state: { status: "loading" } as unknown,
	startCatchUp: vi.fn(),
	sales: {
		status: "ready",
		items: [] as unknown[],
		canRetry: false,
		retry: () => undefined,
	},
}));

vi.mock("../../settings/categories/use-uncategorised-sales", () => ({
	useUncategorisedSales: () => current.sales,
}));

vi.mock("../../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({ tenant: TENANT, stores: [] }),
}));

vi.mock("../../settings/settings-source-context", () => ({
	useSettingsSourceState: () => current.state,
	useRetrySettingsSource: () => () => undefined,
}));

vi.mock("../../settings/roles/use-role-usage", () => ({
	useRoleUsage: () => ({
		loading: false,
		failed: false,
		failedAccounts: new Set(),
		byKey: new Map(),
	}),
}));

vi.mock("../../settings/catch-up/catch-up-context", () => ({
	useCatchUpRunner: () => ({
		running: false,
		problem: null,
		completed: false,
		start: current.startCatchUp,
		abort: () => undefined,
		dismiss: () => undefined,
	}),
}));

function sourceFor(
	store: DemoSettingsStore,
	membership: Membership = { role: "owner", storeIds: null },
): SettingsSource {
	return {
		...createDemoSettingsSource(store),
		membership: async () => membership,
	};
}

function renderPage(source: SettingsSource, path = "/cai-dat/phan-loai") {
	current.state = { status: "ready", source };
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<MemoryRouter initialEntries={[path]}>
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<QueryClientProvider client={client}>
					<PhanLoaiPage />
				</QueryClientProvider>
			</I18nProvider>
		</MemoryRouter>,
	);
}

async function roleOf(name: string): Promise<HTMLElement> {
	return screen.findByRole("combobox", { name });
}

describe("the Phân loại page", () => {
	beforeEach(() => {
		current.startCatchUp.mockClear();
		current.sales.items = [DRESSED_SALE];
	});

	it("opens on the roles tab and moves to the categories and the payment kinds through the tabs", async () => {
		const user = userEvent.setup();
		renderPage(sourceFor(new DemoSettingsStore()));
		expect(await roleOf("Topping")).toHaveValue("topping");
		expect(
			screen.getByRole("link", { name: "Vai trò nhóm món" }),
		).toHaveAttribute("aria-current", "page");
		await user.click(screen.getByRole("link", { name: "Nhóm của món" }));
		expect(await screen.findByTestId("categories-form")).toBeVisible();
		expect(screen.getByRole("link", { name: "Nhóm của món" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		await user.click(screen.getByRole("link", { name: "Loại thanh toán" }));
		expect(await screen.findByTestId("payment-kinds-form")).toBeVisible();
		expect(screen.queryByTestId("categories-form")).toBeNull();
		expect(mappingTabOf("nhom-mon").slug).toBe("nhom-mon");
		expect(mappingTabOf("khong-co").slug).toBe("vai-tro");
		expect(mappingTabOf(null).slug).toBe("vai-tro");
	});

	it("saves a cleared role into the store, shows it at once and starts the catch-up", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		renderPage(sourceFor(store));
		await user.selectOptions(await roleOf("Topping"), "Chưa gán");
		await user.click(screen.getByRole("button", { name: "Lưu" }));
		await waitFor(() =>
			expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
				"Đã lưu.",
			),
		);
		expect(
			store.roles().some((role) => role.itemTypeExternalId === "TYPE-007"),
		).toBe(false);
		expect(await roleOf("Topping")).toHaveValue("");
		expect(current.startCatchUp).toHaveBeenCalledOnce();
	});

	it("shows the saved role even when reading the roles back fails", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		const working = sourceFor(store);
		let failing = false;
		renderPage({
			...working,
			itemTypes: async (tenantId) => {
				if (failing) throw new Error("offline");
				return working.itemTypes(tenantId);
			},
			saveRoles: async (tenantId, changes) => {
				await working.saveRoles(tenantId, changes);
				failing = true;
			},
		});
		await user.selectOptions(await roleOf("Topping"), "Chưa gán");
		await user.click(screen.getByRole("button", { name: "Lưu" }));
		await waitFor(() =>
			expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
				"Đã lưu.",
			),
		);
		expect(await roleOf("Topping")).toHaveValue("");
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"Chưa có thay đổi.",
		);
	});

	it.each([
		[
			{ role: "manager", storeIds: ["s1"] },
			"chủ hoặc quản lý xem được tất cả cửa hàng",
		],
		[
			{ role: "staff", storeIds: null },
			"Chỉ chủ và quản lý xem được tất cả cửa hàng",
		],
	] as const)(
		"shows %j the roles read-only with the reason",
		async (membership, reason) => {
			renderPage(sourceFor(new DemoSettingsStore(), membership));
			expect(
				await screen.findByRole("textbox", { name: "Topping" }),
			).toHaveValue("Topping");
			await waitFor(() =>
				expect(screen.getByTestId("settings-read-only")).toHaveTextContent(
					reason,
				),
			);
			expect(screen.queryByTestId("settings-save-bar")).toBeNull();
		},
	);

	it("writes saved roles into the cached list, leaving the others as they were", () => {
		const entries: ItemTypeEntry[] = [
			{
				posAccountId: "A",
				posAccountName: "POS",
				itemTypeExternalId: "T1",
				name: "Trà",
				role: "drink",
				audit: null,
			},
			{
				posAccountId: "A",
				posAccountName: "POS",
				itemTypeExternalId: "T2",
				name: "Topping",
				role: "topping",
				audit: null,
			},
		];
		expect(
			withRoleChanges(entries, [
				{ posAccountId: "A", itemTypeExternalId: "T2", role: null },
			])?.map((entry) => entry.role),
		).toEqual(["drink", null]);
		expect(withRoleChanges(undefined, [])).toBeUndefined();
	});
});

const CATEGORIES_PATH = "/cai-dat/phan-loai?tab=nhom-mon";
const KINDS_PATH = "/cai-dat/phan-loai?tab=thanh-toan";
const DRESSED_ITEM = "SN-001";
const DRESSED_NAME = "Hạt bí rang";
const SNACK_TYPE = "TYPE-009";
const DRESSED_SALE = soldItem(
	DEMO_POS_ACCOUNT_ID,
	DRESSED_ITEM,
	DRESSED_NAME,
	120_000,
);

function soldItem(
	posAccountId: string,
	itemExternalId: string,
	itemName: string,
	netAmount: number,
	posTypeExternalId: string | null = null,
): SoldUncategorisedItem {
	return {
		posAccountId,
		itemExternalId,
		itemName,
		posTypeExternalId,
		netAmount,
	};
}

function region(name: string | RegExp): Promise<HTMLElement> {
	return screen.findByRole("region", { name });
}

async function saveAndWait(user: ReturnType<typeof userEvent.setup>) {
	await user.click(screen.getByRole("button", { name: "Lưu" }));
	await waitFor(() =>
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			"Đã lưu.",
		),
	);
}

function typeEntry(account: string, id: string, name: string): ItemTypeEntry {
	return {
		posAccountId: account,
		posAccountName: account === "A" ? "POS trà" : "POS cà phê",
		itemTypeExternalId: id,
		name,
		role: null,
		audit: null,
	};
}

function itemEntry(account: string, id: string, name: string): ItemEntry {
	return {
		posAccountId: account,
		itemExternalId: id,
		name,
		sizeLabel: null,
		listPrice: 20000,
		isModifier: false,
		active: true,
		inCatalogue: true,
		posItemTypeExternalId: null,
		overrideItemTypeExternalId: null,
		audit: null,
	};
}

async function chooseForDressedItem(
	user: ReturnType<typeof userEvent.setup>,
	section: string,
	option: string,
) {
	await user.selectOptions(
		within(await region(section)).getByRole("combobox", {
			name: DRESSED_NAME,
		}),
		option,
	);
}

describe("the Nhóm của món tab", () => {
	beforeEach(() => {
		current.startCatchUp.mockClear();
		current.sales.items = [DRESSED_SALE];
	});

	it("lists the demo's uncategorised item first and offers As in the POS and its account's types", async () => {
		renderPage(sourceFor(new DemoSettingsStore()), CATEGORIES_PATH);
		const uncategorised = await region("Chưa phân loại (1)");
		const rows = within(uncategorised).getAllByTestId("category-row");
		expect(rows.map((row) => row.dataset.item)).toEqual([DRESSED_ITEM]);
		const select = within(uncategorised).getByRole("combobox", {
			name: DRESSED_NAME,
		});
		expect(select).toHaveValue("");
		const options = within(select)
			.getAllByRole("option")
			.map((option) => option.textContent);
		expect(options[0]).toBe("Theo POS");
		expect(options).toHaveLength(11);
		expect(options).toContain("Đồ ăn kèm");
		expect(screen.queryByTestId("categories-overridden")).toBeNull();
	});

	it("saves a re-mapped item into the store, moves it out of Chưa phân loại and starts the catch-up", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		renderPage(sourceFor(store), CATEGORIES_PATH);
		await chooseForDressedItem(user, "Chưa phân loại (1)", "Đồ ăn kèm");
		await saveAndWait(user);
		expect(store.overrides()).toEqual([
			expect.objectContaining({
				posAccountId: DEMO_POS_ACCOUNT_ID,
				itemExternalId: DRESSED_ITEM,
				itemTypeExternalId: SNACK_TYPE,
			}),
		]);
		expect(current.startCatchUp).toHaveBeenCalledOnce();
		expect(
			within(await region("Chưa phân loại (0)")).getByTestId(
				"categories-uncategorised-none",
			),
		).toBeVisible();
		expect(
			within(await region("Đã chọn nhóm tại đây (1)")).getByRole("combobox", {
				name: DRESSED_NAME,
			}),
		).toHaveValue(SNACK_TYPE);
	});

	it("deletes the override when As in the POS is chosen, and the item is uncategorised again", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		store.saveOverrides([
			{
				posAccountId: DEMO_POS_ACCOUNT_ID,
				itemExternalId: DRESSED_ITEM,
				itemTypeExternalId: SNACK_TYPE,
				itemTypeName: null,
			},
		]);
		renderPage(sourceFor(store), CATEGORIES_PATH);
		await chooseForDressedItem(user, "Đã chọn nhóm tại đây (1)", "Theo POS");
		await saveAndWait(user);
		expect(store.overrides()).toEqual([]);
		expect(current.startCatchUp).toHaveBeenCalledOnce();
		expect(
			within(await region("Chưa phân loại (1)")).getByRole("combobox", {
				name: DRESSED_NAME,
			}),
		).toHaveValue("");
	});

	it("lists the items in the order of their 90-day sales, with the POS type of their sale lines", async () => {
		current.sales.items = [
			soldItem(
				DEMO_POS_ACCOUNT_ID,
				"SN-002",
				"Bánh quy bơ",
				500_000,
				"TYPE-099",
			),
			DRESSED_SALE,
		];
		renderPage(sourceFor(new DemoSettingsStore()), CATEGORIES_PATH);
		const uncategorised = await region("Chưa phân loại (2)");
		expect(
			within(uncategorised)
				.getAllByTestId("category-row")
				.map((row) => row.dataset.item),
		).toEqual(["SN-002", DRESSED_ITEM]);
		expect(
			within(uncategorised).getByRole("combobox", { name: "Bánh quy bơ" }),
		).toHaveAccessibleDescription(
			"Trên POS: nhóm TYPE-099, không có trong danh mục",
		);
	});

	it("re-maps an item sold by name only, saves it under that name and moves it out of Chưa phân loại at once", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		current.sales.items = [
			soldItem(DEMO_POS_ACCOUNT_ID, "Bánh mì que", "Bánh mì que", 300_000),
			DRESSED_SALE,
		];
		renderPage(sourceFor(store), CATEGORIES_PATH);
		const uncategorised = await region("Chưa phân loại (2)");
		expect(
			within(uncategorised).getByRole("combobox", { name: "Bánh mì que" }),
		).toHaveAccessibleDescription(
			"Trên POS: chưa có nhóm · Không có trong danh mục POS",
		);
		await user.selectOptions(
			within(uncategorised).getByRole("combobox", { name: "Bánh mì que" }),
			"Đồ ăn kèm",
		);
		await saveAndWait(user);
		expect(store.overrides()).toEqual([
			expect.objectContaining({
				posAccountId: DEMO_POS_ACCOUNT_ID,
				itemExternalId: "Bánh mì que",
				itemTypeExternalId: SNACK_TYPE,
			}),
		]);
		expect(current.startCatchUp).toHaveBeenCalledOnce();
		expect(
			within(await region("Chưa phân loại (1)"))
				.getAllByTestId("category-row")
				.map((row) => row.dataset.item),
		).toEqual([DRESSED_ITEM]);
		expect(
			within(await region("Đã chọn nhóm tại đây (1)")).getByRole("combobox", {
				name: "Bánh mì que",
			}),
		).toHaveValue(SNACK_TYPE);
	});

	it("finds any item through the search and saves a type for it", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		renderPage(sourceFor(store), CATEGORIES_PATH);
		const search = await region("Tất cả món");
		await user.type(
			within(search).getByRole("searchbox", { name: "Tìm món" }),
			"banh quy",
		);
		await user.selectOptions(
			within(search).getByRole("combobox", { name: "Bánh quy bơ" }),
			"Topping",
		);
		await saveAndWait(user);
		expect(store.overrides()).toEqual([
			expect.objectContaining({
				itemExternalId: "SN-002",
				itemTypeExternalId: "TYPE-007",
			}),
		]);
	});

	it("offers each item only the types of its own POS account", async () => {
		current.sales.items = [
			soldItem("A", "I1", "Hạt bí", 2),
			soldItem("B", "I2", "Bạc xỉu", 1),
		];
		const demo = sourceFor(new DemoSettingsStore());
		renderPage(
			{
				...demo,
				itemTypes: async () => [
					typeEntry("A", "T1", "Trà sữa"),
					typeEntry("B", "T1", "Cà phê"),
					typeEntry("B", "T2", "Bánh mì"),
				],
				items: async () => [
					itemEntry("A", "I1", "Hạt bí"),
					itemEntry("B", "I2", "Bạc xỉu"),
				],
			},
			CATEGORIES_PATH,
		);
		const uncategorised = await region("Chưa phân loại (2)");
		const optionsOf = (name: string) =>
			within(within(uncategorised).getByRole("combobox", { name }))
				.getAllByRole("option")
				.map((option) => option.textContent);
		expect(optionsOf("Hạt bí")).toEqual(["Theo POS", "Trà sữa"]);
		expect(optionsOf("Bạc xỉu")).toEqual(["Theo POS", "Bánh mì", "Cà phê"]);
	});

	it("shows the refusal's message and keeps the change pending when the save is refused", async () => {
		const user = userEvent.setup();
		const demo = sourceFor(new DemoSettingsStore());
		renderPage(
			{
				...demo,
				saveCategoryOverrides: async () => {
					throw new SettingsWriteError("forbidden");
				},
			},
			CATEGORIES_PATH,
		);
		await chooseForDressedItem(user, "Chưa phân loại (1)", "Đồ ăn kèm");
		await user.click(screen.getByRole("button", { name: "Lưu" }));
		await waitFor(() =>
			expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
				"Không lưu được: tài khoản của bạn không có quyền sửa mục này.",
			),
		);
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"1 thay đổi chưa lưu",
		);
		expect(screen.queryByTestId("settings-retry-save")).toBeNull();
		expect(current.startCatchUp).not.toHaveBeenCalled();
	});

	it("offers a retry after a lost connection that sends the same overrides again", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		const demo = sourceFor(store);
		let attempts = 0;
		renderPage(
			{
				...demo,
				saveCategoryOverrides: async (tenantId, changes) => {
					attempts += 1;
					if (attempts === 1) throw new Error("offline");
					await demo.saveCategoryOverrides(tenantId, changes);
				},
			},
			CATEGORIES_PATH,
		);
		await chooseForDressedItem(user, "Chưa phân loại (1)", "Đồ ăn kèm");
		await user.click(screen.getByRole("button", { name: "Lưu" }));
		await waitFor(() =>
			expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
				"mất kết nối",
			),
		);
		await user.click(screen.getByRole("button", { name: "Thử lại" }));
		await waitFor(() =>
			expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
				"Đã lưu.",
			),
		);
		expect(attempts).toBe(2);
		expect(store.overrides()).toHaveLength(1);
		expect(current.startCatchUp).toHaveBeenCalledOnce();
	});

	it("shows the saved type even when reading the items back fails", async () => {
		const user = userEvent.setup();
		const demo = sourceFor(new DemoSettingsStore());
		let failing = false;
		renderPage(
			{
				...demo,
				items: async (tenantId) => {
					if (failing) throw new Error("offline");
					return demo.items(tenantId);
				},
				saveCategoryOverrides: async (tenantId, changes) => {
					await demo.saveCategoryOverrides(tenantId, changes);
					failing = true;
				},
			},
			CATEGORIES_PATH,
		);
		await chooseForDressedItem(user, "Chưa phân loại (1)", "Đồ ăn kèm");
		await saveAndWait(user);
		expect(
			within(await region("Đã chọn nhóm tại đây (1)")).getByRole("combobox", {
				name: DRESSED_NAME,
			}),
		).toHaveValue(SNACK_TYPE);
	});

	it("offers a retry when the items cannot be read", async () => {
		const demo = sourceFor(new DemoSettingsStore());
		renderPage(
			{
				...demo,
				items: async () => {
					throw new Error("offline");
				},
			},
			CATEGORIES_PATH,
		);
		expect(await screen.findByTestId("categories-load-failed")).toBeVisible();
		expect(screen.getByRole("button", { name: "Thử lại" })).toBeVisible();
	});
});

describe("the Loại thanh toán tab", () => {
	beforeEach(() => {
		current.startCatchUp.mockClear();
		current.sales.items = [DRESSED_SALE];
	});

	it("lists every demo method with its POS kind and the kind in effect, and the note on past shifts", async () => {
		renderPage(sourceFor(new DemoSettingsStore()), KINDS_PATH);
		const bank = await screen.findByRole("combobox", { name: "Chuyển khoản" });
		expect(bank).toHaveValue("");
		expect(bank).toHaveAccessibleDescription(
			"Trên POS: Chuyển khoản · Đang tính là: Chuyển khoản",
		);
		expect(screen.getAllByTestId("payment-kind-row")).toHaveLength(3);
		expect(screen.getByTestId("payment-kinds-drawer-note")).toHaveTextContent(
			"chỉ đổi theo loại mới sau khi đồng bộ lại những ngày đó",
		);
	});

	it("saves a kind change into the store, shows the kind in effect and starts the catch-up", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		renderPage(sourceFor(store), KINDS_PATH);
		await user.selectOptions(
			await screen.findByRole("combobox", { name: "Chuyển khoản" }),
			"Thẻ",
		);
		await saveAndWait(user);
		expect(store.paymentKindOverrides()).toEqual([
			{
				posAccountId: DEMO_POS_ACCOUNT_ID,
				paymentMethodExternalId: "PM-BANK",
				kind: "card",
			},
		]);
		expect(current.startCatchUp).toHaveBeenCalledOnce();
		await waitFor(() =>
			expect(
				screen.getByRole("combobox", { name: "Chuyển khoản" }),
			).toHaveAccessibleDescription(
				"Trên POS: Chuyển khoản · Đang tính là: Thẻ",
			),
		);
	});

	it("deletes the override when As in the POS is chosen, and starts the catch-up", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		store.savePaymentKindOverrides([
			{
				posAccountId: DEMO_POS_ACCOUNT_ID,
				paymentMethodExternalId: "PM-BANK",
				kind: "card",
			},
		]);
		renderPage(sourceFor(store), KINDS_PATH);
		const bank = await screen.findByRole("combobox", { name: "Chuyển khoản" });
		expect(bank).toHaveValue("card");
		await user.selectOptions(bank, "Theo POS");
		await saveAndWait(user);
		expect(store.paymentKindOverrides()).toEqual([]);
		expect(current.startCatchUp).toHaveBeenCalledOnce();
	});

	it("shows the refusal's message when the save is refused and starts no catch-up", async () => {
		const user = userEvent.setup();
		const demo = sourceFor(new DemoSettingsStore());
		renderPage(
			{
				...demo,
				saveKindOverrides: async () => {
					throw new SettingsWriteError("invalid", "payment_kind");
				},
			},
			KINDS_PATH,
		);
		await user.selectOptions(
			await screen.findByRole("combobox", { name: "Chuyển khoản" }),
			"Thẻ",
		);
		await user.click(screen.getByRole("button", { name: "Lưu" }));
		await waitFor(() =>
			expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
				"Không lưu được: có giá trị nằm ngoài khoảng cho phép.",
			),
		);
		expect(current.startCatchUp).not.toHaveBeenCalled();
	});
});

describe("the two tabs for a member who may not write", () => {
	beforeEach(() => {
		current.sales.items = [DRESSED_SALE];
	});

	it.each([
		[{ role: "staff", storeIds: null }, "role"],
		[{ role: "viewer", storeIds: null }, "role"],
		[{ role: "manager", storeIds: ["s1"] }, "scope"],
	] as const)(
		"show %j the categories and the kinds read-only, with the reason and no save bar",
		async (membership, reason) => {
			const user = userEvent.setup();
			renderPage(
				sourceFor(new DemoSettingsStore(), membership),
				CATEGORIES_PATH,
			);
			const uncategorised = await region("Chưa phân loại (1)");
			expect(
				within(uncategorised).getByRole("textbox", { name: DRESSED_NAME }),
			).toHaveValue("Theo POS");
			await waitFor(() =>
				expect(screen.getByTestId("settings-read-only")).toHaveAttribute(
					"data-reason",
					reason,
				),
			);
			expect(screen.queryByRole("combobox")).toBeNull();
			expect(screen.queryByTestId("settings-save-bar")).toBeNull();
			await user.click(screen.getByRole("link", { name: "Loại thanh toán" }));
			expect(
				await screen.findByRole("textbox", { name: "Chuyển khoản" }),
			).toHaveValue("Theo POS");
			expect(screen.getByTestId("settings-read-only")).toHaveAttribute(
				"data-reason",
				reason,
			);
			expect(screen.queryByRole("combobox")).toBeNull();
			expect(screen.queryByTestId("settings-save-bar")).toBeNull();
		},
	);
});
