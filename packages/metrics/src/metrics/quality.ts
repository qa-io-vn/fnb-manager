import type { MetricDefinition } from "../vocabulary.js";

export const qualityMetrics = [
	{
		id: "modifier_line_share",
		group: "quality",
		label: {
			vi: "Tỷ trọng dòng tùy chọn",
			en: "Modifier line share",
		},
		unit: "fraction",
		formula:
			"modifier lines ÷ (item lines + modifier lines) of non-voided invoices",
		grains: ["store-period"],
		direction: "neutral",
		source: "`data_quality_summary()`",
		reports: ["data_quality"],
		status: "available now",
		statusNote: "the function comes with phase 10b",
	},
	{
		id: "consent_coverage",
		group: "quality",
		label: {
			vi: "Tỷ lệ khách định danh có đồng ý tích điểm",
			en: "Consent coverage of identified customers",
		},
		unit: "fraction",
		formula:
			"identified customers with a loyalty consent ÷ identified customers",
		grains: ["store-period"],
		direction: "higher",
		source: "`data_quality_summary()`",
		reports: ["data_quality"],
		status: "needs customer identity",
		statusNote: "the function comes with phase 10b",
	},
] as const satisfies readonly MetricDefinition[];
