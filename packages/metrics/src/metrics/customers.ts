import type { MetricDefinition } from "../vocabulary.js";

export const customerMetrics = [
	{
		id: "customer_capture_rate",
		group: "customers",
		label: {
			vi: "Tỷ lệ hóa đơn định danh khách",
			en: "Customer capture rate",
		},
		unit: "fraction",
		formula:
			"non-voided invoices with a `customer_phone` or a `customer_id` ÷ `invoices`; an invoice identified by id alone (Zalo identity, phases 16–19) counts",
		grains: ["store-day", "store-period"],
		direction: "higher",
		source:
			"`agg_daily_sales.identified_invoices` ÷ `invoices`, `period_summary().identified_share`",
		reports: ["data_quality", "customers"],
		status: "available now",
	},
	{
		id: "repeat_rate",
		group: "customers",
		label: {
			vi: "Tỷ lệ khách quay lại",
			en: "Repeat rate",
		},
		unit: "fraction",
		formula:
			"customers with ≥ 2 visits in the window ÷ customers with ≥ 1 visit",
		grains: ["store-period"],
		direction: "higher",
		source: "`invoices.customer_id` (fact table)",
		reports: ["customers"],
		status: "needs customer identity",
	},
	{
		id: "visit_frequency_30d",
		group: "customers",
		label: {
			vi: "Tần suất ghé 30 ngày",
			en: "Visit frequency, 30 days",
		},
		unit: "visits / customer",
		formula: "visits ÷ active customers over the trailing 30 days",
		grains: ["store-period"],
		direction: "higher",
		source: "`invoices.customer_id`",
		reports: ["customers"],
		status: "needs customer identity",
	},
	{
		id: "visit_frequency_90d",
		group: "customers",
		label: {
			vi: "Tần suất ghé 90 ngày",
			en: "Visit frequency, 90 days",
		},
		unit: "visits / customer",
		formula: "visits ÷ active customers over the trailing 90 days",
		grains: ["store-period"],
		direction: "higher",
		source: "`invoices.customer_id`",
		reports: ["customers"],
		status: "needs customer identity",
	},
	{
		id: "cohort_retention",
		group: "customers",
		label: {
			vi: "Giữ chân theo nhóm tháng",
			en: "Cohort retention",
		},
		unit: "fraction",
		formula:
			"customers first seen in month c who bought in month c + k ÷ size of cohort c",
		grains: ["cohort-month"],
		direction: "higher",
		source: "`customers.first_seen_at`, `invoices.customer_id`",
		reports: ["customers"],
		status: "needs customer identity",
	},
	{
		id: "rfm_quintiles",
		group: "customers",
		label: {
			vi: "Phân khúc RFM",
			en: "RFM quintiles",
		},
		unit: "scores 1–5",
		formula:
			"quintile rank of recency (reversed), frequency and monetary value over the trailing 365 days; 125 cells grouped into about 8 segments",
		grains: ["customer"],
		direction: "neutral",
		source: "`invoices.customer_id`",
		reports: ["customers"],
		status: "needs customer identity",
	},
	{
		id: "customer_ltv",
		group: "customers",
		label: {
			vi: "Giá trị vòng đời khách hàng",
			en: "Customer lifetime value",
		},
		unit: "VND",
		formula:
			"`avg_ticket` × visits per year × gross margin × expected lifespan in years",
		grains: ["customer", "segment"],
		direction: "higher",
		source: "`invoices`, `item_costs`",
		reports: ["customers"],
		status: "needs customer identity and costs",
	},
	{
		id: "loyalty_liability",
		group: "customers",
		label: {
			vi: "Nợ điểm thưởng",
			en: "Loyalty points liability",
		},
		unit: "VND",
		formula:
			"outstanding points × value per point × (1 − expected breakage; 20 % until six months of expiry data exist)",
		grains: ["tenant-month"],
		direction: "lower",
		source: "loyalty ledger (phase 17)",
		reports: ["customers"],
		reportNotes: {
			customers: "loyalty P&L",
		},
		status: "needs customer identity",
	},
	{
		id: "breakage_rate",
		group: "customers",
		label: {
			vi: "Tỷ lệ điểm hết hạn không dùng",
			en: "Breakage rate",
		},
		unit: "fraction",
		formula: "1 − points redeemed ÷ points issued, by issue cohort at expiry",
		grains: ["tenant-month"],
		direction: "neutral",
		source: "loyalty ledger (phase 17)",
		reports: ["customers"],
		reportNotes: {
			customers: "loyalty P&L",
		},
		status: "needs customer identity",
	},
	{
		id: "reward_cost_rate",
		group: "customers",
		label: {
			vi: "Tỷ lệ chi phí thưởng",
			en: "Reward cost rate",
		},
		unit: "fraction",
		formula: "value of rewards redeemed ÷ net revenue of member invoices",
		grains: ["tenant-month"],
		direction: "lower",
		source: "loyalty ledger (phase 17)",
		reports: ["customers"],
		reportNotes: {
			customers: "loyalty P&L",
		},
		status: "needs customer identity",
	},
	{
		id: "member_frequency_uplift",
		group: "customers",
		label: {
			vi: "Mức tăng tần suất của thành viên",
			en: "Member frequency uplift",
		},
		unit: "fraction",
		formula:
			"member visit frequency ÷ matched non-member frequency − 1, on matched cohorts or a hold-out",
		grains: ["tenant-period"],
		direction: "higher",
		source: "loyalty ledger (phase 17), `invoices.customer_id`",
		reports: ["customers"],
		reportNotes: {
			customers: "loyalty P&L",
		},
		status: "needs customer identity",
	},
] as const satisfies readonly MetricDefinition[];
