import type { MetricDefinition } from "../vocabulary.js";

export const cashMetrics = [
	{
		id: "cash_variance",
		group: "cash",
		label: {
			vi: "Chênh lệch tiền mặt",
			en: "Cash variance",
		},
		unit: "VND",
		formula:
			"counted drawer − expected cash (opening float + cash tenders of the shift). Payouts are not synced from the POS, so the standard term − payouts is missing: a shift with a cash payout shows the payout as a shortage until payouts are modelled",
		grains: ["shift"],
		direction: "lower",
		directionOnAbsoluteValue: true,
		source: "`agg_shift_cash.variance_amount`",
		reports: ["shifts", "day", "month", "payments"],
		status: "available now",
	},
	{
		id: "cash_variance_zscore",
		group: "cash",
		label: {
			vi: "Điểm z chênh lệch tiền mặt",
			en: "Cash variance z-score",
		},
		unit: "z",
		formula:
			"(variance − mean variance of the store's shifts in the trailing 56 days) ÷ their sample standard deviation; needs 3 shifts and a non-zero spread; flagged over 2, together with the tenant's absolute and relative thresholds from `report_settings` (by default 50,000 VND and 0.5 % of cash sales)",
		grains: ["shift"],
		direction: "lower",
		directionOnAbsoluteValue: true,
		source: "`cash_variance_flags()`",
		reports: ["shifts", "day", "month", "alerts"],
		status: "available now",
	},
	{
		id: "void_rate",
		group: "cash",
		label: {
			vi: "Tỷ lệ hủy hóa đơn",
			en: "Void rate",
		},
		unit: "fraction",
		formula:
			"voided invoices ÷ (non-voided + voided invoices); the VND figure beside it is Σ `net_amount` of the voided invoices (`voided_amount`)",
		grains: ["store-day"],
		direction: "lower",
		source:
			"`agg_daily_sales.voided_invoices`, `agg_daily_sales.voided_amount`",
		reports: ["shifts", "data_quality"],
		status: "available now",
		statusNote:
			"the cashier-period variant and the z-score ranking within a store (ADR-026) are computed by the reports layer from `invoices` and `invoice_events`, no aggregate holds a cashier",
	},
	{
		id: "edit_rate",
		group: "cash",
		label: {
			vi: "Tỷ lệ sửa hóa đơn",
			en: "Edit rate",
		},
		unit: "fraction",
		formula: "invoices with status `edited` ÷ non-voided invoices",
		grains: ["store-day"],
		direction: "lower",
		source: "`agg_daily_sales.edited_invoices`",
		reports: ["shifts"],
		status: "available now",
		statusNote: "cashier-period variant and z-score ranking as for `void_rate`",
	},
	{
		id: "removed_line_rate",
		group: "cash",
		label: {
			vi: "Tỷ lệ dòng bị xóa",
			en: "Removed-line rate",
		},
		unit: "fraction",
		formula:
			"`invoice_events` of kind `line_removed` ÷ item lines of the period",
		grains: ["store-day", "cashier-period"],
		direction: "lower",
		source: "`invoice_events` (fact table; no aggregate yet)",
		reports: ["shifts"],
		status: "available now",
		statusNote:
			"populated once the adjustment sync of phase 7 runs; computed by the reports layer",
	},
] as const satisfies readonly MetricDefinition[];
