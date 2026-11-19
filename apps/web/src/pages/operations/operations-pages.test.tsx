import { DemoSettingsStore, demoStoreIds } from "@fnb/demo-analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type {
	CashCountRow,
	ChecklistRun,
	ChecklistTemplate,
	IncidentRow,
} from "../../operations/source";
import {
	createFakeOperations,
	type FakeOperations,
} from "../../operations/testing/fake-operations-source";
import { createDemoSettingsSource } from "../../settings/demo-settings-source";
import type { Membership, SettingsSource } from "../../settings/source";
import { createDemoStaffSource } from "../../settings/staff/demo-staff-source";
import { CashCountsPage } from "./cash-counts-page";
import { ChecklistCompliancePage } from "./checklist-compliance-page";
import { IncidentLogPage } from "./incident-log-page";

const TENANT = {
	id: "33333333-3333-4333-8333-333333333333",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: "Asia/Ho_Chi_Minh",
	countryCode: "VN",
};

const [STORE_1 = "", STORE_2 = ""] = demoStoreIds();

const STORES = [
	{
		id: STORE_1,
		tenantId: TENANT.id,
		name: "Cửa hàng mẫu 1",
		code: null,
		timeZone: "Asia/Ho_Chi_Minh",
		businessDayStartMinutes: 0,
		posAccountId: "account",
	},
	{
		id: STORE_2,
		tenantId: TENANT.id,
		name: "Cửa hàng mẫu 2",
		code: null,
		timeZone: "Asia/Ho_Chi_Minh",
		businessDayStartMinutes: 0,
		posAccountId: "account",
	},
];

const NOW = new Date("2026-11-18T05:00:00Z");
const DAY = "2026-11-17";

const current = vi.hoisted(() => ({
	state: { status: "loading" } as unknown,
	selected: [] as unknown[],
	selectStores: (() => undefined) as (ids: string[] | null) => void,
}));

vi.mock("../../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({
		tenant: TENANT,
		stores: STORES,
		selectedStores: current.selected,
		allStoresSelected: current.selected.length === STORES.length,
		selectStores: (storeIds: string[] | null) => current.selectStores(storeIds),
	}),
}));

vi.mock("../../settings/settings-source-context", () => ({
	useSettingsSourceState: () => current.state,
	useRetrySettingsSource: () => () => undefined,
}));

function template(
	id: string,
	phase: ChecklistTemplate["phase"],
	title: string,
): ChecklistTemplate {
	return {
		id,
		storeId: STORE_1,
		phase,
		title,
		active: true,
		version: 2,
		items: [],
		createdAt: "2026-11-01T00:00:00Z",
		audit: null,
	};
}

function run(
	id: string,
	templateId: string,
	phase: ChecklistRun["phase"],
	title: string,
	finishedAt: string,
): ChecklistRun {
	return {
		id,
		storeId: STORE_1,
		templateId,
		templateVersion: 1,
		title,
		phase,
		businessDate: DAY,
		status: "finished",
		startedAt: finishedAt,
		finishedAt,
		startedBy: "staff-1",
		itemsTotal: 2,
		itemsDone: 2,
		photos: 1,
		photosRemoved: 0,
		corrections: 0,
	};
}

function cash(
	shiftNumber: number,
	overrides: Partial<CashCountRow> = {},
): CashCountRow {
	return {
		storeId: STORE_1,
		businessDate: DAY,
		shiftId: `shift-${shiftNumber}`,
		shiftNumber,
		openedAt: "2026-11-17T00:00:00Z",
		closedAt: "2026-11-17T05:00:00Z",
		cashCountId: `count-${shiftNumber}`,
		countedAmount: 2_000_000,
		countedBy: "staff-1",
		countedAt: "2026-11-17T05:05:00Z",
		recounts: 0,
		expectedCashAmount: 2_000_000,
		drawerAmount: 2_000_000,
		cashSalesAmount: 1_500_000,
		varianceAmount: 0,
		drawerVarianceAmount: 0,
		overAbs: false,
		overRel: false,
		overZ: false,
		state: "within",
		...overrides,
	};
}

function incident(
	id: string,
	overrides: Partial<IncidentRow> = {},
): IncidentRow {
	return {
		id,
		storeId: STORE_1,
		businessDate: DAY,
		occurredAt: "2026-11-17T03:00:00Z",
		kind: "incident",
		categoryKey: "thiet_bi",
		description: "Máy xay kêu to",
		itemLabel: null,
		photoBucket: "ops-brand-1",
		photoPaths: ["t/s/incident/i/1.jpg"],
		photosRemoved: false,
		status: "open",
		reportedBy: "staff-1",
		acknowledgedBy: null,
		acknowledgedAt: null,
		resolvedBy: null,
		resolvedAt: null,
		...overrides,
	};
}

function dayOperations(): FakeOperations {
	return createFakeOperations({
		templates: [
			template("open", "opening", "Mở ca"),
			template("mid", "midshift", "Giữa ca"),
			template("close", "closing", "Đóng ca"),
		],
		runs: [
			run("run-open", "open", "opening", "Mở ca", "2026-11-16T23:40:00Z"),
			run("run-mid", "mid", "midshift", "Giữa ca", "2026-11-17T09:00:00Z"),
		],
		details: new Map([
			[
				"run-open",
				{
					runId: "run-open",
					storeId: STORE_1,
					title: "Mở ca",
					phase: "opening",
					businessDate: DAY,
					templateVersion: 1,
					status: "finished",
					startedBy: "staff-1",
					startedAt: "2026-11-16T23:30:00Z",
					finishedAt: "2026-11-16T23:40:00Z",
					photoBucket: "ops-brand-1",
					items: [
						{
							answerId: "a1",
							position: 1,
							label: "Lau quầy (câu chữ phiên bản 1)",
							requiresPhoto: true,
							numberUnit: null,
							done: true,
							numberValue: null,
							photoPath: "t/s/run/run-open/1.jpg",
							photoRemoved: false,
							answeredBy: "staff-1",
							answeredAt: "2026-11-16T23:35:00Z",
						},
						{
							answerId: "a2",
							position: 2,
							label: "Nhiệt độ tủ mát",
							requiresPhoto: false,
							numberUnit: "°C",
							done: true,
							numberValue: 4.5,
							photoPath: null,
							photoRemoved: false,
							answeredBy: "staff-1",
							answeredAt: "2026-11-16T23:36:00Z",
						},
					],
					corrections: [
						{
							id: "c1",
							answerId: "a2",
							before: { done: true, numberValue: 9, photoPath: null },
							after: { done: true, numberValue: 4.5, photoPath: null },
							by: "owner-1",
							at: "2026-11-17T01:00:00Z",
						},
					],
				},
			],
		]),
		cash: [
			cash(1),
			cash(2, {
				countedAmount: 1_900_000,
				varianceAmount: -100_000,
				overAbs: true,
				state: "over",
			}),
			cash(3, {
				cashCountId: null,
				countedAmount: null,
				countedBy: null,
				countedAt: null,
				recounts: null,
				varianceAmount: null,
				state: "no_count",
			}),
		],
		incidents: [
			incident("i-open"),
			incident("i-stock", {
				kind: "stock_out",
				categoryKey: "khac",
				description: "Hết trân châu",
				itemLabel: "Trân châu đen",
				photoPaths: [],
				occurredAt: "2026-11-17T06:00:00Z",
			}),
		],
		handovers: [
			{
				id: "h1",
				storeId: STORE_1,
				businessDate: DAY,
				fromShift: 1,
				toShift: 2,
				note: "Máy xay đã báo thợ",
				writtenBy: "staff-1",
				writtenAt: "2026-11-17T05:00:00Z",
				acknowledgedBy: null,
				acknowledgedAt: null,
			},
		],
		actors: {
			currentUserId: "owner-1",
			byId: new Map([
				["owner-1", { name: null, role: "owner" }],
				["staff-1", { name: "Nhân viên 1", role: "staff" }],
			]),
		},
	});
}

function LocationProbe() {
	const location = useLocation();
	return <p data-testid="probe">{`${location.pathname}${location.search}`}</p>;
}

function renderPage(
	page: ReactElement,
	path: string,
	{
		membership = { role: "owner", storeIds: null } as Membership,
		operations = dayOperations() as FakeOperations | null,
		entry = `${path}?from=${DAY}&to=${DAY}`,
	}: {
		readonly membership?: Membership;
		readonly operations?: FakeOperations | null;
		readonly entry?: string;
	} = {},
) {
	const store = new DemoSettingsStore();
	const source: SettingsSource = {
		...createDemoSettingsSource(store),
		membership: async () => membership,
	};
	current.state = {
		status: "ready",
		source,
		staff: createDemoStaffSource(store),
		operations,
	};
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<MemoryRouter initialEntries={[entry]}>
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<QueryClientProvider client={client}>
					<Routes>
						<Route path={path} element={page} />
					</Routes>
					<LocationProbe />
				</QueryClientProvider>
			</I18nProvider>
		</MemoryRouter>,
	);
	return operations;
}

async function settledCard(testId: string): Promise<HTMLElement> {
	await waitFor(() =>
		expect(screen.getByTestId(testId)).not.toHaveAttribute("data-state"),
	);
	return screen.getByTestId(testId);
}

function rowCells(row: HTMLElement): string[] {
	return within(row)
		.getAllByRole("cell")
		.map((cell) => cell.textContent ?? "");
}

describe("the operations pages", () => {
	beforeEach(() => {
		vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
		current.selected = [STORES[0]];
		current.selectStores = vi.fn();
		URL.createObjectURL = vi.fn(() => "blob:fnb-photo");
		URL.revokeObjectURL = vi.fn();
		Element.prototype.scrollIntoView = () => undefined;
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it.each([
		[<ChecklistCompliancePage key="c" />, "/van-hanh/checklist"],
		[<CashCountsPage key="k" />, "/van-hanh/ket-tien"],
		[<IncidentLogPage key="s" />, "/van-hanh/su-co"],
	])(
		"shows the plain state in the demo, which has no staff app (%#)",
		async (page, path) => {
			renderPage(page, path, { operations: null });
			expect(await screen.findByTestId("operations-demo")).toHaveTextContent(
				"Bản demo không có ứng dụng nhân viên",
			);
			expect(screen.queryByTestId("report-cards")).toBeNull();
			expect(screen.queryByTestId("range-picker")).toBeNull();
		},
	);

	it.each([
		["staff", null],
		["viewer", null],
		["publisher", [STORE_1]],
	] as const)("gives %s the reason and no figures", async (role, storeIds) => {
		renderPage(<CashCountsPage />, "/van-hanh/ket-tien", {
			membership: { role, storeIds: storeIds === null ? null : [...storeIds] },
		});
		await waitFor(() =>
			expect(screen.getByTestId("operations-read-only")).toHaveTextContent(
				"Trang Vận hành chỉ dành cho chủ và quản lý.",
			),
		);
		expect(screen.queryByTestId("operations-cash-card")).toBeNull();
	});

	it("takes the stores a link carries once, even while the selection's setter changes, and drops them from the address", async () => {
		renderPage(<CashCountsPage />, "/van-hanh/ket-tien", {
			entry: `/van-hanh/ket-tien?from=${DAY}&to=${DAY}&store=${STORE_2}`,
		});
		await waitFor(() =>
			expect(screen.getByTestId("probe")).toHaveTextContent(
				`/van-hanh/ket-tien?from=${DAY}&to=${DAY}`,
			),
		);
		expect(screen.getByTestId("probe")).not.toHaveTextContent("store=");
		expect(current.selectStores).toHaveBeenCalledTimes(1);
		expect(current.selectStores).toHaveBeenCalledWith([STORE_2]);
	});

	it("links the three pages with the range kept and marks the open one", async () => {
		renderPage(<CashCountsPage />, "/van-hanh/ket-tien");
		const tabs = within(
			await screen.findByTestId("operations-tabs"),
		).getAllByRole("link");
		expect(tabs.map((tab) => tab.textContent)).toEqual([
			"Checklist",
			"Két tiền",
			"Sự cố & bàn giao",
		]);
		expect(tabs[1]).toHaveAttribute("aria-current", "page");
		expect(tabs[0]).toHaveAttribute(
			"href",
			`/van-hanh/checklist?from=${DAY}&to=${DAY}`,
		);
	});

	it("shows one day at one store across three shifts: done, late and missed, with each run's wording and photo on demand", async () => {
		const user = userEvent.setup();
		const operations = renderPage(
			<ChecklistCompliancePage />,
			"/van-hanh/checklist",
		);
		const card = await settledCard("operations-checklist-card");
		await waitFor(() =>
			expect(within(card).getByTestId("sentence")).toHaveTextContent(
				"1 checklist xong đúng hạn, 1 xong muộn và 1 bị bỏ trong 3 checklist đã đến hạn.",
			),
		);
		const rows = within(card).getAllByRole("row").slice(1);
		expect(rows.map((row) => rowCells(row).slice(1, 4))).toEqual([
			["Mở ca", "Mở ca", "Xong"],
			["Giữa ca", "Giữa ca", "Xong muộn"],
			["Đóng ca", "Đóng ca", "Bị bỏ"],
		]);
		expect(screen.queryByTestId("photo-thumbnail")).toBeNull();
		expect(operations?.calls.some(([method]) => method === "photo")).toBe(
			false,
		);
		await user.click(
			screen.getByRole("button", {
				name: "Xem chi tiết Mở ca, Cửa hàng mẫu 1, ngày 17/11/2026",
			}),
		);
		const detail = await screen.findByTestId("run-detail");
		expect(
			within(detail)
				.getAllByTestId("run-item-label")
				.map((item) => item.textContent),
		).toEqual(["Lau quầy (câu chữ phiên bản 1)", "Nhiệt độ tủ mát"]);
		expect(within(detail).getByTestId("run-detail-version")).toHaveTextContent(
			"Phiên bản 1 · Đã xong · 2/2 mục xong",
		);
		expect(
			await within(detail).findByTestId("photo-thumbnail"),
		).toHaveAttribute("src", "blob:fnb-photo");
		expect(operations?.calls).toContainEqual([
			"photo",
			{ bucket: "ops-brand-1", path: "t/s/run/run-open/1.jpg" },
		]);
		expect(within(detail).getByTestId("run-corrections")).toHaveTextContent(
			"Bạn sửa mục 2",
		);
		expect(document.body.textContent).not.toMatch(/https?:\/\//);
	});

	it("points to Settings when the stores have no checklist", async () => {
		renderPage(<ChecklistCompliancePage />, "/van-hanh/checklist", {
			operations: createFakeOperations(),
		});
		const card = await settledCard("operations-checklist-card");
		await waitFor(() =>
			expect(within(card).getByTestId("card-notice")).toHaveTextContent(
				"Chưa có checklist nào cho các cửa hàng này.",
			),
		);
		expect(
			within(card).getByRole("link", { name: "Soạn checklist ở Cài đặt" }),
		).toHaveAttribute("href", "/cai-dat/checklist");
	});

	it("shows the count beside the POS drawer for each Ca n, the threshold state and who counted, without a cashier or POS shift name", async () => {
		renderPage(<CashCountsPage />, "/van-hanh/ket-tien");
		const card = await settledCard("operations-cash-card");
		await waitFor(() =>
			expect(within(card).getByTestId("sentence")).toHaveTextContent(
				"2 trong 3 ca đã đóng có số đếm trên ứng dụng; 1 ca lệch quá ngưỡng và 1 ca chưa đếm.",
			),
		);
		const rows = within(card).getAllByRole("row").slice(1);
		expect(rows.map((row) => rowCells(row)[1])).toEqual([
			"Ca 1",
			"Ca 2",
			"Ca 3",
		]);
		expect(rowCells(rows[1] as HTMLElement).slice(3, 11)).toEqual([
			"1.900.000 ₫",
			"2.000.000 ₫",
			"2.000.000 ₫",
			"-100.000 ₫",
			"Vượt ngưỡng",
			"mức tuyệt đối",
			"Nhân viên 1",
			"17/11/2026 12:05",
		]);
		expect(rowCells(rows[2] as HTMLElement)[7]).toBe("Chưa đếm");
	});

	it("reopens a count for a recount only after the confirmation", async () => {
		const user = userEvent.setup();
		const operations = renderPage(<CashCountsPage />, "/van-hanh/ket-tien");
		const section = await screen.findByTestId("cash-reopen");
		await user.selectOptions(
			within(section).getByTestId("cash-reopen-choice"),
			"count-2",
		);
		await user.click(within(section).getByRole("button", { name: "Mở lại" }));
		const confirm = within(section).getByTestId("cash-reopen-confirm");
		expect(confirm).toHaveTextContent(
			"Mở lại số đếm Ca 2 ngày 17/11/2026 ở Cửa hàng mẫu 1?",
		);
		expect(
			within(confirm).getByRole("button", { name: "Mở lại số đếm" }),
		).toHaveFocus();
		await user.click(
			within(confirm).getByRole("button", { name: "Mở lại số đếm" }),
		);
		await waitFor(() =>
			expect(
				within(section).getByTestId("cash-reopen-status"),
			).toHaveTextContent(
				"Đã mở lại số đếm Ca 2 ngày 17/11/2026; ca chờ đếm lại.",
			),
		);
		expect(operations?.calls).toEqual([["reopenCashCount", "count-2"]]);
	});

	it("says in plain words that only a manager of the store reopens a count", async () => {
		const user = userEvent.setup();
		const operations = dayOperations();
		operations.refuse("reopenCashCount", "forbidden");
		renderPage(<CashCountsPage />, "/van-hanh/ket-tien", { operations });
		const section = await screen.findByTestId("cash-reopen");
		await user.click(within(section).getByRole("button", { name: "Mở lại" }));
		await user.click(
			within(section).getByRole("button", { name: "Mở lại số đếm" }),
		);
		await waitFor(() =>
			expect(
				within(section).getByTestId("cash-reopen-status"),
			).toHaveTextContent(
				"Chỉ chủ hoặc quản lý của cửa hàng này mở lại được số đếm.",
			),
		);
	});

	it("lists incidents, stock-outs and handovers with their state and filters them by kind, category and status in the address", async () => {
		const user = userEvent.setup();
		renderPage(<IncidentLogPage />, "/van-hanh/su-co");
		const card = await settledCard("operations-log-card");
		await waitFor(() =>
			expect(within(card).getByTestId("sentence")).toHaveTextContent(
				"3 mục khớp bộ lọc: 1 sự cố, 1 hết hàng và 1 ghi chú bàn giao; 3 chưa xem, 0 đã xem và 0 đã xử lý.",
			),
		);
		await user.selectOptions(
			screen.getByTestId("log-filter-kind"),
			"stock_out",
		);
		await waitFor(() =>
			expect(screen.getByTestId("probe")).toHaveTextContent("kind=stock_out"),
		);
		await waitFor(() =>
			expect(within(card).getByTestId("sentence")).toHaveTextContent(
				"1 mục khớp bộ lọc",
			),
		);
		const [row] = within(card).getAllByRole("row").slice(1);
		expect(rowCells(row as HTMLElement).slice(1, 5)).toEqual([
			"Hết hàng",
			"Khác",
			"Hết trân châu",
			"Trân châu đen",
		]);
		await user.selectOptions(screen.getByTestId("log-filter-kind"), "all");
		await user.selectOptions(
			screen.getByTestId("log-filter-category"),
			"thiet_bi",
		);
		await waitFor(() =>
			expect(screen.getByTestId("probe")).toHaveTextContent(
				"category=thiet_bi",
			),
		);
		await user.selectOptions(
			screen.getByTestId("log-filter-status"),
			"resolved",
		);
		await waitFor(() =>
			expect(within(card).getByTestId("sentence")).toHaveTextContent(
				"Không có sự cố, hết hàng hay ghi chú bàn giao nào khớp bộ lọc.",
			),
		);
	});

	it("keeps both filters when two are changed before the address catches up", async () => {
		renderPage(<IncidentLogPage />, "/van-hanh/su-co");
		await settledCard("operations-log-card");
		fireEvent.change(screen.getByTestId("log-filter-kind"), {
			target: { value: "incident" },
		});
		fireEvent.change(screen.getByTestId("log-filter-category"), {
			target: { value: "thiet_bi" },
		});
		await waitFor(() =>
			expect(screen.getByTestId("probe")).toHaveTextContent(
				"kind=incident&category=thiet_bi",
			),
		);
	});

	it("marks an incident seen, resolves it, acknowledges a handover and shows photos only when asked", async () => {
		const user = userEvent.setup();
		const operations = renderPage(<IncidentLogPage />, "/van-hanh/su-co");
		const actions = await screen.findByTestId("log-actions");
		await waitFor(() =>
			expect(within(actions).getAllByTestId("log-entry")).toHaveLength(3),
		);
		expect(screen.queryByTestId("photo-thumbnail")).toBeNull();
		await user.click(
			within(actions).getByRole("button", {
				name: "Xem ảnh: Sự cố ở Cửa hàng mẫu 1 lúc 17/11/2026 10:00",
			}),
		);
		expect(await screen.findByTestId("photo-thumbnail")).toBeVisible();
		await user.click(
			within(actions).getByRole("button", {
				name: "Đánh dấu đã xem: Sự cố ở Cửa hàng mẫu 1 lúc 17/11/2026 10:00",
			}),
		);
		await waitFor(() =>
			expect(screen.getByTestId("log-action-status")).toHaveTextContent(
				"Đã đánh dấu đã xem.",
			),
		);
		await user.click(
			await within(actions).findByRole("button", {
				name: "Đánh dấu đã xử lý: Sự cố ở Cửa hàng mẫu 1 lúc 17/11/2026 10:00",
			}),
		);
		await waitFor(() =>
			expect(screen.getByTestId("log-action-status")).toHaveTextContent(
				"Đã đánh dấu đã xử lý.",
			),
		);
		await user.click(
			within(actions).getByRole("button", {
				name: "Đánh dấu đã xem: Bàn giao ca ở Cửa hàng mẫu 1 lúc 17/11/2026 12:00",
			}),
		);
		await waitFor(() =>
			expect(
				operations?.calls.filter(([method]) => method !== "photo"),
			).toEqual([
				["acknowledgeIncident", "i-open"],
				["resolveIncident", "i-open"],
				["acknowledgeHandover", "h1"],
			]),
		);
	});

	it("explains that a writer never confirms their own report", async () => {
		const user = userEvent.setup();
		const operations = dayOperations();
		operations.refuse("acknowledgeIncident", "forbidden");
		renderPage(<IncidentLogPage />, "/van-hanh/su-co", { operations });
		const actions = await screen.findByTestId("log-actions");
		await user.click(
			(
				await within(actions).findAllByRole("button", {
					name: /^Đánh dấu đã xem: Sự cố/,
				})
			)[0] as HTMLElement,
		);
		await waitFor(() =>
			expect(screen.getByTestId("log-action-status")).toHaveTextContent(
				"người viết không tự xác nhận báo cáo của mình",
			),
		);
	});
});
