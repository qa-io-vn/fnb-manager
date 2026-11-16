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
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { createDemoSettingsSource } from "../demo-settings-source";
import { type Membership, SettingsWriteError } from "../source";
import {
	issueOf,
	TARGET_MAX,
	TARGET_MIN,
	targetAmount,
	WHOLE_MONEY_MAX,
} from "../validation";
import { createDemoManualSource } from "./demo-manual-source";
import type { ManualSettingsSource, TargetRow } from "./source";
import {
	defaultTargetStore,
	monthReportPath,
	readTargetEdits,
	targetMonthsOf,
	withSavedTargets,
} from "./targets";
import { TargetsTab } from "./targets-tab";
import type { MonthPace } from "./use-month-pace";

const NOW = new Date("2026-11-04T05:30:00.000Z");
const TIME_ZONE = "Asia/Ho_Chi_Minh";
const STORE = "MOCK-S1";
const OTHER_STORE = "MOCK-S2";
const NOVEMBER = "2026-11-01";
const AMOUNT_LABEL = /^Mục tiêu doanh thu thuần cho tháng \d{2}\/\d{4}$/;
const WINDOW = [
	"2026-08-01",
	"2026-09-01",
	"2026-10-01",
	NOVEMBER,
	"2026-12-01",
	"2027-01-01",
];

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
		posAccountId: "ACC-1",
	},
	{
		id: OTHER_STORE,
		tenantId: TENANT.id,
		name: "Cửa hàng hai",
		code: null,
		timeZone: TIME_ZONE,
		businessDayStartMinutes: 0,
		posAccountId: "ACC-1",
	},
];

function paceRow(fields: Partial<NonNullable<MonthPace["row"]>> = {}) {
	return {
		period_start: NOVEMBER,
		as_of_date: "2026-11-03",
		elapsed_days: 3,
		remaining_days: 27,
		month_to_date_net_amount: 12_000_000,
		month_to_date_invoices: 300,
		forecast_weekday_profile_net_amount: 120_000_000,
		forecast_seasonal_naive_net_amount: 110_000_000,
		target_net_amount: null,
		...fields,
	};
}

const current = vi.hoisted(() => ({
	state: { status: "loading" } as unknown,
	pace: {
		status: "ready",
		row: null,
		canRetry: false,
		retry: () => undefined,
	} as {
		status: string;
		row: unknown;
		canRetry: boolean;
		retry: () => void;
	},
	paceCalls: [] as [string | null, string][],
	catchUpStarts: 0,
}));

vi.mock("../../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({ tenant: TENANT, stores: STORES }),
}));

vi.mock("../settings-source-context", () => ({
	useSettingsSourceState: () => current.state,
	useRetrySettingsSource: () => () => undefined,
}));

vi.mock("./use-month-pace", () => ({
	useMonthPace: (storeId: string | null, monthStart: string) => {
		current.paceCalls.push([storeId, monthStart]);
		return current.pace;
	},
}));

vi.mock("../catch-up/catch-up-context", () => ({
	useCatchUpRunner: () => ({
		running: false,
		problem: null,
		completed: false,
		start: () => {
			current.catchUpStarts += 1;
		},
		abort: () => undefined,
		dismiss: () => undefined,
	}),
}));

const OWNER: Membership = { role: "owner", storeIds: null };

function renderTab(
	store: DemoSettingsStore,
	{
		membership = OWNER,
		manual = createDemoManualSource(store),
	}: { membership?: Membership; manual?: ManualSettingsSource } = {},
) {
	current.state = {
		status: "ready",
		source: {
			...createDemoSettingsSource(store),
			membership: async () => membership,
		},
		manual,
	};
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<MemoryRouter>
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<QueryClientProvider client={client}>
					<TargetsTab />
				</QueryClientProvider>
			</I18nProvider>
		</MemoryRouter>,
	);
}

function emptyStore(): DemoSettingsStore {
	const store = new DemoSettingsStore();
	store.saveTargets([]);
	return store;
}

async function monthRow(monthStart: string): Promise<HTMLElement> {
	return waitFor(() => {
		const row = screen
			.getAllByTestId("target-month")
			.find((candidate) => candidate.dataset.month === monthStart);
		if (row === undefined) throw new Error(`no row for ${monthStart}`);
		return row;
	});
}

function amountInput(row: HTMLElement): HTMLElement {
	return within(row).getByLabelText(AMOUNT_LABEL);
}

function enterAmount(row: HTMLElement, text: string): void {
	fireEvent.change(amountInput(row), { target: { value: text } });
}

async function save(): Promise<void> {
	await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
	await waitFor(() =>
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			"Đã lưu.",
		),
	);
}

function targetsOf(store: DemoSettingsStore) {
	return store.targets().map((target) => ({ ...target }));
}

describe("the Mục tiêu tab", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"], now: NOW });
		current.pace = {
			status: "ready",
			row: paceRow(),
			canRetry: false,
			retry: () => undefined,
		};
		current.paceCalls = [];
		current.catchUpStarts = 0;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("lists the months from three back to two ahead, the current month marked, for the first store", async () => {
		renderTab(emptyStore());
		await monthRow(NOVEMBER);
		expect(
			screen.getAllByTestId("target-month").map((row) => row.dataset.month),
		).toEqual(WINDOW);
		expect(
			screen
				.getAllByTestId("target-month-label")
				.map((label) => label.textContent),
		).toEqual([
			"Tháng 08/2026",
			"Tháng 09/2026",
			"Tháng 10/2026",
			"Tháng 11/2026 · tháng này",
			"Tháng 12/2026",
			"Tháng 01/2027",
		]);
		expect((await monthRow(NOVEMBER)).dataset.current).toBe("true");
		expect(screen.getByLabelText("Cửa hàng")).toHaveValue(STORE);
		expect(current.paceCalls.at(-1)).toEqual([STORE, NOVEMBER]);
		for (const month of WINDOW) {
			expect(
				within(await monthRow(month)).getByTestId("target-saved"),
			).toHaveTextContent("Chưa đặt mục tiêu.");
		}
	});

	it("saves a monthly target for the chosen store, upserted on store, period kind and start, and shows it with its audit line", async () => {
		const user = userEvent.setup({ delay: null });
		const store = emptyStore();
		renderTab(store);
		await monthRow(NOVEMBER);
		await user.selectOptions(screen.getByLabelText("Cửa hàng"), OTHER_STORE);
		const november = await monthRow(NOVEMBER);
		enterAmount(november, "150000000");
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"1 thay đổi chưa lưu",
		);
		expect(screen.getByLabelText("Cửa hàng")).toBeDisabled();
		await save();
		expect(targetsOf(store)).toEqual([
			{
				storeId: OTHER_STORE,
				periodKind: "month",
				periodStart: NOVEMBER,
				netTargetAmount: 150_000_000,
			},
		]);
		const saved = await monthRow(NOVEMBER);
		expect(within(saved).getByTestId("target-saved")).toHaveTextContent(
			"Mục tiêu: 150.000.000 ₫",
		);
		expect(within(saved).getByTestId("settings-audit-line")).toHaveTextContent(
			"Bạn sửa lần cuối",
		);
		expect(amountInput(saved)).toHaveValue("150.000.000");
		expect(amountInput(saved)).toHaveAccessibleDescription(
			"₫ Mục tiêu đã lưu không xóa được; nhập mức mới để thay.",
		);
		expect(screen.getByLabelText("Cửa hàng")).toBeEnabled();
		expect(current.catchUpStarts).toBe(0);
		enterAmount(saved, "150.000.000");
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"Chưa có thay đổi",
		);
	});

	it("refuses zero, a fraction of a đồng, an amount above the limit and an emptied target before anything is sent", async () => {
		const store = emptyStore();
		store.saveTargets([
			{
				storeId: STORE,
				periodKind: "month",
				periodStart: "2026-10-01",
				netTargetAmount: 90_000_000,
			},
		]);
		const saveTargets = vi.fn();
		renderTab(store, {
			manual: { ...createDemoManualSource(store), saveTargets },
		});
		const november = await monthRow(NOVEMBER);
		const error = () => within(november).getByTestId("settings-field-error");
		enterAmount(november, "0");
		expect(error()).toHaveTextContent("Nhập giá trị từ 1 ₫ trở lên.");
		enterAmount(november, "1500000,5");
		expect(error()).toHaveTextContent(
			"Nhập số tiền chẵn đồng, không có phần lẻ.",
		);
		enterAmount(november, "1000000000000");
		expect(error()).toHaveTextContent(
			"Nhập giá trị không quá 999.999.999.999 ₫.",
		);
		enterAmount(november, "");
		const october = await monthRow("2026-10-01");
		enterAmount(october, "");
		expect(
			within(october).getByTestId("settings-field-error"),
		).toHaveTextContent("Ô này không được để trống.");
		expect(screen.getByTestId("settings-save")).toHaveAttribute(
			"aria-disabled",
			"true",
		);
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			"Sửa các ô đang báo lỗi rồi lưu.",
		);
		fireEvent.click(screen.getByTestId("settings-save"));
		expect(saveTargets).not.toHaveBeenCalled();
		await userEvent.click(screen.getByTestId("settings-cancel"));
		expect(amountInput(october)).toHaveValue("90.000.000");
	});

	it("shows the current month's net so far and both forecasts against the saved target, and links to Tháng for that month and store", async () => {
		const store = emptyStore();
		store.saveTargets([
			{
				storeId: STORE,
				periodKind: "month",
				periodStart: NOVEMBER,
				netTargetAmount: 100_000_000,
			},
		]);
		renderTab(store);
		const november = await monthRow(NOVEMBER);
		const pace = within(november).getByTestId("target-pace");
		expect(pace).toHaveAttribute("data-status", "ready");
		expect(pace).toHaveTextContent("Doanh thu thuần đến hết 03/11/2026");
		expect(within(pace).getByTestId("target-pace-net")).toHaveTextContent(
			"12.000.000 ₫ · 12,0% mục tiêu",
		);
		expect(within(pace).getByTestId("target-pace-profile")).toHaveTextContent(
			"120.000.000 ₫ · 120,0% mục tiêu",
		);
		expect(within(pace).getByTestId("target-pace-naive")).toHaveTextContent(
			"110.000.000 ₫ · 110,0% mục tiêu",
		);
		expect(
			within(pace).getByRole("link", {
				name: "Xem tiến độ trong Báo cáo tháng",
			}),
		).toHaveAttribute("href", `/bao-cao/thang?month=2026-11&store=${STORE}`);
		for (const month of WINDOW.filter((month) => month !== NOVEMBER)) {
			expect(
				within(await monthRow(month)).queryByTestId("target-pace"),
			).toBeNull();
		}
	});

	it("says when no day of the month has closed or a forecast lacks data, while it loads, and when it failed with a retry", async () => {
		const retry = vi.fn();
		current.pace = {
			status: "ready",
			row: paceRow({
				elapsed_days: 0,
				month_to_date_net_amount: 0,
				forecast_seasonal_naive_net_amount: null,
			}),
			canRetry: false,
			retry,
		};
		const { rerender } = renderTab(emptyStore());
		const pace = within(await monthRow(NOVEMBER)).getByTestId("target-pace");
		expect(within(pace).getByTestId("target-pace-net")).toHaveTextContent(
			"chưa có ngày nào khép lại",
		);
		expect(within(pace).getByTestId("target-pace-profile")).toHaveTextContent(
			"120.000.000 ₫",
		);
		expect(within(pace).getByTestId("target-pace-naive")).toHaveTextContent(
			"chưa đủ dữ liệu để dự báo",
		);
		current.pace = { status: "loading", row: null, canRetry: false, retry };
		rerender(
			<MemoryRouter>
				<I18nProvider language="vi" onLanguageChange={() => undefined}>
					<QueryClientProvider client={new QueryClient()}>
						<TargetsTab />
					</QueryClientProvider>
				</I18nProvider>
			</MemoryRouter>,
		);
		const loading = within(await monthRow(NOVEMBER)).getByTestId("target-pace");
		expect(loading).toHaveTextContent("Đang tải doanh thu tháng này…");
		current.pace = { status: "failed", row: null, canRetry: true, retry };
		rerender(
			<MemoryRouter>
				<I18nProvider language="vi" onLanguageChange={() => undefined}>
					<QueryClientProvider client={new QueryClient()}>
						<TargetsTab />
					</QueryClientProvider>
				</I18nProvider>
			</MemoryRouter>,
		);
		const failed = within(await monthRow(NOVEMBER)).getByTestId("target-pace");
		expect(failed).toHaveTextContent("Chưa tải được doanh thu tháng này.");
		await userEvent.click(
			within(failed).getByRole("button", { name: "Thử lại" }),
		);
		expect(retry).toHaveBeenCalledTimes(1);
	});

	it("opens a store-limited manager on their own store, with a field for every month", async () => {
		renderTab(emptyStore(), {
			membership: { role: "manager", storeIds: [OTHER_STORE] },
		});
		await monthRow(NOVEMBER);
		await waitFor(() =>
			expect(screen.getByLabelText("Cửa hàng")).toHaveValue(OTHER_STORE),
		);
		expect(screen.getAllByLabelText(AMOUNT_LABEL)).toHaveLength(6);
		expect(current.paceCalls.at(-1)).toEqual([OTHER_STORE, NOVEMBER]);
	});

	it("shows staff every target with a note and no field or save bar", async () => {
		const store = emptyStore();
		store.saveTargets([
			{
				storeId: STORE,
				periodKind: "month",
				periodStart: NOVEMBER,
				netTargetAmount: 80_000_000,
			},
		]);
		renderTab(store, { membership: { role: "staff", storeIds: null } });
		await waitFor(() =>
			expect(screen.getByTestId("settings-read-only")).toHaveTextContent(
				"Chỉ chủ và quản lý mới đặt được mục tiêu",
			),
		);
		expect(
			within(await monthRow(NOVEMBER)).getByTestId("target-saved"),
		).toHaveTextContent("Mục tiêu: 80.000.000 ₫");
		expect(screen.queryByLabelText(AMOUNT_LABEL)).toBeNull();
		expect(screen.queryByTestId("settings-save-bar")).toBeNull();
	});

	it("names each amount field after its month and words the database's whole-đồng refusal", async () => {
		const store = emptyStore();
		const saveTargets = vi.fn(() =>
			Promise.reject(
				new SettingsWriteError("invalid", "targets_amount_whole_dong"),
			),
		);
		renderTab(store, {
			manual: { ...createDemoManualSource(store), saveTargets },
		});
		const december = await monthRow("2026-12-01");
		expect(
			within(december).getByRole("textbox", {
				name: "Mục tiêu doanh thu thuần cho tháng 12/2026",
			}),
		).toBeInTheDocument();
		enterAmount(december, "5000000");
		await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
		await waitFor(() =>
			expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
				"Không lưu được: mục tiêu phải là số đồng chẵn, từ 1 ₫ trở lên.",
			),
		);
		expect(screen.queryByTestId("settings-retry-save")).toBeNull();
	});

	it("keeps the typed amounts after a lost connection and sends them again on Thử lại", async () => {
		const store = emptyStore();
		const demo = createDemoManualSource(store);
		let fail = true;
		const saveTargets = vi.fn(
			(tenantId: string, rows: Parameters<typeof demo.saveTargets>[1]) => {
				if (fail) {
					fail = false;
					return Promise.reject(new SettingsWriteError("network"));
				}
				return demo.saveTargets(tenantId, rows);
			},
		);
		renderTab(store, { manual: { ...demo, saveTargets } });
		const december = await monthRow("2026-12-01");
		enterAmount(december, "200000000");
		await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
		const retry = await screen.findByTestId("settings-retry-save");
		expect(amountInput(december)).toHaveValue("200000000");
		await userEvent.click(retry);
		await waitFor(() =>
			expect(within(december).getByTestId("target-saved")).toHaveTextContent(
				"Mục tiêu: 200.000.000 ₫",
			),
		);
		expect(saveTargets).toHaveBeenCalledTimes(2);
		expect(saveTargets.mock.calls[1]?.[1]).toEqual([
			{
				storeId: STORE,
				periodKind: "month",
				periodStart: "2026-12-01",
				netTargetAmount: 200_000_000,
			},
		]);
	});
});

describe("the targets helpers", () => {
	it("spans three months back to two months ahead of today's month", () => {
		expect(targetMonthsOf("2026-11-04")).toEqual(WINDOW);
		expect(targetMonthsOf("2026-01-31")).toEqual([
			"2025-10-01",
			"2025-11-01",
			"2025-12-01",
			"2026-01-01",
			"2026-02-01",
			"2026-03-01",
		]);
	});

	it("opens a store-limited owner or manager on their first store and everyone else on the first store", () => {
		expect(defaultTargetStore(OWNER, STORES)).toBe(STORE);
		expect(
			defaultTargetStore({ role: "manager", storeIds: [OTHER_STORE] }, STORES),
		).toBe(OTHER_STORE);
		expect(
			defaultTargetStore({ role: "staff", storeIds: [OTHER_STORE] }, STORES),
		).toBe(STORE);
		expect(defaultTargetStore(undefined, [])).toBeNull();
	});

	it("reads only changed months, refuses an emptied saved target and links the month report", () => {
		const rows: TargetRow[] = [
			{
				id: "t1",
				storeId: STORE,
				periodKind: "month",
				periodStart: NOVEMBER,
				netTargetAmount: 100,
				audit: null,
			},
		];
		const readAmount = (text: string) => ({
			value: Number(text),
			issue: null,
		});
		const reading = readTargetEdits(
			{ [NOVEMBER]: "100", "2026-12-01": "200", "2027-01-01": "" },
			{ storeId: STORE, rows, readAmount },
		);
		expect(reading.changes).toEqual([
			{
				storeId: STORE,
				periodKind: "month",
				periodStart: "2026-12-01",
				netTargetAmount: 200,
			},
		]);
		expect(reading.pendingCount).toBe(1);
		const emptied = readTargetEdits(
			{ [NOVEMBER]: " " },
			{ storeId: STORE, rows, readAmount },
		);
		expect(emptied.issues.get(NOVEMBER)).toEqual({ key: "required" });
		expect(emptied.invalid).toBe(true);
		expect(monthReportPath("2026-12-01", OTHER_STORE)).toBe(
			`/bao-cao/thang?month=2026-12&store=${OTHER_STORE}`,
		);
		const updated = { ...rows[0], netTargetAmount: 150 } as TargetRow;
		expect(withSavedTargets(rows, [updated])).toEqual([updated]);
		expect(withSavedTargets(undefined, [updated])).toBeUndefined();
	});

	it("has the demo refuse what targets_amount_whole_dong refuses, under that name", async () => {
		const manual = createDemoManualSource(emptyStore());
		const target = {
			storeId: STORE,
			periodKind: "month" as const,
			periodStart: NOVEMBER,
			netTargetAmount: 1,
		};
		await expect(manual.saveTargets(TENANT.id, [target])).resolves.toHaveLength(
			1,
		);
		for (const netTargetAmount of [0, 1_500_000.5]) {
			await expect(
				manual.saveTargets(TENANT.id, [{ ...target, netTargetAmount }]),
			).rejects.toMatchObject({
				code: "invalid",
				constraint: "targets_amount_whole_dong",
			});
		}
	});

	it("checks a target from 1 to the largest whole amount the column holds", () => {
		const schema = targetAmount(0);
		expect(TARGET_MIN).toBe(1);
		expect(TARGET_MAX).toBe(WHOLE_MONEY_MAX);
		expect(issueOf(schema, 1)).toBeNull();
		expect(issueOf(schema, TARGET_MAX)).toBeNull();
		expect(issueOf(schema, 0)).toEqual({ key: "atLeast", min: 1 });
		expect(issueOf(schema, TARGET_MAX + 1)).toEqual({
			key: "atMost",
			max: TARGET_MAX,
		});
		expect(issueOf(schema, 1.5)).toEqual({ key: "wholeMoney" });
	});
});
