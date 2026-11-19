import type { LoyaltyParameters } from "@fnb/core";
import type { ProgrammeField } from "./source";

export const PARAMETER_COLUMNS = {
	stampsPerCard: "stamps_per_card",
	stampMinBillAmount: "stamp_min_bill_amount",
	welcomeStamps: "welcome_stamps",
	pointUnitAmount: "point_unit_amount",
	pointsPerUnit: "points_per_unit",
	stampValidityMonths: "stamp_validity_months",
	pointsExpiryMonths: "points_expiry_months",
	earningInvoicesPerPhonePerDay: "earning_invoices_per_phone_per_day",
	checkinWindowBeforeMinutes: "checkin_window_before_minutes",
	checkinWindowAfterMinutes: "checkin_window_after_minutes",
	checkinCodeTtlSeconds: "checkin_code_ttl_seconds",
	checkinPendingHours: "checkin_pending_hours",
	receiptClaimWindowHours: "receipt_claim_window_hours",
	receiptClaimsPerPhonePerDay: "receipt_claims_per_phone_per_day",
	excludedOrderSources: "excluded_order_sources",
	pointValueAmount: "point_value_amount",
	expectedBreakageRate: "expected_breakage_rate",
} as const satisfies Record<keyof LoyaltyParameters, string>;

const FIELD_OF_COLUMN: Readonly<Record<string, ProgrammeField>> = {
	...Object.fromEntries(
		Object.entries(PARAMETER_COLUMNS).map(([field, column]) => [
			column,
			field as ProgrammeField,
		]),
	),
	reward_budget_amount: "rewardBudgetAmount",
	notification_basis: "notificationBasis",
};

export interface ProgrammeRefusal {
	readonly field: ProgrammeField | null;
	readonly hold: boolean;
}

const PHRASES: readonly (readonly [RegExp, ProgrammeField, boolean])[] = [
	[
		/cannot become active while its notification decision is pending/,
		"status",
		true,
	],
	[/notification decision needs its legal basis/, "notificationBasis", false],
	[/programme name holds/, "name", false],
	[/ends on or after the day it starts/, "endsOn", false],
	[/excluded order source/, "excludedOrderSources", false],
];

export function refusedProgrammeField(
	message: string | undefined,
): ProgrammeRefusal {
	const text = message ?? "";
	for (const [pattern, field, hold] of PHRASES) {
		if (pattern.test(text)) return { field, hold };
	}
	const column = /^([a-z_]+) (?:is|holds)\b/.exec(text)?.[1];
	const field =
		column !== undefined && Object.hasOwn(FIELD_OF_COLUMN, column)
			? (FIELD_OF_COLUMN[column] ?? null)
			: null;
	return { field, hold: false };
}
