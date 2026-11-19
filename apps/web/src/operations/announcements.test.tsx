import { DemoSettingsStore, demoStoreIds } from "@fnb/demo-analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { AnnouncementsPage } from "../pages/operations/announcements-page";
import { createDemoSettingsSource } from "../settings/demo-settings-source";
import type { Membership, SettingsSource } from "../settings/source";
import { createDemoStaffSource } from "../settings/staff/demo-staff-source";
import {
	announcementsInScope,
	bodyIssue,
	canManageAnnouncement,
	composeIssues,
	composeRequest,
	defaultPinDate,
	emptyCompose,
	normalisedBody,
	pinBounds,
	pinIssue,
	pinUntilOf,
	publishableStores,
	sendsToEveryStore,
	splitReaders,
	storesLabelOf,
	titleIssue,
} from "./announcements";
import type {
	Announcement,
	AnnouncementReader,
	AnnouncementReadRate,
} from "./announcements-source";
import {
	createFakeOperations,
	type FakeOperations,
} from "./testing/fake-operations-source";

const TENANT = {
	id: "33333333-3333-4333-8333-333333333333",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: "Asia/Ho_Chi_Minh",
	countryCode: "VN",
};
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const ZONE = TENANT.timeZone;

const [STORE_1 = "", STORE_2 = ""] = demoStoreIds();

const STORES = [
	{
		id: STORE_1,
		tenantId: TENANT.id,
		name: "Cửa hàng mẫu 1",
		code: null,
		timeZone: ZONE,
		businessDayStartMinutes: 0,
		posAccountId: "account",
	},
	{
		id: STORE_2,
		tenantId: TENANT.id,
		name: "Cửa hàng mẫu 2",
		code: null,
		timeZone: ZONE,
		businessDayStartMinutes: 0,
		posAccountId: "account",
	},
];

const NOW = new Date("2026-11-18T05:00:00Z");
const TODAY = "2026-11-18";
const LINK_TEXT = "Xem lịch tại https://example.com/lich và www.example.vn";

const current = vi.hoisted(() => ({
	state: { status: "loading" } as unknown,
	selected: [] as unknown[],
}));

vi.mock("../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({
		tenant: TENANT,
		stores: STORES,
		selectedStores: current.selected,
		allStoresSelected: current.selected.length === STORES.length,
		selectStores: () => undefined,
	}),
}));

vi.mock("../settings/settings-source-context", () => ({
	useSettingsSourceState: () => current.state,
	useRetrySettingsSource: () => () => undefined,
}));

function announcement(
	id: string,
	overrides: Partial<Announcement> = {},
): Announcement {
	return {
		id,
		tenantId: TENANT.id,
		storeIds: [STORE_1],
		audience: ["manager", "staff"],
		title: `Thông báo ${id}`,
		body: "Nội dung",
		pinned: false,
		pinnedUntil: null,
		publishedBy: "owner-1",
		publishedAt: "2026-11-17T02:00:00Z",
		expiresAt: null,
		recipient: false,
		readAt: null,
		...overrides,
	};
}

function rate(
	announcementId: string,
	recipients: number,
	readers: number,
	readersWithin24h: number,
): AnnouncementReadRate {
	return {
		announcementId,
		recipients,
		readers,
		readersWithin24h,
		readRate: recipients === 0 ? null : readers / recipients,
		readRate24h: recipients === 0 ? null : readersWithin24h / recipients,
	};
}

function reader(
	userId: string,
	displayName: string | null,
	readAt: string | null,
	overrides: Partial<AnnouncementReader> = {},
): AnnouncementReader {
	return {
		userId,
		displayName,
		role: "staff",
		storeIds: [STORE_1],
		member: true,
		readAt,
		...overrides,
	};
}

function seeded(): FakeOperations {
	const operations = createFakeOperations({
		actors: {
			currentUserId: "owner-1",
			byId: new Map([
				["owner-1", { name: null, role: "owner" }],
				["manager-2", { name: "Quản lý cửa hàng 2", role: "manager" }],
			]),
		},
	});
	operations.data.announcements = [
		announcement("pinned", {
			title: "Lịch trực Tết",
			body: LINK_TEXT,
			pinned: true,
			pinnedUntil: "2026-11-24T17:00:00Z",
			storeIds: null,
		}),
		announcement("both", {
			title: "Đồng phục mới",
			storeIds: [STORE_1, STORE_2],
			publishedAt: "2026-11-16T02:00:00Z",
		}),
		announcement("store-2", {
			title: "Sửa máy lạnh",
			storeIds: [STORE_2],
			publishedBy: "manager-2",
			publishedAt: "2026-11-15T02:00:00Z",
		}),
		announcement("other-tenant", {
			tenantId: OTHER_TENANT,
			title: "Thông báo của quán khác",
			storeIds: null,
		}),
	];
	operations.data.readRates = new Map([
		["pinned", rate("pinned", 5, 3, 2)],
		["both", rate("both", 4, 4, 4)],
		["store-2", rate("store-2", 0, 0, 0)],
	]);
	operations.data.readers = new Map([
		[
			"pinned",
			[
				reader("u-1", "Nhân viên An", null),
				reader("u-2", null, null, { role: "manager" }),
				reader("u-3", "Nhân viên Bình", "2026-11-17T03:15:00Z", {
					member: false,
				}),
			],
		],
	]);
	operations.data.publishRecipients = 4;
	return operations;
}

function renderPage({
	membership = { role: "owner", storeIds: null } as Membership,
	operations = seeded() as FakeOperations | null,
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
		<MemoryRouter initialEntries={["/van-hanh/thong-bao?range=7d"]}>
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<QueryClientProvider client={client}>
					<Routes>
						<Route path="/van-hanh/thong-bao" element={<AnnouncementsPage />} />
					</Routes>
				</QueryClientProvider>
			</I18nProvider>
		</MemoryRouter>,
	);
	return operations;
}

async function listItems(): Promise<HTMLElement[]> {
	await screen.findByTestId("announcement-list");
	await waitFor(() =>
		expect(screen.getByTestId("announcement-list")).not.toHaveAttribute(
			"data-state",
		),
	);
	return within(screen.getByTestId("announcement-list")).queryAllByTestId(
		"announcement",
	);
}

function item(title: string): HTMLElement {
	const found = screen
		.getAllByTestId("announcement")
		.find(
			(element) =>
				within(element).getByTestId("announcement-title").textContent === title,
		);
	if (found === undefined) throw new Error(`no announcement ${title}`);
	return found;
}

describe("the announcement rules", () => {
	it("takes a one-line title and a plain-text body within the server's limits", () => {
		expect(titleIssue("   ")).toBe("required");
		expect(titleIssue("x".repeat(120))).toBeNull();
		expect(titleIssue("x".repeat(121))).toBe("tooLong");
		expect(titleIssue("😀".repeat(120))).toBeNull();
		expect(titleIssue("Hai\tdòng")).toBe("control");
		expect(bodyIssue(" \n ")).toBe("required");
		expect(bodyIssue("Dòng 1\r\nDòng 2\tcột")).toBeNull();
		expect(bodyIssue("x".repeat(4001))).toBe("tooLong");
		expect(bodyIssue("chuông\u0007")).toBe("control");
		expect(normalisedBody("\n  Dòng 1\r\nDòng 2  \n")).toBe("Dòng 1\nDòng 2");
	});

	it("pins until the end of a local day from today to 364 days ahead and never past the expiry", () => {
		expect(pinBounds(TODAY)).toEqual({ min: TODAY, max: "2027-11-17" });
		expect(defaultPinDate(TODAY)).toBe("2026-11-24");
		expect(pinUntilOf("2026-11-24", ZONE)).toBe("2026-11-24T17:00:00.000Z");
		expect(pinIssue("", TODAY, ZONE, { required: false })).toBeNull();
		expect(pinIssue("", TODAY, ZONE, { required: true })).toBe("required");
		expect(pinIssue(TODAY, TODAY, ZONE, { required: true })).toBeNull();
		expect(pinIssue("2026-11-17", TODAY, ZONE, { required: true })).toBe(
			"range",
		);
		expect(pinIssue("2027-11-18", TODAY, ZONE, { required: true })).toBe(
			"range",
		);
		expect(pinIssue("2026-02-30", TODAY, ZONE, { required: true })).toBe(
			"range",
		);
		expect(
			pinIssue("2026-11-24", TODAY, ZONE, {
				required: true,
				expiresAt: "2026-11-24T17:00:00Z",
			}),
		).toBeNull();
		expect(
			pinIssue("2026-11-25", TODAY, ZONE, {
				required: true,
				expiresAt: "2026-11-24T17:00:00Z",
			}),
		).toBe("afterExpiry");
	});

	it("lets an owner or manager manage an announcement only when every store it names is in their scope", () => {
		const owner: Membership = { role: "owner", storeIds: null };
		const limited: Membership = { role: "manager", storeIds: [STORE_1] };
		expect(canManageAnnouncement(owner, null)).toBe(true);
		expect(canManageAnnouncement(owner, [STORE_2])).toBe(true);
		expect(canManageAnnouncement(limited, null)).toBe(false);
		expect(canManageAnnouncement(limited, [STORE_1])).toBe(true);
		expect(canManageAnnouncement(limited, [STORE_1, STORE_2])).toBe(false);
		expect(canManageAnnouncement(limited, [])).toBe(false);
		for (const role of ["staff", "viewer", "publisher"] as const) {
			expect(canManageAnnouncement({ role, storeIds: null }, null)).toBe(false);
			expect(publishableStores(STORES, { role, storeIds: null })).toEqual([]);
		}
		expect(canManageAnnouncement(undefined, [STORE_1])).toBe(false);
		expect(publishableStores(STORES, owner)).toEqual(STORES);
		expect(publishableStores(STORES, limited)).toEqual([STORES[0]]);
		expect(sendsToEveryStore(owner)).toBe(true);
		expect(sendsToEveryStore(limited)).toBe(false);
		expect(sendsToEveryStore({ role: "staff", storeIds: null })).toBe(false);
	});

	it("keeps the tenant's announcements for the stores selected, every-store ones included", () => {
		const list = seeded().data.announcements;
		expect(
			announcementsInScope(list, TENANT.id, [STORE_1]).map((row) => row.id),
		).toEqual(["pinned", "both"]);
		expect(
			announcementsInScope(list, TENANT.id, [STORE_2]).map((row) => row.id),
		).toEqual(["pinned", "both", "store-2"]);
		expect(storesLabelOf(STORES, null)).toEqual({ every: true });
		expect(storesLabelOf(STORES.slice(0, 1), [STORE_1, STORE_2])).toEqual({
			every: false,
			names: ["Cửa hàng mẫu 1"],
			others: 1,
		});
	});

	it("lists the people who have not read first and the readers by read time", () => {
		const { unread, read } = splitReaders([
			reader("late", "Muộn", "2026-11-17T09:00:00Z"),
			reader("none", "Chưa", null),
			reader("early", "Sớm", "2026-11-17T01:00:00Z"),
		]);
		expect(unread.map((row) => row.userId)).toEqual(["none"]);
		expect(read.map((row) => row.userId)).toEqual(["early", "late"]);
	});

	it("builds the request: every store as null, chosen stores once each, the pin as the end of the day", () => {
		const draft = {
			...emptyCompose("every", [STORE_1]),
			title: "  Họp đầu tuần ",
			body: "\nSáng thứ Hai 8 giờ.\r\n",
		};
		expect(composeRequest(draft, ZONE)).toEqual({
			title: "Họp đầu tuần",
			body: "Sáng thứ Hai 8 giờ.",
			storeIds: null,
			pinnedUntil: null,
		});
		expect(
			composeRequest(
				{
					...draft,
					storeChoice: "chosen",
					storeIds: [STORE_2, STORE_2],
					pinDate: "2026-11-20",
				},
				ZONE,
			),
		).toMatchObject({
			storeIds: [STORE_2],
			pinnedUntil: "2026-11-20T17:00:00.000Z",
		});
		expect(
			composeIssues(
				{ ...draft, storeChoice: "chosen", storeIds: [] },
				TODAY,
				ZONE,
			),
		).toEqual({ title: null, body: null, stores: "none", pin: null });
	});
});

describe("the announcements page", () => {
	beforeEach(() => {
		vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
		current.selected = [...STORES];
		Element.prototype.scrollIntoView = () => undefined;
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("shows the plain state in the demo, which has no staff app", async () => {
		renderPage({ operations: null });
		expect(await screen.findByTestId("operations-demo")).toHaveTextContent(
			"Bản demo không có ứng dụng nhân viên nên chưa có thông báo.",
		);
		expect(
			screen.getByRole("heading", { level: 1, name: "Vận hành · Thông báo" }),
		).toBeInTheDocument();
		expect(screen.queryByTestId("announcement-compose")).toBeNull();
		expect(screen.queryByTestId("announcement-list")).toBeNull();
		expect(screen.queryByTestId("range-picker")).toBeNull();
	});

	it.each([
		["staff", null],
		["viewer", null],
		["publisher", [STORE_1]],
	] as const)(
		"gives %s the reason and no announcement",
		async (role, storeIds) => {
			const operations = renderPage({
				membership: {
					role,
					storeIds: storeIds === null ? null : [...storeIds],
				},
			});
			await waitFor(() =>
				expect(screen.getByTestId("operations-read-only")).toHaveTextContent(
					"Trang Vận hành chỉ dành cho chủ và quản lý.",
				),
			);
			expect(screen.queryByTestId("announcement-compose")).toBeNull();
			expect(screen.queryByTestId("announcement-list")).toBeNull();
			expect(operations?.calls.map(([method]) => method)).not.toContain(
				"announcements",
			);
		},
	);

	it("lists the tenant's announcements pinned first with the read rate, the body as plain text and no range", async () => {
		renderPage();
		const items = await listItems();
		expect(
			items.map(
				(element) =>
					within(element).getByTestId("announcement-title").textContent,
			),
		).toEqual(["Lịch trực Tết", "Đồng phục mới", "Sửa máy lạnh"]);
		expect(screen.queryByTestId("range-picker")).toBeNull();
		expect(screen.getByTestId("announcement-summary")).toHaveTextContent(
			"3 thông báo, 1 đang ghim.",
		);
		const pinned = item("Lịch trực Tết");
		expect(pinned).toHaveAttribute("data-pinned", "true");
		expect(within(pinned).getByTestId("announcement-pinned")).toHaveTextContent(
			"Đang ghim đến 25/11/2026 00:00",
		);
		expect(within(pinned).getByTestId("announcement-text")).toHaveTextContent(
			LINK_TEXT,
		);
		expect(screen.getByTestId("announcement-list").querySelector("a")).toBe(
			null,
		);
		expect(within(pinned).getByTestId("announcement-stores")).toHaveTextContent(
			"Cửa hàng: mọi cửa hàng · Gửi tới: Quản lý, Nhân viên",
		);
		expect(pinned).toHaveTextContent("Đăng 17/11/2026 09:00 · Bạn");
		await waitFor(() =>
			expect(
				within(pinned).getByTestId("announcement-rate-value"),
			).toHaveTextContent(/^3\/5 người \(60(,0)?\s?%\)$/),
		);
		expect(
			within(pinned).getByTestId("announcement-rate-day"),
		).toHaveTextContent(/Trong 24 giờ đầu: 2\/5 người \(40(,0)?\s?%\)/);
		const storeTwo = item("Sửa máy lạnh");
		await waitFor(() =>
			expect(
				within(storeTwo).getByTestId("announcement-rate"),
			).toHaveTextContent("Chưa có ai trong danh sách nhận."),
		);
		expect(storeTwo).toHaveTextContent("Quản lý cửa hàng 2");
		expect(screen.queryByText("Thông báo của quán khác")).toBeNull();
	});

	it("shows only the announcements of the stores selected", async () => {
		current.selected = [STORES[0]];
		renderPage();
		const items = await listItems();
		expect(items).toHaveLength(2);
		expect(screen.queryByText("Sửa máy lạnh")).toBeNull();
	});

	it("lists who has not read first and the readers with their read time, on demand", async () => {
		const user = userEvent.setup();
		const operations = renderPage();
		await listItems();
		const pinned = item("Lịch trực Tết");
		expect(operations?.calls.map(([method]) => method)).not.toContain(
			"announcementReaders",
		);
		await user.click(
			within(pinned).getByRole("button", {
				name: "Xem ai chưa đọc: Lịch trực Tết",
			}),
		);
		const unread = await within(pinned).findByTestId("announcement-unread");
		expect(unread).toHaveTextContent("Chưa đọc (2)");
		expect(
			within(unread)
				.getAllByTestId("announcement-reader")
				.map((row) => row.textContent),
		).toEqual(["Nhân viên An · Nhân viên", "Chưa có tên · Quản lý"]);
		const read = within(pinned).getByTestId("announcement-read");
		expect(read).toHaveTextContent("Đã đọc (1)");
		expect(within(read).getByTestId("announcement-reader")).toHaveTextContent(
			"Nhân viên Bình · Nhân viên · không còn là thành viên · đọc lúc 17/11/2026 10:15",
		);
		expect(
			within(pinned).getByTestId("announcement-readers-toggle"),
		).toHaveAttribute("aria-expanded", "true");
	});

	it("refuses an empty announcement on the page without calling the server", async () => {
		const user = userEvent.setup();
		const operations = renderPage();
		await listItems();
		await user.click(screen.getByRole("button", { name: "Đăng thông báo" }));
		const compose = screen.getByTestId("announcement-compose");
		expect(compose).toHaveTextContent("Nhập tiêu đề.");
		expect(compose).toHaveTextContent("Nhập nội dung.");
		expect(screen.getByTestId("announcement-publish-status")).toHaveTextContent(
			"Sửa các mục đánh dấu đỏ trước khi đăng.",
		);
		expect(screen.getByLabelText("Tiêu đề")).toHaveAttribute(
			"aria-invalid",
			"true",
		);
		expect(operations?.calls.map(([method]) => method)).not.toContain(
			"publishAnnouncement",
		);
	});

	it("publishes to every store with a pin as the owner and lists it first", async () => {
		const user = userEvent.setup();
		const operations = renderPage();
		await listItems();
		await user.type(screen.getByLabelText("Tiêu đề"), "  Họp đầu tuần ");
		await user.type(
			screen.getByLabelText("Nội dung"),
			"Sáng thứ Hai 8 giờ.{enter}Xem www.example.vn",
		);
		expect(
			screen.getByLabelText("Mọi cửa hàng, kể cả cửa hàng mở sau này"),
		).toBeChecked();
		await user.type(
			within(screen.getByTestId("announcement-compose")).getByLabelText(
				"Ghim đến hết ngày",
			),
			"2026-11-20",
		);
		await user.click(screen.getByRole("button", { name: "Đăng thông báo" }));
		await waitFor(() =>
			expect(
				screen.getByTestId("announcement-publish-status"),
			).toHaveTextContent("Đã đăng tới 4 người."),
		);
		expect(
			operations?.calls.find(([method]) => method === "publishAnnouncement"),
		).toEqual([
			"publishAnnouncement",
			{
				tenantId: TENANT.id,
				title: "Họp đầu tuần",
				body: "Sáng thứ Hai 8 giờ.\nXem www.example.vn",
				storeIds: null,
				pinnedUntil: "2026-11-20T17:00:00.000Z",
			},
		]);
		expect(screen.getByLabelText("Tiêu đề")).toHaveValue("");
		await waitFor(() =>
			expect(
				within(
					screen.getAllByTestId("announcement")[0] as HTMLElement,
				).getByTestId("announcement-title"),
			).toHaveTextContent("Họp đầu tuần"),
		);
	});

	it("publishes to the stores chosen, and says when nobody receives it", async () => {
		const user = userEvent.setup();
		const operations = renderPage();
		if (operations === null) throw new Error("no operations");
		operations.data.publishRecipients = 0;
		await listItems();
		await user.type(screen.getByLabelText("Tiêu đề"), "Kiểm kho");
		await user.type(screen.getByLabelText("Nội dung"), "Tối nay kiểm kho.");
		await user.click(screen.getByLabelText("Các cửa hàng chọn dưới đây"));
		await user.click(screen.getByLabelText("Cửa hàng mẫu 1"));
		await user.click(screen.getByLabelText("Cửa hàng mẫu 2"));
		await user.click(screen.getByRole("button", { name: "Đăng thông báo" }));
		expect(screen.getByTestId("announcement-store-choice")).toHaveTextContent(
			"Chọn ít nhất một cửa hàng.",
		);
		await user.click(screen.getByLabelText("Cửa hàng mẫu 2"));
		await user.click(screen.getByRole("button", { name: "Đăng thông báo" }));
		await waitFor(() =>
			expect(
				screen.getByTestId("announcement-publish-status"),
			).toHaveTextContent(
				"Đã đăng; chưa có ai trong danh sách nhận của các cửa hàng này.",
			),
		);
		expect(
			operations.calls.find(
				([method]) => method === "publishAnnouncement",
			)?.[1],
		).toMatchObject({ storeIds: [STORE_2], pinnedUntil: null });
	});

	it("gives a store-limited manager their stores only, the scope note, and no pin on an announcement beyond them", async () => {
		const user = userEvent.setup();
		const operations = renderPage({
			membership: { role: "manager", storeIds: [STORE_1] },
		});
		await listItems();
		expect(
			screen.queryByLabelText("Mọi cửa hàng, kể cả cửa hàng mở sau này"),
		).toBeNull();
		expect(screen.getByLabelText("Cửa hàng mẫu 1")).toBeChecked();
		expect(screen.queryByLabelText("Cửa hàng mẫu 2")).toBeNull();
		expect(screen.getByTestId("announcement-scope-note")).toHaveTextContent(
			"chỉ tính quản lý và nhân viên của các cửa hàng bạn quản lý",
		);
		for (const title of ["Lịch trực Tết", "Đồng phục mới"]) {
			const row = item(title);
			expect(
				within(row).getByTestId("announcement-not-managed"),
			).toBeInTheDocument();
			expect(within(row).queryByTestId("announcement-pin")).toBeNull();
			expect(within(row).queryByTestId("announcement-unpin")).toBeNull();
		}
		await user.type(screen.getByLabelText("Tiêu đề"), "Ca tối");
		await user.type(screen.getByLabelText("Nội dung"), "Ca tối thêm người.");
		await user.click(screen.getByRole("button", { name: "Đăng thông báo" }));
		await waitFor(() =>
			expect(
				operations?.calls.find(
					([method]) => method === "publishAnnouncement",
				)?.[1],
			).toMatchObject({ storeIds: [STORE_1] }),
		);
	});

	it("unpins and pins until the end of the chosen day, and says when the server refuses", async () => {
		const user = userEvent.setup();
		const operations = renderPage();
		if (operations === null) throw new Error("no operations");
		await listItems();
		await user.click(
			screen.getByRole("button", { name: "Bỏ ghim: Lịch trực Tết" }),
		);
		await waitFor(() =>
			expect(screen.getByTestId("announcement-pin-status")).toHaveTextContent(
				"Đã bỏ ghim thông báo.",
			),
		);
		expect(
			operations.calls.find(([method]) => method === "setAnnouncementPin")?.[1],
		).toEqual({ announcementId: "pinned", pinnedUntil: null });
		const both = item("Đồng phục mới");
		expect(within(both).getByLabelText("Ghim đến hết ngày")).toHaveValue(
			"2026-11-24",
		);
		await user.click(
			within(both).getByRole("button", { name: "Ghim: Đồng phục mới" }),
		);
		await waitFor(() =>
			expect(screen.getByTestId("announcement-pin-status")).toHaveTextContent(
				"Đã ghim thông báo.",
			),
		);
		expect(
			operations.calls.filter(
				([method]) => method === "setAnnouncementPin",
			)[1]?.[1],
		).toEqual({
			announcementId: "both",
			pinnedUntil: "2026-11-24T17:00:00.000Z",
		});
		operations.refuse("setAnnouncementPin", "forbidden");
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Bỏ ghim: Đồng phục mới" }),
			).toBeInTheDocument(),
		);
		await user.click(
			screen.getByRole("button", { name: "Bỏ ghim: Đồng phục mới" }),
		);
		await waitFor(() =>
			expect(screen.getByTestId("announcement-pin-status")).toHaveTextContent(
				"Bạn không ghim hay bỏ ghim được thông báo này",
			),
		);
	});

	it("keeps the pin button unavailable for a day outside the pin's range", async () => {
		const user = userEvent.setup();
		const operations = renderPage();
		await listItems();
		const both = item("Đồng phục mới");
		const date = within(both).getByLabelText("Ghim đến hết ngày");
		await user.clear(date);
		await user.type(date, "2026-11-17");
		expect(both).toHaveTextContent(
			"Chọn một ngày từ 18/11/2026 đến 17/11/2027.",
		);
		const pin = within(both).getByRole("button", {
			name: "Ghim: Đồng phục mới",
		});
		expect(pin).toHaveAttribute("aria-disabled", "true");
		await user.click(pin);
		expect(operations?.calls.map(([method]) => method)).not.toContain(
			"setAnnouncementPin",
		);
	});

	it("shows twenty announcements at a time", async () => {
		const user = userEvent.setup();
		const operations = createFakeOperations();
		operations.data.announcements = Array.from({ length: 25 }, (_, index) =>
			announcement(`n-${index + 1}`),
		);
		renderPage({ operations });
		expect(await listItems()).toHaveLength(20);
		await user.click(
			screen.getByRole("button", { name: "Xem thêm thông báo" }),
		);
		expect(screen.getAllByTestId("announcement")).toHaveLength(25);
		expect(screen.queryByTestId("announcement-more")).toBeNull();
	});

	it("says when the read rate cannot be loaded and offers a retry", async () => {
		const operations = seeded();
		operations.refuse("announcementReadRate", "network");
		renderPage({ operations });
		await listItems();
		await waitFor(() =>
			expect(
				within(item("Lịch trực Tết")).getByTestId("announcement-rate"),
			).toHaveTextContent("Không tải được tỉ lệ đọc."),
		);
		expect(
			within(item("Lịch trực Tết")).getByRole("button", { name: "Thử lại" }),
		).toBeInTheDocument();
	});
});
