import { DemoSettingsStore, demoStoreIds } from "@fnb/demo-analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { ChecklistTemplate } from "../../operations/source";
import {
	createFakeOperations,
	type FakeOperations,
} from "../../operations/testing/fake-operations-source";
import { createDemoSettingsSource } from "../../settings/demo-settings-source";
import type { Membership, SettingsSource } from "../../settings/source";
import { createDemoStaffSource } from "../../settings/staff/demo-staff-source";
import ChecklistPage from "./checklist-page";

const TENANT = {
	id: "33333333-3333-4333-8333-333333333333",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: "Asia/Ho_Chi_Minh",
	countryCode: "VN",
};

const [STORE_1 = "", STORE_2 = ""] = demoStoreIds();

const current = vi.hoisted(() => ({
	state: { status: "loading" } as unknown,
}));

vi.mock("../../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({ tenant: TENANT, stores: [] }),
}));

vi.mock("../../settings/settings-source-context", () => ({
	useSettingsSourceState: () => current.state,
	useRetrySettingsSource: () => () => undefined,
}));

vi.mock("../../settings/catch-up/catch-up-context", () => ({
	useCatchUpRunner: () => ({
		running: false,
		problem: null,
		completed: false,
		start: () => undefined,
		abort: () => undefined,
		dismiss: () => undefined,
	}),
}));

function template(
	id: string,
	storeId: string | null,
	overrides: Partial<ChecklistTemplate> = {},
): ChecklistTemplate {
	return {
		id,
		storeId,
		phase: "opening",
		title: `Mở ca ${id}`,
		active: true,
		version: 1,
		items: [
			{
				id: `${id}-1`,
				position: 1,
				label: "Mở ca trên POS",
				requiresPhoto: false,
				numberUnit: null,
			},
			{
				id: `${id}-2`,
				position: 2,
				label: "Lau quầy",
				requiresPhoto: true,
				numberUnit: null,
			},
		],
		createdAt: "2026-11-01T00:00:00Z",
		audit: null,
		...overrides,
	};
}

function renderPage({
	membership = { role: "owner", storeIds: null } as Membership,
	operations = createFakeOperations({
		templates: [template("all", null), template("one", STORE_1)],
	}) as FakeOperations | null,
}: {
	readonly membership?: Membership;
	readonly operations?: FakeOperations | null;
} = {}) {
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
		<MemoryRouter>
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<QueryClientProvider client={client}>
					<ChecklistPage />
				</QueryClientProvider>
			</I18nProvider>
		</MemoryRouter>,
	);
	return operations;
}

function card(title: string) {
	const found = screen
		.getAllByTestId("checklist-template")
		.find(
			(candidate) =>
				within(candidate).getByTestId("checklist-title").textContent === title,
		);
	if (found === undefined) throw new Error(`no checklist ${title}`);
	return found;
}

function status() {
	return screen.getByTestId("checklist-status");
}

describe("the Checklist page", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("shows the plain state and no form in the demo, which has no staff app", async () => {
		renderPage({ operations: null });
		expect(await screen.findByTestId("checklist-demo")).toHaveTextContent(
			"Bản demo không có ứng dụng nhân viên",
		);
		expect(screen.queryByTestId("checklist-settings")).toBeNull();
		expect(screen.queryByRole("button", { name: "Tạo checklist" })).toBeNull();
	});

	it.each([
		["staff", null],
		["viewer", null],
		["publisher", null],
	] as const)(
		"gives %s the reason and no checklist",
		async (role, storeIds) => {
			renderPage({ membership: { role, storeIds } });
			await waitFor(() =>
				expect(screen.getByTestId("settings-read-only")).toHaveTextContent(
					"Trang Checklist chỉ dành cho chủ và quản lý.",
				),
			);
			expect(screen.getByTestId("settings-read-only")).toHaveAttribute(
				"data-reason",
				"role",
			);
			expect(screen.queryByTestId("checklist-settings")).toBeNull();
		},
	);

	it("lists every store's checklists first, then each store's, with the version, items and photo items", async () => {
		renderPage();
		const groups = await screen.findAllByTestId("checklist-group");
		expect(
			groups.map((group) => within(group).getByRole("heading").textContent),
		).toEqual(["Mọi cửa hàng", "Cửa hàng mẫu 1"]);
		expect(
			within(card("Mở ca all")).getByTestId("checklist-facts"),
		).toHaveTextContent(
			"Mở ca · Phiên bản 1 · Đang dùng · 2 mục · 1 mục cần ảnh",
		);
		expect(
			within(card("Mở ca all"))
				.getAllByTestId("checklist-item-text")
				.map((item) => item.textContent),
		).toEqual(["Mở ca trên POS", "Lau quầy"]);
	});

	it("creates a checklist from the outline for one store and says it applies from the next run", async () => {
		const user = userEvent.setup();
		const operations = renderPage();
		await user.click(
			await screen.findByRole("button", { name: "Tạo checklist" }),
		);
		const form = screen.getByTestId("checklist-form");
		await user.selectOptions(
			within(form).getByTestId("checklist-form-store"),
			STORE_2,
		);
		await user.selectOptions(
			within(form).getByTestId("checklist-form-phase"),
			"closing",
		);
		await user.click(
			within(form).getByRole("button", { name: "Tạo từ khung" }),
		);
		await user.click(
			within(form).getByRole("button", { name: "Tạo checklist" }),
		);
		await waitFor(() =>
			expect(status()).toHaveTextContent("Đã tạo checklist Checklist đóng ca."),
		);
		expect(operations?.calls[0]).toEqual([
			"saveChecklistTemplate",
			expect.objectContaining({
				templateId: null,
				storeId: STORE_2,
				phase: "closing",
				title: "Checklist đóng ca",
			}),
		]);
		expect(screen.queryByTestId("checklist-form")).toBeNull();
		expect(await screen.findByText("Checklist đóng ca")).toBeVisible();
	});

	it("saves an edit as a new version of the same checklist", async () => {
		const user = userEvent.setup();
		const operations = renderPage();
		await user.click(
			await screen.findByRole("button", { name: "Sửa checklist Mở ca one" }),
		);
		const form = screen.getByTestId("checklist-form");
		const first = within(form).getByLabelText("Mục 1");
		await user.clear(first);
		await user.type(first, "Mở ca trên POS và đếm tiền đầu ca");
		await user.click(
			within(form).getByRole("button", { name: "Lưu phiên bản mới" }),
		);
		await waitFor(() =>
			expect(status()).toHaveTextContent(
				"Đã lưu phiên bản 2 của Mở ca one; áp dụng từ lần làm tiếp theo.",
			),
		);
		expect(operations?.calls[0]?.[1]).toMatchObject({
			templateId: "one",
			storeId: STORE_1,
			phase: "opening",
		});
		await waitFor(() =>
			expect(
				within(card("Mở ca one")).getByTestId("checklist-facts"),
			).toHaveTextContent("Phiên bản 2"),
		);
	});

	it("retires and reactivates a checklist without a new version", async () => {
		const user = userEvent.setup();
		const operations = renderPage();
		await user.click(
			await screen.findByRole("button", {
				name: "Ngừng dùng checklist Mở ca one",
			}),
		);
		await waitFor(() =>
			expect(status()).toHaveTextContent("Đã ngừng dùng Mở ca one"),
		);
		await waitFor(() =>
			expect(card("Mở ca one")).toHaveAttribute("data-active", "false"),
		);
		await user.click(
			screen.getByRole("button", { name: "Dùng lại checklist Mở ca one" }),
		);
		await waitFor(() =>
			expect(status()).toHaveTextContent("Đã dùng lại Mở ca one."),
		);
		expect(operations?.calls).toEqual([
			["setChecklistTemplateActive", { templateId: "one", active: false }],
			["setChecklistTemplateActive", { templateId: "one", active: true }],
		]);
		expect(
			within(card("Mở ca one")).getByTestId("checklist-facts"),
		).toHaveTextContent("Phiên bản 1");
	});

	it("copies a checklist to another store in scope as a new checklist there", async () => {
		const user = userEvent.setup();
		const operations = renderPage();
		await user.click(
			await screen.findByRole("button", {
				name: "Sao chép checklist Mở ca one sang cửa hàng khác",
			}),
		);
		const panel = screen.getByTestId("checklist-copy");
		expect(
			within(within(panel).getByTestId("checklist-copy-store"))
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["Cửa hàng mẫu 2"]);
		await user.click(within(panel).getByRole("button", { name: "Sao chép" }));
		await waitFor(() =>
			expect(status()).toHaveTextContent(
				"Đã sao chép Mở ca one sang Cửa hàng mẫu 2.",
			),
		);
		expect(operations?.calls[0]).toEqual([
			"saveChecklistTemplate",
			{
				templateId: null,
				storeId: STORE_2,
				phase: "opening",
				title: "Mở ca one",
				items: [
					{ label: "Mở ca trên POS", requiresPhoto: false, numberUnit: null },
					{ label: "Lau quầy", requiresPhoto: true, numberUnit: null },
				],
			},
		]);
		const groups = await screen.findAllByTestId("checklist-group");
		expect(groups).toHaveLength(3);
	});

	it("lets a store-limited manager edit only their store's checklists and read every store's with the reason", async () => {
		const user = userEvent.setup();
		renderPage({ membership: { role: "manager", storeIds: [STORE_1] } });
		const [everyStore] = await screen.findAllByTestId("checklist-group");
		expect(everyStore).toHaveAttribute("data-store-id", "all");
		expect(
			within(card("Mở ca all")).getByTestId("checklist-read-only"),
		).toHaveAttribute("data-reason", "scope");
		expect(
			within(card("Mở ca all")).queryByRole("button", { name: /Sửa/ }),
		).toBeNull();
		expect(
			within(card("Mở ca one")).getByRole("button", {
				name: "Sửa checklist Mở ca one",
			}),
		).toBeVisible();
		expect(
			within(card("Mở ca one")).queryByRole("button", { name: /Sao chép/ }),
		).toBeNull();
		await user.click(screen.getByRole("button", { name: "Tạo checklist" }));
		expect(
			within(screen.getByTestId("checklist-form-store"))
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["Cửa hàng mẫu 1"]);
	});

	it("names a refusal by the database in plain words", async () => {
		const user = userEvent.setup();
		const operations = createFakeOperations({
			templates: [template("one", STORE_1)],
		});
		operations.refuse("setChecklistTemplateActive", "forbidden");
		renderPage({ operations });
		await user.click(
			await screen.findByRole("button", {
				name: "Ngừng dùng checklist Mở ca one",
			}),
		);
		await waitFor(() =>
			expect(status()).toHaveTextContent(
				"Bạn chỉ sửa checklist của cửa hàng mình quản lý",
			),
		);
		operations.refuse("setChecklistTemplateActive", "network");
		await user.click(
			screen.getByRole("button", { name: "Ngừng dùng checklist Mở ca one" }),
		);
		await waitFor(() =>
			expect(screen.getByTestId("checklist-retry")).toBeVisible(),
		);
	});

	it("says so when there is no checklist yet", async () => {
		renderPage({ operations: createFakeOperations() });
		expect(await screen.findByTestId("checklist-empty")).toHaveTextContent(
			"Chưa có checklist nào.",
		);
	});
});
