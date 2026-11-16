import { DemoSettingsStore } from "@fnb/demo-analytics";
import { ThemeCallError } from "@fnb/reports";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { todayIn } from "../../lib/business-dates";
import { createDemoSettingsSource } from "../../settings/demo-settings-source";
import {
	type Membership,
	type SettingsSource,
	SettingsWriteError,
	type StoreProfile,
} from "../../settings/source";
import CuaHangPage, { withSavedStore } from "./cua-hang-page";

const TENANT = {
	id: "33333333-3333-4333-8333-333333333333",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: "Asia/Ho_Chi_Minh",
	countryCode: "VN",
};

function nextYear(): number {
	return Number(todayIn(TENANT.timeZone, new Date()).slice(0, 4)) + 1;
}

const SAVED_BY_YOU = /^Bạn sửa lần cuối \d{2}\/\d{2}\/\d{4} lúc \d{2}:\d{2}\.$/;

const current = vi.hoisted(() => ({
	state: { status: "loading" } as unknown,
	analytics: { status: "loading" } as unknown,
}));

vi.mock("../../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({ tenant: TENANT, stores: [] }),
}));

vi.mock("../../settings/settings-source-context", () => ({
	useSettingsSourceState: () => current.state,
	useRetrySettingsSource: () => () => undefined,
}));

vi.mock("../../data/analytics-source-context", () => ({
	useAnalyticsSourceState: () => current.analytics,
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
): SettingsSource {
	return {
		...createDemoSettingsSource(store),
		membership: async () => membership,
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
				<CuaHangPage />
			</QueryClientProvider>
		</I18nProvider>,
	);
	return client;
}

async function storeBlock(storeId: string): Promise<HTMLElement> {
	const blocks = await screen.findAllByTestId("store-profile");
	const block = blocks.find(
		(candidate) => candidate.getAttribute("data-store") === storeId,
	);
	if (block === undefined) throw new Error(`no block for ${storeId}`);
	return block;
}

async function tenantBlock(): Promise<HTMLElement> {
	return screen.findByTestId("tenant-profile");
}

async function saveIn(
	user: ReturnType<typeof userEvent.setup>,
	block: HTMLElement,
	expected = "Đã lưu.",
) {
	await user.click(within(block).getByRole("button", { name: "Lưu" }));
	await waitFor(() =>
		expect(
			within(block).getByTestId("settings-save-bar-status"),
		).toHaveTextContent(expected),
	);
}

function membershipLoaded(block: HTMLElement) {
	return waitFor(() =>
		expect(within(block).queryByText("Đang kiểm tra quyền sửa của bạn…")).toBe(
			null,
		),
	);
}

describe("the Cửa hàng page", () => {
	beforeEach(() => {
		current.analytics = { status: "loading" };
	});

	afterEach(() => window.localStorage.clear());

	it("shows the POS facts of every store with their source and no input", async () => {
		renderPage(sourceFor(new DemoSettingsStore()));
		const first = await storeBlock("MOCK-S1");
		expect(await storeBlock("MOCK-S2")).toBeInTheDocument();
		expect(
			within(first).getByRole("heading", { level: 3, name: "Cửa hàng mẫu 1" }),
		).toBeInTheDocument();
		const facts = within(first).getByTestId("store-pos-facts");
		expect(within(facts).getAllByTestId("store-from-pos")).toHaveLength(4);
		for (const fact of facts.querySelectorAll("dd")) {
			expect(fact).toHaveTextContent("lấy từ POS");
		}
		expect(within(facts).getByTestId("store-pos-name")).toHaveTextContent(
			"Cửa hàng mẫu 1",
		);
		expect(within(facts).getByTestId("store-pos-address")).toHaveTextContent(
			"1 Đường Mẫu",
		);
		expect(within(facts).getByTestId("store-pos-time-zone")).toHaveTextContent(
			"Asia/Ho_Chi_Minh",
		);
		expect(within(facts).getByTestId("store-pos-day-start")).toHaveTextContent(
			"Ngày kinh doanh bắt đầu lúc00:00",
		);
		expect(facts.querySelectorAll("input, select, textarea")).toHaveLength(0);
		expect(within(first).getByLabelText("Mã cửa hàng")).toHaveValue("CH1");
		expect(within(first).getByLabelText("Số ghế")).toHaveValue("40");
		expect(within(first).getByLabelText("Hóa đơn điện tử")).toHaveValue(
			"configured",
		);
		expect(within(first).getByTestId("settings-audit-line")).toHaveTextContent(
			"Chưa lưu lần nào.",
		);
	});

	it("says a store has no opening hours yet, then saves seats and opening hours and shows who saved them", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		renderPage(sourceFor(store));
		const young = await storeBlock("MOCK-S2");
		await membershipLoaded(young);
		expect(within(young).getByTestId("opening-hours-editor")).toHaveTextContent(
			"Lưu giờ mở cửa sẽ đổi Giờ & ngày, các số liệu theo giờ mở cửa của Hôm nay",
		);
		expect(within(young).getByTestId("store-hours-unset")).toHaveTextContent(
			"Chưa nhập giờ mở cửa",
		);
		expect(
			within(await storeBlock("MOCK-S1")).queryByTestId("store-hours-unset"),
		).toBeNull();
		await user.type(within(young).getByLabelText("Số ghế"), "24");
		await user.click(
			within(young).getByRole("checkbox", { name: "Thứ Hai, nghỉ cả ngày" }),
		);
		await user.click(
			within(young).getByRole("button", {
				name: "Thứ Hai: chép sang các ngày khác",
			}),
		);
		expect(
			within(young).getByTestId("settings-save-bar-pending"),
		).toHaveTextContent("2 thay đổi chưa lưu");
		await saveIn(user, young);
		expect(store.seatCount("MOCK-S2")).toBe(24);
		expect(store.storeProfile("MOCK-S2")?.openingHours).toEqual({
			mon: [["07:00", "22:00"]],
			tue: [["07:00", "22:00"]],
			wed: [["07:00", "22:00"]],
			thu: [["07:00", "22:00"]],
			fri: [["07:00", "22:00"]],
			sat: [["07:00", "22:00"]],
			sun: [["07:00", "22:00"]],
		});
		await waitFor(() =>
			expect(
				within(young).getByTestId("settings-audit-line"),
			).toHaveTextContent(SAVED_BY_YOU),
		);
		expect(within(young).getByLabelText("Số ghế")).toHaveValue("24");
		expect(within(young).queryByTestId("store-hours-unset")).toBeNull();
		expect(
			within(young).getByTestId("settings-save-bar-pending"),
		).toHaveTextContent("Chưa có thay đổi.");
		expect(
			within(await storeBlock("MOCK-S1")).getByTestId("settings-audit-line"),
		).toHaveTextContent("Chưa lưu lần nào.");
	});

	it("saves the code, opening date and statuses and clears the seats", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		renderPage(sourceFor(store));
		const first = await storeBlock("MOCK-S1");
		await membershipLoaded(first);
		const code = within(first).getByLabelText("Mã cửa hàng");
		await user.clear(code);
		await user.type(code, " Q1 ");
		const opened = within(first).getByLabelText("Ngày khai trương");
		await user.clear(opened);
		await user.type(opened, "2019-06-01");
		await user.clear(within(first).getByLabelText("Số ghế"));
		await user.selectOptions(
			within(first).getByLabelText("Hóa đơn điện tử"),
			"Đã tắt",
		);
		await user.selectOptions(
			within(first).getByLabelText("Đánh số hóa đơn"),
			"Hằng năm",
		);
		await user.selectOptions(
			within(first).getByLabelText("Tính năng thành viên trên POS"),
			"Đang tắt",
		);
		expect(
			within(first).getByTestId("settings-save-bar-pending"),
		).toHaveTextContent("6 thay đổi chưa lưu");
		await saveIn(user, first);
		expect(store.storeProfile("MOCK-S1")).toMatchObject({
			code: "Q1",
			openedOn: "2019-06-01",
			seatCount: null,
			eInvoiceStatus: "disabled",
			tranNoResetPeriod: "yearly",
			memberCaptureStatus: "disabled",
		});
	});

	it("refuses a seat count, a code and an opening date outside their limits before saving", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		renderPage(sourceFor(store));
		const first = await storeBlock("MOCK-S1");
		await membershipLoaded(first);
		const seats = within(first).getByLabelText("Số ghế");
		await user.clear(seats);
		await user.type(seats, "6000");
		await user.tab();
		const code = within(first).getByLabelText("Mã cửa hàng");
		await user.clear(code);
		await user.type(code, "MA-QUA-DAI-13");
		const opened = within(first).getByLabelText("Ngày khai trương");
		await user.clear(opened);
		await user.type(opened, "1999-12-31");
		const errors = within(first)
			.getAllByTestId("settings-field-error")
			.map((error) => error.textContent);
		expect(errors).toEqual([
			"Nhập tối đa 12 ký tự.",
			`Chọn ngày từ 01/01/2000 đến 31/12/${nextYear()}.`,
			"Nhập giá trị từ 0 đến 5.000.",
		]);
		expect(within(first).getByTestId("settings-save")).toHaveAttribute(
			"aria-disabled",
			"true",
		);
		expect(
			within(first).getByTestId("settings-save-bar-status"),
		).toHaveTextContent("Sửa các ô đang báo lỗi rồi lưu.");
		await user.click(within(first).getByTestId("settings-save"));
		expect(store.storeProfile("MOCK-S1")?.seatCount).toBe(40);
	});

	it("refuses an opening span left empty and keeps it out of the store", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		renderPage(sourceFor(store));
		const first = await storeBlock("MOCK-S1");
		await membershipLoaded(first);
		await user.click(
			within(first).getByRole("button", {
				name: "Thêm khung giờ cho Thứ Hai",
			}),
		);
		expect(within(first).getByTestId("opening-hours-mon")).toHaveTextContent(
			"Nhập giờ dạng giờ:phút, ví dụ 07:00.",
		);
		expect(within(first).getByTestId("settings-save")).toHaveAttribute(
			"aria-disabled",
			"true",
		);
		expect(
			within(first).getByTestId("settings-save-bar-status"),
		).toHaveTextContent("Sửa các ô đang báo lỗi rồi lưu.");
		await user.click(within(first).getByTestId("settings-cancel"));
		expect(
			within(first).getByTestId("settings-save-bar-pending"),
		).toHaveTextContent("Chưa có thay đổi.");
	});

	it("refuses a code another store of the tenant uses with the duplicate-code message", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		renderPage(sourceFor(store));
		const young = await storeBlock("MOCK-S2");
		await membershipLoaded(young);
		const code = within(young).getByLabelText("Mã cửa hàng");
		await user.clear(code);
		await user.type(code, "ch1");
		await saveIn(
			user,
			young,
			"Không lưu được: mã này đã dùng cho một cửa hàng khác của chuỗi.",
		);
		expect(within(young).getByTestId("settings-field-error")).toHaveTextContent(
			"mã này đã dùng cho một cửa hàng khác của chuỗi",
		);
		expect(store.storeProfile("MOCK-S2")?.code).toBe("CH2");
		await user.type(code, "x");
		expect(within(young).queryByTestId("settings-field-error")).toBeNull();
		expect(
			within(young).getByTestId("settings-save-bar-status"),
		).not.toHaveTextContent("Không lưu được");
	});

	it.each([
		[
			"42501 on opening hours",
			new SettingsWriteError("forbidden"),
			true,
			"Không lưu được: chỉ chủ cửa hàng mới đổi được giờ mở cửa, vì giờ mở cửa quyết định cảnh báo và lịch đồng bộ.",
		],
		[
			"42501 without opening hours",
			new SettingsWriteError("forbidden"),
			false,
			"Không lưu được: tài khoản của bạn không có quyền sửa mục này.",
		],
		[
			"23505 on the store code",
			new SettingsWriteError("duplicate", "stores_code_unique_in_tenant"),
			false,
			"Không lưu được: mã này đã dùng cho một cửa hàng khác của chuỗi.",
		],
		[
			"23514 on the opening hours",
			new SettingsWriteError("invalid", "stores_opening_hours_valid"),
			true,
			"Không lưu được: giờ mở cửa không hợp lệ, hãy kiểm tra lại các khung giờ.",
		],
		[
			"a lost connection",
			new SettingsWriteError("network"),
			false,
			"Không lưu được vì mất kết nối; kiểm tra mạng rồi thử lại.",
		],
	] as const)(
		"shows the message of %s",
		async (_case, refusal, hours, message) => {
			const user = userEvent.setup();
			const store = new DemoSettingsStore();
			const source: SettingsSource = {
				...sourceFor(store),
				updateStoreProfile: async () => {
					throw refusal;
				},
			};
			renderPage(source);
			const first = await storeBlock("MOCK-S1");
			await membershipLoaded(first);
			if (hours) {
				await user.click(
					within(first).getByRole("checkbox", {
						name: "Chủ Nhật, nghỉ cả ngày",
					}),
				);
			} else {
				await user.clear(within(first).getByLabelText("Mã cửa hàng"));
				await user.type(within(first).getByLabelText("Mã cửa hàng"), "Q9");
			}
			await saveIn(user, first, message);
			expect(store.storeProfile("MOCK-S1")?.code).toBe("CH1");
		},
	);

	it("shows a manager the opening hours read-only with the owner-only reason and lets them save the rest", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		renderPage(sourceFor(store, { role: "manager", storeIds: null }));
		const first = await storeBlock("MOCK-S1");
		await waitFor(() =>
			expect(
				within(first).getByTestId("store-hours-read-only"),
			).toHaveTextContent(
				"Chỉ chủ cửa hàng mới đổi được giờ mở cửa, vì giờ mở cửa quyết định cảnh báo và lịch đồng bộ.",
			),
		);
		expect(within(first).queryByTestId("settings-read-only")).toBeNull();
		for (const time of within(first).getAllByTestId("opening-hours-open")) {
			expect(time).toHaveAttribute("readonly");
		}
		for (const closed of within(first).getAllByTestId("opening-hours-closed")) {
			expect(closed).toBeDisabled();
		}
		expect(within(first).queryByTestId("opening-hours-add")).toBeNull();
		const seats = within(first).getByLabelText("Số ghế");
		expect(seats).not.toHaveAttribute("readonly");
		await user.clear(seats);
		await user.type(seats, "36");
		await saveIn(user, first);
		expect(store.seatCount("MOCK-S1")).toBe(36);
		expect(
			within(await tenantBlock()).getByTestId("settings-read-only"),
		).toHaveTextContent(
			"Chỉ chủ xem được tất cả cửa hàng mới đổi được loại hình pháp lý và ngôn ngữ mặc định.",
		);
		expect(
			within(await tenantBlock()).queryByTestId("settings-save-bar"),
		).toBeNull();
	});

	it("lets a store-limited owner change the hours of their store only", async () => {
		renderPage(
			sourceFor(new DemoSettingsStore(), {
				role: "owner",
				storeIds: ["MOCK-S1"],
			}),
		);
		const first = await storeBlock("MOCK-S1");
		const young = await storeBlock("MOCK-S2");
		await waitFor(() =>
			expect(within(young).getByTestId("settings-read-only")).toHaveTextContent(
				"Cửa hàng này nằm ngoài phạm vi cửa hàng của bạn nên chỉ xem được.",
			),
		);
		expect(within(first).queryByTestId("settings-read-only")).toBeNull();
		expect(within(first).queryByTestId("store-hours-read-only")).toBeNull();
		expect(within(first).getAllByTestId("opening-hours-add")).not.toHaveLength(
			0,
		);
		expect(within(young).queryByTestId("settings-save-bar")).toBeNull();
		expect(within(first).getByTestId("settings-save-bar")).toBeInTheDocument();
		expect(
			within(await tenantBlock()).getByTestId("settings-read-only"),
		).toBeInTheDocument();
	});

	it.each([
		{ role: "viewer", storeIds: null },
		{ role: "staff", storeIds: null },
	] as const)(
		"shows %j every block read-only with its reason and no save control",
		async (membership) => {
			renderPage(sourceFor(new DemoSettingsStore(), membership));
			const first = await storeBlock("MOCK-S1");
			await waitFor(() =>
				expect(
					within(first).getByTestId("settings-read-only"),
				).toHaveTextContent(
					"Chỉ chủ và quản lý của cửa hàng này mới sửa được hồ sơ cửa hàng",
				),
			);
			expect(within(first).getByLabelText("Mã cửa hàng")).toHaveAttribute(
				"readonly",
			);
			expect(within(first).getByLabelText("Hóa đơn điện tử")).toHaveValue(
				"Đã đăng ký",
			);
			expect(within(first).queryByTestId("store-hours-read-only")).toBeNull();
			expect(screen.queryAllByTestId("settings-save-bar")).toHaveLength(0);
			expect(
				within(await tenantBlock()).getByLabelText("Loại hình pháp lý"),
			).toHaveValue("Hộ kinh doanh");
		},
	);

	it("saves the legal form and the default language with the audit line", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		renderPage(sourceFor(store));
		const tenant = await tenantBlock();
		await membershipLoaded(tenant);
		expect(tenant).toHaveTextContent(
			"hộ kinh doanh và doanh nghiệp siêu nhỏ được miễn",
		);
		expect(tenant).toHaveTextContent(
			"Đối chiếu với quy định đến ngày 12/11/2026; không thay cho tư vấn pháp lý.",
		);
		expect(
			within(tenant)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual([
			"Hộ kinh doanh",
			"Doanh nghiệp siêu nhỏ",
			"Doanh nghiệp nhỏ",
			"Doanh nghiệp khác",
			"Chưa xác định",
			"Tiếng Việt",
			"English",
		]);
		await user.selectOptions(
			within(tenant).getByLabelText("Loại hình pháp lý"),
			"Doanh nghiệp siêu nhỏ",
		);
		await user.selectOptions(
			within(tenant).getByLabelText("Ngôn ngữ mặc định"),
			"English",
		);
		expect(
			within(tenant).getByTestId("settings-save-bar-pending"),
		).toHaveTextContent("2 thay đổi chưa lưu");
		await saveIn(user, tenant);
		expect(store.tenantProfile()).toMatchObject({
			legalForm: "micro_enterprise",
			defaultLanguage: "en",
		});
		await waitFor(() =>
			expect(
				within(tenant).getByTestId("settings-audit-line"),
			).toHaveTextContent(SAVED_BY_YOU),
		);
	});

	it("names the receipt numbering the data suggests and applies it", async () => {
		const user = userEvent.setup();
		const callTheme = vi.fn(async () => [
			{ store_id: null, receipt_days: null, receipt_restarts_daily: null },
			{ store_id: "MOCK-S1", receipt_days: 118, receipt_restarts_daily: true },
			{ store_id: "MOCK-S2", receipt_days: 64, receipt_restarts_daily: false },
		]);
		current.analytics = {
			status: "ready",
			source: { kind: "demo", call: vi.fn(), callTheme },
		};
		const store = new DemoSettingsStore();
		store.saveStoreProfile({
			...(store.storeProfile("MOCK-S1") as NonNullable<
				ReturnType<DemoSettingsStore["storeProfile"]>
			>),
			tranNoResetPeriod: "unknown",
		});
		renderPage(sourceFor(store));
		const first = await storeBlock("MOCK-S1");
		await membershipLoaded(first);
		await waitFor(() =>
			expect(first).toHaveTextContent(
				"Gợi ý từ dữ liệu: số hóa đơn của 118 ngày gần nhất bắt đầu lại mỗi ngày, nên chọn Hằng ngày.",
			),
		);
		expect(callTheme).toHaveBeenCalledWith(
			"data_quality_summary",
			expect.objectContaining({ store_ids: ["MOCK-S1", "MOCK-S2"] }),
		);
		expect(await storeBlock("MOCK-S2")).toHaveTextContent(
			"Gợi ý từ dữ liệu: số hóa đơn của 64 ngày gần nhất không bắt đầu lại mỗi ngày, nên chọn Hằng năm hoặc Không đánh lại theo cài đặt POS.",
		);
		expect(
			within(await storeBlock("MOCK-S2")).queryByTestId("store-receipts-apply"),
		).toBeNull();
		const apply = within(first).getByTestId("store-receipts-apply");
		expect(apply).not.toHaveAttribute("aria-disabled");
		await user.click(apply);
		expect(within(first).getByLabelText("Đánh số hóa đơn")).toHaveValue(
			"daily",
		);
		expect(apply).toHaveFocus();
		expect(apply).toHaveAttribute("aria-disabled", "true");
		await user.click(apply);
		expect(
			within(first).getByTestId("settings-save-bar-pending"),
		).toHaveTextContent("1 thay đổi chưa lưu");
		await saveIn(user, first);
		expect(store.storeProfile("MOCK-S1")?.tranNoResetPeriod).toBe("daily");
	});

	it.each([
		[
			"has too few days of numeric receipts",
			async () => [
				{ store_id: null, receipt_days: null, receipt_restarts_daily: null },
				{
					store_id: "MOCK-S1",
					receipt_days: null,
					receipt_restarts_daily: null,
				},
				{
					store_id: "MOCK-S2",
					receipt_days: null,
					receipt_restarts_daily: null,
				},
			],
		],
		[
			"cannot be read",
			async () => {
				throw new ThemeCallError("data_quality_summary", "network");
			},
		],
	])("leaves the suggestion out when the data %s", async (_case, answer) => {
		const callTheme = vi.fn(answer);
		current.analytics = {
			status: "ready",
			source: { kind: "demo", call: vi.fn(), callTheme },
		};
		renderPage(sourceFor(new DemoSettingsStore()));
		const first = await storeBlock("MOCK-S1");
		await membershipLoaded(first);
		await waitFor(() =>
			expect(screen.getByTestId("store-profiles")).toHaveAttribute(
				"data-receipt-suggestions",
				"settled",
			),
		);
		expect(callTheme).toHaveBeenCalledOnce();
		expect(first).toHaveTextContent(
			"POS đánh số lại hóa đơn từ đầu sau mỗi khoảng thời gian này.",
		);
		expect(first).not.toHaveTextContent("Gợi ý từ dữ liệu");
	});

	it("offers to try again when the profiles could not be read", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		const working = sourceFor(store);
		let failing = true;
		renderPage({
			...working,
			storeProfiles: async (tenantId) => {
				if (failing) throw new Error("offline");
				return working.storeProfiles(tenantId);
			},
		});
		const failed = await screen.findByTestId("store-profiles-load-failed");
		expect(failed).toHaveTextContent("Không tải được dữ liệu");
		failing = false;
		await user.click(within(failed).getByRole("button", { name: "Thử lại" }));
		expect(await storeBlock("MOCK-S1")).toBeInTheDocument();
	});

	it("replaces only the saved store in the cached list", () => {
		const first = { storeId: "a", seatCount: 1 } as unknown as StoreProfile;
		const second = { storeId: "b", seatCount: 2 } as unknown as StoreProfile;
		const saved = { storeId: "b", seatCount: 9 } as unknown as StoreProfile;
		expect(withSavedStore([first, second], saved)).toEqual([first, saved]);
		expect(withSavedStore(undefined, saved)).toBeUndefined();
	});
});
