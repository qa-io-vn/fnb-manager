import {
	type CardModel,
	type ChartModel,
	type Comparison,
	decomposeNet,
	decomposeTicket,
	decomposition,
	type TableModel,
	type TypedValue,
} from "@fnb/reports";
import { describe, expect, it } from "vitest";
import { type MessageKey, type MessageParams, translate } from "../i18n";
import { vndFormatters } from "../test/render";
import {
	chartOf,
	chipOf,
	decompositionOf,
	headlineKindOf,
	tableOf,
	toReportCardProps,
} from "./card-adapter";
import { formatPart, formatTypedValue } from "./typed-values";

const formatters = vndFormatters();
const t = (key: MessageKey, params?: MessageParams) =>
	translate("vi", key, params);
const tEn = (key: MessageKey, params?: MessageParams) =>
	translate("en", key, params);

function format(value: TypedValue): string {
	return formatTypedValue(value, t, formatters).replace(/ /g, " ");
}

function comparison(overrides: Partial<Comparison> = {}): Comparison {
	return {
		kind: "previous",
		label: { key: "report.compare.previous.day", values: {} },
		range: { from: "2026-11-02", to: "2026-11-02" },
		current: 0.25,
		reference: 0.2,
		change: 0.25,
		difference: 0.05,
		basis: "all_stores",
		coveredStores: 2,
		totalStores: 2,
		sampleDays: null,
		unavailable: null,
		...overrides,
	};
}

function card(overrides: Partial<CardModel> = {}): CardModel {
	return {
		id: "net_revenue",
		titleKey: "report.day.net.title",
		subtitle: null,
		metricId: "net_revenue",
		relatedMetricIds: ["invoices"],
		headline: { value: 12_500_000, unit: "money", caption: null },
		comparisons: [comparison({ change: 0.1, difference: 1_000_000 })],
		decomposition: {
			metric: "net_revenue",
			against: "previous",
			basis: "all_stores",
			total: 1_000,
			parts: [
				{ factor: "invoices", from: 10, to: 11, effect: 600 },
				{ factor: "items_per_ticket", from: 1.5, to: 1.4, effect: -200 },
				{ factor: "avg_item_price", from: 30, to: 32, effect: 600 },
			],
		},
		narrative: [
			{
				key: "report.day.net.up",
				values: {
					day: { kind: "date", value: "2026-11-03" },
					delta: { kind: "percent", value: 0.055 },
				},
			},
			{
				key: "report.clause.driver.store",
				values: {
					store: { kind: "text", value: "Cửa hàng mẫu 2" },
					delta: { kind: "moneySigned", value: 937_000 },
				},
			},
		],
		tables: [],
		chart: null,
		notice: null,
		markers: { provisional: false, stale: true, verification: "sample" },
		csvName: "ngay-net-revenue-2026-11-03",
		...overrides,
	};
}

describe("typed values", () => {
	it("formats every value kind for the interface", () => {
		expect(format({ kind: "money", value: 12_500_000 })).toBe("12,5 tr ₫");
		expect(format({ kind: "moneyExact", value: 3_131_000 })).toBe(
			"3.131.000 ₫",
		);
		expect(format({ kind: "moneySigned", value: 937_000 })).toBe("+937.000 ₫");
		expect(format({ kind: "moneySigned", value: -20_000 })).toBe("-20.000 ₫");
		expect(format({ kind: "countSigned", value: 13 })).toBe("+13");
		expect(format({ kind: "count", value: 1_234 })).toBe("1.234");
		expect(format({ kind: "decimal", value: 2.25 })).toBe("2,3");
		expect(format({ kind: "percent", value: 0.0845 })).toBe("8,5%");
		expect(format({ kind: "signedPercent", value: -0.061 })).toBe("-6,1%");
		expect(format({ kind: "percentPoints", value: 0.035 })).toBe("+3,5 điểm %");
		expect(format({ kind: "percentChange", value: 12.5 })).toBe("+12,5%");
		expect(format({ kind: "hour", value: 8 })).toBe("08:00");
		expect(format({ kind: "date", value: "2026-11-03" })).toBe("03/11/2026");
		expect(format({ kind: "weekday", value: "2" })).toBe("Thứ Ba");
		expect(format({ kind: "month", value: "2026-10" })).toBe("10/2026");
		expect(format({ kind: "year", value: "2026" })).toBe("2026");
		expect(format({ kind: "isoWeek", value: "2026-W45" })).toBe("tuần 45/2026");
		expect(format({ kind: "text", value: "Ca sáng" })).toBe("Ca sáng");
		expect(format({ kind: "message", value: "report.paymentKind.cash" })).toBe(
			"Tiền mặt",
		);
	});

	it("fills a sentence template with formatted values", () => {
		const sentence = formatPart(
			{
				key: "report.clause.coverage.youngStore",
				values: {
					store: { kind: "text", value: "Cửa hàng mẫu 2" },
					date: { kind: "date", value: "2026-08-31" },
				},
			},
			t,
			formatters,
		);
		expect(sentence).toBe(
			"Cửa hàng mẫu 2 mở từ 31/08/2026, chưa có dữ liệu năm trước.",
		);
	});
});

describe("card adapter", () => {
	it("maps headline units to value kinds", () => {
		expect(headlineKindOf("money")).toBe("money");
		expect(headlineKindOf("fraction")).toBe("percent");
		expect(headlineKindOf("signedFraction")).toBe("signedPercent");
		expect(headlineKindOf("percentChange")).toBe("percentChange");
	});

	it("shows fraction comparisons in points and the rest as relative changes", () => {
		const points = chipOf(comparison(), "fraction", "higher", t, formatters, 0);
		expect(points).toMatchObject({ change: 0.05, unit: "points" });
		const relative = chipOf(comparison(), "money", "higher", t, formatters, 1);
		expect(relative).toMatchObject({ change: 0.25, unit: "relative" });
		const ownUnit = chipOf(
			comparison({ unit: "fraction" }),
			"money",
			"neutral",
			t,
			formatters,
			2,
		);
		expect(ownUnit).toMatchObject({ change: 0.05, unit: "points" });
	});

	it("labels an unavailable comparison with its state", () => {
		const young = chipOf(
			comparison({
				kind: "last_year",
				unavailable: "store_too_young",
				change: null,
				difference: null,
			}),
			"money",
			"higher",
			t,
			formatters,
			0,
		);
		expect(young).toMatchObject({
			label: "chưa có dữ liệu năm trước",
			change: null,
		});
	});

	it("builds the props of a ReportCard from a card model", () => {
		const props = toReportCardProps(card(), "day", t, formatters);
		expect(props.title).toBe("Doanh thu thuần");
		expect(props.testId).toBe("card-day-net_revenue");
		expect(props.csvFileName).toBe("ngay-net-revenue-2026-11-03.csv");
		expect(props.metric.id).toBe("net_revenue");
		expect(props.relatedMetrics?.map((metric) => metric.id)).toEqual([
			"invoices",
		]);
		expect(props.stale).toBe(true);
		expect(props.verification).toBe("sample");
		expect(props.sentence.replace(/ /g, " ")).toBe(
			"Ngày 03/11/2026, doanh thu thuần cao hơn mức nền cùng thứ 5,5%. Cửa hàng mẫu 2 tạo khác biệt lớn nhất (+937.000 ₫).",
		);
		expect(props.decomposition?.label.replace(/ /g, " ")).toBe(
			"Chênh lệch +1.000 ₫ so với hôm trước: số hóa đơn +600 ₫ · số món mỗi hóa đơn -200 ₫ · giá trung bình mỗi món +600 ₫",
		);
		const english = toReportCardProps(card(), "day", tEn, formatters);
		expect(english.title).toBe("Net revenue");
		expect(english.chips[0]?.label).toBe("vs the day before");
	});

	it("links a notice to the settings page that holds the missing input", () => {
		const props = toReportCardProps(
			card({
				notice: {
					tone: "warning",
					part: { key: "report.day.hourly.noBaseline", values: {} },
					action: "settings_roles",
				},
			}),
			"day",
			t,
			formatters,
		);
		expect(props.notice).toEqual({
			tone: "warning",
			text: "Chưa có mức nền theo giờ: cần dữ liệu của cùng thứ trong 8 tuần trước.",
			action: { label: "Gán vai trò món", to: "/cai-dat/phan-loai" },
		});
	});

	it("translates message cells and keeps heat columns", () => {
		const model: TableModel = {
			captionKey: "report.day.payments.table",
			columns: [
				{ key: "kind", labelKey: "report.table.paymentKind", kind: "message" },
				{ key: "amount", labelKey: "report.table.amount", kind: "money" },
			],
			rows: [
				{ id: "a", cells: { kind: "report.paymentKind.cash", amount: 5 } },
			],
			initialSort: { key: "amount", direction: "descending" },
			variant: "heat",
			heatColumns: ["amount"],
		};
		expect(tableOf(model, t)).toEqual({
			caption: "Thanh toán theo phương thức",
			columns: [
				{ key: "kind", label: "Loại", kind: "text" },
				{ key: "amount", label: "Số tiền", kind: "money" },
			],
			rows: [{ id: "a", cells: { kind: "Tiền mặt", amount: 5 } }],
			initialSort: { key: "amount", direction: "descending" },
			heatColumns: ["amount"],
		});
	});

	it("writes shift cells as Ca n and cashier keys as their label, never a raw value", () => {
		const model: TableModel = {
			captionKey: "report.day.shifts.table",
			columns: [
				{ key: "shift", labelKey: "report.table.shift", kind: "shift" },
				{ key: "cashier", labelKey: "report.table.cashier", kind: "label" },
			],
			rows: [
				{ id: "a", cells: { shift: 1, cashier: "Lan" } },
				{
					id: "b",
					cells: { shift: 2, cashier: "report.label.unknownCashier" },
				},
			],
			initialSort: null,
			variant: "standard",
			heatColumns: [],
		};
		const table = tableOf(model, t);
		expect(table.columns.map((column) => column.kind)).toEqual([
			"text",
			"text",
		]);
		expect(table.rows.map((row) => row.cells)).toEqual([
			{ shift: "Ca 1", cashier: "Lan" },
			{ shift: "Ca 2", cashier: "chưa rõ thu ngân" },
		]);
		const english = tableOf(model, (key, params) =>
			translate("en", key, params),
		);
		expect(english.rows[0]?.cells.shift).toBe("Shift 1");
	});

	it("maps charts with a right axis, stacks, mark lines and areas", () => {
		const chart: ChartModel = {
			labelKey: "report.day.hourly.chart",
			categories: [
				{ kind: "hour", value: 8 },
				{ kind: "hour", value: 9 },
			],
			series: [
				{
					label: { key: "report.periodRow.current", values: {} },
					kind: "bar",
					tone: "primary",
					axis: "left",
					stack: "total",
					values: [100, null],
				},
				{
					label: { key: "report.periodRow.baseline", values: {} },
					kind: "line",
					tone: "muted",
					axis: "right",
					stack: null,
					values: [12.5, -5],
				},
			],
			leftUnit: "money",
			rightUnit: "percentChange",
			markLines: [
				{
					label: { key: "report.compare.target", values: {} },
					value: 80,
					axis: "right",
				},
			],
			markAreas: [
				{
					label: { key: "report.holiday.tet", values: {} },
					fromIndex: 0,
					toIndex: 1,
				},
			],
		};
		const spec = chartOf(chart, t, formatters);
		expect(spec.categories).toEqual(["08:00", "09:00"]);
		expect(spec.valueKind).toBe("money");
		expect(spec.rightValueKind).toBe("percent");
		expect(spec.series[0]).toMatchObject({ stack: "total", axis: "left" });
		expect(spec.series[1]?.values).toEqual([0.125, -0.05]);
		expect(spec.series[1]).not.toHaveProperty("stack");
		expect(spec.markLines).toEqual([
			{ label: "so với mục tiêu", value: 0.8, axis: "right" },
		]);
		expect(spec.markAreas).toEqual([{ label: "Tết", from: 0, to: 1 }]);
	});

	it("shows decomposition parts that add up to the total they show", () => {
		let state = 20_261_108;
		const random = () => {
			state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
			return state / 4_294_967_296;
		};
		const sums = () => {
			const invoices = 50 + Math.floor(random() * 800);
			const items = Math.round(invoices * (1 + random()) * 1000) / 1000;
			const net = Math.round(invoices * (30_000 + random() * 90_000));
			return { net, invoices, items };
		};
		const amounts = (text: string) =>
			[...text.matchAll(/([+-]?\d{1,3}(?:\.\d{3})*)\s₫/gu)].map((match) =>
				Number((match[1] ?? "").replace(/\./g, "")),
			);
		for (let round = 0; round < 200; round += 1) {
			const current = sums();
			const reference = sums();
			for (const [metric, split] of [
				["net_revenue", decomposeNet(current, reference)],
				["avg_ticket", decomposeTicket(current, reference)],
			] as const) {
				const shown = decompositionOf(
					card({
						decomposition: decomposition(
							metric,
							"previous",
							"all_stores",
							split,
						),
					}),
					t,
					formatters,
				);
				const [total, ...parts] = amounts(shown?.label ?? "");
				expect(parts).toHaveLength(metric === "net_revenue" ? 3 : 2);
				expect(
					parts.reduce((sum, value) => sum + value, 0),
					shown?.label,
				).toBe(total);
			}
		}
	});

	it("refuses a metric the web registry does not know", () => {
		expect(() =>
			toReportCardProps(
				card({ metricId: "unknown_metric" }),
				"day",
				t,
				formatters,
			),
		).toThrow(/unknown_metric/);
	});
});
