import { DemoSettingsStore } from "@fnb/demo-analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { createDemoSettingsSource } from "../../settings/demo-settings-source";
import {
	type Membership,
	type SettingsSource,
	SettingsWriteError,
} from "../../settings/source";
import { createDemoStaffSource } from "../../settings/staff/demo-staff-source";
import {
	PAIRING_CODE_TTL_MS,
	type StaffSettingsSource,
} from "../../settings/staff/source";
import NhanVienPage, {
	contactErrorKey,
	revenueErrorKey,
} from "./nhan-vien-page";

const TENANT = {
	id: "33333333-3333-4333-8333-333333333333",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: "Asia/Ho_Chi_Minh",
	countryCode: "VN",
};

const OWNER: Membership = { role: "owner", storeIds: null };

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

function renderPage({
	membership = OWNER,
	store = new DemoSettingsStore(),
	staff = {},
}: {
	readonly membership?: Membership;
	readonly store?: DemoSettingsStore;
	readonly staff?: Partial<StaffSettingsSource>;
} = {}) {
	const source: SettingsSource = {
		...createDemoSettingsSource(store),
		membership: async () => membership,
	};
	const staffSource: StaffSettingsSource = {
		...createDemoStaffSource(store),
		...staff,
	};
	current.state = { status: "ready", source, staff: staffSource };
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<MemoryRouter>
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<QueryClientProvider client={client}>
					<NhanVienPage />
				</QueryClientProvider>
			</I18nProvider>
		</MemoryRouter>,
	);
	return staffSource;
}

async function rosterList() {
	return screen.findByTestId("staff-roster-list");
}

function rowOf(name: string) {
	const row = screen
		.getAllByTestId("staff-row")
		.find(
			(candidate) =>
				within(candidate).getByTestId("staff-name").textContent === name,
		);
	if (row === undefined) throw new Error(`no row for ${name}`);
	return row;
}

function listStatus() {
	return screen.getByTestId("staff-roster-status");
}

describe("the Nhân viên page", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		window.localStorage.clear();
	});

	it("lists the roster with role, stores, status, pairing and only a phone hint, the deactivated last", async () => {
		renderPage();
		const list = await rosterList();
		expect(
			within(list)
				.getAllByTestId("staff-name")
				.map((name) => name.textContent),
		).toEqual(["Nhân viên 1", "Nhân viên 2", "Quản lý 1", "Nhân viên 3"]);
		const paired = rowOf("Nhân viên 1");
		expect(within(paired).getByTestId("staff-role")).toHaveTextContent(
			"Nhân viên",
		);
		expect(within(paired).getByTestId("staff-stores")).toHaveTextContent(
			"Cửa hàng mẫu 1",
		);
		expect(within(paired).getByTestId("staff-status")).toHaveTextContent(
			"Đang hoạt động",
		);
		expect(within(paired).getByTestId("staff-pairing")).toHaveTextContent(
			/^Đã ghép nối ngày \d{2}\/\d{2}\/\d{4}$/,
		);
		expect(within(paired).getByTestId("staff-phone")).toHaveTextContent("…204");
		const invited = rowOf("Nhân viên 2");
		expect(within(invited).getByTestId("staff-status")).toHaveTextContent(
			"Chờ ghép nối",
		);
		expect(within(invited).getByTestId("staff-pairing")).toHaveTextContent(
			"Chưa ghép nối",
		);
		expect(within(invited).getByTestId("staff-phone")).toHaveTextContent(
			"Chưa liên kết",
		);
		expect(
			within(rowOf("Quản lý 1")).getByTestId("staff-stores"),
		).toHaveTextContent("Cửa hàng mẫu 1, Cửa hàng mẫu 2");
		const out = rowOf("Nhân viên 3");
		expect(within(out).getByTestId("staff-status")).toHaveTextContent(
			/^Đã ngừng từ \d{2}\/\d{2}\/\d{4}$/,
		);
		expect(
			within(out).getByRole("button", { name: "Mở lại quyền của Nhân viên 3" }),
		).toBeVisible();
		expect(
			within(paired).getByRole("button", {
				name: "Ngừng quyền của Nhân viên 1",
			}),
		).toBeVisible();
		expect(
			within(out).queryByRole("button", {
				name: "Tạo mã ghép nối cho Nhân viên 3",
			}),
		).toBeNull();
		expect(
			within(invited).getByRole("button", {
				name: "Tạo mã ghép nối cho Nhân viên 2",
			}),
		).toBeVisible();
		expect(screen.getByTestId("staff-app-empty")).toHaveTextContent(
			"chưa có ứng dụng nhân viên trên Zalo",
		);
	});

	it("shows a person whose Zalo identity is gone as not paired, even while the row stays active", async () => {
		const store = new DemoSettingsStore();
		const demo = createDemoStaffSource(store);
		renderPage({
			store,
			staff: {
				roster: async (tenantId) =>
					(await demo.roster(tenantId)).map((row) =>
						row.id === "demo-staff-1" ? { ...row, paired: false } : row,
					),
			},
		});
		await rosterList();
		const row = rowOf("Nhân viên 1");
		expect(row).toHaveAttribute("data-status", "active");
		expect(within(row).getByTestId("staff-status")).toHaveTextContent(
			"Đang hoạt động",
		);
		expect(within(row).getByTestId("staff-pairing")).toHaveTextContent(
			"Chưa ghép nối",
		);
	});

	it("says so in plain words when nobody is on the roster", async () => {
		renderPage({ staff: { roster: async () => [] } });
		expect(await screen.findByTestId("staff-roster-empty")).toHaveTextContent(
			"Chưa có ai trong danh sách.",
		);
		expect(
			screen.getByRole("button", { name: "Thêm nhân viên" }),
		).toBeVisible();
	});

	it("adds a person who then waits to pair, and returns the focus to the add button", async () => {
		const user = userEvent.setup();
		renderPage();
		await rosterList();
		await user.click(screen.getByRole("button", { name: "Thêm nhân viên" }));
		const form = screen.getByTestId("staff-form");
		await user.type(within(form).getByLabelText("Tên hiển thị"), "Nhân viên 5");
		await user.click(within(form).getByLabelText("Cửa hàng mẫu 2"));
		await user.click(within(form).getByRole("button", { name: "Thêm" }));
		await waitFor(() =>
			expect(listStatus()).toHaveTextContent("Đã thêm Nhân viên 5."),
		);
		expect(screen.queryByTestId("staff-form")).toBeNull();
		const added = await waitFor(() => rowOf("Nhân viên 5"));
		expect(within(added).getByTestId("staff-status")).toHaveTextContent(
			"Chờ ghép nối",
		);
		expect(within(added).getByTestId("staff-stores")).toHaveTextContent(
			"Cửa hàng mẫu 2",
		);
		expect(within(added).getByTestId("settings-audit-line")).toHaveTextContent(
			/^Bạn sửa lần cuối/,
		);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Thêm nhân viên" }),
			).toHaveFocus(),
		);
	});

	it("edits a person's role and stores", async () => {
		const user = userEvent.setup();
		renderPage();
		await rosterList();
		await user.click(
			within(rowOf("Nhân viên 2")).getByRole("button", {
				name: "Sửa Nhân viên 2",
			}),
		);
		const form = screen.getByTestId("staff-form");
		await user.selectOptions(within(form).getByLabelText("Vai trò"), "manager");
		await user.click(within(form).getByLabelText("Cửa hàng mẫu 1"));
		await user.click(within(form).getByRole("button", { name: "Lưu" }));
		await waitFor(() =>
			expect(listStatus()).toHaveTextContent(
				"Đã lưu thay đổi của Nhân viên 2.",
			),
		);
		const row = rowOf("Nhân viên 2");
		expect(within(row).getByTestId("staff-role")).toHaveTextContent("Quản lý");
		expect(within(row).getByTestId("staff-stores")).toHaveTextContent(
			"Cửa hàng mẫu 1, Cửa hàng mẫu 2",
		);
		await waitFor(() =>
			expect(
				within(row).getByRole("button", { name: "Sửa Nhân viên 2" }),
			).toHaveFocus(),
		);
	});

	it("deactivates only after the confirmation, and reactivates to pair again", async () => {
		const user = userEvent.setup();
		renderPage();
		await rosterList();
		const deactivate = within(rowOf("Nhân viên 1")).getByRole("button", {
			name: "Ngừng quyền của Nhân viên 1",
		});
		await user.click(deactivate);
		const confirm = screen.getByTestId("staff-confirm");
		expect(confirm).toHaveTextContent(
			"Ngừng quyền của Nhân viên 1? Người này bị đăng xuất khỏi ứng dụng nhân viên ngay",
		);
		await user.click(within(confirm).getByRole("button", { name: "Quay lại" }));
		expect(screen.queryByTestId("staff-confirm")).toBeNull();
		expect(rowOf("Nhân viên 1")).toHaveAttribute("data-status", "active");
		await waitFor(() => expect(deactivate).toHaveFocus());
		await user.click(deactivate);
		await user.click(
			within(screen.getByTestId("staff-confirm")).getByRole("button", {
				name: "Ngừng quyền",
			}),
		);
		await waitFor(() =>
			expect(listStatus()).toHaveTextContent("Đã ngừng quyền của Nhân viên 1."),
		);
		const out = rowOf("Nhân viên 1");
		expect(out).toHaveAttribute("data-status", "inactive");
		expect(within(out).getByTestId("staff-phone")).toHaveTextContent(
			"Chưa liên kết",
		);
		await user.click(
			within(out).getByRole("button", { name: "Mở lại quyền của Nhân viên 1" }),
		);
		await waitFor(() =>
			expect(listStatus()).toHaveTextContent(
				"Đã mở lại Nhân viên 1; người này cần ghép nối lại.",
			),
		);
		expect(rowOf("Nhân viên 1")).toHaveAttribute("data-status", "invited");
	});

	it("shows the refusals of the roster functions in plain words, with Thử lại after a lost connection", async () => {
		const user = userEvent.setup();
		let failures: SettingsWriteError[] = [
			new SettingsWriteError("forbidden"),
			new SettingsWriteError("network"),
		];
		const store = new DemoSettingsStore();
		const demo = createDemoStaffSource(store);
		renderPage({
			store,
			staff: {
				addStaff: async (tenantId, change) => {
					const failure = failures.shift();
					if (failure !== undefined) throw failure;
					return demo.addStaff(tenantId, change);
				},
				deactivateStaff: async () => {
					throw new SettingsWriteError("forbidden");
				},
			},
		});
		await rosterList();
		await user.click(screen.getByRole("button", { name: "Thêm nhân viên" }));
		const form = screen.getByTestId("staff-form");
		await user.type(within(form).getByLabelText("Tên hiển thị"), "Nhân viên 5");
		await user.click(within(form).getByLabelText("Cửa hàng mẫu 1"));
		await user.click(within(form).getByRole("button", { name: "Thêm" }));
		await waitFor(() =>
			expect(within(form).getByTestId("staff-form-status")).toHaveTextContent(
				"Không lưu được: bạn chỉ thêm hoặc sửa được nhân viên ở các cửa hàng mình quản lý.",
			),
		);
		await user.click(within(form).getByRole("button", { name: "Thêm" }));
		await waitFor(() =>
			expect(within(form).getByTestId("staff-form-status")).toHaveTextContent(
				"Không lưu được vì mất kết nối",
			),
		);
		await user.click(within(form).getByRole("button", { name: "Thử lại" }));
		await waitFor(() =>
			expect(listStatus()).toHaveTextContent("Đã thêm Nhân viên 5."),
		);
		failures = [];
		await user.click(
			within(rowOf("Nhân viên 2")).getByRole("button", {
				name: "Ngừng quyền của Nhân viên 2",
			}),
		);
		await user.click(
			within(screen.getByTestId("staff-confirm")).getByRole("button", {
				name: "Ngừng quyền",
			}),
		);
		await waitFor(() =>
			expect(listStatus()).toHaveTextContent(
				"Không đổi được: người này làm ở cửa hàng ngoài phạm vi của bạn.",
			),
		);
		expect(rowOf("Nhân viên 2")).toHaveAttribute("data-status", "invited");
	});

	it("gives a store-limited manager their stores only, the others' rows read-only, and no revenue setting", async () => {
		const user = userEvent.setup();
		renderPage({ membership: { role: "manager", storeIds: ["MOCK-S1"] } });
		await rosterList();
		const shared = rowOf("Quản lý 1");
		expect(within(shared).queryByRole("button")).toBeNull();
		expect(within(shared).getByTestId("staff-row-read-only")).toHaveTextContent(
			"Người này làm ở cửa hàng ngoài phạm vi của bạn nên bạn chỉ xem được.",
		);
		expect(
			within(rowOf("Nhân viên 1")).getByRole("button", {
				name: "Sửa Nhân viên 1",
			}),
		).toBeVisible();
		await user.click(screen.getByRole("button", { name: "Thêm nhân viên" }));
		const stores = screen.getByTestId("staff-form-stores");
		expect(within(stores).getAllByRole("checkbox")).toHaveLength(1);
		expect(within(stores).getByLabelText("Cửa hàng mẫu 1")).toBeChecked();
		expect(screen.queryByTestId("staff-revenue")).toBeNull();
	});

	it.each([
		["staff", null],
		["viewer", null],
		["publisher", null],
	] as const)(
		"shows the %s only the reason, without the roster or any control",
		async (role, storeIds) => {
			const staff = renderPage({ membership: { role, storeIds } });
			const roster = vi.spyOn(staff, "roster");
			const notice = await screen.findByTestId("settings-read-only");
			await waitFor(() =>
				expect(notice).toHaveAttribute("data-reason", "role"),
			);
			expect(notice).toHaveTextContent(
				"Trang Nhân viên chỉ dành cho chủ và quản lý.",
			);
			expect(screen.queryByTestId("staff-roster")).toBeNull();
			expect(screen.queryByTestId("staff-app")).toBeNull();
			expect(screen.queryByTestId("staff-revenue")).toBeNull();
			expect(screen.queryAllByRole("button")).toHaveLength(0);
			expect(roster).not.toHaveBeenCalled();
		},
	);

	it("lets the owner with every store choose what staff may see of revenue, explaining each level", async () => {
		const user = userEvent.setup();
		const store = new DemoSettingsStore();
		const staff = renderPage({ store });
		const section = await screen.findByTestId("staff-revenue");
		const all = within(section).getByLabelText(
			"Toàn bộ doanh thu của cửa hàng mình",
		);
		expect(all).toBeChecked();
		expect(all).toHaveAccessibleDescription(
			"Nhân viên xem mọi số liệu doanh thu, báo cáo và hóa đơn của cửa hàng mình làm, như quản lý cửa hàng đó.",
		);
		await user.click(within(section).getByLabelText("Chỉ tổng hôm nay"));
		expect(
			within(section).getByTestId("settings-save-bar-pending"),
		).toHaveTextContent("1 thay đổi chưa lưu");
		await user.click(within(section).getByRole("button", { name: "Lưu" }));
		await waitFor(() =>
			expect(
				within(section).getByTestId("settings-save-bar-status"),
			).toHaveTextContent("Đã lưu."),
		);
		expect(await staff.staffRevenueVisibility(TENANT.id)).toBe("store_totals");
		expect(screen.getByTestId("staff-revenue")).toHaveAttribute(
			"data-saved",
			"store_totals",
		);
	});

	it("shows a store-limited owner the revenue level read-only with the reason", async () => {
		renderPage({ membership: { role: "owner", storeIds: ["MOCK-S1"] } });
		const section = await screen.findByTestId("staff-revenue");
		expect(within(section).getByTestId("settings-read-only")).toHaveTextContent(
			"Chỉ chủ xem được tất cả cửa hàng mới đổi được mục này.",
		);
		expect(
			within(section).getByTestId("staff-revenue-current"),
		).toHaveTextContent("Đang áp dụng: Toàn bộ doanh thu của cửa hàng mình");
		expect(within(section).queryByRole("radio")).toBeNull();
		expect(within(section).queryByTestId("settings-save-bar")).toBeNull();
	});

	it("names the owner-only refusal of the revenue level", () => {
		expect(revenueErrorKey("forbidden", "settings.error.forbidden")).toBe(
			"settings.staff.revenue.error.forbidden",
		);
		expect(revenueErrorKey("network", "settings.error.network")).toBe(
			"settings.error.network",
		);
	});

	it("draws each store's staff app QR code in the browser, and says which store has no code or no app", async () => {
		const store = new DemoSettingsStore();
		const demo = createDemoSettingsSource(store);
		const [first] = await demo.storeProfiles(TENANT.id);
		if (first === undefined) throw new Error("no demo store");
		await demo.updateStoreProfile(TENANT.id, "MOCK-S2", { code: null });
		renderPage({
			store,
			staff: {
				staffApps: async () => [
					{
						brandId: "brand-1",
						miniAppId: "mock-staff-app",
						title: "Nhân viên mẫu",
						storeIds: ["MOCK-S1", "MOCK-S2"],
					},
				],
			},
		});
		const cards = await screen.findAllByTestId("staff-app-store");
		expect(cards).toHaveLength(2);
		const [withCode, withoutCode] = cards;
		if (withCode === undefined || withoutCode === undefined) return;
		expect(within(withCode).getByTestId("staff-app-link")).toHaveTextContent(
			`https://zalo.me/s/mock-staff-app/?store=${first.code}`,
		);
		const qr = within(withCode).getByRole("img", {
			name: "Mã QR mở ứng dụng nhân viên cho Cửa hàng mẫu 1",
		});
		expect(qr.tagName.toLowerCase()).toBe("svg");
		expect(qr.querySelector("path")?.getAttribute("d")).toMatch(
			/^M4 4h7v1h-7z/,
		);
		expect(within(withCode).getByTestId("staff-app-title")).toHaveTextContent(
			"Ứng dụng: Nhân viên mẫu",
		);
		expect(within(withoutCode).queryByRole("img")).toBeNull();
		expect(
			within(withoutCode).getByTestId("staff-app-no-code"),
		).toHaveTextContent("Cửa hàng chưa có mã cửa hàng nên chưa có mã QR");
		const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
		await userEvent
			.setup()
			.click(screen.getByRole("button", { name: "In mã QR" }));
		expect(print).toHaveBeenCalledTimes(1);
		expect(document.querySelectorAll("img[src], iframe")).toHaveLength(0);
	});

	it("issues a pairing code, shows it once, large, with its countdown and a copy button, and keeps it out of storage, the address and the console", async () => {
		const user = userEvent.setup();
		const setItem = vi.spyOn(Storage.prototype, "setItem");
		const logs = (["log", "info", "warn", "error", "debug"] as const).map(
			(method) => vi.spyOn(console, method),
		);
		const writeText = vi.fn(async (_text: string) => undefined);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		const issued: string[] = [];
		renderPage({
			staff: {
				issuePairingCode: async (_tenantId, rosterId) => {
					issued.push(rosterId);
					return {
						rosterId,
						code: "482913",
						expiresAt: new Date(Date.now() + PAIRING_CODE_TTL_MS).toISOString(),
					};
				},
			},
		});
		await rosterList();
		expect(
			within(rowOf("Nhân viên 3")).queryByRole("button", {
				name: "Tạo mã ghép nối cho Nhân viên 3",
			}),
		).toBeNull();
		await user.click(
			within(rowOf("Nhân viên 2")).getByRole("button", {
				name: "Tạo mã ghép nối cho Nhân viên 2",
			}),
		);
		const panel = await screen.findByTestId("pairing-code");
		expect(issued).toEqual(["demo-staff-2"]);
		expect(within(panel).getByTestId("pairing-code-value")).toHaveTextContent(
			"482913",
		);
		expect(within(panel).getByRole("timer")).toHaveTextContent(
			/Còn hiệu lực (10:00|09:5\d)/,
		);
		const copy = within(panel).getByRole("button", { name: "Chép mã" });
		expect(copy).toHaveFocus();
		await user.click(copy);
		expect(writeText).toHaveBeenCalledWith("482913");
		expect(
			within(panel).getByTestId("pairing-code-copy-status"),
		).toHaveTextContent("Đã chép mã.");
		await user.click(within(panel).getByRole("button", { name: "Đóng" }));
		expect(screen.queryByTestId("pairing-code")).toBeNull();
		expect(document.body).not.toHaveTextContent("482913");
		expect(setItem).not.toHaveBeenCalled();
		expect(window.location.href).not.toContain("482913");
		for (const log of logs) {
			expect(JSON.stringify(log.mock.calls)).not.toContain("482913");
		}
		Reflect.deleteProperty(navigator, "clipboard");
	});

	it.each([
		[
			"invalid",
			"Không tạo được mã: người này đã ngừng, hoặc tài khoản của họ là chủ, người xem hay tài khoản đăng báo cáo.",
		],
		[
			"forbidden",
			"Không tạo được mã: người này làm ở cửa hàng ngoài phạm vi của bạn.",
		],
		["network", "Không lưu được vì mất kết nối; kiểm tra mạng rồi thử lại."],
	] as const)(
		"explains a pairing code refused as %s, and a later issue replaces the refusal",
		async (code, message) => {
			const user = userEvent.setup();
			let refuse = true;
			renderPage({
				staff: {
					issuePairingCode: async (_tenantId, rosterId) => {
						if (refuse) throw new SettingsWriteError(code);
						return {
							rosterId,
							code: "120034",
							expiresAt: new Date(
								Date.now() + PAIRING_CODE_TTL_MS,
							).toISOString(),
						};
					},
				},
			});
			await rosterList();
			const issue = within(rowOf("Nhân viên 1")).getByRole("button", {
				name: "Tạo mã ghép nối cho Nhân viên 1",
			});
			await user.click(issue);
			expect(await screen.findByTestId("pairing-refused")).toHaveTextContent(
				message,
			);
			expect(screen.queryByTestId("pairing-code")).toBeNull();
			refuse = false;
			await user.click(issue);
			expect(await screen.findByTestId("pairing-code-value")).toHaveTextContent(
				"120034",
			);
			expect(screen.queryByTestId("pairing-refused")).toBeNull();
		},
	);

	it("says when the code could not be copied, and drops the panel of a person who is deactivated", async () => {
		const user = userEvent.setup();
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async () => {
					throw new Error("denied");
				},
			},
		});
		renderPage();
		await rosterList();
		await user.click(
			within(rowOf("Nhân viên 1")).getByRole("button", {
				name: "Tạo mã ghép nối cho Nhân viên 1",
			}),
		);
		const panel = await screen.findByTestId("pairing-code");
		expect(within(panel).getByTestId("pairing-code-value")).toHaveTextContent(
			/^[0-9]{6}$/,
		);
		await user.click(within(panel).getByRole("button", { name: "Chép mã" }));
		expect(
			within(panel).getByTestId("pairing-code-copy-status"),
		).toHaveTextContent(
			"Không chép được mã; đọc mã trên màn hình cho người đó.",
		);
		await user.click(
			within(rowOf("Nhân viên 1")).getByRole("button", {
				name: "Ngừng quyền của Nhân viên 1",
			}),
		);
		await user.click(
			within(screen.getByTestId("staff-confirm")).getByRole("button", {
				name: "Ngừng quyền",
			}),
		);
		await waitFor(() =>
			expect(rowOf("Nhân viên 1")).toHaveAttribute("data-status", "inactive"),
		);
		expect(screen.queryByTestId("pairing-code")).toBeNull();
		Reflect.deleteProperty(navigator, "clipboard");
	});
});

describe("the staff app's contact note on Nhân viên", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("lets an owner with every store change the note, holding back a link before sending", async () => {
		const user = userEvent.setup();
		const staff = renderPage();
		const section = await screen.findByTestId("staff-contact");
		const field = within(section).getByLabelText("Lời nhắn");
		expect(field).toHaveValue(
			"Gặp quản lý ca tại quầy để nhận mã ghép nối. Ngoài giờ làm, nhắn quản lý qua Zalo.",
		);
		await user.clear(field);
		await user.type(field, "Xem www.example.com");
		expect(
			within(section).getByTestId("settings-field-error"),
		).toHaveTextContent("Lời nhắn không được chứa đường link");
		const save = within(section).getByRole("button", { name: "Lưu" });
		expect(save).toHaveAttribute("aria-disabled", "true");
		await user.clear(field);
		await user.type(field, "Gặp chị quản lý ở quầy.{Enter}Gọi 0901 234 567.");
		expect(within(section).queryByTestId("settings-field-error")).toBeNull();
		await user.click(within(section).getByRole("button", { name: "Lưu" }));
		await waitFor(() =>
			expect(
				within(section).getByTestId("settings-save-bar"),
			).toHaveTextContent("Đã lưu."),
		);
		expect(await staff.staffContact(TENANT.id)).toBe(
			"Gặp chị quản lý ở quầy.\nGọi 0901 234 567.",
		);
	});

	it.each([
		["a manager", { role: "manager", storeIds: null }],
		["a store-limited owner", { role: "owner", storeIds: ["MOCK-S1"] }],
	] as const)(
		"shows %s the note read-only with the reason",
		async (_who, membership) => {
			renderPage({
				membership: {
					role: membership.role,
					storeIds:
						membership.storeIds === null ? null : [...membership.storeIds],
				},
			});
			const section = await screen.findByTestId("staff-contact");
			await waitFor(() =>
				expect(
					within(section).getByTestId("staff-contact-read-only"),
				).toHaveTextContent(
					"Chỉ chủ quán quản lý tất cả cửa hàng sửa lời nhắn này.",
				),
			);
			expect(
				within(section).getByTestId("staff-contact-current"),
			).toHaveTextContent("Gặp quản lý ca tại quầy");
			expect(within(section).queryByRole("textbox")).toBeNull();
			expect(within(section).queryByTestId("settings-save-bar")).toBeNull();
		},
	);

	it("says when no note is set", async () => {
		renderPage({
			membership: { role: "manager", storeIds: null },
			staff: { staffContact: async () => null },
		});
		expect(
			await screen.findByTestId("staff-contact-current"),
		).toHaveTextContent(
			"Chưa có lời nhắn; ứng dụng đang hiện lời nhắn mặc định.",
		);
	});

	it("names the owner-only and invalid refusals of the note", () => {
		expect(contactErrorKey("forbidden", "settings.error.forbidden")).toBe(
			"settings.staff.contact.error.forbidden",
		);
		expect(contactErrorKey("invalid", "settings.error.invalid")).toBe(
			"settings.staff.contact.error.invalid",
		);
		expect(contactErrorKey("network", "settings.error.network")).toBe(
			"settings.error.network",
		);
	});
});
