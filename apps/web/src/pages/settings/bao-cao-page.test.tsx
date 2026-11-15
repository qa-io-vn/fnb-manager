import { DemoSettingsStore } from "@fnb/demo-analytics";
import { DEFAULT_REPORT_SETTINGS } from "@fnb/reports";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { createDemoSettingsSource } from "../../settings/demo-settings-source";
import {
	type Membership,
	type SettingsSource,
	SettingsWriteError,
} from "../../settings/source";
import { PREFERENCES_KEY, PreferencesProvider } from "../../state/preferences";
import BaoCaoPage from "./bao-cao-page";

const TENANT = {
	id: "33333333-3333-4333-8333-333333333333",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: "Asia/Ho_Chi_Minh",
	countryCode: "VN",
};

const OTHER_TENANT = {
	...TENANT,
	id: "44444444-4444-4444-8444-444444444444",
	name: "Quán thứ hai",
};

const current = vi.hoisted(() => ({
	state: { status: "loading" } as
		| { status: "loading" }
		| { status: "failed" }
		| { status: "ready"; source: unknown },
	tenant: null as unknown,
}));

vi.mock("../../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({ tenant: current.tenant }),
}));

vi.mock("../../settings/settings-source-context", () => ({
	useSettingsSourceState: () => current.state,
}));

function sourceFor(
	store: DemoSettingsStore,
	membership: Membership | null = { role: "owner", storeIds: null },
): SettingsSource {
	return {
		...createDemoSettingsSource(store),
		membership: async () => membership,
	};
}

function pageIn(client: QueryClient) {
	return (
		<I18nProvider language="vi" onLanguageChange={() => undefined}>
			<QueryClientProvider client={client}>
				<PreferencesProvider>
					<BaoCaoPage />
				</PreferencesProvider>
			</QueryClientProvider>
		</I18nProvider>
	);
}

function renderPage(source: SettingsSource | "failed") {
	current.tenant = TENANT;
	current.state =
		source === "failed" ? { status: "failed" } : { status: "ready", source };
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return { client, ...render(pageIn(client)) };
}

async function windowDays(): Promise<HTMLElement> {
	return screen.findByRole("textbox", { name: "Số ngày xét thực đơn" });
}

async function saveAndWait(user: ReturnType<typeof userEvent.setup>) {
	await user.click(screen.getByRole("button", { name: "Lưu" }));
	await waitFor(() =>
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			"Đã lưu.",
		),
	);
}

describe("the Ngưỡng báo cáo page", () => {
	afterEach(() => window.localStorage.clear());

	it("says what saving changes and saves a threshold with who changed it", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		renderPage(sourceFor(store));
		expect(screen.getByTestId("thresholds-note")).toHaveTextContent(
			"báo cáo Ngày, Tháng, các báo cáo chủ đề và bản tin ngày",
		);
		const input = await windowDays();
		expect(input).toHaveValue("28");
		expect(screen.queryByTestId("settings-read-only")).toBeNull();
		await user.clear(input);
		await user.type(input, "21");
		await saveAndWait(user);
		expect(store.hasReportSettingsRow()).toBe(true);
		expect(store.reportSettings()).toEqual({
			...DEFAULT_REPORT_SETTINGS,
			menuWindowDays: 21,
		});
		expect(await windowDays()).toHaveValue("21");
		expect(screen.getByTestId("settings-audit-line")).toHaveTextContent(
			/^Bạn sửa lần cuối \d{2}\/\d{2}\/\d{4} lúc \d{2}:\d{2}\.$/,
		);
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"Chưa có thay đổi.",
		);
	});

	it("deletes the row when the defaults are restored and saved", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		store.saveReportSettings({
			...DEFAULT_REPORT_SETTINGS,
			cashAbsThreshold: 80_000,
			peakHours: 4,
		});
		renderPage(sourceFor(store));
		expect(await windowDays()).toHaveValue("28");
		expect(
			screen.getByRole("textbox", { name: "Chênh lệch két theo số tiền" }),
		).toHaveValue("80.000");
		await user.click(
			screen.getByRole("button", { name: "Khôi phục mặc định" }),
		);
		expect(store.hasReportSettingsRow()).toBe(true);
		await saveAndWait(user);
		expect(store.hasReportSettingsRow()).toBe(false);
		expect(store.reportSettings()).toEqual(DEFAULT_REPORT_SETTINGS);
		expect(
			screen.getByRole("textbox", { name: "Chênh lệch két theo số tiền" }),
		).toHaveValue("50.000");
		expect(screen.getByTestId("settings-audit-line")).toHaveTextContent(
			"Đang dùng giá trị mặc định.",
		);
	});

	it("tells a refused save apart and keeps what was typed", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		const source: SettingsSource = {
			...sourceFor(store),
			saveReportSettings: async () => {
				throw new SettingsWriteError("forbidden");
			},
		};
		renderPage(source);
		const input = await windowDays();
		await user.clear(input);
		await user.type(input, "35");
		await user.click(screen.getByRole("button", { name: "Lưu" }));
		await waitFor(() =>
			expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
				"tài khoản của bạn không có quyền sửa mục này",
			),
		);
		expect(input).toHaveValue("35");
		expect(store.hasReportSettingsRow()).toBe(false);
		await user.type(input, "0");
		expect(
			screen.getByTestId("settings-save-bar-status"),
		).not.toHaveTextContent("không có quyền");
	});

	it.each([
		[{ role: "manager", storeIds: null }, "chỉ chủ xem được tất cả cửa hàng"],
		[{ role: "owner", storeIds: ["s1"] }, "chỉ chủ xem được tất cả cửa hàng"],
		[{ role: "viewer", storeIds: null }, "chỉ chủ xem được tất cả cửa hàng"],
	] as const)(
		"shows %j the values read-only with the reason and no save control",
		async (membership, reason) => {
			const store = new DemoSettingsStore();
			store.saveReportSettings({ ...DEFAULT_REPORT_SETTINGS, peakHours: 4 });
			renderPage(sourceFor(store, membership));
			expect(await windowDays()).toHaveAttribute("readonly");
			await waitFor(() =>
				expect(screen.getByTestId("settings-read-only")).toHaveTextContent(
					reason,
				),
			);
			expect(
				screen.getByRole("textbox", { name: "Số giờ cao điểm" }),
			).toHaveValue("4");
			expect(screen.queryByTestId("settings-save-bar")).toBeNull();
			expect(screen.queryByTestId("settings-restore-defaults")).toBeNull();
		},
	);

	it("lets a member who may not write still choose this device's CSV format", async () => {
		const user = userEvent.setup();
		renderPage(
			sourceFor(new DemoSettingsStore(), { role: "viewer", storeIds: null }),
		);
		await windowDays();
		await user.click(
			screen.getByRole("radio", {
				name: "Dấu chấm phẩy cho Excel cài đặt vùng Việt Nam",
			}),
		);
		expect(
			JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? "{}")
				.csvDialect,
		).toBe("semicolon");
	});

	it("offers to try again when the thresholds could not be read", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		let failing = true;
		const working = sourceFor(store);
		renderPage({
			...working,
			reportSettings: async (tenantId) => {
				if (failing) throw new Error("offline");
				return working.reportSettings(tenantId);
			},
		});
		const failed = await screen.findByTestId("thresholds-load-failed");
		expect(failed).toHaveTextContent("Không tải được dữ liệu");
		failing = false;
		await user.click(screen.getByRole("button", { name: "Thử lại" }));
		expect(await windowDays()).toHaveValue("28");
	});

	it("keeps the form and what was typed when a later refresh of the thresholds fails", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		let failing = false;
		const working = sourceFor(store);
		const { client } = renderPage({
			...working,
			reportSettings: async (tenantId) => {
				if (failing) throw new Error("offline");
				return working.reportSettings(tenantId);
			},
		});
		const input = await windowDays();
		await user.clear(input);
		await user.type(input, "35");
		failing = true;
		await client.refetchQueries();
		expect(screen.queryByTestId("thresholds-load-failed")).toBeNull();
		expect(await windowDays()).toHaveValue("35");
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"1 thay đổi chưa lưu",
		);
	});

	it("shows the saved value and says it is saved even when reading it back fails", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		let failing = false;
		const working = sourceFor(store);
		renderPage({
			...working,
			reportSettings: async (tenantId) => {
				if (failing) throw new Error("offline");
				return working.reportSettings(tenantId);
			},
			saveReportSettings: async (tenantId, changes) => {
				await working.saveReportSettings(tenantId, changes);
				failing = true;
			},
		});
		const input = await windowDays();
		await user.clear(input);
		await user.type(input, "21");
		await saveAndWait(user);
		expect(store.reportSettings().menuWindowDays).toBe(21);
		expect(await windowDays()).toHaveValue("21");
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"Chưa có thay đổi.",
		);
		expect(screen.getByTestId("settings-audit-line")).toHaveTextContent(
			"Bạn sửa lần cuối",
		);
		await user.click(
			screen.getByRole("button", { name: "Khôi phục mặc định" }),
		);
		await user.click(screen.getByRole("button", { name: "Hủy thay đổi" }));
		expect(await windowDays()).toHaveValue("21");
	});

	it("opens a clean form, with no leftover edit or status, when the business changes", async () => {
		const user = userEvent.setup();
		const first = sourceFor(new DemoSettingsStore());
		const second = sourceFor(new DemoSettingsStore());
		const { client, rerender } = renderPage(first);
		expect(await windowDays()).toHaveValue("28");
		current.tenant = OTHER_TENANT;
		current.state = { status: "ready", source: second };
		rerender(pageIn(client));
		const input = await windowDays();
		await user.clear(input);
		await user.type(input, "35");
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"1 thay đổi chưa lưu",
		);
		current.tenant = TENANT;
		current.state = { status: "ready", source: first };
		rerender(pageIn(client));
		expect(await windowDays()).toHaveValue("28");
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"Chưa có thay đổi.",
		);
		expect(
			screen.getByTestId("settings-save-bar-status"),
		).toBeEmptyDOMElement();
	});

	it("says when the thresholds cannot be read, and still offers the device choice", () => {
		renderPage("failed");
		expect(screen.getByTestId("thresholds-load-failed")).toHaveTextContent(
			"Không tải được dữ liệu",
		);
		expect(screen.getByTestId("device-csv-choice")).toBeInTheDocument();
	});
});
