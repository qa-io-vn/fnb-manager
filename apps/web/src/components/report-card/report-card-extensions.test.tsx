import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { metricRegistry } from "../../metrics/registry";
import { renderWithLanguage, vndFormatters } from "../../test/render";
import { printPalette } from "./chart-theme";
import { csvOfRows, displayCell, HEAT_LEVELS, heatLevels } from "./data-table";
import {
	chartSizeFor,
	dataExtent,
	initialChartSizeFor,
	markAreaLabelPosition,
	markLineBounds,
	optionOf,
	PRINT_CHART_WIDTH_PX,
	tidyCeiling,
} from "./echarts-view";
import { axisFormats } from "./lazy-chart";
import { ReportCard, type ReportCardProps } from "./report-card";
import type { ChartSpec, TableColumn, TableRow } from "./types";

vi.mock("./echarts-view", async (importOriginal) => {
	const original = await importOriginal<typeof import("./echarts-view")>();
	return { ...original, default: () => <div data-testid="echarts" /> };
});

const downloads: { name: string; content: string }[] = [];

vi.mock("../../lib/csv", async (importOriginal) => {
	const original = await importOriginal<typeof import("../../lib/csv")>();
	return {
		...original,
		downloadTextFile: (name: string, content: string) =>
			downloads.push({ name, content }),
	};
});

const formatters = vndFormatters();

const columns: TableColumn[] = [
	{ key: "date", label: "Ngày", kind: "date" },
	{ key: "weekday", label: "Thứ", kind: "weekday" },
	{ key: "month", label: "Tháng", kind: "month" },
	{ key: "hour", label: "Giờ", kind: "hour" },
	{ key: "share", label: "Tỷ trọng", kind: "percent" },
	{ key: "points", label: "Chênh lệch", kind: "percentPoints" },
];

const rows: TableRow[] = [
	{
		id: "a",
		cells: {
			date: "2026-11-03",
			weekday: 2,
			month: "2026-11",
			hour: 8,
			share: 0.256,
			points: 0.012,
		},
	},
];

function props(overrides: Partial<ReportCardProps> = {}): ReportCardProps {
	return {
		title: "Giảm giá và voucher",
		metric: metricRegistry.discount_cost,
		headline: { value: 370_000, kind: "money" },
		chips: [
			{
				id: "points",
				label: "tỷ lệ giảm giá so với hôm trước",
				change: 0.003,
				direction: "neutral",
				unit: "points",
			},
		],
		sentence: "Câu giải thích.",
		table: { caption: "Khuyến mãi", columns: columns.slice(0, 2), rows },
		csvFileName: "ngay-discounts-2026-11-03.csv",
		secondaryTable: { caption: "Thành phần", columns: columns.slice(2), rows },
		secondaryCsvFileName: "ngay-discounts-2026-11-03-2.csv",
		verification: "sample",
		formatters,
		...overrides,
	};
}

describe("report card extensions", () => {
	beforeEach(() => {
		downloads.length = 0;
	});

	it("formats date, weekday, month, hour and point cells", () => {
		const cell = (index: number) =>
			displayCell(
				columns[index] as TableColumn,
				rows[0]?.cells[columns[index]?.key ?? ""] ?? null,
				formatters,
				(text) => `${text} điểm %`,
			);
		expect([0, 1, 2, 3, 4, 5].map(cell)).toEqual([
			"03/11/2026",
			"Thứ Ba",
			"11/2026",
			"08:00",
			"25,6%",
			"+1,2 điểm %",
		]);
	});

	it("writes ISO dates, display weekdays, months and hours, and percentages to CSV", () => {
		expect(
			csvOfRows(columns, rows, (label) => `${label} (%)`, formatters),
		).toBe(
			"﻿Ngày,Thứ,Tháng,Giờ,Tỷ trọng (%),Chênh lệch\r\n2026-11-03,Thứ Ba,11/2026,08:00,25.6,1.2\r\n",
		);
	});

	it("splits heat columns into quintiles of their non-null values", () => {
		const heatRows: TableRow[] = [1, 2, 3, 4, 5, null, 10, 20, 30, 40].map(
			(value, index) => ({ id: String(index), cells: { m1: value } }),
		);
		const levels = heatLevels(heatRows, ["m1"]);
		expect(levels.size).toBe(9);
		expect(levels.get("0|m1")).toBe(0);
		expect(levels.get("9|m1")).toBe(HEAT_LEVELS - 1);
		expect(levels.has("5|m1")).toBe(false);
		expect(new Set(levels.values())).toEqual(new Set([0, 1, 2, 3, 4]));
	});

	it("colours heat cells, shows points chips, the stale marker, the notice link and the decomposition", () => {
		render(
			<MemoryRouter>
				<I18nProvider language="vi" onLanguageChange={() => undefined}>
					<ReportCard
						{...props({
							stale: true,
							notice: {
								tone: "warning",
								text: "Chưa gán vai trò món.",
								action: { label: "Gán vai trò món", to: "/cai-dat/phan-loai" },
							},
							decomposition: { label: "Chênh lệch +1.000 ₫", parts: [] },
							table: {
								caption: "Ma trận",
								columns: [
									{ key: "year", label: "Năm", kind: "text" },
									{ key: "m1", label: "Tháng 1", kind: "money" },
								],
								rows: [
									{ id: "2025", cells: { year: "2025", m1: 1 } },
									{ id: "2026", cells: { year: "2026", m1: 316_123_000 } },
								],
								heatColumns: ["m1"],
							},
							wide: true,
							busy: true,
						})}
					/>
				</I18nProvider>
			</MemoryRouter>,
		);
		const matrix = screen.getByRole("table", { name: "Ma trận" });
		expect(
			within(matrix)
				.getAllByRole("cell")
				.map((cell) => cell.getAttribute("data-heat")),
		).toEqual([null, "0", null, "2"]);
		const peak = within(matrix).getAllByRole("cell")[3];
		expect(peak?.textContent?.replace(/\u00a0/g, " ")).toBe("316,1 tr ₫");
		expect(peak?.getAttribute("title")?.replace(/\u00a0/g, " ")).toBe(
			"316.123.000 ₫",
		);
		const article = screen.getByRole("article");
		expect(article.className).toContain("xl:col-span-3");
		expect(article.className).toContain("print:col-span-1");
		expect(article).toHaveAttribute("aria-busy", "true");
		expect(screen.getByTestId("busy-marker").textContent).toBe("Đang tải…");
		expect(screen.getByTestId("comparison-chip").textContent).toContain(
			"+0,3 điểm %",
		);
		expect(screen.getByTestId("stale-marker").textContent).toBe(
			"đang cập nhật",
		);
		expect(screen.getByRole("note").textContent).toContain(
			"Chưa gán vai trò món.",
		);
		expect(
			screen.getByRole("link", { name: "Gán vai trò món" }),
		).toHaveAttribute("href", "/cai-dat/phan-loai");
		expect(screen.getByTestId("decomposition").textContent).toBe(
			"Chênh lệch +1.000 ₫",
		);
	});

	it("downloads the second table under its own file name", () => {
		renderWithLanguage(<ReportCard {...props()} />);
		const buttons = screen.getAllByRole("button", { name: /^Tải CSV/ });
		expect(buttons).toHaveLength(2);
		expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
			"Tải CSV: Khuyến mãi",
			"Tải CSV: Thành phần",
		]);
		expect(buttons.map((button) => button.textContent)).toEqual([
			"Tải CSV",
			"Tải CSV",
		]);
		fireEvent.click(buttons[1] as HTMLElement);
		expect(downloads.map((download) => download.name)).toEqual([
			"ngay-discounts-2026-11-03-2.csv",
		]);
		expect(downloads[0]?.content.startsWith("﻿")).toBe(true);
	});
});

describe("chart option mapping", () => {
	const spec: ChartSpec = {
		label: "Pareto",
		categories: ["A", "B", "C"],
		series: [
			{ name: "Doanh thu", kind: "bar", tone: "primary", values: [5, 3, 2] },
			{
				name: "Lũy kế",
				kind: "line",
				tone: "tertiary",
				values: [0.5, 0.8, 1],
				axis: "right",
			},
			{
				name: "Thiếu",
				kind: "bar",
				tone: "negative",
				values: [-1, null, 0],
				stack: "v",
			},
		],
		valueKind: "money",
		rightValueKind: "percent",
		markLines: [{ label: "80 %", value: 0.8, axis: "right" }],
		markAreas: [{ label: "Tết", from: 1, to: 2 }],
	};
	const option = optionOf(spec, printPalette, {
		spec,
		formats: axisFormats(spec, formatters),
	});

	it("puts right-axis series on a second value axis", () => {
		expect(Array.isArray(option.yAxis)).toBe(true);
		expect(option.series.map((series) => series.yAxisIndex)).toEqual([0, 1, 0]);
	});

	it("colours series by tone and stacks the stacked ones", () => {
		expect(option.series.map((series) => series.itemStyle.color)).toEqual([
			printPalette.primary,
			printPalette.tertiary,
			printPalette.negative,
		]);
		expect(option.series[2]).toHaveProperty("stack", "v");
		expect(option.series[0]).not.toHaveProperty("stack");
	});

	it("draws labelled horizontal mark lines on their axis and category mark areas", () => {
		const line = option.series[1]?.markLine;
		expect(line?.data).toEqual([{ name: "80 % 80,0%", yAxis: 0.8 }]);
		expect(option.series[0]?.markLine).toBeUndefined();
		expect(option.series[0]?.markArea?.data).toEqual([
			[
				{ name: "Tết", xAxis: "B", label: { position: "insideTop" } },
				{ xAxis: "C" },
			],
		]);
	});

	it("keeps the axes and the legend clear of mark lines, counts and long names", () => {
		expect(option.legend).toMatchObject({ type: "scroll", show: true });
		const axes = option.yAxis as { scale: boolean }[];
		expect(axes.map((axis) => axis.scale)).toEqual([false, false]);
		const above: ChartSpec = {
			label: "Nhịp tháng",
			categories: ["1", "2", "3"],
			series: [
				{ name: "Lũy kế", kind: "line", tone: "primary", values: [10, 20, 30] },
			],
			valueKind: "count",
			markLines: [
				{ label: "Dự báo", value: 525.3, axis: "left" },
				{ label: "Mục tiêu", value: 25, axis: "left" },
			],
			zeroBased: false,
		};
		const fitted = optionOf(above, printPalette, {
			spec: above,
			formats: axisFormats(above, formatters),
		});
		expect(fitted.yAxis).toMatchObject({
			max: 530,
			minInterval: 1,
			scale: true,
		});
		expect(fitted.yAxis).not.toHaveProperty("min");
		expect(markLineBounds(spec, "right")).toEqual({});
		expect(tidyCeiling(525_300_000)).toBe(530_000_000);
		expect(tidyCeiling(0.8)).toBeCloseTo(0.8, 12);
		expect(dataExtent(spec, "left")).toEqual({ min: -1, max: 5 });
		expect([0, 1, 2].map(markAreaLabelPosition)).toEqual([
			"insideTop",
			"insideBottom",
			"insideTop",
		]);
	});

	it("returns charts to the container width once printing ends", () => {
		expect(chartSizeFor(true)).toEqual({ width: PRINT_CHART_WIDTH_PX });
		expect(chartSizeFor(false)).toEqual({ width: "auto" });
	});

	it("gives a new chart a width only while printing, so its svg never reads width auto", () => {
		expect(initialChartSizeFor(true)).toEqual({ width: PRINT_CHART_WIDTH_PX });
		expect(initialChartSizeFor(false)).toEqual({});
	});
});
