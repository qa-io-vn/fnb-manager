import { DemoSettingsStore } from "@fnb/demo-analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { MembersPage } from "../pages/loyalty/members-page";
import { createFakePrivacy } from "../privacy/testing";
import { createDemoSettingsSource } from "../settings/demo-settings-source";
import type {
	Membership,
	SettingsSource,
	TenantRole,
} from "../settings/source";
import type {
	CohortRetentionRow,
	CustomerMetrics,
	CustomerSource,
	RfmSegmentRow,
} from "./source";
import { EMPTY_METRICS, MEASURED_METRICS } from "./testing";

const current = vi.hoisted(() => ({ state: { status: "loading" } as unknown }));

vi.mock("../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({
		tenant: {
			id: "33333333-3333-4333-8333-333333333333",
			name: "Quán mẫu",
			currencyCode: "VND",
			timeZone: "Asia/Ho_Chi_Minh",
			countryCode: "VN",
		},
		stores: [
			{
				id: "ffffffff-0000-4000-8000-000000000001",
				tenantId: "33333333-3333-4333-8333-333333333333",
				name: "Cửa hàng mẫu 1",
				code: null,
				timeZone: "Asia/Ho_Chi_Minh",
				businessDayStartMinutes: 0,
				posAccountId: "account",
			},
		],
		selectedStores: [],
		allStoresSelected: true,
		selectStores: () => undefined,
	}),
}));

vi.mock("../settings/settings-source-context", () => ({
	useSettingsSourceState: () => current.state,
	useRetrySettingsSource: () => () => undefined,
}));

interface Options {
	readonly role?: TenantRole;
	readonly metrics?: () => Promise<CustomerMetrics>;
	readonly rfm?: readonly RfmSegmentRow[];
	readonly cohorts?: readonly CohortRetentionRow[];
}

function renderMembers({
	role = "owner",
	metrics = async () => MEASURED_METRICS,
	rfm = [],
	cohorts = [],
}: Options = {}) {
	const membership: Membership = { role, storeIds: null };
	const source: SettingsSource = {
		...createDemoSettingsSource(new DemoSettingsStore()),
		membership: async () => membership,
	};
	const customers = {
		kind: "supabase",
		privacy: createFakePrivacy(),
		metrics: vi.fn(metrics),
		rfm: vi.fn(async () => [...rfm]),
		cohorts: vi.fn(async () => [...cohorts]),
		members: vi.fn(async () => ({ rows: [], next: null })),
		lookup: vi.fn(async () => []),
		member: vi.fn(async () => null),
		ledger: vi.fn(async () => []),
		queue: vi.fn(async () => []),
		reconciliation: vi.fn(async () => []),
		resolveQueueItem: vi.fn(),
		anomalies: vi.fn(async () => []),
	} as unknown as CustomerSource;
	current.state = { status: "ready", source, customers };
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<MemoryRouter initialEntries={["/khach-hang/thanh-vien"]}>
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<QueryClientProvider client={client}>
					<Routes>
						<Route path="/khach-hang/thanh-vien" element={<MembersPage />} />
					</Routes>
				</QueryClientProvider>
			</I18nProvider>
		</MemoryRouter>,
	);
	return customers;
}

beforeEach(() => {
	Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
	current.state = { status: "loading" };
});

const metric = (id: string) =>
	screen
		.getAllByTestId("customer-metric")
		.find((card) => card.dataset.metric === id) as HTMLElement;

describe("the customer metric cards", () => {
	it("shows every metric with the capture rate beside the others", async () => {
		renderMembers();
		await screen.findByTestId("customer-metric-cards");
		const value = (id: string) =>
			within(metric(id)).getByTestId("customer-metric-value").textContent;
		expect(value("customer_capture_rate")).toMatch(/93/);
		expect(value("repeat_rate")).toMatch(/15/);
		expect(value("visit_frequency_30d")).toMatch(/1[.,]2/);
		expect(value("visit_frequency_90d")).toMatch(/1[.,]238/);
		expect(value("loyalty_liability")).toMatch(/100/);
		expect(value("breakage_rate")).toMatch(/66|67/);
		expect(value("reward_cost_rate")).toMatch(/4[.,]4/);
		expect(value("member_frequency_uplift")).toMatch(/18/);
		expect(metric("customer_capture_rate")).toHaveTextContent(
			"27 trên 29 hóa đơn",
		);
		expect(metric("member_frequency_uplift")).toHaveTextContent(
			"10 thành viên, 10 khách so sánh",
		);
		expect(screen.getAllByTestId("customer-metric")).toHaveLength(8);
	});

	it("shows an unmeasured figure as not measured, never as zero", async () => {
		renderMembers({ metrics: async () => EMPTY_METRICS });
		await screen.findByTestId("customer-metric-cards");
		for (const id of [
			"customer_capture_rate",
			"repeat_rate",
			"visit_frequency_30d",
			"loyalty_liability",
			"breakage_rate",
			"reward_cost_rate",
			"member_frequency_uplift",
		]) {
			expect(
				within(metric(id)).getByTestId("customer-metric-value"),
			).toHaveTextContent("Chưa đo được");
		}
	});

	it("keeps a measured zero as zero (partition: zero versus null)", async () => {
		renderMembers({
			metrics: async () => ({
				...MEASURED_METRICS,
				repeatCustomers: 0,
				repeatRate: 0,
				liability: 0,
				outstandingPoints: 0,
			}),
		});
		await screen.findByTestId("customer-metric-cards");
		expect(
			within(metric("repeat_rate")).getByTestId("customer-metric-value")
				.textContent,
		).not.toContain("Chưa đo được");
		expect(
			within(metric("loyalty_liability")).getByTestId("customer-metric-value")
				.textContent,
		).not.toContain("Chưa đo được");
	});

	it("asks for the trailing 30 days over the stores in scope", async () => {
		const customers = renderMembers();
		await screen.findByTestId("customer-metric-cards");
		const [storeIds, from, to] = (customers.metrics as ReturnType<typeof vi.fn>)
			.mock.calls[0] as [string[], string, string];
		expect(storeIds).toEqual(["ffffffff-0000-4000-8000-000000000001"]);
		expect(
			(new Date(`${to}T00:00:00Z`).getTime() -
				new Date(`${from}T00:00:00Z`).getTime()) /
				86_400_000,
		).toBe(29);
	});

	it("shows a failure message when the metrics cannot be loaded", async () => {
		renderMembers({
			metrics: async () => {
				throw new Error("offline");
			},
		});
		expect(await screen.findByTestId("customer-metrics-failed")).toBeVisible();
	});

	it("lists the RFM segments with counts and shares", async () => {
		renderMembers({
			rfm: [
				{ segment: "champions", customers: 2, share: 0.4 },
				{ segment: "lost", customers: 3, share: 0.6 },
			],
		});
		const list = await screen.findByTestId("customer-rfm");
		expect(within(list).getAllByRole("listitem")).toHaveLength(2);
		expect(list).toHaveTextContent("Khách ưu tú");
		expect(list).toHaveTextContent("Đã mất");
	});

	it("says so when there are no segments", async () => {
		renderMembers({ rfm: [] });
		expect(await screen.findByTestId("customer-rfm-none")).toBeVisible();
	});

	it("shows each cohort with its size and a dash for a null retention", async () => {
		renderMembers({
			cohorts: [
				{
					cohortMonth: "2026-09-01",
					monthOffset: 0,
					cohortSize: 12,
					retained: 2,
					retention: 0.1667,
				},
				{
					cohortMonth: "2026-09-01",
					monthOffset: 1,
					cohortSize: 12,
					retained: 0,
					retention: 0,
				},
				{
					cohortMonth: "2026-10-01",
					monthOffset: 0,
					cohortSize: 0,
					retained: 0,
					retention: null,
				},
			],
		});
		const list = await screen.findByTestId("customer-cohorts");
		const september = list.querySelector('[data-cohort="2026-09-01"]');
		expect(september).toHaveTextContent("Nhóm tháng 2026-09: 12 khách");
		expect(september).toHaveTextContent("Sau 0 tháng: 16,7%");
		expect(september).toHaveTextContent("Sau 1 tháng: 0,0%");
		expect(list.querySelector('[data-cohort="2026-10-01"]')).toHaveTextContent(
			"—",
		);
	});

	it("is shown to a viewer too, who reads loyalty data", async () => {
		renderMembers({ role: "viewer" });
		expect(await screen.findByTestId("customer-metric-cards")).toBeVisible();
	});

	it("holds no phone, name or customer id", async () => {
		renderMembers({
			rfm: [{ segment: "champions", customers: 2, share: 0.4 }],
		});
		await screen.findByTestId("customer-rfm");
		const text = document.body.textContent ?? "";
		expect(text).not.toMatch(/\+84\d{9}|\b0\d{9}\b/);
		expect(text).not.toMatch(
			/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
		);
	});
});
