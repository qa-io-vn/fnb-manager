import { DEFAULT_LOYALTY_PARAMETERS } from "@fnb/core";
import { SettingsWriteError } from "../settings/source";
import type {
	LoyaltyProgrammeRecord,
	LoyaltySource,
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
	};
}
