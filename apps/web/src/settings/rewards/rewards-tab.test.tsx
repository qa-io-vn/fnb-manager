import { DEFAULT_LOYALTY_PARAMETERS } from "@fnb/core";
import { DemoSettingsStore } from "@fnb/demo-analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { LoyaltySource } from "../../loyalty/source";
import { createDemoSettingsSource } from "../demo-settings-source";
import type { Membership, SettingsSource } from "../source";
import { createDemoRewardsSource } from "./demo-rewards-source";
import { RewardsTab } from "./rewards-tab";
import {
	type RewardRails,
	type RewardRecord,
	type RewardsSource,
	RewardWriteError,
} from "./source";
import { rewardWriteError } from "./supabase-rewards-source";

const STORE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROGRAMME = "11111111-1111-4111-8111-111111111111";

const TENANT = {
	id: "33333333-3333-4333-8333-333333333333",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: "Asia/Ho_Chi_Minh",
	countryCode: "VN",
};

const current = vi.hoisted(() => ({ state: { status: "loading" } as unknown }));

vi.mock("../../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({
		tenant: TENANT,
		stores: [
			{ id: STORE_A, name: "Cửa hàng A" },
			{ id: STORE_B, name: "Cửa hàng B" },
		],
	}),
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

function reward(overrides: Partial<RewardRecord> = {}): RewardRecord {
	return {
		id: "44444444-4444-4444-8444-444444444444",
		programmeId: PROGRAMME,
		rewardKey: "ly-mien-phi",
		name: "Ly trà miễn phí",
		description: null,
		rewardKind: "free_item",
		rewardPercent: null,
		rewardAmount: null,
		rewardItemExternalIds: ["DR-008-M"],
		excludedItemExternalIds: [],
		costStamps: 8,
		costPoints: 0,
		minBillAmount: 0,
		validFrom: null,
		validUntil: null,
		validDays: 30,
		holdHours: 24,
		perMemberLimit: null,
		storeIds: null,
		status: "draft",
		approval: null,
		createdAt: "2026-11-18T01:00:00Z",
		audit: null,
		...overrides,
	};
}

const RAILS: RewardRails = {
	rails: [
		{
			storeId: STORE_A,
			rail: "pos_payment_discount",
			activeFrom: "2026-11-01T00:00:00Z",
		},
	],
	mappings: [
		{
			storeId: STORE_A,
			rewardKey: "ly-mien-phi",
			posDiscountName: null,
			posFreeItemExternalId: "DR-008-M",
			crmProgrammeExternalId: null,
			einvoiceDisplay: "zero_price_line",
		},
	],
};

function fakeRewards(rows: RewardRecord[]): RewardsSource & {
	readonly setStatus: ReturnType<typeof vi.fn>;
	readonly saveReward: ReturnType<typeof vi.fn>;
} {
	const saved = [...rows];
	return {
		kind: "supabase",
		rewards: async () => [...saved],
		rails: async () => RAILS,
		discountDays: async () => [
			{
				itemExternalId: "DR-008-M",
				itemName: "Trà sữa truyền thống",
				priceDiscountDays: 12,
				giftDays: 0,
				voucherDays: 0,
				limitDays: null,
				overLimit: false,
			},
		],
		saveReward: vi.fn(async (_tenantId, change) => {
			const row = reward({ ...change, id: change.id ?? "new-reward" });
			saved.push(row);
			return row;
		}),
		setStatus: vi.fn(async (_tenantId, change) => {
			if (change.status === "active") {
				throw new RewardWriteError("invalid", "status", "noRail");
			}
			const index = saved.findIndex((row) => row.id === change.id);
			const row: RewardRecord = {
				...(saved[index] as RewardRecord),
				status: change.status,
				approval: { at: "2026-11-19T02:00:00Z", by: { kind: "you" } },
			};
			saved[index] = row;
			return row;
		}),
	};
}

const LOYALTY: LoyaltySource = {
	kind: "supabase",
	programmes: async () => [
		{
			id: PROGRAMME,
			name: "Tích dấu thử",
			startsOn: "2026-12-01",
			endsOn: null,
			rewardBudgetAmount: 0,
			status: "active",
			notificationDecision: "below_threshold",
			notificationDecidedAt: null,
			notificationBasis: null,
			parameters: DEFAULT_LOYALTY_PARAMETERS,
			createdAt: "2026-11-18T00:00:00Z",
			audit: null,
		},
	],
	saveProgramme: vi.fn(),
	staffPhones: async () => [],
	addStaffPhone: vi.fn(),
	removeStaffPhone: vi.fn(),
} as unknown as LoyaltySource;

function renderTab(membership: Membership, rewards: RewardsSource) {
	const source: SettingsSource = {
		...createDemoSettingsSource(new DemoSettingsStore()),
		kind: rewards.kind,
		membership: async () => membership,
	};
	current.state = {
		status: "ready",
		source,
		loyalty: LOYALTY,
		customers: null,
		rewards,
	};
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<MemoryRouter>
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<QueryClientProvider client={client}>
					<RewardsTab />
				</QueryClientProvider>
			</I18nProvider>
		</MemoryRouter>,
	);
}

afterEach(() => {
	current.state = { status: "loading" };
});

describe("the rewards tab", () => {
	it("lets the owner approve a draft and shows the database's refusal to activate next to the actions", async () => {
		const user = userEvent.setup();
		const rewards = fakeRewards([reward()]);
		renderTab({ role: "owner", storeIds: null }, rewards);
		const panel = await screen.findByTestId("reward-status-panel");
		expect(screen.getByTestId("reward-approval")).toHaveTextContent(
			"Chờ chủ quán duyệt.",
		);
		expect(screen.getByTestId("reward-owner-approves")).toHaveTextContent(
			"Bạn là chủ quán quản lý mọi cửa hàng nên duyệt được ưu đãi.",
		);
		await user.click(within(panel).getByRole("button", { name: "Duyệt" }));
		await waitFor(() =>
			expect(screen.getByTestId("reward-status-panel")).toHaveAttribute(
				"data-status",
				"approved",
			),
		);
		expect(rewards.setStatus).toHaveBeenCalledWith(TENANT.id, {
			id: "44444444-4444-4444-8444-444444444444",
			status: "approved",
		});
		expect(screen.getByTestId("reward-approval")).toHaveTextContent(
			"Bạn đã duyệt lúc",
		);
		expect(screen.getByTestId("reward-activation-blocked")).toHaveTextContent(
			"Chưa kích hoạt được: Cửa hàng B chưa sẵn sàng.",
		);
		await user.click(screen.getByRole("button", { name: "Kích hoạt" }));
		expect(
			await screen.findByTestId("reward-status-refusal"),
		).toHaveTextContent(
			"Chưa kích hoạt được: có cửa hàng áp dụng chưa có kênh ưu đãi đang dùng.",
		);
		expect(screen.getByTestId("reward-discount-days")).toHaveTextContent(
			"Trà sữa truyền thống",
		);
	});

	it("never offers a manager the approval and says only the owner approves", async () => {
		renderTab({ role: "manager", storeIds: null }, fakeRewards([reward()]));
		const panel = await screen.findByTestId("reward-status-panel");
		expect(within(panel).queryByRole("button", { name: "Duyệt" })).toBeNull();
		expect(
			within(panel).getByRole("button", { name: "Ngừng hẳn" }),
		).toBeVisible();
		expect(screen.getByTestId("reward-owner-approves")).toHaveTextContent(
			"Chỉ chủ quán quản lý mọi cửa hàng mới duyệt được ưu đãi.",
		);
		expect(screen.getByTestId("reward-create")).toBeVisible();
	});

	it("keeps a viewer read only, with the reason", async () => {
		renderTab({ role: "viewer", storeIds: null }, fakeRewards([reward()]));
		expect(await screen.findByTestId("settings-read-only")).toHaveTextContent(
			"Bạn chỉ xem được danh mục ưu đãi.",
		);
		await screen.findByTestId("reward-form");
		expect(screen.queryByTestId("reward-actions")).toBeNull();
		expect(screen.queryByTestId("reward-create")).toBeNull();
		expect(screen.queryByTestId("settings-save-bar")).toBeNull();
	});

	it("shows the demo's sample catalogue read only", async () => {
		renderTab({ role: "owner", storeIds: null }, createDemoRewardsSource());
		expect(await screen.findByTestId("rewards-demo")).toHaveTextContent(
			"Bản demo cho xem một danh mục ưu đãi mẫu, chỉ để đọc.",
		);
		expect(screen.getAllByTestId("reward-row")).toHaveLength(3);
		expect(screen.queryByTestId("reward-actions")).toBeNull();
		expect(screen.queryByTestId("settings-save-bar")).toBeNull();
		expect(screen.getByTestId("reward-days-demo")).toBeVisible();
	});
});

describe("the database refusals of a reward write", () => {
	it("land on the field or the status they are about", () => {
		const cases = [
			[
				"22023",
				"a price-reducing reward gives at most 50 % off the price it reduces (FR-CMP-12)",
				"rewardPercent",
				"cap",
			],
			[
				"22023",
				"an amount-off reward gives at most 50 % of its minimum bill (FR-CMP-12)",
				"rewardAmount",
				"amountCap",
			],
			[
				"22023",
				"an amount-off reward names the minimum bill it reduces, so the discount cap can be checked (FR-CMP-12)",
				"minBillAmount",
				"minBillRequired",
			],
			[
				"42501",
				"only an owner with every store approves a reward",
				"status",
				"ownerApproves",
			],
			[
				"22023",
				"a reward is active only when every store in its scope has a coupon rail (coupon_rails)",
				"status",
				"noRail",
			],
			[
				"22023",
				"a reward is active only when every store in its scope maps it to a POS discount or 0-price line with an e-invoice display (coupon_rail_rewards)",
				"status",
				"noMapping",
			],
			[
				"22023",
				"a retired reward stays retired: create a new one",
				"status",
				"retiredFinal",
			],
			[
				"23505",
				'duplicate key value violates unique constraint "coupons_programme_id_reward_key_key"',
				"rewardKey",
				"duplicateKey",
			],
		] as const;
		for (const [code, message, field, refusal] of cases) {
			const error = rewardWriteError({ code, message });
			expect(error, message).toBeInstanceOf(RewardWriteError);
			expect(
				[error.constraint, (error as RewardWriteError).refusal],
				message,
			).toEqual([field, refusal]);
		}
		expect(rewardWriteError({ code: "42501", message: "rls" }).code).toBe(
			"forbidden",
		);
	});
});
