import type { MetricDefinition } from "../vocabulary.js";

export const promotionMetrics = [
	{
		id: "promo_lift",
		group: "promotions",
		label: {
			vi: "Doanh thu gộp tăng thêm nhờ khuyến mãi",
			en: "Promotion gross lift",
		},
		unit: "VND",
		formula:
			"difference-in-differences of gross revenue on the promotion days against the chosen comparator",
		grains: ["store-period"],
		direction: "higher",
		source: "`promotion_lift()` (`gross_lift`)",
		reports: ["promotions"],
		status: "available now",
		statusNote: "the function comes with phase 10b",
	},
	{
		id: "promo_net_lift",
		group: "promotions",
		label: {
			vi: "Lãi ròng từ khuyến mãi",
			en: "Promotion net lift",
		},
		unit: "VND",
		formula: "gross lift − discount cost of the promotion days",
		grains: ["store-period"],
		direction: "higher",
		source: "`promotion_lift()` (`net_lift`)",
		reports: ["promotions"],
		status: "available now",
		statusNote: "the function comes with phase 10b",
	},
	{
		id: "discount_days",
		group: "promotions",
		label: {
			vi: "Số ngày giảm giá bán trong năm",
			en: "Discount days in the year",
		},
		unit: "count",
		formula:
			"days from 1 January to the as-of date on which the item sold below its list price or under a bill discount (gift and voucher days left out)",
		grains: ["item-period"],
		direction: "neutral",
		source: "`item_discount_days()` (`price_discount_days`)",
		reports: ["promotions"],
		status: "available now",
		statusNote: "the function comes with phase 10b",
	},
] as const satisfies readonly MetricDefinition[];
