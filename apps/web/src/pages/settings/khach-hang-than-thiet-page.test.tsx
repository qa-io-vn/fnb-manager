import { DEFAULT_LOYALTY_PARAMETERS } from "@fnb/core";
import { DemoSettingsStore, demoStoreIds } from "@fnb/demo-analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { createDemoLoyaltySource } from "../../loyalty/demo-loyalty-source";
import type {
	LoyaltyProgrammeRecord,
	LoyaltySource,
	StaffPhoneRow,
} from "../../loyalty/source";
import { createDemoSettingsSource } from "../../settings/demo-settings-source";
import type { Membership, SettingsSource } from "../../settings/source";
import KhachHangThanThietPage, {
	preferredProgramme,
	withSavedProgramme,
} from "./khach-hang-than-thiet-page";

const TENANT = {
	id: "33333333-3333-4333-8333-333333333333",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: "Asia/Ho_Chi_Minh",
	countryCode: "VN",
};

const [STORE_1 = ""] = demoStoreIds();
const COUNTRY = "+84";
const STAFF_PHONE = `${COUNTRY}900000777`;

const current = vi.hoisted(() => ({ state: { status: "loading" } as unknown }));

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

function programme(
	overrides: Partial<LoyaltyProgrammeRecord> = {},
): LoyaltyProgrammeRecord {
	return {
		id: "11111111-1111-4111-8111-111111111111",
		name: "Tích dấu thử",
		startsOn: "2026-12-01",
		endsOn: null,
		rewardBudgetAmount: 0,
		status: "draft",
		notificationDecision: "pending",
		notificationDecidedAt: null,
		notificationBasis: null,
		parameters: DEFAULT_LOYALTY_PARAMETERS,
		createdAt: "2026-11-18T00:00:00Z",
		audit: null,
		...overrides,
	};
}

function fakeLoyalty(
	programmes: LoyaltyProgrammeRecord[],
	phones: StaffPhoneRow[] = [],
): LoyaltySource & {
	readonly saveProgramme: ReturnType<typeof vi.fn>;
	readonly addStaffPhone: ReturnType<typeof vi.fn>;
	readonly removeStaffPhone: ReturnType<typeof vi.fn>;
	readonly staffPhones: ReturnType<typeof vi.fn>;
} {
	const rows = [...phones];
	const saved = [...programmes];
	return {
		kind: "supabase",
		programmes: vi.fn(async () => [...saved]),
		saveProgramme: vi.fn(async (_tenantId, change) => {
			const row = programme({
				...change,
				id: change.id ?? "22222222-2222-4222-8222-222222222222",
			});
			saved.splice(0, saved.length, row);
			return row;
		}),
		staffPhones: vi.fn(async () => [...rows]),
		addStaffPhone: vi.fn(async (_tenantId, change) => {
			const row = {
				id: `phone-${rows.length + 1}`,
				phone: change.phone,
				label: change.label,
				createdAt: "2026-11-19T01:00:00Z",
			};
			rows.push(row);
			return row;
		}),
		removeStaffPhone: vi.fn(async (_tenantId, id: string) => {
			rows.splice(
				rows.findIndex((row) => row.id === id),
				1,
			);
		}),
	};
}

function renderPage(membership: Membership, loyalty: LoyaltySource) {
	const source: SettingsSource = {
		...createDemoSettingsSource(new DemoSettingsStore()),
		kind: loyalty.kind,
		membership: async () => membership,
	};
	current.state = { status: "ready", source, loyalty, customers: null };
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<MemoryRouter>
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<QueryClientProvider client={client}>
					<KhachHangThanThietPage />
				</QueryClientProvider>
			</I18nProvider>
		</MemoryRouter>,
	);
}

const OWNER: Membership = { role: "owner", storeIds: null };

afterEach(() => {
	current.state = { status: "loading" };
});

function bodyText(): string {
	return document.body.textContent ?? "";
}

describe("Khách hàng thân thiết", () => {
	it("picks the active programme first and keeps a saved one in place", () => {
		const draft = programme({ id: "d", status: "draft" });
		const active = programme({ id: "a", status: "active" });
		expect(preferredProgramme([draft, active])?.id).toBe("a");
		expect(preferredProgramme([])).toBeNull();
		expect(
			withSavedProgramme([draft], { ...draft, name: "Mới" })?.map(
				(row) => row.name,
			),
		).toEqual(["Mới"]);
		expect(withSavedProgramme([draft], active)?.map((row) => row.id)).toEqual([
			"a",
			"d",
		]);
	});

	it("shows the demo's sample programme read only, with masked sample staff phones", async () => {
		renderPage(OWNER, createDemoLoyaltySource());
		expect(await screen.findByTestId("loyalty-demo")).toHaveTextContent(
			"chương trình mẫu",
		);
		expect(
			(await screen.findByRole("textbox", {
				name: "Tên chương trình",
			})) as HTMLInputElement,
		).toHaveAttribute("readonly");
		expect(screen.queryByTestId("settings-save-bar")).toBeNull();
		const phones = await screen.findAllByTestId("loyalty-phone-masked");
		expect(phones.map((phone) => phone.textContent)).toEqual([
			`${COUNTRY} ••• ••• 101`,
			`${COUNTRY} ••• ••• 102`,
		]);
		expect(screen.queryByTestId("loyalty-phone-form")).toBeNull();
		expect(screen.queryByTestId("loyalty-phone-remove")).toBeNull();
	});

	it("lets the owner create the first programme from the defaults", async () => {
		const user = userEvent.setup();
		const loyalty = fakeLoyalty([]);
		renderPage(OWNER, loyalty);
		expect(await screen.findByTestId("loyalty-empty")).toBeVisible();
		await user.click(screen.getByTestId("loyalty-create"));
		await user.type(
			screen.getByRole("textbox", { name: "Tên chương trình" }),
			"Tích dấu mùa đông",
		);
		await user.click(screen.getByTestId("settings-save"));
		await waitFor(() => expect(loyalty.saveProgramme).toHaveBeenCalledTimes(1));
		expect(loyalty.saveProgramme.mock.calls[0]?.[1]).toMatchObject({
			id: null,
			name: "Tích dấu mùa đông",
			status: "draft",
			notificationDecision: "pending",
			parameters: DEFAULT_LOYALTY_PARAMETERS,
		});
		expect(await screen.findByText("Đã lưu.", { exact: false })).toBeVisible();
	});

	it("lets the owner add a staff phone in any form, shown masked, and remove it", async () => {
		const user = userEvent.setup();
		const loyalty = fakeLoyalty([programme()]);
		renderPage(OWNER, loyalty);
		const form = await screen.findByTestId("loyalty-phone-form");
		await user.type(within(form).getByTestId("loyalty-phone-input"), "12");
		await user.click(within(form).getByTestId("loyalty-phone-add"));
		expect(
			within(form).getByText("Số điện thoại không đọc được."),
		).toBeVisible();
		expect(loyalty.addStaffPhone).not.toHaveBeenCalled();
		await user.clear(within(form).getByTestId("loyalty-phone-input"));
		await user.type(
			within(form).getByTestId("loyalty-phone-input"),
			"090 000 0777",
		);
		await user.type(within(form).getByTestId("loyalty-phone-label"), "Pha chế");
		await user.click(within(form).getByTestId("loyalty-phone-add"));
		await waitFor(() =>
			expect(loyalty.addStaffPhone).toHaveBeenCalledWith(TENANT.id, {
				phone: STAFF_PHONE,
				label: "Pha chế",
			}),
		);
		expect(await screen.findByTestId("loyalty-phone-masked")).toHaveTextContent(
			`${COUNTRY} ••• ••• 777`,
		);
		expect(screen.getByTestId("loyalty-phones-status")).toHaveTextContent(
			`Đã thêm số ${COUNTRY} ••• ••• 777.`,
		);
		expect(within(form).getByTestId("loyalty-phone-input")).toHaveValue("");
		expect(bodyText()).not.toContain(STAFF_PHONE);
		expect(bodyText()).not.toContain("0777");
		await user.click(screen.getByTestId("loyalty-phone-remove"));
		await waitFor(() =>
			expect(loyalty.removeStaffPhone).toHaveBeenCalledWith(
				TENANT.id,
				"phone-1",
			),
		);
		expect(await screen.findByTestId("loyalty-phones-none")).toBeVisible();
	});

	it("gives a viewer the programme read only and no staff phones", async () => {
		const loyalty = fakeLoyalty([programme()]);
		renderPage({ role: "viewer", storeIds: null }, loyalty);
		expect(await screen.findByTestId("settings-read-only")).toHaveTextContent(
			"Bạn chỉ xem được chương trình.",
		);
		expect(
			(await screen.findByRole("textbox", {
				name: "Tên chương trình",
			})) as HTMLInputElement,
		).toHaveAttribute("readonly");
		expect(screen.queryByTestId("settings-save-bar")).toBeNull();
		expect(screen.queryByTestId("loyalty-staff-phones")).toBeNull();
		expect(loyalty.staffPhones).not.toHaveBeenCalled();
		expect(screen.getByTestId("loyalty-members-link")).toBeVisible();
	});

	it("gives staff the programme read only, no staff phones and no link to the members", async () => {
		const loyalty = fakeLoyalty([programme()]);
		renderPage({ role: "staff", storeIds: null }, loyalty);
		expect(await screen.findByTestId("settings-read-only")).toBeVisible();
		expect(screen.queryByTestId("settings-save-bar")).toBeNull();
		expect(screen.queryByTestId("loyalty-staff-phones")).toBeNull();
		expect(screen.queryByTestId("loyalty-members-link")).toBeNull();
	});

	it("gives a store-limited manager the programme and the staff phones read only", async () => {
		const loyalty = fakeLoyalty(
			[programme()],
			[
				{
					id: "phone-1",
					phone: STAFF_PHONE,
					label: null,
					createdAt: "2026-11-18T00:00:00Z",
				},
			],
		);
		renderPage({ role: "manager", storeIds: [STORE_1] }, loyalty);
		expect(await screen.findByTestId("settings-read-only")).toHaveAttribute(
			"data-reason",
			"scope",
		);
		expect(await screen.findByTestId("loyalty-phone-masked")).toHaveTextContent(
			`${COUNTRY} ••• ••• 777`,
		);
		expect(screen.queryByTestId("loyalty-phone-form")).toBeNull();
		expect(screen.queryByTestId("loyalty-phone-remove")).toBeNull();
		expect(bodyText()).not.toContain(STAFF_PHONE);
	});
});
