import { SettingsWriteError } from "../source";
import type {
	DiscountDaysRow,
	RewardRails,
	RewardRecord,
	RewardsSource,
} from "./source";

export const DEMO_REWARD_PROGRAMME_ID = "demo-loyalty-programme";

const BASE = {
	programmeId: DEMO_REWARD_PROGRAMME_ID,
	description: null,
	rewardPercent: null,
	rewardAmount: null,
	rewardItemExternalIds: null,
	excludedItemExternalIds: [],
	costStamps: 0,
	costPoints: 0,
	minBillAmount: 0,
	validFrom: null,
	validUntil: null,
	validDays: 30,
	holdHours: 24,
	perMemberLimit: null,
	storeIds: null,
	createdAt: "2026-11-01T02:00:00.000Z",
	audit: null,
} as const;

export const DEMO_REWARDS: readonly RewardRecord[] = [
	{
		...BASE,
		id: "demo-reward-free-drink",
		rewardKey: "ly-tra-sua",
		name: "Tặng 1 ly trà sữa truyền thống",
		description: "Đổi 8 dấu lấy một ly trà sữa truyền thống size M.",
		rewardKind: "free_item",
		rewardItemExternalIds: ["DR-008-M"],
		costStamps: 8,
		validFrom: "2026-12-01",
		validUntil: "2027-11-30",
		perMemberLimit: 2,
		storeIds: ["MOCK-S1"],
		status: "active",
		approval: { at: "2026-11-02T03:00:00.000Z", by: { kind: "owner" } },
	},
	{
		...BASE,
		id: "demo-reward-bill-percent",
		rewardKey: "giam-20-hoa-don",
		name: "Giảm 20% hóa đơn",
		rewardKind: "percent_off",
		rewardPercent: 20,
		excludedItemExternalIds: ["SN-001"],
		costPoints: 300,
		minBillAmount: 50_000,
		status: "approved",
		approval: { at: "2026-11-03T03:00:00.000Z", by: { kind: "owner" } },
	},
	{
		...BASE,
		id: "demo-reward-upgrade",
		rewardKey: "len-size-l",
		name: "Lên size L miễn phí",
		rewardKind: "free_upgrade",
		costStamps: 3,
		status: "draft",
		approval: null,
	},
];

export const DEMO_REWARD_RAILS: RewardRails = {
	rails: [
		{
			storeId: "MOCK-S1",
			rail: "pos_payment_discount",
			activeFrom: "2026-11-01T02:00:00.000Z",
		},
	],
	mappings: [
		{
			storeId: "MOCK-S1",
			rewardKey: "ly-tra-sua",
			posDiscountName: null,
			posFreeItemExternalId: "DR-008-M",
			crmProgrammeExternalId: null,
			einvoiceDisplay: "zero_price_line",
		},
		{
			storeId: "MOCK-S1",
			rewardKey: "giam-20-hoa-don",
			posDiscountName: "Ưu đãi thành viên 20%",
			posFreeItemExternalId: null,
			crmProgrammeExternalId: null,
			einvoiceDisplay: "discount",
		},
	],
};

function refused(): Promise<never> {
	return Promise.reject(new SettingsWriteError("forbidden"));
}

export function createDemoRewardsSource(): RewardsSource {
	return {
		kind: "demo",
		async rewards() {
			return [...DEMO_REWARDS];
		},
		async rails() {
			return DEMO_REWARD_RAILS;
		},
		async discountDays(): Promise<DiscountDaysRow[]> {
			return [];
		},
		saveReward: refused,
		setStatus: refused,
	};
}
