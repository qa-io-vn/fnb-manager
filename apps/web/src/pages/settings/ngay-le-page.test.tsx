import { DemoSettingsStore } from "@fnb/demo-analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { todayIn } from "../../lib/business-dates";
import { createDemoSettingsSource } from "../../settings/demo-settings-source";
import {
	type Membership,
	type SettingsSource,
	SettingsWriteError,
} from "../../settings/source";
import NgayLePage, { holidayErrorKey } from "./ngay-le-page";

const TENANT = {
	id: "33333333-3333-4333-8333-333333333333",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: "Asia/Ho_Chi_Minh",
	countryCode: "VN",
};

const SAVED_BY_YOU = /^Bạn sửa lần cuối \d{2}\/\d{2}\/\d{4} lúc \d{2}:\d{2}\.$/;

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

function sourceFor(
	store: DemoSettingsStore,
	membership: Membership = { role: "owner", storeIds: null },
	overrides: Partial<SettingsSource> = {},
): SettingsSource {
	return {
		...createDemoSettingsSource(store),
		membership: async () => membership,
		...overrides,
	};
}

function renderPage(source: SettingsSource) {
	current.state = { status: "ready", source };
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<I18nProvider language="vi" onLanguageChange={() => undefined}>
			<QueryClientProvider client={client}>
				<NgayLePage />
			</QueryClientProvider>
		</I18nProvider>,
	);
	return client;
}

async function chooseYear(
	user: ReturnType<typeof userEvent.setup>,
	year: number,
) {
	await user.selectOptions(await screen.findByLabelText("Năm"), String(year));
	await waitFor(() =>
		expect(screen.getByTestId("holidays-page")).toHaveAttribute(
			"data-year",
			String(year),
		),
	);
	await screen.findByTestId("holidays-global");
	return screen.findByTestId("holidays-custom");
}

async function writable() {
	await waitFor(() =>
		expect(screen.queryByText("Đang kiểm tra quyền sửa của bạn…")).toBeNull(),
	);
	return screen.findByTestId("holidays-add");
}

async function addDay(
	user: ReturnType<typeof userEvent.setup>,
	date: string,
	name: string,
) {
	const form = await writable();
	const dateInput = within(form).getByLabelText("Ngày");
	await user.clear(dateInput);
	await user.type(dateInput, date);
	const nameInput = within(form).getByLabelText("Tên");
	await user.clear(nameInput);
	await user.type(nameInput, name);
	await user.click(within(form).getByRole("button", { name: "Thêm" }));
}

function status() {
	return screen.getByTestId("holidays-status");
}

describe("the Ngày lễ page", () => {
	afterEach(() => window.localStorage.clear());

	it("opens on the current year and offers every year from 2024 to 2030", async () => {
		renderPage(sourceFor(new DemoSettingsStore()));
		const select = await screen.findByLabelText("Năm");
		const thisYear = Math.min(
			Math.max(Number(todayIn(TENANT.timeZone, new Date()).slice(0, 4)), 2024),
			2030,
		);
		expect(select).toHaveValue(String(thisYear));
		expect(
			within(select)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["2024", "2025", "2026", "2027", "2028", "2029", "2030"]);
		expect(
			screen.getByText(
				"Chọn từ năm 2024 đến năm 2030; lịch ngày lễ quốc gia có sẵn cho các năm 2024 đến 2028.",
			),
		).toBeVisible();
	});

	it("shows the national days of the chosen year read-only, named in Vietnamese and labelled by kind", async () => {
		const user = userEvent.setup();
		renderPage(sourceFor(new DemoSettingsStore()));
		await chooseYear(user, 2026);
		const global = await screen.findByTestId("holidays-global");
		expect(
			within(global).getByTestId("holidays-global-note"),
		).toHaveTextContent("Lịch này có sẵn cho các năm 2024 đến 2028");
		const rows = within(global).getAllByTestId("holiday-row");
		expect(rows.length).toBeGreaterThan(10);
		for (const row of rows) {
			expect(row).toHaveAttribute("data-custom", "false");
			expect(row.querySelectorAll("button, input, select")).toHaveLength(0);
			expect(row.dataset.date?.startsWith("2026-")).toBe(true);
		}
		const tetDay1 = rows.find((row) => within(row).queryByText("Mùng 1 Tết"));
		expect(tetDay1).toBeDefined();
		if (tetDay1 === undefined) return;
		expect(within(tetDay1).getByTestId("holiday-kind")).toHaveTextContent(
			"Tết",
		);
		expect(within(tetDay1).getByTestId("holiday-date")).toHaveTextContent(
			"Thứ Ba, 17/02/2026",
		);
		const reunification = rows.find((row) =>
			within(row).queryByText("Ngày Giải phóng miền Nam, thống nhất đất nước"),
		);
		expect(
			reunification && within(reunification).getByTestId("holiday-kind"),
		).toHaveTextContent("Ngày lễ");
		expect(global).not.toHaveTextContent("Reunification Day");
		await chooseYear(user, 2029);
		expect(
			await screen.findByTestId("holidays-global-empty"),
		).toHaveTextContent("Chưa có lịch ngày lễ quốc gia cho năm 2029");
	});

	it("adds a day off with its author and deletes it, with delete offered on own days only", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		renderPage(sourceFor(store));
		const custom = await chooseYear(user, 2026);
		expect(
			within(custom).getByTestId("holidays-custom-empty"),
		).toHaveTextContent("Chưa có ngày nghỉ riêng nào trong năm 2026.");
		expect(within(custom).getByRole("note")).toHaveTextContent(
			"Ngày nghỉ riêng không tính vào mức nền và dự báo",
		);
		await addDay(user, "2026-03-09", "  Nghỉ sửa quán ");
		await waitFor(() =>
			expect(status()).toHaveTextContent(
				"Đã thêm Nghỉ sửa quán, Thứ Hai, 09/03/2026.",
			),
		);
		expect(store.customHolidays()).toEqual([
			{
				countryCode: "VN",
				holidayDate: "2026-03-09",
				name: "Nghỉ sửa quán",
				kind: "custom",
			},
		]);
		const [row] = within(custom).getAllByTestId("holiday-row");
		expect(row).toHaveAttribute("data-custom", "true");
		expect(row).toHaveTextContent("Nghỉ sửa quán");
		expect(
			within(row as HTMLElement).getByTestId("settings-audit-line"),
		).toHaveTextContent(SAVED_BY_YOU);
		expect(within(custom).getByLabelText("Tên")).toHaveValue("");
		expect(screen.getAllByTestId("holiday-delete")).toHaveLength(1);
		expect(
			within(screen.getByTestId("holidays-global")).queryAllByRole("button"),
		).toHaveLength(0);
		await user.click(
			screen.getByRole("button", {
				name: "Xóa Nghỉ sửa quán, Thứ Hai, 09/03/2026",
			}),
		);
		await waitFor(() =>
			expect(status()).toHaveTextContent(
				"Đã xóa Nghỉ sửa quán, Thứ Hai, 09/03/2026.",
			),
		);
		expect(store.customHolidays()).toEqual([]);
		expect(
			await within(custom).findByTestId("holidays-custom-empty"),
		).toBeInTheDocument();
		await waitFor(() =>
			expect(within(custom).getByTestId("holidays-custom-title")).toHaveFocus(),
		);
	});

	it("refuses a name over 80 characters, an empty form and a date outside the calendar before sending", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		const addHoliday = vi.fn(createDemoSettingsSource(store).addHoliday);
		renderPage(sourceFor(store, undefined, { addHoliday }));
		const form = await writable();
		await user.click(within(form).getByRole("button", { name: "Thêm" }));
		expect(within(form).getAllByTestId("settings-field-error")).toHaveLength(2);
		await addDay(user, "2031-01-02", "a".repeat(81));
		const errors = within(form).getAllByTestId("settings-field-error");
		expect(errors.map((error) => error.textContent)).toEqual([
			"Chọn ngày từ 01/01/2024 đến 31/12/2030.",
			"Nhập tối đa 80 ký tự.",
		]);
		expect(within(form).getByLabelText("Tên")).toHaveAttribute(
			"aria-invalid",
			"true",
		);
		expect(addHoliday).not.toHaveBeenCalled();
		await addDay(user, "2026-05-04", "ạ".repeat(80));
		await waitFor(() => expect(addHoliday).toHaveBeenCalledTimes(1));
		expect(addHoliday.mock.calls[0]?.[1]).toEqual({
			holidayDate: "2026-05-04",
			name: "ạ".repeat(80),
		});
	});

	it("holds back a name the date already has, and names the database's duplicate refusal", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		const addHoliday = vi.fn(createDemoSettingsSource(store).addHoliday);
		renderPage(sourceFor(store, undefined, { addHoliday }));
		await chooseYear(user, 2026);
		await addDay(user, "2026-03-09", "Nghỉ sửa quán");
		await waitFor(() => expect(addHoliday).toHaveBeenCalledTimes(1));
		await addDay(user, "2026-03-09", "Nghỉ sửa quán");
		expect(
			await screen.findByText("Ngày này đã có ngày nghỉ riêng cùng tên."),
		).toBeVisible();
		expect(addHoliday).toHaveBeenCalledTimes(1);
		addHoliday.mockRejectedValueOnce(new SettingsWriteError("duplicate"));
		await addDay(user, "2026-03-10", "Nghỉ sửa quán");
		await waitFor(() =>
			expect(status()).toHaveTextContent(
				"Không lưu được: ngày này đã có ngày nghỉ riêng cùng tên.",
			),
		);
		expect(
			holidayErrorKey("delete", {
				errorCode: "duplicate",
				errorKey: "settings.error.duplicate",
			}),
		).toBe("settings.error.duplicate");
	});

	it("moves to the year of a day added in another year, keeping the form, its focus and the status line mounted", async () => {
		const user = userEvent.setup();
		renderPage(sourceFor(new DemoSettingsStore()));
		const custom = await chooseYear(user, 2026);
		const status = within(custom).getByTestId("holidays-status");
		const submit = within(custom).getByRole("button", { name: "Thêm" });
		await addDay(user, "2027-02-01", "Nghỉ đầu năm");
		await waitFor(() =>
			expect(screen.getByTestId("holidays-page")).toHaveAttribute(
				"data-year",
				"2027",
			),
		);
		expect(screen.getByLabelText("Năm")).toHaveValue("2027");
		expect(await within(custom).findByText("Nghỉ đầu năm")).toBeVisible();
		expect(screen.getByTestId("holidays-custom")).toBe(custom);
		expect(within(custom).getByTestId("holidays-status")).toBe(status);
		expect(status).toHaveTextContent("Đã thêm Nghỉ đầu năm");
		expect(within(custom).getByRole("button", { name: "Thêm" })).toBe(submit);
		expect(submit).toHaveFocus();
	});

	it("sends the same day again after a lost connection through the add's own path: the form empties and the year moves", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		const addHoliday = vi.fn(createDemoSettingsSource(store).addHoliday);
		addHoliday.mockRejectedValueOnce(new SettingsWriteError("network"));
		renderPage(sourceFor(store, undefined, { addHoliday }));
		const custom = await chooseYear(user, 2026);
		const status = within(custom).getByTestId("holidays-status");
		await addDay(user, "2027-02-01", "Nghỉ đầu năm");
		await waitFor(() =>
			expect(status).toHaveTextContent(
				"Không lưu được vì mất kết nối; kiểm tra mạng rồi thử lại.",
			),
		);
		expect(store.customHolidays()).toEqual([]);
		expect(screen.getByTestId("holidays-page")).toHaveAttribute(
			"data-year",
			"2026",
		);
		await user.click(screen.getByTestId("settings-retry-save"));
		await waitFor(() =>
			expect(status).toHaveTextContent(
				"Đã thêm Nghỉ đầu năm, Thứ Hai, 01/02/2027.",
			),
		);
		expect(addHoliday).toHaveBeenCalledTimes(2);
		expect(store.customHolidays()).toHaveLength(1);
		expect(screen.queryByTestId("settings-retry-save")).toBeNull();
		await waitFor(() =>
			expect(screen.getByTestId("holidays-page")).toHaveAttribute(
				"data-year",
				"2027",
			),
		);
		expect(screen.getByLabelText("Năm")).toHaveValue("2027");
		const form = within(custom).getByTestId("holidays-add");
		expect(within(form).getByLabelText("Ngày")).toHaveValue("");
		expect(within(form).getByLabelText("Tên")).toHaveValue("");
		expect(within(form).queryAllByTestId("settings-field-error")).toHaveLength(
			0,
		);
		expect(await within(custom).findByText("Nghỉ đầu năm")).toBeVisible();
		expect(within(custom).getByTestId("holidays-status")).toBe(status);
		expect(within(custom).getByTestId("holidays-custom-title")).toHaveFocus();
	});

	it.each([
		[
			{ role: "manager", storeIds: ["MOCK-S1"] },
			"scope",
			"chỉ chủ hoặc quản lý xem được tất cả cửa hàng mới sửa được",
		],
		[
			{ role: "staff", storeIds: null },
			"role",
			"Chỉ chủ và quản lý xem được tất cả cửa hàng mới sửa được",
		],
		[
			{ role: "viewer", storeIds: null },
			"role",
			"Chỉ chủ và quản lý xem được tất cả cửa hàng mới sửa được",
		],
	] as const)(
		"shows %o the days without add or delete, with the reason %s",
		async (membership, reason, text) => {
			const user = userEvent.setup();
			const store = new DemoSettingsStore();
			store.saveHolidays([
				{
					countryCode: "VN",
					holidayDate: "2026-03-09",
					name: "Nghỉ sửa quán",
					kind: "custom",
				},
			]);
			renderPage(sourceFor(store, membership));
			const custom = await chooseYear(user, 2026);
			const notice = await within(custom).findByTestId("settings-read-only");
			expect(notice).toHaveAttribute("data-reason", reason);
			expect(notice).toHaveTextContent(text);
			expect(within(custom).getByText("Nghỉ sửa quán")).toBeVisible();
			expect(screen.queryByTestId("holidays-add")).toBeNull();
			expect(screen.queryAllByTestId("holiday-delete")).toHaveLength(0);
		},
	);

	it("says the year could not be read and reads it again on Thử lại", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		const holidays = vi.fn(createDemoSettingsSource(store).holidays);
		holidays.mockRejectedValueOnce(new Error("offline"));
		renderPage(sourceFor(store, undefined, { holidays }));
		const failed = await screen.findByTestId("holidays-load-failed");
		expect(failed).toHaveTextContent("Chưa đọc được ngày lễ của năm");
		await user.click(within(failed).getByRole("button", { name: "Thử lại" }));
		expect(await screen.findByTestId("holidays-global")).toBeInTheDocument();
		expect(holidays).toHaveBeenCalledTimes(2);
	});
});
