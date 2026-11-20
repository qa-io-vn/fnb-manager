import { DemoSettingsStore } from "@fnb/demo-analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { createFormatters } from "../../lib/format";
import {
	createDemoLoyaltySource,
	DEFAULT_STORE_KNOBS,
	DEMO_STAFF_MODE_STORE,
} from "../../loyalty/demo-loyalty-source";
import type {
	ConfirmationMode,
	LoyaltySource,
	LoyaltyStoreSettings,
	LoyaltyStoreSettingsChange,
} from "../../loyalty/source";
import { createDemoSettingsSource } from "../demo-settings-source";
import type { Membership, SettingsSource } from "../source";
import { SettingsWriteError } from "../source";
import { draftOf } from "./confirmation-fields";
import { ConfirmationTab, pendingCountOf } from "./confirmation-tab";

const TENANT = {
	id: "33333333-3333-4333-8333-333333333333",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: "Asia/Ho_Chi_Minh",
	countryCode: "VN",
};

const STORE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const current = vi.hoisted(() => ({
	state: { status: "loading" } as unknown,
	stores: [] as { id: string; name: string }[],
}));

vi.mock("../../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({ tenant: TENANT, stores: current.stores }),
}));

vi.mock("../settings-source-context", () => ({
	useSettingsSourceState: () => current.state,
	useRetrySettingsSource: () => () => undefined,
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

function settingsOf(
	storeId: string,
	confirmation: ConfirmationMode,
): LoyaltyStoreSettings {
	return {
		...DEFAULT_STORE_KNOBS,
		confirmation,
		storeId,
		updatedAt: "2026-11-20T02:00:00Z",
	};
}

function fakeLoyalty(rows: LoyaltyStoreSettings[]) {
	const saved = [...rows];
	const saveStoreSettings = vi.fn(
		async (
			_tenantId: string,
			storeId: string,
			change: LoyaltyStoreSettingsChange,
		) => {
			const index = saved.findIndex((row) => row.storeId === storeId);
			const before = saved[index];
			if (before === undefined) throw new SettingsWriteError("forbidden");
			const after = {
				...before,
				...change,
				updatedAt: "2026-11-20T03:00:00Z",
			};
			saved[index] = after;
			return after;
		},
	);
	const source = {
		kind: "supabase" as const,
		programmes: vi.fn(async () => []),
		saveProgramme: vi.fn(),
		staffPhones: vi.fn(async () => []),
		addStaffPhone: vi.fn(),
		removeStaffPhone: vi.fn(),
		storeSettings: vi.fn(async () => [...saved]),
		saveStoreSettings,
		billAnomalies: vi.fn(async () => []),
	} as unknown as LoyaltySource;
	return { source, saveStoreSettings };
}

function renderTab(
	membership: Membership,
	loyalty: LoyaltySource,
	stores = [
		{ id: STORE_A, name: "Cửa hàng A" },
		{ id: STORE_B, name: "Cửa hàng B" },
	],
) {
	const source: SettingsSource = {
		...createDemoSettingsSource(new DemoSettingsStore()),
		kind: loyalty.kind,
		membership: async () => membership,
	};
	current.state = { status: "ready", source, loyalty, customers: null };
	current.stores = stores;
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<MemoryRouter>
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<QueryClientProvider client={client}>
					<ConfirmationTab />
				</QueryClientProvider>
			</I18nProvider>
		</MemoryRouter>,
	);
}

const OWNER: Membership = { role: "owner", storeIds: null };
const OWNER_OF_A: Membership = { role: "owner", storeIds: [STORE_A] };
const OWNER_OF_B: Membership = { role: "owner", storeIds: [STORE_B] };
const MANAGER: Membership = { role: "manager", storeIds: null };
const VIEWER: Membership = { role: "viewer", storeIds: null };

afterEach(() => {
	current.state = { status: "loading" };
	current.stores = [];
});

async function form(): Promise<HTMLElement> {
	return screen.findByTestId("loyalty-confirmation-form");
}

describe("Xác nhận tại quầy", () => {
	it("explains both ways with their trade-off and lists each store with its mode", async () => {
		const { source } = fakeLoyalty([
			settingsOf(STORE_A, "pos_sync"),
			settingsOf(STORE_B, "staff"),
		]);
		renderTab(OWNER, source);
		const cards = screen.getAllByTestId("loyalty-confirmation-compare");
		expect(cards[0]).toHaveTextContent("Khớp hóa đơn POS (mặc định)");
		expect(cards[0]).toHaveTextContent("chờ lần đồng bộ");
		expect(cards[1]).toHaveTextContent("dùng được với mọi POS");
		expect(cards[1]).toHaveTextContent("hạn mức và kiểm tra ngẫu nhiên");
		const stores = await screen.findAllByTestId("loyalty-confirmation-store");
		expect(
			stores.map(
				(store) =>
					within(store).getByTestId("loyalty-confirmation-mode").dataset.mode,
			),
		).toEqual(["pos_sync", "staff"]);
		expect(stores[0]).toHaveAttribute("aria-pressed", "true");
	});

	// Decision table (ISTQB): role and store scope x the store's mode -> the
	// owner of the store edits, every other combination reads only, with the
	// reason the database would give (set_loyalty_store_settings: 42501).
	it.each([
		["owner of every store", OWNER, "pos_sync", true, null],
		["owner of every store", OWNER, "staff", true, null],
		["owner of that store", OWNER_OF_A, "pos_sync", true, null],
		["owner of that store", OWNER_OF_A, "staff", true, null],
		["owner of another store", OWNER_OF_B, "pos_sync", false, "scope"],
		["owner of another store", OWNER_OF_B, "staff", false, "scope"],
		["manager", MANAGER, "pos_sync", false, "ownerOnly"],
		["manager", MANAGER, "staff", false, "ownerOnly"],
		["viewer", VIEWER, "pos_sync", false, "ownerOnly"],
		["viewer", VIEWER, "staff", false, "ownerOnly"],
	] as const)(
		"the %s on a store in %s mode edits: %s (reason %s)",
		async (_name, membership, mode, edits, reason) => {
			const { source } = fakeLoyalty([settingsOf(STORE_A, mode)]);
			renderTab(membership, source, [{ id: STORE_A, name: "Cửa hàng A" }]);
			const box = await form();
			const radio = within(box).getByTestId(
				"loyalty-confirmation-mode-staff",
			) as HTMLInputElement;
			await waitFor(() => expect(radio.disabled).toBe(!edits));
			expect(radio.checked).toBe(mode === "staff");
			const shiftCap = within(box).getByTestId(
				"loyalty-confirmation-billStaffShiftCap",
			);
			if (edits) {
				expect(shiftCap).not.toHaveAttribute("readonly");
				expect(within(box).getByTestId("settings-save-bar")).toBeVisible();
				expect(
					screen.queryByTestId("loyalty-confirmation-read-only"),
				).toBeNull();
			} else {
				expect(shiftCap).toHaveAttribute("readonly");
				expect(within(box).queryByTestId("settings-save-bar")).toBeNull();
				expect(
					screen.getByTestId("loyalty-confirmation-read-only"),
				).toHaveAttribute("data-reason", reason);
			}
		},
	);

	it("shows the demo's sample stores read only, with its own note", async () => {
		renderTab(OWNER, createDemoLoyaltySource(), [
			{ id: DEMO_STAFF_MODE_STORE, name: "Demo 1" },
			{ id: "MOCK-S2", name: "Demo 2" },
		]);
		expect(screen.getByTestId("loyalty-confirmation-demo")).toHaveTextContent(
			"chỉ để đọc",
		);
		const box = await form();
		expect(
			within(box).getByTestId("loyalty-confirmation-mode-staff"),
		).toBeDisabled();
		expect(
			within(box).getByTestId("loyalty-confirmation-mode-staff"),
		).toBeChecked();
		expect(within(box).queryByTestId("settings-save-bar")).toBeNull();
		expect(screen.queryByTestId("loyalty-confirmation-read-only")).toBeNull();
	});

	it("lets the owner switch a store to staff mode, warns what changes and sends only the mode", async () => {
		const user = userEvent.setup();
		const { source, saveStoreSettings } = fakeLoyalty([
			settingsOf(STORE_A, "pos_sync"),
			settingsOf(STORE_B, "pos_sync"),
		]);
		renderTab(OWNER, source);
		const stores = await screen.findAllByTestId("loyalty-confirmation-store");
		await user.click(stores[1] as HTMLElement);
		const box = await form();
		expect(box).toHaveAttribute("data-store", STORE_B);
		expect(
			within(box).getByTestId("loyalty-confirmation-switch"),
		).toHaveTextContent("có thể đặt trước");
		await user.click(
			within(box).getByTestId("loyalty-confirmation-mode-staff"),
		);
		expect(
			within(box).getByTestId("loyalty-confirmation-switch"),
		).toHaveTextContent("hóa đơn POS không còn tích điểm");
		await user.click(within(box).getByTestId("settings-save"));
		await waitFor(() => expect(saveStoreSettings).toHaveBeenCalledTimes(1));
		expect(saveStoreSettings.mock.calls[0]).toEqual([
			TENANT.id,
			STORE_B,
			{ confirmation: "staff" },
		]);
		await waitFor(() =>
			expect(
				within(
					screen.getAllByTestId("loyalty-confirmation-store")[1] as HTMLElement,
				).getByTestId("loyalty-confirmation-mode"),
			).toHaveAttribute("data-mode", "staff"),
		);
	});

	// Boundary value: one above the largest staff cap the database accepts.
	it("refuses a cap outside the database's range before sending anything", async () => {
		const user = userEvent.setup();
		const { source, saveStoreSettings } = fakeLoyalty([
			settingsOf(STORE_A, "staff"),
		]);
		renderTab(OWNER, source, [{ id: STORE_A, name: "Cửa hàng A" }]);
		const box = await form();
		const cap = within(box).getByTestId(
			"loyalty-confirmation-billStaffShiftCap",
		);
		await user.clear(cap);
		await user.type(cap, "1001");
		expect(
			await within(box).findByText(/1\.000/, {
				selector: '[data-testid="settings-field-error"]',
			}),
		).toBeVisible();
		await user.click(within(box).getByTestId("settings-save"));
		expect(saveStoreSettings).not.toHaveBeenCalled();
		await user.clear(cap);
		await user.type(cap, "1000");
		await user.click(within(box).getByTestId("settings-save"));
		await waitFor(() => expect(saveStoreSettings).toHaveBeenCalledTimes(1));
		expect(saveStoreSettings.mock.calls[0]?.[2]).toEqual({
			billStaffShiftCap: 1000,
		});
	});

	it("shows the refusal of the database and keeps the draft", async () => {
		const user = userEvent.setup();
		const { source, saveStoreSettings } = fakeLoyalty([
			settingsOf(STORE_A, "pos_sync"),
		]);
		saveStoreSettings.mockRejectedValueOnce(
			new SettingsWriteError("forbidden"),
		);
		renderTab(OWNER, source, [{ id: STORE_A, name: "Cửa hàng A" }]);
		const box = await form();
		await user.click(
			within(box).getByTestId("loyalty-confirmation-mode-staff"),
		);
		await user.click(within(box).getByTestId("settings-save"));
		await waitFor(() =>
			expect(
				within(box).getByTestId("settings-save-bar-status"),
			).not.toHaveTextContent(/^$/),
		);
		expect(
			within(box).getByTestId("loyalty-confirmation-mode-staff"),
		).toBeChecked();
	});

	it("counts each changed control once", () => {
		const draft = draftOf(
			settingsOf(STORE_A, "pos_sync"),
			createFormatters({
				currencyCode: "VND",
				uiLocale: "vi-VN",
				timeZone: TENANT.timeZone,
				unitLabels: { million: "tr", billion: "tỷ" },
			}),
		);
		expect(pendingCountOf(draft, draft)).toBe(0);
		expect(
			pendingCountOf(draft, {
				...draft,
				confirmation: "staff",
				texts: { ...draft.texts, billStaffShiftCap: "30" },
			}),
		).toBe(2);
	});

	it("says so when no store is in scope", () => {
		const { source } = fakeLoyalty([]);
		renderTab(OWNER, source, []);
		expect(screen.getByTestId("loyalty-confirmation-no-stores")).toBeVisible();
	});
});
