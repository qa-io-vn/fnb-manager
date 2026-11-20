import { DEFAULT_LOYALTY_PARAMETERS } from "@fnb/core";
import { demoStoreIds } from "@fnb/demo-analytics";
import type { IsoDate } from "@fnb/reports";
import { addDays } from "../lib/business-dates";
import { SettingsWriteError } from "../settings/source";
import type {
	BillAnomalyRow,
	LoyaltyProgrammeRecord,
	LoyaltySource,
	LoyaltyStoreKnobs,
	LoyaltyStoreSettings,
	StaffPhoneRow,
} from "./source";

export const DEMO_PROGRAMME: LoyaltyProgrammeRecord = {
	id: "demo-loyalty-programme",
	name: "Tích dấu 8 ly",
	startsOn: "2026-12-01",
	endsOn: "2027-11-30",
	rewardBudgetAmount: 20_000_000,
	status: "draft",
	notificationDecision: "pending",
	notificationDecidedAt: null,
	notificationBasis: null,
	parameters: DEFAULT_LOYALTY_PARAMETERS,
	createdAt: "2026-11-01T02:00:00.000Z",
	audit: null,
};

export const DEMO_STAFF_PHONES: readonly StaffPhoneRow[] = [
	{
		id: "demo-staff-phone-1",
		phone: "0900000101",
		label: "Thu ngân ca sáng",
		createdAt: "2026-11-01T02:00:00.000Z",
	},
	{
		id: "demo-staff-phone-2",
		phone: "0900000102",
		label: null,
		createdAt: "2026-11-01T02:05:00.000Z",
	},
];

/** The database defaults of loyalty_store_settings (migration 20261120500000). */
export const DEFAULT_STORE_KNOBS: LoyaltyStoreKnobs = {
	confirmation: "pos_sync",
	maxBillAmount: 2_000_000,
	billEvidenceRequiredLevel: 2,
	billManagerApprovalAbove: 1_000_000,
	billAmountTolerance: 1_000,
	billUnconfirmedHours: 24,
	billSilenceOutcome: "reverse",
	billStaffShiftCap: 25,
	staffAmountPerDay: 30_000_000,
	storeEarnsPerDay: 400,
	staffRedemptionsPerDay: 50,
	reverseWindowMinutes: 480,
	billAuditSamplePct: 2,
	selfClaim: false,
	counterCodeTtlSeconds: 90,
	autoApproveMaxAmount: 0,
	autoApprovePerDay: 0,
	billPhotoRetentionDays: 90,
	billReaderMode: "off",
	shadowReconcile: true,
};

const DEMO_SETTINGS_AT = "2026-11-20T02:00:00.000Z";

/** The demo store that records paper bills; every other demo store waits for the POS. */
export const DEMO_STAFF_MODE_STORE: string = demoStoreIds()[0] ?? "MOCK-S1";

export function demoStoreSettings(storeId: string): LoyaltyStoreSettings {
	const staff = storeId === DEMO_STAFF_MODE_STORE;
	return {
		...DEFAULT_STORE_KNOBS,
		...(staff
			? {
					confirmation: "staff" as const,
					maxBillAmount: 1_500_000,
					billStaffShiftCap: 30,
					selfClaim: true,
				}
			: {}),
		storeId,
		updatedAt: DEMO_SETTINGS_AT,
	};
}

interface DemoStaffDay {
	readonly staffUserId: string | null;
	readonly staffName: string | null;
	readonly counts: Omit<
		BillAnomalyRow,
		"storeId" | "businessDate" | "staffUserId" | "staffName"
	>;
}

function counts(
	overrides: Partial<DemoStaffDay["counts"]>,
): DemoStaffDay["counts"] {
	return {
		bills: 12,
		billsTotal: 1_080_000,
		level0: 0,
		level2: 11,
		confirmed: 11,
		queued: 1,
		disagreements: 0,
		disputes: 0,
		timedOut: 0,
		reversals: 0,
		auditsFailed: 0,
		redemptionsConfirmed: 2,
		topMemberShare: 0.167,
		amountOutliers: 0,
		maxBillsInHour: 3,
		peerMedianBills: 10,
		flags: [],
		...overrides,
	};
}

/** Sample staff days, newest first: one quiet day, one with every kind of signal. */
const DEMO_STAFF_DAYS: readonly (readonly DemoStaffDay[])[] = [
	[
		{
			staffUserId: "demo-staff-lan",
			staffName: "Lan (ca sáng)",
			counts: counts({}),
		},
		{
			staffUserId: "demo-staff-minh",
			staffName: "Minh (ca tối)",
			counts: counts({
				bills: 26,
				billsTotal: 2_960_000,
				level0: 3,
				level2: 19,
				confirmed: 20,
				queued: 2,
				disagreements: 3,
				disputes: 1,
				timedOut: 1,
				reversals: 2,
				auditsFailed: 1,
				redemptionsConfirmed: 6,
				topMemberShare: 0.5,
				amountOutliers: 1,
				maxBillsInHour: 9,
				peerMedianBills: 11,
				flags: [
					"peer_outlier",
					"disagreements",
					"disputes",
					"one_member",
					"amount_outliers",
					"audit_failed",
					"burst",
				],
			}),
		},
		{
			staffUserId: null,
			staffName: null,
			counts: counts({
				bills: 4,
				billsTotal: 220_000,
				level0: 4,
				level2: 0,
				confirmed: 4,
				queued: 0,
				redemptionsConfirmed: 0,
				topMemberShare: 0.25,
				maxBillsInHour: 1,
				peerMedianBills: null,
			}),
		},
	],
	[
		{
			staffUserId: "demo-staff-lan",
			staffName: "Lan (ca sáng)",
			counts: counts({ bills: 9, level2: 9, confirmed: 9, queued: 0 }),
		},
		{
			staffUserId: "demo-staff-minh",
			staffName: "Minh (ca tối)",
			counts: counts({
				bills: 11,
				level2: 8,
				confirmed: 8,
				queued: 0,
				timedOut: 3,
				reversals: 3,
				flags: ["timeouts"],
			}),
		},
	],
];

export function demoBillAnomalies(
	storeIds: readonly string[],
	from: IsoDate,
	to: IsoDate,
): BillAnomalyRow[] {
	if (!storeIds.includes(DEMO_STAFF_MODE_STORE) || from > to) return [];
	return DEMO_STAFF_DAYS.flatMap((day, index) => {
		const businessDate = addDays(to, -index);
		if (businessDate < from) return [];
		return day.map(
			(staff): BillAnomalyRow => ({
				storeId: DEMO_STAFF_MODE_STORE,
				businessDate,
				staffUserId: staff.staffUserId,
				staffName: staff.staffName,
				...staff.counts,
			}),
		);
	});
}

function refused(): Promise<never> {
	return Promise.reject(new SettingsWriteError("forbidden"));
}

export function createDemoLoyaltySource(): LoyaltySource {
	return {
		kind: "demo",
		async programmes() {
			return [DEMO_PROGRAMME];
		},
		saveProgramme: refused,
		async staffPhones() {
			return [...DEMO_STAFF_PHONES];
		},
		addStaffPhone: refused,
		removeStaffPhone: refused,
		async storeSettings(_tenantId, storeIds) {
			return [...new Set(storeIds)].map(demoStoreSettings);
		},
		saveStoreSettings: refused,
		async billAnomalies(storeIds, from, to) {
			return demoBillAnomalies(storeIds, from, to);
		},
	};
}
