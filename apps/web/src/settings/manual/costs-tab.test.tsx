import { DemoSettingsStore } from "@fnb/demo-analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { todayIn } from "../../lib/business-dates";
import { type CsvDialect, downloadTextFile, UTF8_BOM } from "../../lib/csv";
import { CsvDialectProvider } from "../../state/csv-dialect";
import { createDemoSettingsSource } from "../demo-settings-source";
import {
	type ItemEntry,
	type ItemTypeEntry,
	type Membership,
	type SettingsSource,
	SettingsWriteError,
} from "../source";
import type { CostSale } from "./costs";
import { CostsTab, defaultCostScope } from "./costs-tab";
import { createDemoManualSource } from "./demo-manual-source";
import type { ManualSettingsSource } from "./source";

const TIME_ZONE = "Asia/Ho_Chi_Minh";
const TODAY = todayIn(TIME_ZONE, new Date());
const TODAY_TEXT = TODAY.split("-").reverse().join("/");
const NEXT_YEAR_END = `31/12/${Number(TODAY.slice(0, 4)) + 1}`;
const ACCOUNT = "ACC-1";
const STORE = "MOCK-S1";
const OTHER_STORE = "MOCK-S2";
const MILK_TEA = "Trà sữa trân châu (M)";

const TENANT = {
	id: "33333333-3333-4333-8333-333333333333",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: TIME_ZONE,
	countryCode: "VN",
};

const STORES = [
	{
		id: STORE,
		tenantId: TENANT.id,
		name: "Cửa hàng một",
		code: null,
		timeZone: TIME_ZONE,
		businessDayStartMinutes: 0,
		posAccountId: ACCOUNT,
	},
	{
		id: OTHER_STORE,
		tenantId: TENANT.id,
		name: "Cửa hàng hai",
		code: null,
		timeZone: TIME_ZONE,
		businessDayStartMinutes: 0,
		posAccountId: "ACC-2",
	},
];

function item(
	id: string,
	name: string,
	fields: Partial<ItemEntry> = {},
): ItemEntry {
	return {
		posAccountId: ACCOUNT,
		itemExternalId: id,
		name,
		sizeLabel: null,
		listPrice: 40_000,
		isModifier: false,
		active: true,
		inCatalogue: true,
		posItemTypeExternalId: "T1",
		overrideItemTypeExternalId: null,
		audit: null,
		...fields,
	};
}

const ITEMS: readonly ItemEntry[] = [
	item("I1", "Trà sữa trân châu", { sizeLabel: "M" }),
	item("I2", "Bánh flan", { listPrice: 20_000 }),
	item("I3", "Cà phê sữa", { posAccountId: "ACC-2" }),
	item("I4", "Trân châu thêm", { isModifier: true }),
];

const TYPES: readonly ItemTypeEntry[] = [
	{
		posAccountId: ACCOUNT,
		posAccountName: "POS một",
		itemTypeExternalId: "T1",
		name: "Trà sữa",
		role: "drink",
		audit: null,
	},
];

function sale(itemExternalId: string, netAmount: number): CostSale {
	return {
		itemExternalId,
		name: itemExternalId,
		sizeLabel: null,
		category: null,
		netAmount,
	};
}

const current = vi.hoisted(() => ({
	state: { status: "loading" } as unknown,
	sales: {
		status: "ready",
		sales: [] as unknown[],
		canRetry: false,
		retry: () => undefined,
	} as {
		status: string;
		sales: unknown[];
		canRetry: boolean;
		retry: () => void;
	},
	salesCalls: [] as string[][],
}));

vi.mock("../../lib/csv", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../lib/csv")>()),
	downloadTextFile: vi.fn(),
}));

vi.mock("../../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({ tenant: TENANT, stores: STORES }),
}));

vi.mock("../settings-source-context", () => ({
	useSettingsSourceState: () => current.state,
	useRetrySettingsSource: () => () => undefined,
}));

vi.mock("./use-item-sales", () => ({
	useItemSales: (storeIds: readonly string[]) => {
		current.salesCalls.push([...storeIds]);
		return current.sales;
	},
}));

vi.mock("../catch-up/catch-up-context", () => ({
	useCatchUpRunner: () => ({
		running: false,
		problem: null,
		completed: false,
		start: () => undefined,
		abort: () => undefined,
		dismiss: () => undefined,
	}),
}));

function settingsSource(
	store: DemoSettingsStore,
	membership: Membership,
): SettingsSource {
	return {
		...createDemoSettingsSource(store),
		membership: async () => membership,
		items: async () => [...ITEMS],
		itemTypes: async () => [...TYPES],
	};
}

const OWNER: Membership = { role: "owner", storeIds: null };

function renderTab(
	store: DemoSettingsStore,
	{
		membership = OWNER,
		manual = createDemoManualSource(store),
		dialect = "comma",
	}: {
		membership?: Membership;
		manual?: ManualSettingsSource;
		dialect?: CsvDialect;
	} = {},
) {
	current.state = {
		status: "ready",
		source: settingsSource(store, membership),
		manual,
	};
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<I18nProvider language="vi" onLanguageChange={() => undefined}>
			<CsvDialectProvider dialect={dialect}>
				<QueryClientProvider client={client}>
					<CostsTab />
				</QueryClientProvider>
			</CsvDialectProvider>
		</I18nProvider>,
	);
}

async function rowOf(itemExternalId: string): Promise<HTMLElement> {
	return waitFor(() => {
		const row = screen
			.getAllByTestId("cost-row")
			.find((candidate) => candidate.dataset.item === itemExternalId);
		if (row === undefined) throw new Error(`no row for ${itemExternalId}`);
		return row;
	});
}

function costInput(row: HTMLElement): HTMLElement {
	return within(row).getByLabelText("Giá vốn mới");
}

function dateInput(row: HTMLElement): HTMLElement {
	return within(row).getByLabelText("Áp dụng từ ngày");
}

function enterCost(row: HTMLElement, text: string): void {
	fireEvent.change(costInput(row), { target: { value: text } });
}

async function save(): Promise<void> {
	await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
	await waitFor(() =>
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			"Đã lưu.",
		),
	);
}

function costsOf(store: DemoSettingsStore) {
	return store.costs().map((cost) => ({ ...cost }));
}

describe("the Giá vốn tab", () => {
	beforeEach(() => {
		current.sales = {
			status: "ready",
			sales: [],
			canRetry: false,
			retry: () => undefined,
		};
	});

	it("dates a first cost 01/01/2023 for the whole history", async () => {
		const store = new DemoSettingsStore();
		renderTab(store);
		const row = await rowOf("I1");
		expect(within(row).getByTestId("cost-current")).toHaveTextContent(
			"Chưa có giá vốn.",
		);
		expect(dateInput(row)).toHaveValue("2023-01-01");
		expect(dateInput(row)).toHaveAccessibleDescription(
			"Áp dụng cho toàn bộ lịch sử bán.",
		);
		enterCost(row, "12000");
		await save();
		expect(costsOf(store)).toEqual([
			{
				storeId: null,
				itemExternalId: "I1",
				costAmount: 12_000,
				effectiveFrom: "2023-01-01",
			},
		]);
		expect(within(row).getByTestId("cost-current")).toHaveTextContent(
			"Giá vốn hôm nay: 12.000 ₫, từ 01/01/2023 · bằng 30,0% giá bán",
		);
		expect(costInput(row)).toHaveValue("");
		expect(dateInput(row)).toHaveValue(TODAY);
		expect(dateInput(row)).toHaveAccessibleDescription(
			"Từ ngày này trở đi; các ngày trước giữ giá vốn cũ.",
		);
	});

	it("dates a later cost today and keeps the earlier days at the earlier cost", async () => {
		const store = new DemoSettingsStore();
		store.saveCosts([
			{
				storeId: null,
				itemExternalId: "I1",
				costAmount: 12_000,
				effectiveFrom: "2023-01-01",
			},
		]);
		renderTab(store);
		const row = await rowOf("I1");
		expect(dateInput(row)).toHaveValue(TODAY);
		enterCost(row, "15.000");
		await save();
		expect(costsOf(store)).toEqual([
			{
				storeId: null,
				itemExternalId: "I1",
				costAmount: 12_000,
				effectiveFrom: "2023-01-01",
			},
			{
				storeId: null,
				itemExternalId: "I1",
				costAmount: 15_000,
				effectiveFrom: TODAY,
			},
		]);
		expect(within(row).getByTestId("cost-current")).toHaveTextContent(
			`Giá vốn hôm nay: 15.000 ₫, từ ${TODAY_TEXT}`,
		);
		fireEvent.change(dateInput(row), { target: { value: "2023-01-01" } });
		expect(dateInput(row)).toHaveAccessibleDescription(
			"Thay giá vốn đang có từ đúng ngày này.",
		);
	});

	it("shows a store the cost for all stores until its own cost, which wins from its date, and lists only the store's own POS items", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		store.saveCosts([
			{
				storeId: null,
				itemExternalId: "I1",
				costAmount: 10_000,
				effectiveFrom: "2023-01-01",
			},
			{
				storeId: null,
				itemExternalId: "I2",
				costAmount: 8_000,
				effectiveFrom: "2023-01-01",
			},
			{
				storeId: STORE,
				itemExternalId: "I2",
				costAmount: 9_000,
				effectiveFrom: "2024-01-01",
			},
		]);
		renderTab(store);
		expect(await rowOf("I3")).toBeInTheDocument();
		await user.selectOptions(
			screen.getByLabelText("Áp dụng cho"),
			"Cửa hàng một",
		);
		const milkTea = await rowOf("I1");
		expect(within(milkTea).getByTestId("cost-current")).toHaveTextContent(
			"Giá vốn hôm nay: 10.000 ₫, từ 01/01/2023, theo Tất cả cửa hàng",
		);
		expect(dateInput(milkTea)).toHaveValue(TODAY);
		expect(dateInput(milkTea)).toHaveAccessibleDescription(
			"Từ ngày này trở đi; các ngày trước giữ giá vốn chung.",
		);
		expect(within(milkTea).queryByTestId("cost-history-toggle")).toBeNull();
		const flan = await rowOf("I2");
		expect(within(flan).getByTestId("cost-current")).toHaveTextContent(
			"Giá vốn hôm nay: 9.000 ₫, từ 01/01/2024 · bằng 45,0% giá bán",
		);
		expect(within(flan).getByTestId("cost-current")).not.toHaveTextContent(
			"theo Tất cả cửa hàng",
		);
		expect(dateInput(flan)).toHaveValue(TODAY);
		expect(
			screen
				.getAllByTestId("cost-row")
				.map((row) => row.dataset.item)
				.sort(),
		).toEqual(["I1", "I2"]);
		fireEvent.change(dateInput(milkTea), { target: { value: "2023-01-01" } });
		expect(dateInput(milkTea)).toHaveAccessibleDescription(
			"Thay giá vốn chung ở cửa hàng này từ ngày này trở đi, kể cả các ngày đã qua.",
		);
		fireEvent.change(dateInput(flan), { target: { value: "2023-06-01" } });
		expect(dateInput(flan)).toHaveAccessibleDescription(
			"Thay giá vốn chung ở cửa hàng này từ ngày này đến hết 31/12/2023, kể cả các ngày đã qua.",
		);
		fireEvent.change(dateInput(flan), { target: { value: TODAY } });
		enterCost(milkTea, "11000");
		await save();
		expect(costsOf(store)).toContainEqual({
			storeId: STORE,
			itemExternalId: "I1",
			costAmount: 11_000,
			effectiveFrom: "2023-01-01",
		});
		expect(within(milkTea).getByTestId("cost-current")).toHaveTextContent(
			"Giá vốn hôm nay: 11.000 ₫, từ 01/01/2023 · bằng 27,5% giá bán",
		);
	});

	it("keeps an item with unsaved input on the list whatever the search, and counts a changed date as unsaved", async () => {
		const user = userEvent.setup();
		renderTab(new DemoSettingsStore());
		const flan = await rowOf("I2");
		fireEvent.change(dateInput(flan), { target: { value: "2024-02-01" } });
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"1 thay đổi chưa lưu",
		);
		expect(screen.getByLabelText("Áp dụng cho")).toBeDisabled();
		expect(within(flan).getByTestId("settings-field-error")).toHaveTextContent(
			"Ô này không được để trống.",
		);
		enterCost(await rowOf("I1"), "-1");
		await user.type(
			screen.getByRole("searchbox", { name: "Tìm món" }),
			"ca phe",
		);
		expect(
			screen.getAllByTestId("cost-row").map((row) => row.dataset.item),
		).toEqual(["I2", "I3", "I1"]);
		expect(screen.getByTestId("costs-list-status")).toHaveTextContent(
			"Đang hiện 1 trên 1 món",
		);
		expect(screen.getByTestId("costs-unsaved-kept")).toHaveTextContent(
			"Kèm 2 món có thay đổi chưa lưu",
		);
		await user.click(screen.getByRole("button", { name: "Hủy thay đổi" }));
		expect(
			screen.getAllByTestId("cost-row").map((row) => row.dataset.item),
		).toEqual(["I3"]);
		expect(screen.getByLabelText("Áp dụng cho")).toBeEnabled();
	});

	it("says why a delete failed in its own words and retries it after a lost connection", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		store.saveCosts([
			{
				storeId: null,
				itemExternalId: "I2",
				costAmount: 8_000,
				effectiveFrom: "2023-01-01",
			},
		]);
		const demo = createDemoManualSource(store);
		const failures: SettingsWriteError[] = [
			new SettingsWriteError("forbidden"),
			new SettingsWriteError("network"),
		];
		const manual: ManualSettingsSource = {
			...demo,
			deleteItemCost: async (tenantId, id) => {
				const failure = failures.shift();
				if (failure !== undefined) throw failure;
				return demo.deleteItemCost(tenantId, id);
			},
		};
		renderTab(store, { manual });
		const flan = await rowOf("I2");
		await user.click(within(flan).getByTestId("cost-history-toggle"));
		const remove = within(flan).getByRole("button", {
			name: "Xóa giá vốn từ 01/01/2023 của Bánh flan",
		});
		await user.click(remove);
		await waitFor(() =>
			expect(screen.getByTestId("costs-delete-status")).toHaveTextContent(
				"Không xóa được: tài khoản của bạn không có quyền xóa giá vốn này.",
			),
		);
		expect(screen.queryByTestId("costs-delete-retry")).toBeNull();
		await user.click(remove);
		await waitFor(() =>
			expect(screen.getByTestId("costs-delete-status")).toHaveTextContent(
				"Không xóa được vì mất kết nối; kiểm tra mạng rồi thử lại.",
			),
		);
		expect(store.costs()).toHaveLength(1);
		await user.click(screen.getByTestId("costs-delete-retry"));
		await waitFor(() =>
			expect(screen.getByTestId("costs-delete-status")).toHaveTextContent(
				"Đã xóa giá vốn từ 01/01/2023 của Bánh flan.",
			),
		);
		expect(store.costs()).toEqual([]);
	});

	it("waits for the membership before asking for a store-limited manager's 90-day sales", async () => {
		current.salesCalls = [];
		let answer: (membership: Membership) => void = () => undefined;
		const membership = new Promise<Membership>((resolve) => {
			answer = resolve;
		});
		const store = new DemoSettingsStore();
		current.state = {
			status: "ready",
			source: {
				...settingsSource(store, OWNER),
				membership: () => membership,
			},
			manual: createDemoManualSource(store),
		};
		render(
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<QueryClientProvider
					client={
						new QueryClient({ defaultOptions: { queries: { retry: false } } })
					}
				>
					<CostsTab />
				</QueryClientProvider>
			</I18nProvider>,
		);
		expect(await screen.findByText("Đang tải…")).toBeInTheDocument();
		expect(current.salesCalls.every((ids) => ids.length === 0)).toBe(true);
		answer({ role: "manager", storeIds: [STORE] });
		await waitFor(() =>
			expect(screen.getByLabelText("Áp dụng cho")).toHaveValue(STORE),
		);
		expect(
			current.salesCalls
				.filter((ids) => ids.length > 0)
				.map((ids) => ids.join()),
		).not.toContain([STORE, OTHER_STORE].join());
	});

	it("refuses a negative cost, a fraction of a đồng and a date outside the range with their messages, and sends nothing", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		renderTab(store);
		const row = await rowOf("I1");
		await user.type(costInput(row), "-5000");
		expect(within(row).getByTestId("settings-field-error")).toHaveTextContent(
			"Nhập giá trị từ 0 ₫ trở lên.",
		);
		expect(screen.getByRole("button", { name: "Lưu" })).toHaveAttribute(
			"aria-disabled",
			"true",
		);
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			"Sửa các ô đang báo lỗi rồi lưu.",
		);
		await user.clear(costInput(row));
		await user.type(costInput(row), "25000,5");
		expect(within(row).getByTestId("settings-field-error")).toHaveTextContent(
			"Nhập số tiền chẵn đồng, không có phần lẻ.",
		);
		await user.clear(costInput(row));
		await user.type(costInput(row), "25000");
		fireEvent.change(dateInput(row), { target: { value: "2022-12-31" } });
		expect(within(row).getByTestId("settings-field-error")).toHaveTextContent(
			`Chọn ngày từ 01/01/2023 đến ${NEXT_YEAR_END}.`,
		);
		await user.click(screen.getByRole("button", { name: "Lưu" }));
		expect(store.costs()).toEqual([]);
		await user.click(screen.getByRole("button", { name: "Hủy thay đổi" }));
		expect(costInput(row)).toHaveValue("");
		expect(dateInput(row)).toHaveValue("2023-01-01");
	});

	it("lists a cost's history newest first and deletes a row of it", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		store.saveCosts([
			{
				storeId: null,
				itemExternalId: "I1",
				costAmount: 10_000,
				effectiveFrom: "2023-01-01",
			},
			{
				storeId: null,
				itemExternalId: "I1",
				costAmount: 12_000,
				effectiveFrom: "2026-06-01",
			},
		]);
		renderTab(store);
		const row = await rowOf("I1");
		const toggle = within(row).getByRole("button", {
			name: "Lịch sử giá vốn (2)",
		});
		expect(toggle).toHaveAttribute("aria-expanded", "false");
		await user.click(toggle);
		expect(toggle).toHaveAttribute("aria-expanded", "true");
		const history = within(row).getByRole("list", {
			name: `Lịch sử giá vốn của ${MILK_TEA}`,
		});
		const entries = within(history).getAllByTestId("cost-history-row");
		expect(entries.map((entry) => entry.dataset.date)).toEqual([
			"2026-06-01",
			"2023-01-01",
		]);
		expect(entries[0]).toHaveTextContent(
			"Từ 01/06/2026: 12.000 ₫ · đang áp dụng",
		);
		await user.click(
			within(history).getByRole("button", {
				name: `Xóa giá vốn từ 01/06/2026 của ${MILK_TEA}`,
			}),
		);
		await waitFor(() =>
			expect(screen.getByTestId("costs-delete-status")).toHaveTextContent(
				`Đã xóa giá vốn từ 01/06/2026 của ${MILK_TEA}.`,
			),
		);
		expect(costsOf(store)).toEqual([
			{
				storeId: null,
				itemExternalId: "I1",
				costAmount: 10_000,
				effectiveFrom: "2023-01-01",
			},
		]);
		expect(within(row).getByTestId("cost-current")).toHaveTextContent(
			"Giá vốn hôm nay: 10.000 ₫, từ 01/01/2023",
		);
	});

	it("opens a store-limited manager on their store, saves its costs and shows the costs for all stores read-only", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		store.saveCosts([
			{
				storeId: null,
				itemExternalId: "I1",
				costAmount: 10_000,
				effectiveFrom: "2023-01-01",
			},
		]);
		renderTab(store, { membership: { role: "manager", storeIds: [STORE] } });
		await waitFor(() =>
			expect(screen.getByLabelText("Áp dụng cho")).toHaveValue(STORE),
		);
		const row = await rowOf("I1");
		expect(dateInput(row)).toHaveValue(TODAY);
		enterCost(row, "11000");
		await save();
		expect(costsOf(store)).toContainEqual({
			storeId: STORE,
			itemExternalId: "I1",
			costAmount: 11_000,
			effectiveFrom: TODAY,
		});
		await user.selectOptions(screen.getByLabelText("Áp dụng cho"), "all");
		expect(await screen.findByTestId("settings-read-only")).toHaveTextContent(
			"Giá vốn cho tất cả cửa hàng chỉ chủ hoặc quản lý xem được tất cả cửa hàng mới sửa được",
		);
		const shared = await rowOf("I1");
		expect(within(shared).getByTestId("cost-current")).toHaveTextContent(
			"Giá vốn hôm nay: 10.000 ₫, từ 01/01/2023",
		);
		expect(within(shared).queryByLabelText("Giá vốn mới")).toBeNull();
		await user.click(within(shared).getByTestId("cost-history-toggle"));
		expect(within(shared).queryByTestId("cost-delete")).toBeNull();
		expect(screen.queryByTestId("settings-save-bar")).toBeNull();
	});

	it("shows staff every cost read-only with the reason", async () => {
		const store = new DemoSettingsStore();
		renderTab(store, { membership: { role: "staff", storeIds: null } });
		expect(await screen.findByTestId("settings-read-only")).toHaveTextContent(
			"Chỉ chủ và quản lý mới nhập được dữ liệu này",
		);
		const row = await rowOf("I1");
		expect(within(row).queryByLabelText("Giá vốn mới")).toBeNull();
		expect(screen.queryByTestId("settings-save-bar")).toBeNull();
	});

	it("keeps the typed costs after a lost connection and saves them on Thử lại", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		const demo = createDemoManualSource(store);
		let failures = 1;
		const manual: ManualSettingsSource = {
			...demo,
			saveItemCosts: async (tenantId, rows) => {
				if (failures > 0) {
					failures -= 1;
					throw new SettingsWriteError("network");
				}
				return demo.saveItemCosts(tenantId, rows);
			},
		};
		renderTab(store, { manual });
		const row = await rowOf("I2");
		await user.type(costInput(row), "8000");
		await user.click(screen.getByRole("button", { name: "Lưu" }));
		await waitFor(() =>
			expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
				"Không lưu được vì mất kết nối",
			),
		);
		expect(costInput(row)).toHaveValue("8.000");
		await user.click(screen.getByTestId("settings-retry-save"));
		await waitFor(() => expect(costInput(row)).toHaveValue(""));
		expect(costsOf(store)).toEqual([
			{
				storeId: null,
				itemExternalId: "I2",
				costAmount: 8_000,
				effectiveFrom: "2023-01-01",
			},
		]);
	});

	it("puts the 90-day sellers first, waits for them before listing, and falls back to name order when they fail", async () => {
		current.sales = {
			status: "loading",
			sales: [],
			canRetry: false,
			retry: () => undefined,
		};
		const store = new DemoSettingsStore();
		const { rerender } = renderTab(store);
		expect(await screen.findByTestId("costs-sales-loading")).toBeVisible();
		expect(screen.queryByTestId("cost-row")).toBeNull();
		current.sales = {
			status: "ready",
			sales: [sale("I2", 2_000_000), sale("I1", 1_000_000)],
			canRetry: false,
			retry: () => undefined,
		};
		rerender(
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<QueryClientProvider client={new QueryClient()}>
					<CostsTab />
				</QueryClientProvider>
			</I18nProvider>,
		);
		await waitFor(() =>
			expect(
				screen.getAllByTestId("cost-row").map((row) => row.dataset.item),
			).toEqual(["I2", "I1", "I3"]),
		);
		expect(
			within(await rowOf("I2")).getByTestId("cost-facts"),
		).toHaveTextContent(
			"Trà sữa · Giá bán 20.000 ₫ · Doanh thu 90 ngày 2,0 tr ₫",
		);
		expect(screen.getByTestId("costs-list-status")).toHaveTextContent(
			"Đang hiện 3 trên 3 món",
		);
	});

	it("says when the 90-day sales could not be read and offers a retry", async () => {
		const retry = vi.fn();
		current.sales = { status: "failed", sales: [], canRetry: true, retry };
		renderTab(new DemoSettingsStore());
		const alert = await screen.findByTestId("costs-sales-failed");
		expect(alert).toHaveTextContent(
			"Chưa tải được doanh thu 90 ngày nên danh sách đang xếp theo tên.",
		);
		await userEvent.click(
			within(alert).getByRole("button", { name: "Thử lại" }),
		);
		expect(retry).toHaveBeenCalledOnce();
		expect(
			screen.getAllByTestId("cost-row").map((row) => row.dataset.item),
		).toEqual(["I2", "I3", "I1"]);
	});

	it("finds an item without Vietnamese marks", async () => {
		const user = userEvent.setup();
		renderTab(new DemoSettingsStore());
		await rowOf("I1");
		await user.type(screen.getByRole("searchbox", { name: "Tìm món" }), "banh");
		expect(
			screen.getAllByTestId("cost-row").map((row) => row.dataset.item),
		).toEqual(["I2"]);
		await user.clear(screen.getByRole("searchbox", { name: "Tìm món" }));
		await user.type(
			screen.getByRole("searchbox", { name: "Tìm món" }),
			"khong co",
		);
		expect(screen.getByTestId("costs-list-status")).toHaveTextContent(
			"Không có món nào khớp.",
		);
	});
});

describe("defaultCostScope", () => {
	it("opens owners and managers of every store on all stores and a store-limited one on their first store", () => {
		expect(defaultCostScope({ role: "owner", storeIds: null }, STORES)).toBe(
			null,
		);
		expect(
			defaultCostScope({ role: "manager", storeIds: [OTHER_STORE] }, STORES),
		).toBe(OTHER_STORE);
		expect(
			defaultCostScope({ role: "staff", storeIds: [OTHER_STORE] }, STORES),
		).toBe(null);
		expect(defaultCostScope(undefined, STORES)).toBe(null);
	});
});

const CSV_HEADER = "ma_mon,ten_mon,size,ma_cua_hang,gia_von,tu_ngay";

async function importFile(text: string, name = "gia-von.csv"): Promise<void> {
	await screen.findByTestId("costs-import");
	fireEvent.change(screen.getByTestId("costs-import-file"), {
		target: { files: [new File([text], name, { type: "text/csv" })] },
	});
}

async function preview(): Promise<HTMLElement> {
	return screen.findByTestId("cost-import-preview");
}

function importRows(): { line: string; outcome: string }[] {
	return screen.getAllByTestId("cost-import-row").map((row) => ({
		line: row.dataset.line ?? "",
		outcome: row.dataset.outcome ?? "",
	}));
}

function costFile(...rows: readonly string[]): string {
	return [CSV_HEADER, ...rows].join("\r\n");
}

describe("the CSV import of the Giá vốn tab", () => {
	beforeEach(() => {
		vi.mocked(downloadTextFile).mockClear();
		current.sales = {
			status: "ready",
			sales: [],
			canRetry: false,
			retry: () => undefined,
		};
	});

	it("downloads the scope's template in the device's dialect with the BOM and the store code, and re-imports it unchanged as nothing to save", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		store.saveCosts([
			{
				storeId: STORE,
				itemExternalId: "I1",
				costAmount: 12_000,
				effectiveFrom: "2023-01-01",
			},
		]);
		renderTab(store, { dialect: "semicolon" });
		await user.selectOptions(
			await screen.findByLabelText("Áp dụng cho"),
			STORE,
		);
		await rowOf("I1");
		await user.click(screen.getByRole("button", { name: "Tải mẫu" }));
		expect(downloadTextFile).toHaveBeenCalledOnce();
		const [name, content, type] =
			vi.mocked(downloadTextFile).mock.calls[0] ?? [];
		expect(name).toBe(`gia-von-ch1-${TODAY}.csv`);
		expect(type).toBe("text/csv;charset=utf-8");
		expect(content?.split("\r\n")).toEqual([
			`${UTF8_BOM}ma_mon;ten_mon;size;ma_cua_hang;gia_von;tu_ngay`,
			"I2;Bánh flan;;CH1;;",
			"I1;Trà sữa trân châu;M;CH1;12000;2023-01-01",
			"",
		]);
		await importFile(content ?? "");
		const shown = await preview();
		expect(
			within(shown).getByTestId("cost-import-summary-save"),
		).toHaveTextContent("Sẽ lưu: 0 dòng");
		expect(
			within(shown).getByTestId("cost-import-summary-unchanged"),
		).toHaveTextContent("1 dòng");
		expect(
			within(shown).getByTestId("cost-import-summary-blank"),
		).toHaveTextContent("1 dòng");
		expect(within(shown).getByTestId("cost-import-nothing")).toHaveTextContent(
			"Tệp không có giá vốn mới nào để lưu.",
		);
		expect(
			within(shown).getByRole("button", { name: "Lưu 0 dòng" }),
		).toHaveAttribute("aria-disabled", "true");
		expect(screen.getByLabelText("Áp dụng cho")).toBeDisabled();
		await user.click(within(shown).getByRole("button", { name: "Hủy nhập" }));
		expect(screen.queryByTestId("cost-import-preview")).toBeNull();
		expect(screen.getByLabelText("Áp dụng cho")).toBeEnabled();
	});

	it("previews each row with its store, full cost, dd/MM/yyyy date and outcome, then saves the valid rows in one call", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		const demo = createDemoManualSource(store);
		const calls: number[] = [];
		const manual: ManualSettingsSource = {
			...demo,
			saveItemCosts: async (tenantId, rows) => {
				calls.push(rows.length);
				return demo.saveItemCosts(tenantId, rows);
			},
		};
		renderTab(store, { manual });
		await rowOf("I1");
		await importFile(
			costFile(
				"I1,Tra sua,M,,25.000,",
				'I3,Ca phe sua,,ch2,"1.250.000",15/03/2024',
				'I2,,,,"8333,33",2024-01-01',
				"NOPE,,,,1000,2024-01-01",
				"I1,,,ZZ,1000,2024-01-01",
				"I1,,,ch2,1000,2024-01-01",
			),
		);
		const shown = await preview();
		expect(importRows()).toEqual([
			{ line: "2", outcome: "ok" },
			{ line: "3", outcome: "cost_above_price" },
			{ line: "4", outcome: "invalid_cost" },
			{ line: "5", outcome: "unknown_item" },
			{ line: "6", outcome: "unknown_store" },
			{ line: "7", outcome: "unknown_item" },
		]);
		const [first, second, third, fourth, fifth, sixth] =
			within(shown).getAllByTestId("cost-import-row");
		expect(first).toHaveTextContent(
			`Dòng 2 · ${MILK_TEA}Tất cả cửa hàng · 25.000 ₫ · từ 01/01/2023Sẽ lưu.`,
		);
		expect(second).toHaveTextContent(
			"Cửa hàng hai · 1.250.000 ₫ · từ 15/03/2024",
		);
		expect(second).toHaveTextContent(
			"Sẽ lưu; giá vốn cao hơn giá bán 40.000 ₫.",
		);
		expect(third).toHaveTextContent('giá vốn "8333,33"');
		expect(third).toHaveTextContent(
			"Giá vốn tính bằng đồng, không có phần lẻ.",
		);
		expect(fourth).toHaveTextContent("Không có món nào mã NOPE.");
		expect(fifth).toHaveTextContent("Không có cửa hàng nào mã ZZ.");
		expect(sixth).toHaveTextContent(
			"Món mã I1 không có trong danh sách giá vốn của Cửa hàng hai",
		);
		expect(
			within(shown).getByTestId("cost-import-summary-blank-code"),
		).toHaveTextContent(
			"Không ghi mã cửa hàng, nhập cho Tất cả cửa hàng: 3 dòng",
		);
		await user.click(within(shown).getByRole("button", { name: "Lưu 2 dòng" }));
		await waitFor(() =>
			expect(screen.getByTestId("cost-import-saved")).toHaveTextContent(
				"Đã lưu 2 giá vốn từ tệp gia-von.csv.",
			),
		);
		expect(calls).toEqual([2]);
		expect(screen.queryByTestId("cost-import-preview")).toBeNull();
		expect(costsOf(store)).toEqual([
			{
				storeId: null,
				itemExternalId: "I1",
				costAmount: 25_000,
				effectiveFrom: "2023-01-01",
			},
			{
				storeId: OTHER_STORE,
				itemExternalId: "I3",
				costAmount: 1_250_000,
				effectiveFrom: "2024-03-15",
			},
		]);
		expect(
			within(await rowOf("I1")).getByTestId("cost-current"),
		).toHaveTextContent("Giá vốn hôm nay: 25.000 ₫, từ 01/01/2023");
	});

	it("keeps the preview and writes nothing when the database refuses an amount, says so once and offers no retry that would fail again", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		const demo = createDemoManualSource(store);
		const save = vi.fn(async () => {
			throw new SettingsWriteError("invalid", "item_costs_amount_whole_dong");
		});
		renderTab(store, { manual: { ...demo, saveItemCosts: save } });
		await rowOf("I1");
		await importFile(costFile("I1,,,,25000,", "I2,,,,9000,"));
		const shown = await preview();
		const button = within(shown).getByRole("button", { name: "Lưu 2 dòng" });
		await user.click(button);
		const refused = await within(shown).findByTestId("cost-import-refused");
		expect(refused).toHaveTextContent(
			"Không lưu được: có giá vốn không chẵn đồng hoặc nằm ngoài khoảng cho phép.Không dòng nào được lưu; sửa tệp rồi nhập lại.",
		);
		expect(
			(refused.textContent ?? "").toLowerCase().split("không dòng nào được lưu")
				.length,
		).toBe(2);
		expect(button).toHaveAttribute("aria-disabled", "true");
		await user.click(button);
		expect(save).toHaveBeenCalledOnce();
		expect(costsOf(store)).toEqual([]);
		expect(screen.getByTestId("cost-import-preview")).toBeVisible();
	});

	it("keeps the preview after a lost connection and saves on the next try", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		const demo = createDemoManualSource(store);
		let failures = 1;
		const manual: ManualSettingsSource = {
			...demo,
			saveItemCosts: async (tenantId, rows) => {
				if (failures > 0) {
					failures -= 1;
					throw new SettingsWriteError("network");
				}
				return demo.saveItemCosts(tenantId, rows);
			},
		};
		renderTab(store, { manual });
		await rowOf("I1");
		await importFile(costFile("I1,,,,25000,", "I2,,,,9000,"));
		const shown = await preview();
		await user.click(within(shown).getByRole("button", { name: "Lưu 2 dòng" }));
		const refused = await within(shown).findByTestId("cost-import-refused");
		expect(refused).toHaveTextContent(
			"Không dòng nào được lưu; bản xem trước vẫn ở đây để bạn thử lại.",
		);
		expect(costsOf(store)).toEqual([]);
		await user.click(within(shown).getByRole("button", { name: "Lưu 2 dòng" }));
		await waitFor(() =>
			expect(screen.getByTestId("cost-import-saved")).toHaveTextContent(
				"Đã lưu 2 giá vốn",
			),
		);
		expect(costsOf(store)).toHaveLength(2);
		expect(screen.getByTestId("costs-import")).toHaveFocus();
	});

	it("clears the file input once the file is read, so the same file can be chosen again, focuses the preview and returns focus to Nhập từ CSV on cancel", async () => {
		const user = userEvent.setup();
		renderTab(new DemoSettingsStore());
		await rowOf("I1");
		const input = (await screen.findByTestId(
			"costs-import-file",
		)) as HTMLInputElement;
		const file = new File([costFile("I1,,,,1000,")], "gia-von.csv", {
			type: "text/csv",
		});
		await user.upload(input, file);
		await preview();
		expect(input.value).toBe("");
		expect(input.files).toHaveLength(0);
		expect(screen.getByTestId("cost-import-preview-title")).toHaveFocus();
		await user.click(screen.getByRole("button", { name: "Hủy nhập" }));
		expect(screen.queryByTestId("cost-import-preview")).toBeNull();
		expect(screen.getByTestId("costs-import")).toHaveFocus();
		await user.upload(input, file);
		expect(await preview()).toHaveTextContent("Xem trước tệp gia-von.csv");
		expect(input.value).toBe("");
	});

	it("refuses a file of more than 2,000 rows to save before sending anything", async () => {
		const store = new DemoSettingsStore();
		const demo = createDemoManualSource(store);
		const save = vi.fn(demo.saveItemCosts);
		renderTab(store, { manual: { ...demo, saveItemCosts: save } });
		await rowOf("I1");
		const rows = Array.from({ length: 2_001 }, (_, index) => {
			const item = ["I1", "I2", "I3"][Math.floor(index / 1_000)];
			const day = new Date(Date.UTC(2023, 0, 1 + (index % 1_000)))
				.toISOString()
				.slice(0, 10);
			return `${item},,,,1000,${day}`;
		});
		await importFile(costFile(...rows));
		const shown = await preview();
		expect(within(shown).getByTestId("cost-import-too-many")).toHaveTextContent(
			"Tệp có 2.001 dòng cần lưu. Mỗi lần nhập tối đa 2.000 dòng; hãy chia tệp.",
		);
		const button = within(shown).getByRole("button", {
			name: "Lưu 2.001 dòng",
		});
		expect(button).toHaveAttribute("aria-disabled", "true");
		await userEvent.click(button);
		expect(save).not.toHaveBeenCalled();
		expect(within(shown).getAllByTestId("cost-import-row")).toHaveLength(100);
		await userEvent.click(
			within(shown).getByRole("button", { name: "Xem thêm 100 dòng" }),
		);
		expect(within(shown).getAllByTestId("cost-import-row")).toHaveLength(200);
	});

	it("asks for the date order of an ambiguous file and reads its dates again", async () => {
		const user = userEvent.setup();
		renderTab(new DemoSettingsStore());
		await rowOf("I1");
		await importFile(costFile("I1,,,,1000,03/04/2024"));
		const shown = await preview();
		const order = within(shown).getByRole("group", { name: "Thứ tự ngày" });
		expect(within(order).getByLabelText("Ngày/Tháng/Năm")).toBeChecked();
		expect(
			within(shown).getByTestId("cost-import-row-values"),
		).toHaveTextContent("từ 03/04/2024");
		await user.click(within(order).getByLabelText("Tháng/Ngày/Năm"));
		expect(
			within(shown).getByTestId("cost-import-row-values"),
		).toHaveTextContent("từ 04/03/2024");
	});

	it("says why a file cannot be read", async () => {
		renderTab(new DemoSettingsStore());
		await rowOf("I1");
		await importFile("ten_mon,gia_von\r\nTrà,1000");
		expect(await screen.findByTestId("cost-import-problem")).toHaveTextContent(
			'Tệp thiếu cột ma_mon; hãy bắt đầu từ tệp tải bằng "Tải mẫu".',
		);
		expect(screen.getByLabelText("Áp dụng cho")).toBeEnabled();
	});

	it("lets staff download the template but not import", async () => {
		renderTab(new DemoSettingsStore(), {
			membership: { role: "staff", storeIds: null },
		});
		await rowOf("I1");
		expect(screen.getByRole("button", { name: "Tải mẫu" })).toBeVisible();
		expect(screen.queryByTestId("costs-import")).toBeNull();
	});

	it("marks a row of a store outside a store-limited manager's scope", async () => {
		const user = userEvent.setup();
		renderTab(new DemoSettingsStore(), {
			membership: { role: "manager", storeIds: [STORE] },
		});
		await waitFor(() =>
			expect(screen.getByLabelText("Áp dụng cho")).toHaveValue(STORE),
		);
		await rowOf("I1");
		await importFile(costFile("I1,,,CH2,1000,2024-01-01", "I1,,,,1000,"));
		const shown = await preview();
		expect(importRows()).toEqual([
			{ line: "2", outcome: "out_of_scope" },
			{ line: "3", outcome: "ok" },
		]);
		expect(
			within(shown).getAllByTestId("cost-import-row-outcome")[0],
		).toHaveTextContent("Bạn không được nhập giá vốn cho Cửa hàng hai.");
		await user.click(within(shown).getByRole("button", { name: "Lưu 1 dòng" }));
		await screen.findByTestId("cost-import-saved");
	});
});
