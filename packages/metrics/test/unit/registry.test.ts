import { describe, expect, it } from "vitest";
import {
	findMetric,
	hasStorePeriodValue,
	isAvailableNow,
	isComputedByMetricValue,
	isMetricId,
	metricById,
	metrics,
	metricsForReport,
	metricsInGroup,
	metricValueIds,
	type ReportId,
	reportNames,
} from "../../src/index.js";

describe("metric lookup", () => {
	it("finds a metric by its typed id", () => {
		const metric = metricById("avg_ticket");
		expect(metric.label).toEqual({
			vi: "Giá trị trung bình mỗi hóa đơn",
			en: "Average ticket",
		});
		expect(metric.unit).toBe("VND");
	});

	it("finds a metric from an untyped id and returns nothing for an unknown one", () => {
		expect(findMetric("discount_rate")?.direction).toBe("lower");
		expect(findMetric("ctx_fnb_revenue_2024")).toBeUndefined();
		expect(findMetric("Net revenue")).toBeUndefined();
	});

	it("tells a metric id from any other string", () => {
		expect(isMetricId("same_weekday_baseline")).toBe(true);
		expect(isMetricId("same_weekday")).toBe(false);
	});

	it("throws for an id that is not in the registry", () => {
		expect(() => metricById("no_such_metric" as "net_revenue")).toThrow(
			"unknown metric no_such_metric",
		);
	});
});

describe("metrics for a report", () => {
	it("lists the metrics mapped to a report in registry order", () => {
		expect(metricsForReport("hours").map((metric) => metric.id)).toEqual([
			"sales_per_opening_hour",
			"invoices_per_opening_hour",
			"revpash",
			"peak_share_20_21",
			"dead_hour_share_17_18",
		]);
	});

	it("puts a metric used by every periodic report on each of them", () => {
		for (const report of ["day", "week", "month", "year"] as const) {
			expect(metricsForReport(report).map((metric) => metric.id)).toContain(
				"invoices",
			);
		}
	});

	it("counts the promotion lift note as the promotions report", () => {
		const baseline = metricById("same_weekday_baseline");
		expect(metricsForReport("promotions")).toContain(baseline);
		expect(baseline.reportNotes.promotions).toBe("lift");
	});

	it("maps every metric to a known report and gives every report a metric", () => {
		const reports = Object.keys(reportNames) as ReportId[];
		for (const report of reports) {
			expect(metricsForReport(report).length, report).toBeGreaterThan(0);
		}
		expect(
			reports.reduce(
				(total, report) => total + metricsForReport(report).length,
				0,
			),
		).toBe(metrics.reduce((total, metric) => total + metric.reports.length, 0));
	});

	it("groups metrics by the section of docs/metrics.md", () => {
		expect(metricsInGroup("menu").map((metric) => metric.id)).toEqual([
			"item_velocity",
			"menu_class",
		]);
	});
});

describe("availability", () => {
	it("is available now only with the status available now", () => {
		expect(isAvailableNow("net_revenue")).toBe(true);
		expect(isAvailableNow(metricById("sales_per_opening_hour"))).toBe(true);
		expect(isAvailableNow("revpash")).toBe(false);
		expect(isAvailableNow("menu_class")).toBe(false);
		expect(isAvailableNow("customer_ltv")).toBe(false);
	});

	it("has a store-period value for store-day and store-period metrics outside baselines and forecasts", () => {
		expect(hasStorePeriodValue("net_revenue")).toBe(true);
		expect(hasStorePeriodValue("customer_capture_rate")).toBe(true);
		expect(hasStorePeriodValue("removed_line_rate")).toBe(true);
		expect(hasStorePeriodValue("same_weekday_baseline")).toBe(false);
		expect(hasStorePeriodValue("forecast_mae")).toBe(false);
		expect(hasStorePeriodValue("weekday_share")).toBe(false);
		expect(hasStorePeriodValue("cash_variance")).toBe(false);
		expect(hasStorePeriodValue("item_velocity")).toBe(false);
	});

	it("leaves metrics that wait for an input out of metric_value", () => {
		expect(hasStorePeriodValue("revpash")).toBe(true);
		expect(isComputedByMetricValue("revpash")).toBe(false);
		expect(isComputedByMetricValue("repeat_rate")).toBe(false);
	});

	it("lists the metric_value ids in registry order", () => {
		expect(metricValueIds()).toEqual([
			"net_revenue",
			"gross_revenue",
			"invoices",
			"avg_ticket",
			"items_per_ticket",
			"avg_item_price",
			"cash_share",
			"voucher_invoice_share",
			"member_invoice_share",
			"discount_rate",
			"attach_rate_topping",
			"attach_rate_snack",
			"size_l_share",
			"sales_per_opening_hour",
			"invoices_per_opening_hour",
			"peak_share_20_21",
			"dead_hour_share_17_18",
			"void_rate",
			"edit_rate",
			"removed_line_rate",
			"customer_capture_rate",
		]);
	});
});
