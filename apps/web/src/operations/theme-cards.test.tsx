import { DemoSettingsStore, demoStoreIds } from "@fnb/demo-analytics";
import { rangeOf } from "@fnb/reports";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { createDemoSettingsSource } from "../settings/demo-settings-source";
import type { Membership, SettingsSource } from "../settings/source";
import { createDemoStaffSource } from "../settings/staff/demo-staff-source";
import type { CashCountRow } from "./source";
import {
	createFakeOperations,
	type FakeOperations,
} from "./testing/fake-operations-source";
import {
	CashCountThemeCard,
	MissingChecklistsThemeCard,
	MissingCountsThemeCard,
	OPERATIONS_CARD_IDS,
} from "./theme-cards";

const TENANT = {
	id: "33333333-3333-4333-8333-333333333333",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: "Asia/Ho_Chi_Minh",
	countryCode: "VN",
};

const [STORE_1 = ""] = demoStoreIds();

const current = vi.hoisted(() => ({ state: { status: "loading" } as unknown }));

vi.mock("../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({ tenant: TENANT, stores: [] }),
}));

vi.mock("../settings/settings-source-context", () => ({
	useSettingsSourceState: () => current.state,
	useRetrySettingsSource: () => () => undefined,
}));

function context(from: string, to: string) {
	return {
		tenantId: TENANT.id,
		stores: [
			{
				id: STORE_1,
				name: "Cửa hàng mẫu 1",
				timeZone: "Asia/Ho_Chi_Minh",
				businessDayStartMinutes: 0,
			},
		],
		allStoresSelected: false,
		range: rangeOf(from, to, "2026-11-17"),
		sample: false,
		params: {},
		catchUpPending: null,
	};
}

function cash(
	shiftNumber: number,
	overrides: Partial<CashCountRow> = {},
): CashCountRow {
	return {
		storeId: STORE_1,
		businessDate: "2026-11-17",
		shiftId: `shift-${shiftNumber}`,
		shiftNumber,
		openedAt: "2026-11-17T00:00:00Z",
		closedAt: "2026-11-17T05:00:00Z",
		cashCountId: `count-${shiftNumber}`,
		countedAmount: 2_000_000,
		countedBy: "staff-1",
		countedAt: "2026-11-17T05:05:00Z",
		recounts: 0,
		expectedCashAmount: 2_000_000,
		drawerAmount: 2_010_000,
		cashSalesAmount: 1_500_000,
		varianceAmount: 0,
		drawerVarianceAmount: 10_000,
		overAbs: false,
		overRel: false,
		overZ: false,
		state: "within",
		...overrides,
	};
}

function renderCard(
	card: ReactElement,
	{
		membership = { role: "owner", storeIds: null } as Membership,
		operations = createFakeOperations({
			cash: [
				cash(1),
				cash(2, {
					cashCountId: null,
					countedAmount: null,
					countedBy: null,
					countedAt: null,
					recounts: null,
					varianceAmount: null,
					state: "no_count",
				}),
			],
		}) as FakeOperations | null,
	} = {},
) {
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
				<QueryClientProvider client={client}>{card}</QueryClientProvider>
			</I18nProvider>
		</MemoryRouter>,
	);
}

async function settled(testId: string): Promise<HTMLElement> {
	await waitFor(() =>
		expect(screen.getByTestId(testId)).not.toHaveAttribute(
			"data-state",
			"loading",
		),
	);
	return screen.getByTestId(testId);
}

describe("the staff app's cards on the theme pages", () => {
	beforeEach(() => {
		vi.useFakeTimers({
			now: new Date("2026-11-18T05:00:00Z"),
			toFake: ["Date"],
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it.each([
		[
			OPERATIONS_CARD_IDS.cash,
			<CashCountThemeCard
				key="a"
				context={context("2026-11-11", "2026-11-17")}
			/>,
		],
		[
			OPERATIONS_CARD_IDS.missingCounts,
			<MissingCountsThemeCard
				key="b"
				context={context("2026-11-11", "2026-11-17")}
			/>,
		],
		[
			OPERATIONS_CARD_IDS.missingChecklists,
			<MissingChecklistsThemeCard
				key="c"
				context={context("2026-11-11", "2026-11-17")}
			/>,
		],
	])(
		"show %s's plain state for the missing input in the demo",
		async (testId, card) => {
			renderCard(card, { operations: null });
			const element = await settled(testId);
			expect(element).toHaveAttribute("data-state", "plain");
			expect(within(element).getByTestId("card-plain")).toHaveTextContent(
				"Mục này cần ứng dụng nhân viên; bản demo không có nên chưa có số liệu.",
			);
		},
	);

	it("tells staff and viewers the card is for owners and managers", async () => {
		renderCard(
			<CashCountThemeCard context={context("2026-11-11", "2026-11-17")} />,
			{ membership: { role: "viewer", storeIds: null } },
		);
		await waitFor(() =>
			expect(screen.getByTestId("card-plain")).toHaveTextContent(
				"Mục này chỉ dành cho chủ và quản lý.",
			),
		);
	});

	it("puts the app's count beside the POS drawer for each Ca n on Ca & két tiền, linked to the history", async () => {
		renderCard(
			<CashCountThemeCard context={context("2026-11-11", "2026-11-17")} />,
		);
		const card = await settled(OPERATIONS_CARD_IDS.cash);
		await waitFor(() =>
			expect(within(card).getByTestId("sentence")).toHaveTextContent(
				"1 trong 2 ca đã đóng có số đếm trên ứng dụng; 0 ca lệch quá ngưỡng và 1 ca chưa đếm.",
			),
		);
		const headers = within(card)
			.getAllByRole("columnheader")
			.map((header) => header.textContent ?? "");
		expect(headers.some((header) => header.includes("Két POS"))).toBe(true);
		expect(headers.some((header) => header.includes("Đếm trên ứng dụng"))).toBe(
			true,
		);
		expect(
			within(card)
				.getAllByRole("row")
				.slice(1)
				.map((row) => within(row).getAllByRole("cell")[1]?.textContent),
		).toEqual(["Ca 1", "Ca 2"]);
		expect(
			within(card).getByRole("link", { name: "Xem lịch sử két tiền" }),
		).toHaveAttribute(
			"href",
			"/van-hanh/ket-tien?from=2026-11-11&to=2026-11-17",
		);
	});

	it("flags each closed shift without a count on Chất lượng dữ liệu", async () => {
		renderCard(
			<MissingCountsThemeCard context={context("2026-11-11", "2026-11-17")} />,
		);
		const card = await settled(OPERATIONS_CARD_IDS.missingCounts);
		await waitFor(() =>
			expect(within(card).getByTestId("sentence")).toHaveTextContent(
				"1 trong 2 ca đã đóng chưa có số đếm trên ứng dụng nhân viên.",
			),
		);
		expect(
			within(card)
				.getAllByRole("row")
				.slice(1)
				.map((row) => within(row).getAllByRole("cell")[1]?.textContent),
		).toEqual(["Ca 2"]);
	});

	it("uses only the last 92 days of a longer range and says so", async () => {
		const operations = createFakeOperations();
		renderCard(
			<MissingCountsThemeCard context={context("2026-01-01", "2026-11-17")} />,
			{ operations },
		);
		const card = await settled(OPERATIONS_CARD_IDS.missingCounts);
		await waitFor(() =>
			expect(card).toHaveTextContent("92 ngày cuối của khoảng đã chọn"),
		);
	});

	it("lists the missed checklists on Chất lượng dữ liệu with the rule and a link to compliance", async () => {
		renderCard(
			<MissingChecklistsThemeCard
				context={context("2026-11-17", "2026-11-17")}
			/>,
			{
				operations: createFakeOperations({
					templates: [
						{
							id: "close",
							storeId: STORE_1,
							phase: "closing",
							title: "Đóng ca",
							active: true,
							version: 1,
							items: [],
							createdAt: "2026-11-01T00:00:00Z",
							audit: null,
						},
					],
				}),
			},
		);
		const card = await settled(OPERATIONS_CARD_IDS.missingChecklists);
		await waitFor(() =>
			expect(within(card).getByTestId("sentence")).toHaveTextContent(
				"1 trong 1 checklist đã đến hạn bị bỏ.",
			),
		);
		expect(
			within(card).getByRole("link", { name: "Xem tuân thủ checklist" }),
		).toHaveAttribute(
			"href",
			"/van-hanh/checklist?from=2026-11-17&to=2026-11-17",
		);
	});
});
