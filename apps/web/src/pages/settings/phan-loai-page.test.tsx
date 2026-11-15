import { DemoSettingsStore } from "@fnb/demo-analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { createDemoSettingsSource } from "../../settings/demo-settings-source";
import type {
	ItemTypeEntry,
	Membership,
	SettingsSource,
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
	beforeEach(() => current.startCatchUp.mockClear());

	it("opens on the roles tab and names the phase of the other two", async () => {
		const user = userEvent.setup();
		renderPage(sourceFor(new DemoSettingsStore()));
		expect(await roleOf("Topping")).toHaveValue("topping");
		expect(
			screen.getByRole("link", { name: "Vai trò nhóm món" }),
		).toHaveAttribute("aria-current", "page");
		await user.click(screen.getByRole("link", { name: "Loại thanh toán" }));
		expect(screen.getByTestId("mapping-tab-later")).toHaveTextContent("10b");
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
			},
			{
				posAccountId: "A",
				posAccountName: "POS",
				itemTypeExternalId: "T2",
				name: "Topping",
				role: "topping",
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
