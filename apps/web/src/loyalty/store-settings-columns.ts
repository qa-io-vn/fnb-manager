import type { LoyaltyStoreKnob } from "./source";

/** The loyalty_store_settings column of each knob; set_loyalty_store_settings takes the same names. */
export const STORE_SETTING_COLUMNS: Readonly<Record<LoyaltyStoreKnob, string>> =
	{
		confirmation: "confirmation",
		maxBillAmount: "max_bill_amount",
		billEvidenceRequiredLevel: "bill_evidence_required_level",
		billManagerApprovalAbove: "bill_manager_approval_above",
		billAmountTolerance: "bill_amount_tolerance",
		billUnconfirmedHours: "bill_unconfirmed_hours",
		billSilenceOutcome: "bill_silence_outcome",
		billStaffShiftCap: "bill_staff_shift_cap",
		staffAmountPerDay: "staff_amount_per_day",
		storeEarnsPerDay: "store_earns_per_day",
		staffRedemptionsPerDay: "staff_redemptions_per_day",
		reverseWindowMinutes: "reverse_window_minutes",
		billAuditSamplePct: "bill_audit_sample_pct",
		selfClaim: "self_claim",
		counterCodeTtlSeconds: "counter_code_ttl_seconds",
		autoApproveMaxAmount: "auto_approve_max_amount",
		autoApprovePerDay: "auto_approve_per_day",
		billPhotoRetentionDays: "bill_photo_retention_days",
		billReaderMode: "bill_reader_mode",
		shadowReconcile: "shadow_reconcile",
	};

/** The JSON object set_loyalty_store_settings takes: only the knobs given, by column name. */
export function storeSettingsPayload(
	change: Partial<Record<LoyaltyStoreKnob, unknown>>,
): Record<string, unknown> {
	const payload: Record<string, unknown> = {};
	for (const knob of Object.keys(STORE_SETTING_COLUMNS) as LoyaltyStoreKnob[]) {
		const value = change[knob];
		if (value !== undefined) payload[STORE_SETTING_COLUMNS[knob]] = value;
	}
	return payload;
}
