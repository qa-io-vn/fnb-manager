import { createDemoReportSource } from "@fnb/demo-analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { createFakePostgrest } from "../../exports/testing/fake-postgrest";
import {
	STORE_ONE,
	STORE_TWO,
	syntheticTables,
} from "../../exports/testing/synthetic-data";
import { I18nProvider } from "../../i18n";
import type { Membership, SettingsSource } from "../../settings/source";
import { canIncludePersonal, ExportsPage, tabOf } from "./exports-page";

const TENANT = {
	id: "33333333-3333-4333-8333-333333333333",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: "Asia/Ho_Chi_Minh",
	countryCode: "VN",
};

const STORES = [STORE_ONE, STORE_TWO].map((store) => ({
	id: store.id,
	tenantId: TENANT.id,
	name: store.name,
	code: null,
	timeZone: store.timeZone,
	businessDayStartMinutes: store.businessDayStartMinutes,
	posAccountId: "44444444-4444-4444-8444-444444444444",
}));

const current = vi.hoisted(() => ({
	mode: "live" as "live" | "demo",
	membership: null as unknown,
	failMembership: false,
	client: null as unknown,
	analytics: { status: "loading" } as unknown,
}));

vi.mock("../../app-mode/app-mode", () => ({
	useAppMode: () => ({ mode: current.mode }),
}));

vi.mock("../../auth/session", () => ({
	useSession: () => ({ client: current.client }),
}));

vi.mock("../../data/analytics-source-context", () => ({
	useAnalyticsSourceState: () => current.analytics,
}));

vi.mock("../../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({
		tenant: TENANT,
		stores: STORES,
		selectedStores: STORES,
	}),
}));

vi.mock("../../settings/settings-source-context", () => ({
	useSettingsSourceState: () => ({
		status: "ready",
		source: {
			kind: "demo",
			membership: async () => {
				if (current.failMembership) throw new Error("offline");
				return current.membership;
			},
		} as unknown as SettingsSource,
		manual: {},
	}),
	useRetrySettingsSource: () => () => undefined,
}));

function renderPage(
	membership: Membership | null,
	path = "/xuat-du-lieu",
	mode: "live" | "demo" = "live",
	failMembership = false,
) {
	current.mode = mode;
	current.membership = membership;
	current.failMembership = failMembership;
	current.analytics = {
		status: "ready",
		source: createDemoReportSource({ now: () => new Date() }),
	};
	current.client = createFakePostgrest({
		stores: [STORE_ONE, STORE_TWO],
		tables: syntheticTables({
			stores: [STORE_ONE, STORE_TWO],
			from: "2026-10-01",
			to: "2026-10-03",
			invoicesPerDay: 2,
		}),
	}).client;
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<I18nProvider language="vi" onLanguageChange={() => undefined}>
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={[path]}>
					<ExportsPage />
				</MemoryRouter>
			</QueryClientProvider>
		</I18nProvider>,
	);
}

describe("the Xuất dữ liệu page", () => {
	it("opens on the pack tab by default and names both tabs", async () => {
		renderPage({ role: "owner", storeIds: null });
		expect(
			await screen.findByRole("link", { name: "Gói dữ liệu cho AI" }),
		).toHaveAttribute("aria-current", "page");
		expect(
			screen.getByRole("link", { name: "Xuất dữ liệu" }),
		).not.toHaveAttribute("aria-current");
		expect(await screen.findByTestId("pack-form")).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { level: 2, name: "Gói dữ liệu cho AI" }),
		).toBeInTheDocument();
		expect(tabOf(null)).toBe("goi");
		expect(tabOf("xuat")).toBe("xuat");
		expect(tabOf("other")).toBe("goi");
	});

	it("offers the personal-data box to an owner with every store", async () => {
		renderPage({ role: "owner", storeIds: null }, "/xuat-du-lieu?tab=xuat");
		expect(await screen.findByTestId("export-form")).toBeInTheDocument();
		const box = screen.getByRole("checkbox", { name: "Kèm thông tin cá nhân" });
		expect(box).not.toBeChecked();
	});

	it("offers the box to a manager with every store but never to a store-limited one", async () => {
		const { unmount } = renderPage(
			{ role: "manager", storeIds: null },
			"/xuat-du-lieu?tab=xuat",
		);
		expect(await screen.findByTestId("export-personal")).toBeInTheDocument();
		unmount();
		renderPage(
			{ role: "manager", storeIds: [STORE_ONE.id] },
			"/xuat-du-lieu?tab=xuat",
		);
		expect(await screen.findByTestId("export-form")).toBeInTheDocument();
		expect(screen.queryByTestId("export-personal")).toBeNull();
		expect(
			canIncludePersonal({ role: "manager", storeIds: [STORE_ONE.id] }),
		).toBe(false);
		expect(canIncludePersonal({ role: "staff", storeIds: null })).toBe(false);
	});

	it.each([
		["staff", { role: "staff", storeIds: null }],
		["viewer", { role: "viewer", storeIds: null }],
		["no membership", null],
	] as const)(
		"explains to %s that only owners and managers export",
		async (_name, membership) => {
			renderPage(membership, "/xuat-du-lieu?tab=xuat");
			expect(await screen.findByTestId("exports-denied")).toHaveTextContent(
				"Chỉ chủ quán và quản lý xuất được dữ liệu.",
			);
			expect(screen.queryByTestId("exports-tabs")).toBeNull();
			expect(screen.queryByTestId("export-form")).toBeNull();
		},
	);

	it("gives the publisher nothing under the heading", async () => {
		renderPage({ role: "publisher", storeIds: null }, "/xuat-du-lieu?tab=xuat");
		await waitFor(() =>
			expect(screen.queryByText("Đang kiểm tra quyền của bạn…")).toBeNull(),
		);
		expect(
			screen.getByRole("heading", { level: 1, name: "Xuất dữ liệu" }),
		).toBeInTheDocument();
		expect(screen.queryByTestId("exports-gate-failed")).toBeNull();
		expect(screen.queryByTestId("exports-denied")).toBeNull();
		expect(screen.queryByTestId("exports-tabs")).toBeNull();
		expect(screen.queryByTestId("export-form")).toBeNull();
	});

	it("says the demo has no real invoices and links to the pack tab", async () => {
		const user = userEvent.setup();
		renderPage(
			{ role: "owner", storeIds: null },
			"/xuat-du-lieu?tab=xuat",
			"demo",
		);
		expect(await screen.findByTestId("exports-demo-notice")).toHaveTextContent(
			"Bản demo không có dữ liệu hóa đơn thật để xuất.",
		);
		expect(screen.queryByTestId("export-form")).toBeNull();
		await user.click(
			screen.getByRole("link", { name: "Xem gói dữ liệu cho AI" }),
		);
		expect(await screen.findByTestId("pack-form")).toBeInTheDocument();
	});

	it("shows a retry when the membership cannot be read", async () => {
		renderPage(
			{ role: "owner", storeIds: null },
			"/xuat-du-lieu",
			"live",
			true,
		);
		expect(await screen.findByTestId("exports-gate-failed")).toHaveTextContent(
			"Không đọc được quyền của bạn.",
		);
		expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
	});
});
