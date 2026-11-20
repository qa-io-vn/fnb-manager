import { DemoSettingsStore } from "@fnb/demo-analytics";
import { customRange } from "@fnb/reports";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreRow } from "../../data/row-source";
import { I18nProvider } from "../../i18n";
import {
	createDemoLoyaltySource,
	DEFAULT_STORE_KNOBS,
	DEMO_STAFF_MODE_STORE,
} from "../../loyalty/demo-loyalty-source";
import type { BillAnomalyRow, LoyaltySource } from "../../loyalty/source";
import type { AnomalyLocation } from "../../loyalty/use-anomaly-location";
import { createDemoSettingsSource } from "../../settings/demo-settings-source";
import type { SettingsSource } from "../../settings/source";
import { CONFIRMATION_SETTINGS_HREF, StaffAnomalies } from "./staff-anomalies";

const TENANT = {
	id: "33333333-3333-4333-8333-333333333333",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: "Asia/Ho_Chi_Minh",
	countryCode: "VN",
};

const current = vi.hoisted(() => ({ state: { status: "loading" } as unknown }));

vi.mock("../../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({ tenant: TENANT, stores: [] }),
}));

vi.mock("../../settings/settings-source-context", () => ({
	useSettingsSourceState: () => current.state,
	useRetrySettingsSource: () => () => undefined,
}));

function store(id: string, name: string): StoreRow {
	return {
		id,
		tenantId: TENANT.id,
		name,
		code: null,
		timeZone: TENANT.timeZone,
		businessDayStartMinutes: 0,
		posAccountId: "pos",
	};
}

function location(stores: readonly StoreRow[]): AnomalyLocation {
	return {
		range: customRange("2026-11-13", "2026-11-19", "2026-11-19"),
		stores,
		rangeClamped: false,
		invalid: false,
		goTo: () => undefined,
	};
}

function renderSection(
	loyalty: LoyaltySource,
	stores: readonly StoreRow[],
	canRead = true,
) {
	const source: SettingsSource = {
		...createDemoSettingsSource(new DemoSettingsStore()),
		kind: loyalty.kind,
	};
	current.state = { status: "ready", source, loyalty, customers: null };
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<MemoryRouter>
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<QueryClientProvider client={client}>
					<StaffAnomalies location={location(stores)} canRead={canRead} />
				</QueryClientProvider>
			</I18nProvider>
		</MemoryRouter>,
	);
}

afterEach(() => {
	current.state = { status: "loading" };
});

const DEMO_STORES = [
	store(DEMO_STAFF_MODE_STORE, "Cửa hàng mẫu 1"),
	store("MOCK-S2", "Cửa hàng mẫu 2"),
];

describe("the per-staff anomaly section", () => {
	it("lists the demo's staff days with flags as chips and explains each flag shown", async () => {
		renderSection(createDemoLoyaltySource(), DEMO_STORES);
		const rows = await screen.findAllByTestId("bill-anomaly-row");
		expect(rows.length).toBeGreaterThan(0);
		const first = rows[0] as HTMLElement;
		expect(first).toHaveAttribute("data-flagged", "true");
		expect(within(first).getByTestId("bill-anomaly-staff")).toHaveTextContent(
			"Minh (ca tối)",
		);
		expect(first).toHaveTextContent("Cửa hàng mẫu 1");
		const chips = within(first).getAllByTestId("bill-anomaly-flag");
		expect(chips.map((chip) => chip.textContent)).toContain("Khách khiếu nại");
		expect(
			screen
				.getAllByTestId("bill-anomaly-staff")
				.map((cell) => cell.textContent),
		).toContain("Khách tự quét (tự duyệt)");
		const legend = screen.getByTestId("bill-anomaly-legend");
		expect(legend).toHaveTextContent("Ghi dồn trong một giờ");
		expect(legend).toHaveTextContent("gấp 3 lần nhịp thường");
		expect(screen.getByTestId("bill-anomalies-summary")).toHaveTextContent(
			/dòng có dấu hiệu cần xem/,
		);
	});

	// Equivalence partition: no chosen store confirms at the counter.
	it("explains the empty state and links to the settings when no store is in staff mode", async () => {
		renderSection(createDemoLoyaltySource(), [DEMO_STORES[1] as StoreRow]);
		const empty = await screen.findByTestId("bill-anomalies-no-staff-stores");
		expect(empty).toHaveTextContent("Không cửa hàng nào");
		expect(within(empty).getByRole("link")).toHaveAttribute(
			"href",
			CONFIRMATION_SETTINGS_HREF,
		);
		expect(screen.queryByTestId("bill-anomaly-row")).toBeNull();
	});

	// Security: viewers never call bill_anomaly_report (owners and managers only).
	it("keeps the report from viewers without asking the database", async () => {
		const loyalty = createDemoLoyaltySource();
		const billAnomalies = vi.spyOn(loyalty, "billAnomalies");
		const storeSettings = vi.spyOn(loyalty, "storeSettings");
		renderSection(loyalty, DEMO_STORES, false);
		expect(screen.getByTestId("bill-anomalies-read-only")).toHaveTextContent(
			"Chỉ chủ quán và quản lý",
		);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(billAnomalies).not.toHaveBeenCalled();
		expect(storeSettings).not.toHaveBeenCalled();
	});

	it("asks the report for the staff-mode stores only and says when they recorded no bill", async () => {
		const billAnomalies = vi.fn(async (): Promise<BillAnomalyRow[]> => []);
		const loyalty = {
			...createDemoLoyaltySource(),
			kind: "supabase" as const,
			storeSettings: async (_tenantId: string, ids: readonly string[]) =>
				ids.map((id) => ({
					...DEFAULT_STORE_KNOBS,
					confirmation: id === "b" ? ("staff" as const) : ("pos_sync" as const),
					storeId: id,
					updatedAt: "x",
				})),
			billAnomalies,
		};
		renderSection(loyalty, [store("a", "A"), store("b", "B")]);
		expect(await screen.findByTestId("bill-anomalies-empty")).toBeVisible();
		expect(billAnomalies).toHaveBeenCalledWith(
			["b"],
			"2026-11-13",
			"2026-11-19",
		);
	});

	it("labels a flag it does not know yet instead of hiding it", async () => {
		const loyalty = {
			...createDemoLoyaltySource(),
			billAnomalies: async () => [
				{
					storeId: DEMO_STAFF_MODE_STORE,
					businessDate: "2026-11-19",
					staffUserId: "u",
					staffName: "Lan",
					bills: 0,
					billsTotal: 0,
					level0: 0,
					level2: 0,
					confirmed: 0,
					queued: 0,
					disagreements: 0,
					disputes: 0,
					timedOut: 0,
					reversals: 0,
					auditsFailed: 0,
					redemptionsConfirmed: 0,
					topMemberShare: null,
					amountOutliers: 0,
					maxBillsInHour: null,
					peerMedianBills: null,
					flags: ["late_night"],
				},
			],
		};
		renderSection(loyalty, DEMO_STORES);
		const chip = await screen.findByTestId("bill-anomaly-flag");
		expect(chip).toHaveTextContent("Dấu hiệu khác (late_night)");
		expect(screen.getByTestId("bill-anomaly-row")).toHaveTextContent("—");
	});
});
