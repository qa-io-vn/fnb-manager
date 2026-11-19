import { DemoSettingsStore, demoStoreIds } from "@fnb/demo-analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { csvOfRows } from "../components/report-card/data-table";
import { I18nProvider, translate } from "../i18n";
import { MemberPage } from "../pages/loyalty/member-page";
import { MembersPage } from "../pages/loyalty/members-page";
import { QueuePage } from "../pages/loyalty/queue-page";
import { createDemoSettingsSource } from "../settings/demo-settings-source";
import type { Membership, SettingsSource } from "../settings/source";
import { vndFormatters } from "../test/render";
import { loyaltyReadAccess } from "./access";
import {
	anomalyRows,
	anomalySummary,
	anomalyTable,
	balanceOf,
	balancesByMember,
	candidatesInOrder,
	closedQueueItems,
	ledgerTable,
	memberColumns,
	memberTableRows,
	numberedShifts,
	openQueueItems,
	resolutionIssue,
} from "./models";
import type {
	AnomalyInputs,
	CustomerSource,
	InvoiceReference,
	LedgerEntryRow,
	MemberRow,
	QueueItemRow,
} from "./source";

const TENANT = {
	id: "33333333-3333-4333-8333-333333333333",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: "Asia/Ho_Chi_Minh",
	countryCode: "VN",
};

const [STORE_1 = "", STORE_2 = ""] = demoStoreIds();

const STORES = [STORE_1, STORE_2].map((id, index) => ({
	id,
	tenantId: TENANT.id,
	name: `Cửa hàng mẫu ${index + 1}`,
	code: null,
	timeZone: "Asia/Ho_Chi_Minh",
	businessDayStartMinutes: 0,
	posAccountId: "account",
}));

const COUNTRY = "+84";
const phoneOf = (tail: string) => `${COUNTRY}90000${tail}`;
const FULL_PHONES = [phoneOf("0101"), phoneOf("0102")];

const M1 = "aaaaaaaa-0000-4000-8000-000000000001";
const M2 = "aaaaaaaa-0000-4000-8000-000000000002";
const M3 = "aaaaaaaa-0000-4000-8000-000000000003";
const PROGRAMME = "bbbbbbbb-0000-4000-8000-000000000001";

const MEMBERS: MemberRow[] = [
	{
		membershipId: M1,
		programmeId: PROGRAMME,
		phone: FULL_PHONES[0] ?? null,
		joinedAt: "2026-11-15T02:00:00Z",
		status: "active",
		channel: "mini_app",
	},
	{
		membershipId: M2,
		programmeId: PROGRAMME,
		phone: `0${FULL_PHONES[1]?.slice(3)}`,
		joinedAt: "2026-11-14T02:00:00Z",
		status: "suspended",
		channel: "till",
	},
	{
		membershipId: M3,
		programmeId: PROGRAMME,
		phone: null,
		joinedAt: "2026-11-13T02:00:00Z",
		status: "active",
		channel: "staff",
	},
];

function invoice(
	id: string,
	receiptNo: string,
	soldAt: string,
): InvoiceReference {
	return {
		id,
		externalId: `EXT-${id}`,
		receiptNo,
		businessDate: soldAt.slice(0, 10),
		soldAt,
		netAmount: 55_000,
		shiftExternalId: null,
	};
}

function entry(id: string, overrides: Partial<LedgerEntryRow>): LedgerEntryRow {
	return {
		id,
		membershipId: M1,
		storeId: STORE_1,
		entryKind: "earn",
		stampDelta: 0,
		pointDelta: 0,
		valueAmount: 0,
		invoice: null,
		businessDate: null,
		matchedPath: null,
		pending: false,
		sourceEntryId: null,
		reason: null,
		occurredAt: "2026-11-17T03:00:00Z",
		expiresAt: null,
		...overrides,
	};
}

const LEDGER: LedgerEntryRow[] = [
	entry("e1", {
		entryKind: "adjust",
		storeId: null,
		stampDelta: 2,
		reason: "welcome",
		occurredAt: "2026-11-15T02:00:00Z",
	}),
	entry("e2", {
		stampDelta: 1,
		pointDelta: 5,
		valueAmount: 2_500,
		matchedPath: "A",
		businessDate: "2026-11-16",
		invoice: invoice("i1", "12", "2026-11-16T03:00:00Z"),
		occurredAt: "2026-11-16T04:00:00Z",
	}),
	entry("e3", {
		entryKind: "clawback",
		stampDelta: -1,
		pointDelta: -5,
		valueAmount: -2_500,
		sourceEntryId: "e2",
		reason: "invoice_voided",
		invoice: invoice("i1", "12", "2026-11-16T03:00:00Z"),
		occurredAt: "2026-11-17T01:00:00Z",
	}),
	entry("e4", {
		stampDelta: 1,
		pointDelta: 3,
		matchedPath: "B",
		pending: true,
		businessDate: "2026-11-17",
		invoice: invoice("i2", "15", "2026-11-17T03:00:00Z"),
		occurredAt: "2026-11-17T03:05:00Z",
	}),
	entry("e5", {
		stampDelta: 1,
		pointDelta: 6,
		matchedPath: "C",
		pending: true,
		businessDate: "2026-11-17",
		invoice: invoice("i3", "16", "2026-11-17T04:00:00Z"),
		occurredAt: "2026-11-17T04:05:00Z",
	}),
	entry("e6", {
		entryKind: "confirm",
		sourceEntryId: "e5",
		invoice: invoice("i3", "16", "2026-11-17T04:00:00Z"),
		occurredAt: "2026-11-17T05:00:00Z",
	}),
];

const t = (
	key: Parameters<typeof translate>[1],
	params?: Record<string, string | number>,
) => translate("vi", key, params);

const CONTEXT = {
	t,
	formatters: vndFormatters(),
	timeZone: TENANT.timeZone,
	stores: STORES,
};

const ITEM: QueueItemRow = {
	id: "cccccccc-0000-4000-8000-000000000001",
	storeId: STORE_1,
	membershipId: M1,
	phone: FULL_PHONES[0] ?? null,
	matchedPath: "B",
	reason: "two_candidates",
	state: "open",
	createdAt: "2026-11-17T06:00:00Z",
	resolvedAt: null,
	resolvedBy: null,
	chosenInvoiceId: null,
	resolutionReason: null,
	entryId: null,
	checkin: { recordedAt: "2026-11-17T05:55:00Z", amount: null },
	claim: null,
	candidateIds: ["i5", "i4"],
	candidates: [
		invoice("i5", "21", "2026-11-17T05:58:00Z"),
		invoice("i4", "20", "2026-11-17T05:52:00Z"),
	],
};

const CLOSED: QueueItemRow = {
	...ITEM,
	id: "cccccccc-0000-4000-8000-000000000002",
	state: "resolved",
	resolvedAt: "2026-11-16T08:00:00Z",
	chosenInvoiceId: "i4",
	resolutionReason: "Khách đưa hóa đơn giấy",
};

describe("the members page model", () => {
	it("gives a balance like the ledger function: confirmed earns, adjustments and clawbacks spend, open pending earns wait", () => {
		expect(balanceOf(LEDGER)).toEqual({
			stamps: 3,
			points: 6,
			pendingStamps: 1,
			pendingPoints: 3,
			lastVisit: "2026-11-17",
			entries: 6,
		});
		expect(balanceOf([])).toMatchObject({ stamps: 0, lastVisit: null });
	});

	it("lists members with masked phones only, in the table and in its CSV", () => {
		const balances = balancesByMember(LEDGER);
		const rows = memberTableRows(MEMBERS, balances, CONTEXT);
		expect(rows.map((row) => row.cells.phone)).toEqual([
			`${COUNTRY} ••• ••• 101`,
			`${COUNTRY} ••• ••• 102`,
			"Không có số",
		]);
		expect(rows[0]?.cells).toMatchObject({
			joined: "2026-11-15",
			status: "Đang hoạt động",
			stamps: 3,
			points: 6,
			pending: 4,
			lastVisit: "2026-11-17",
		});
		expect(rows[1]?.cells).toMatchObject({ status: "Tạm khóa", stamps: 0 });
		const csv = csvOfRows(memberColumns(t), rows, (label) => label);
		for (const phone of FULL_PHONES) {
			expect(csv).not.toContain(phone);
			expect(csv).not.toContain(phone.slice(3));
		}
	});
});

describe("the ledger lookup model", () => {
	it("lists every ledger row newest first with its path, invoice and reason", () => {
		const table = ledgerTable(LEDGER, CONTEXT);
		expect(table.rows.map((row) => row.id)).toEqual([
			"e6",
			"e5",
			"e4",
			"e3",
			"e2",
			"e1",
		]);
		const byId = new Map(table.rows.map((row) => [row.id, row.cells]));
		expect(byId.get("e2")).toMatchObject({
			kind: "Tích",
			path: "A · Số điện thoại trên hóa đơn",
			invoice: "Số 12 · 16/11/2026",
			state: "Đã thu hồi",
			stamps: 1,
			points: 5,
		});
		expect(byId.get("e3")).toMatchObject({
			kind: "Thu hồi",
			reason: "Hóa đơn bị hủy",
			stamps: -1,
		});
		expect(byId.get("e4")).toMatchObject({ state: "Chờ xác nhận" });
		expect(byId.get("e5")).toMatchObject({ state: "Đã xác nhận" });
		expect(byId.get("e1")).toMatchObject({
			kind: "Điều chỉnh",
			reason: "Quà tham gia",
			store: "Toàn chuỗi",
		});
	});
});

describe("the reconciliation queue model", () => {
	it("splits open items from resolved ones and shows candidates by time of sale", () => {
		const items = [CLOSED, ITEM];
		expect(openQueueItems(items).map((item) => item.id)).toEqual([ITEM.id]);
		expect(closedQueueItems(items).map((item) => item.id)).toEqual([CLOSED.id]);
		expect(candidatesInOrder(ITEM).map((invoice) => invoice.id)).toEqual([
			"i4",
			"i5",
		]);
	});

	it("needs a chosen invoice and a reason of at most 200 characters, and no invoice to dismiss", () => {
		expect(resolutionIssue(null, "lý do", false)).toBe("choiceRequired");
		expect(resolutionIssue("i4", "  ", false)).toBe("reasonRequired");
		expect(resolutionIssue("i4", "x".repeat(201), false)).toBe("reasonTooLong");
		expect(resolutionIssue("i4", "Khách đưa hóa đơn giấy", false)).toBeNull();
		expect(resolutionIssue(null, "Khách không mua", true)).toBeNull();
	});

	it("gives owners and managers the queue, viewers the lists only and staff nothing; only owners see full phones", () => {
		const of = (role: Membership["role"], storeIds: string[] | null = null) =>
			loyaltyReadAccess({ role, storeIds });
		expect(of("owner")).toMatchObject({
			canRead: true,
			canResolve: true,
			seesFullPhone: true,
		});
		expect(of("manager", [STORE_1])).toMatchObject({
			canRead: true,
			canResolve: true,
			seesFullPhone: false,
		});
		expect(of("viewer")).toMatchObject({ canRead: true, canResolve: false });
		expect(of("staff")).toMatchObject({ canRead: false, reason: "role" });
		expect(of("publisher")).toMatchObject({ canRead: false });
		expect(loyaltyReadAccess(null).reason).toBe("notMember");
		expect(loyaltyReadAccess(undefined).reason).toBe("unknown");
	});
});

describe("the shift anomaly model", () => {
	const inputs: AnomalyInputs = {
		shifts: [
			{
				id: "s1",
				storeId: STORE_1,
				externalId: "pos-b",
				openedAt: "2026-11-17T01:00:00Z",
				closedAt: "2026-11-17T05:00:00Z",
			},
			{
				id: "s2",
				storeId: STORE_1,
				externalId: "pos-a",
				openedAt: "2026-11-17T05:00:00Z",
				closedAt: "2026-11-17T10:00:00Z",
			},
			{
				id: "s3",
				storeId: STORE_2,
				externalId: "pos-c",
				openedAt: "2026-11-17T02:00:00Z",
				closedAt: null,
			},
		],
		earns: [
			{
				storeId: STORE_1,
				businessDate: "2026-11-17",
				matchedPath: "A",
				shiftExternalId: "pos-b",
				soldAt: "2026-11-17T02:00:00Z",
			},
			{
				storeId: STORE_1,
				businessDate: "2026-11-17",
				matchedPath: "B",
				shiftExternalId: "pos-b",
				soldAt: "2026-11-17T03:00:00Z",
			},
			{
				storeId: STORE_1,
				businessDate: "2026-11-17",
				matchedPath: "C",
				shiftExternalId: null,
				soldAt: "2026-11-17T06:00:00Z",
			},
			{
				storeId: STORE_1,
				businessDate: "2026-11-10",
				matchedPath: "A",
				shiftExternalId: null,
				soldAt: "2026-11-10T06:00:00Z",
			},
		],
		refusals: [
			{
				storeId: STORE_1,
				businessDate: "2026-11-17",
				reason: "excluded_phone",
				shiftExternalId: "pos-a",
				soldAt: "2026-11-17T07:00:00Z",
			},
			{
				storeId: STORE_1,
				businessDate: "2026-11-17",
				reason: "below_minimum",
				shiftExternalId: "pos-b",
				soldAt: "2026-11-17T04:00:00Z",
			},
			{
				storeId: STORE_2,
				businessDate: "2026-11-17",
				reason: "daily_cap",
				shiftExternalId: null,
				soldAt: "2026-11-17T09:00:00Z",
			},
		],
		adjustments: [{ storeId: STORE_1, at: "2026-11-17T07:30:00Z" }],
		checkinsWithoutInvoice: [{ storeId: STORE_1, at: "2026-11-17T11:00:00Z" }],
	};

	it("numbers the shifts of a store and day by opening time, never by the POS name", () => {
		const numbered = numberedShifts(inputs.shifts, STORES);
		expect(
			numbered.map((shift) => [shift.id, shift.businessDate, shift.number]),
		).toEqual(
			expect.arrayContaining([
				["s1", "2026-11-17", 1],
				["s2", "2026-11-17", 2],
				["s3", "2026-11-17", 1],
			]),
		);
	});

	it("counts earns, refusals by reason, manual adjustments and check-ins without an invoice per shift within the range", () => {
		const rows = anomalyRows(inputs, STORES, "2026-11-15", "2026-11-17");
		const of = (storeId: string, shiftNumber: number | null) =>
			rows.find(
				(row) => row.storeId === storeId && row.shiftNumber === shiftNumber,
			);
		expect(rows).toHaveLength(4);
		expect(of(STORE_1, 1)).toMatchObject({
			earns: 2,
			refusalsTotal: 1,
			adjustments: 0,
			signals: 0,
		});
		expect(of(STORE_1, 1)?.refusals.below_minimum).toBe(1);
		expect(of(STORE_1, 2)).toMatchObject({
			earns: 1,
			refusalsTotal: 1,
			adjustments: 1,
			signals: 2,
		});
		expect(of(STORE_1, 2)?.refusals.excluded_phone).toBe(1);
		expect(of(STORE_1, null)).toMatchObject({
			checkinsWithoutInvoice: 1,
			signals: 1,
		});
		expect(of(STORE_2, 1)?.refusals.daily_cap).toBe(1);
		expect(anomalySummary(rows)).toEqual({
			shifts: 4,
			earns: 3,
			refusals: 3,
			adjustments: 1,
			checkinsWithoutInvoice: 1,
			flagged: 3,
		});
		const table = anomalyTable(rows, CONTEXT);
		expect(table.columns.map((column) => column.key)).toEqual([
			"store",
			"date",
			"shift",
			"earns",
			"refusals",
			"refusal_below_minimum",
			"refusal_daily_cap",
			"refusal_excluded_phone",
			"adjustments",
			"checkins",
			"signals",
		]);
		expect(table.initialSort).toEqual({
			key: "signals",
			direction: "descending",
		});
		expect(table.rows.map((row) => row.cells.shift)).toContain("Ngoài ca");
	});
});

const current = vi.hoisted(() => ({ state: { status: "loading" } as unknown }));

vi.mock("../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({
		tenant: TENANT,
		stores: STORES,
		selectedStores: STORES,
		allStoresSelected: true,
		selectStores: () => undefined,
	}),
}));

vi.mock("../settings/settings-source-context", () => ({
	useSettingsSourceState: () => current.state,
	useRetrySettingsSource: () => () => undefined,
}));

interface FakeCustomers extends CustomerSource {
	readonly calls: string[];
}

function fakeCustomers(): FakeCustomers {
	const calls: string[] = [];
	return {
		kind: "supabase",
		calls,
		members: vi.fn(async () => {
			calls.push("members");
			return { rows: MEMBERS, next: null };
		}),
		lookup: vi.fn(async (_tenantId: string, phone: string) => {
			calls.push("lookup");
			return phone.endsWith("0101") ? [MEMBERS[0] as MemberRow] : [];
		}),
		member: vi.fn(
			async (id: string) =>
				MEMBERS.find((row) => row.membershipId === id) ?? null,
		),
		ledger: vi.fn(async () => {
			calls.push("ledger");
			return LEDGER;
		}),
		queue: vi.fn(async () => {
			calls.push("queue");
			return [ITEM, CLOSED];
		}),
		resolveQueueItem: vi.fn(async () => ({
			state: "resolved" as const,
			entryId: "e9",
			refusal: null,
		})),
		anomalies: vi.fn(async () => ({
			shifts: [],
			earns: [],
			refusals: [],
			adjustments: [],
			checkinsWithoutInvoice: [],
		})),
	};
}

function LocationProbe() {
	const location = useLocation();
	return <p data-testid="probe">{`${location.pathname}${location.search}`}</p>;
}

function renderPage(
	page: ReactElement,
	path: string,
	entry: string,
	{
		membership = { role: "owner", storeIds: null } as Membership,
		customers = fakeCustomers() as FakeCustomers | null,
	} = {},
) {
	const source: SettingsSource = {
		...createDemoSettingsSource(new DemoSettingsStore()),
		membership: async () => membership,
	};
	current.state = { status: "ready", source, customers };
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<MemoryRouter initialEntries={[entry]}>
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<QueryClientProvider client={client}>
					<Routes>
						<Route path={path} element={page} />
					</Routes>
					<LocationProbe />
				</QueryClientProvider>
			</I18nProvider>
		</MemoryRouter>,
	);
	return customers;
}

beforeEach(() => {
	Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
	current.state = { status: "loading" };
	document.title = "";
});

function expectNoFullPhone() {
	const text = `${document.body.textContent ?? ""} ${document.title}`;
	for (const phone of FULL_PHONES) {
		expect(text).not.toContain(phone);
		expect(text).not.toContain(phone.slice(3));
	}
}

describe("the members page", () => {
	it("lists the members masked, each linked to its ledger, with the metric cards' slot", async () => {
		renderPage(
			<MembersPage />,
			"/khach-hang/thanh-vien",
			"/khach-hang/thanh-vien",
		);
		const rows = await screen.findAllByTestId("loyalty-member-row");
		expect(rows).toHaveLength(3);
		const first = within(rows[0] as HTMLElement).getByRole("link");
		expect(first).toHaveTextContent(`${COUNTRY} ••• ••• 101`);
		expect(first).toHaveAttribute("href", `/khach-hang/thanh-vien/${M1}`);
		expect(screen.getByTestId("loyalty-metrics-slot")).toBeVisible();
		expect(screen.getByTestId("loyalty-members-count")).toHaveTextContent(
			"3 thành viên.",
		);
		expect(document.title).toContain("Khách hàng · Thành viên");
		expectNoFullPhone();
	});

	it("shows the full phone only in the owner's lookup result, and never puts it in the address", async () => {
		const user = userEvent.setup();
		const customers = renderPage(
			<MembersPage />,
			"/khach-hang/thanh-vien",
			"/khach-hang/thanh-vien",
		);
		const input = await screen.findByTestId("loyalty-lookup-input");
		await user.type(input, "0900000101");
		await user.click(screen.getByTestId("loyalty-lookup-submit"));
		expect(await screen.findByTestId("loyalty-lookup-phone")).toHaveTextContent(
			`${COUNTRY} 90 000 0101`,
		);
		expect(customers?.lookup).toHaveBeenCalledWith(TENANT.id, "0900000101");
		expect(screen.getByTestId("probe")).toHaveTextContent(
			/^\/khach-hang\/thanh-vien$/,
		);
		expect(document.title).not.toContain("0101");
	});

	it("keeps the lookup result masked for a manager and refuses an unreadable phone", async () => {
		const user = userEvent.setup();
		const customers = renderPage(
			<MembersPage />,
			"/khach-hang/thanh-vien",
			"/khach-hang/thanh-vien",
			{ membership: { role: "manager", storeIds: [STORE_1] } },
		);
		const input = await screen.findByTestId("loyalty-lookup-input");
		await user.type(input, "12");
		await user.click(screen.getByTestId("loyalty-lookup-submit"));
		expect(screen.getByText("Số điện thoại không đọc được.")).toBeVisible();
		expect(customers?.lookup).not.toHaveBeenCalled();
		await user.clear(input);
		await user.type(input, "0900000101");
		await user.click(screen.getByTestId("loyalty-lookup-submit"));
		expect(await screen.findByTestId("loyalty-lookup-phone")).toHaveTextContent(
			`${COUNTRY} ••• ••• 101`,
		);
		expectNoFullPhone();
	});

	it("gives staff the reason and reads nothing", async () => {
		const customers = renderPage(
			<MembersPage />,
			"/khach-hang/thanh-vien",
			"/khach-hang/thanh-vien",
			{ membership: { role: "staff", storeIds: null } },
		);
		expect(await screen.findByTestId("loyalty-no-access")).toHaveTextContent(
			"chủ, quản lý và người xem",
		);
		expect(customers?.calls).toEqual([]);
	});

	it("explains in the demo that the section needs live data", async () => {
		renderPage(
			<MembersPage />,
			"/khach-hang/thanh-vien",
			"/khach-hang/thanh-vien",
			{
				customers: null,
			},
		);
		expect(await screen.findByTestId("loyalty-demo")).toHaveTextContent(
			"Mục này cần dữ liệu thật",
		);
		expect(screen.queryByTestId("loyalty-lookup")).toBeNull();
		expect(screen.getByTestId("loyalty-tabs")).toBeVisible();
	});
});

describe("the member ledger page", () => {
	it("shows the balance and the ledger rows of one member, masked in the heading and the title", async () => {
		renderPage(
			<MemberPage />,
			"/khach-hang/thanh-vien/:membershipId",
			`/khach-hang/thanh-vien/${M1}`,
		);
		expect(
			await screen.findByTestId("loyalty-balance-stamps"),
		).toHaveTextContent("3");
		expect(screen.getByTestId("loyalty-balance-points")).toHaveTextContent("6");
		expect(screen.getByTestId("loyalty-member")).toHaveTextContent(
			`Thành viên ${COUNTRY} ••• ••• 101`,
		);
		const ledger = screen.getByTestId("loyalty-ledger");
		expect(within(ledger).getAllByRole("row")).toHaveLength(7);
		expect(document.title).toContain("Khách hàng · Sổ điểm");
		expectNoFullPhone();
	});

	it("sends an address that is not a membership id back to the list", async () => {
		renderPage(
			<MemberPage />,
			"/khach-hang/thanh-vien/:membershipId",
			"/khach-hang/thanh-vien/0900000101",
		);
		await waitFor(() =>
			expect(screen.getByTestId("probe")).toHaveTextContent(
				/^\/khach-hang\/thanh-vien$/,
			),
		);
	});
});

describe("the reconciliation queue page", () => {
	it("lets a manager resolve an item with a chosen invoice and a reason", async () => {
		const user = userEvent.setup();
		const customers = renderPage(
			<QueuePage />,
			"/khach-hang/doi-soat",
			"/khach-hang/doi-soat",
			{ membership: { role: "manager", storeIds: [STORE_1] } },
		);
		const item = await screen.findByTestId("loyalty-queue-item");
		const radios = within(item).getAllByTestId("loyalty-queue-candidate");
		expect(radios).toHaveLength(2);
		await user.click(within(item).getByTestId("loyalty-queue-choose"));
		expect(within(item).getByText("Chọn một hóa đơn trước.")).toBeVisible();
		await user.click(radios[0] as HTMLElement);
		await user.click(within(item).getByTestId("loyalty-queue-choose"));
		expect(within(item).getByText("Ghi lý do xử lý.")).toBeVisible();
		expect(customers?.resolveQueueItem).not.toHaveBeenCalled();
		await user.type(
			within(item).getByTestId("loyalty-queue-reason"),
			"Khách đưa hóa đơn giấy",
		);
		await user.click(within(item).getByTestId("loyalty-queue-choose"));
		await waitFor(() =>
			expect(customers?.resolveQueueItem).toHaveBeenCalledWith({
				itemId: ITEM.id,
				choice: "i4",
				reason: "Khách đưa hóa đơn giấy",
			}),
		);
		expect(
			await screen.findByText("Đã tích cho hóa đơn được chọn."),
		).toBeVisible();
		expect(screen.getByTestId("loyalty-queue-history")).toHaveTextContent(
			"Khách đưa hóa đơn giấy",
		);
		expectNoFullPhone();
	});

	it("tells a viewer the queue is for owners and managers and reads nothing", async () => {
		const customers = renderPage(
			<QueuePage />,
			"/khach-hang/doi-soat",
			"/khach-hang/doi-soat",
			{ membership: { role: "viewer", storeIds: null } },
		);
		expect(await screen.findByTestId("loyalty-queue-denied")).toBeVisible();
		expect(customers?.calls).toEqual([]);
	});
});
