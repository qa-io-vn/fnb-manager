import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { metricRegistry } from "../../metrics/registry";
import { renderWithLanguage, vndFormatters } from "../../test/render";
import { csvOfRows } from "./data-table";
import { ReportCard, type ReportCardProps } from "./report-card";
import type { TableSpec } from "./types";

vi.mock("./echarts-view", () => ({
	default: () => <div data-testid="echarts" />,
}));

const downloads: { name: string; content: string }[] = [];

vi.mock("../../lib/csv", async (importOriginal) => {
	const original = await importOriginal<typeof import("../../lib/csv")>();
	return {
		...original,
		downloadTextFile: (name: string, content: string) =>
			downloads.push({ name, content }),
	};
});

const table: TableSpec = {
	caption: "Doanh thu thuần",
	columns: [
		{ key: "store", label: "Cửa hàng", kind: "text" },
		{ key: "value", label: "Doanh thu thuần", kind: "money" },
		{ key: "change", label: "Chênh lệch", kind: "signedPercent" },
	],
	rows: [
		{ id: "a", cells: { store: "Quán Một", value: 2_500_000, change: 0.25 } },
		{ id: "b", cells: { store: "Quán, Hai", value: 7_400_000, change: -0.1 } },
	],
	initialSort: { key: "value", direction: "descending" },
};

function props(overrides: Partial<ReportCardProps> = {}): ReportCardProps {
	return {
		title: "Doanh thu thuần",
		metric: metricRegistry.net_revenue,
		headline: { value: 12_400_000, kind: "money" },
		chips: [
			{ id: "up", label: "so với mức nền", change: 0.12, direction: "higher" },
			{
				id: "down",
				label: "so với hôm qua",
				change: -0.05,
				direction: "higher",
			},
		],
		sentence: "Câu giải thích.",
		chart: {
			label: "Theo cửa hàng",
			categories: ["Quán Một", "Quán, Hai"],
			series: [
				{
					name: "Doanh thu",
					kind: "bar",
					tone: "primary",
					values: [2_500_000, 7_400_000],
				},
			],
			valueKind: "money",
		},
		table,
		csvFileName: "net.csv",
		verification: "verified",
		formatters: vndFormatters(),
		...overrides,
	};
}

describe("ReportCard", () => {
	beforeEach(() => {
		downloads.length = 0;
	});

	it("renders the six parts in order", async () => {
		const { container } = renderWithLanguage(<ReportCard {...props()} />);
		await screen.findByTestId("echarts");
		const order = [
			screen.getByTestId("headline"),
			screen.getAllByTestId("comparison-chip")[0],
			screen.getByTestId("sentence"),
			screen.getByTestId("echarts"),
			screen.getByRole("table", { name: "Doanh thu thuần" }),
			screen.getByText("Giải thích chỉ số"),
		];
		const positions = order.map((element) =>
			[...container.querySelectorAll("*")].indexOf(element as Element),
		);
		expect(positions).toEqual(
			[...positions].sort((left, right) => left - right),
		);
	});

	it("shows a compact headline with the exact value as a tooltip", () => {
		renderWithLanguage(<ReportCard {...props()} />);
		const headline = screen.getByTestId("headline");
		expect(headline.textContent?.replace(/ /g, " ")).toBe("12,4 tr ₫");
		expect(headline.getAttribute("title")?.replace(/ /g, " ")).toBe(
			"12.400.000 ₫",
		);
	});

	it("colours chips by the metric direction", () => {
		renderWithLanguage(<ReportCard {...props()} />);
		const chips = screen.getAllByTestId("comparison-chip");
		expect(chips.map((chip) => chip.dataset.tone)).toEqual([
			"positive",
			"negative",
		]);
		const lowerIsBetter = props({
			chips: [
				{ id: "x", label: "so với mức nền", change: 0.12, direction: "lower" },
			],
		});
		renderWithLanguage(<ReportCard {...lowerIsBetter} />);
		expect(screen.getAllByTestId("comparison-chip").at(-1)?.dataset.tone).toBe(
			"negative",
		);
	});

	it("keeps an accessible table of the chart data", () => {
		renderWithLanguage(<ReportCard {...props()} />);
		const fallback = screen.getByTestId("chart-fallback");
		expect(within(fallback).getByRole("table")).toBeInTheDocument();
		expect(within(fallback).getByText("Quán, Hai")).toBeInTheDocument();
	});

	it("sorts the table and downloads exactly the rows shown as UTF-8 CSV with BOM", () => {
		renderWithLanguage(<ReportCard {...props()} />);
		const dataTable = screen.getByRole("table", { name: "Doanh thu thuần" });
		const firstCells = () =>
			within(dataTable)
				.getAllByRole("row")
				.slice(1)
				.map((row) => within(row).getAllByRole("cell")[0]?.textContent);
		expect(firstCells()).toEqual(["Quán, Hai", "Quán Một"]);
		fireEvent.click(
			screen.getByRole("button", { name: "Sắp xếp theo Cửa hàng" }),
		);
		expect(firstCells()).toEqual(["Quán, Hai", "Quán Một"]);
		fireEvent.click(
			screen.getByRole("button", { name: "Sắp xếp theo Cửa hàng" }),
		);
		expect(firstCells()).toEqual(["Quán Một", "Quán, Hai"]);
		fireEvent.click(screen.getByRole("button", { name: /^Tải CSV/ }));
		expect(downloads).toHaveLength(1);
		expect(downloads[0]?.content).toBe(
			'﻿Cửa hàng,Doanh thu thuần,Chênh lệch (%)\r\nQuán Một,2500000,25\r\n"Quán, Hai",7400000,-10\r\n',
		);
	});

	it("shows the first rows of a long table and every row on request", () => {
		const longTable: TableSpec = {
			...table,
			rows: [
				...table.rows,
				{ id: "c", cells: { store: "Quán Ba", value: 900_000, change: 0 } },
			],
			previewRows: 2,
		};
		renderWithLanguage(<ReportCard {...props({ table: longTable })} />);
		const dataTable = screen.getByRole("table", { name: "Doanh thu thuần" });
		const hiddenStores = () =>
			within(dataTable)
				.getAllByRole("row")
				.slice(1)
				.filter((row) => row.classList.contains("hidden"))
				.map((row) => within(row).getAllByRole("cell")[0]?.textContent);
		const toggle = screen.getByTestId("table-preview-toggle");
		expect(toggle).toHaveTextContent("Xem tất cả 3 dòng");
		expect(toggle).toHaveAttribute("aria-expanded", "false");
		expect(hiddenStores()).toEqual(["Quán Ba"]);
		expect(
			within(dataTable).getByText("Quán Ba").closest("tr")?.className,
		).toContain("print:table-row");
		fireEvent.click(toggle);
		expect(toggle).toHaveTextContent("Chỉ xem 2 dòng đầu");
		expect(toggle).toHaveAttribute("aria-expanded", "true");
		expect(hiddenStores()).toEqual([]);
		fireEvent.click(toggle);
		expect(hiddenStores()).toEqual(["Quán Ba"]);
		fireEvent.click(screen.getByRole("button", { name: /^Tải CSV/ }));
		expect(downloads[0]?.content.split("\r\n").filter(Boolean)).toHaveLength(4);
	});

	it("leaves a table that fits its preview without the toggle", () => {
		renderWithLanguage(
			<ReportCard {...props({ table: { ...table, previewRows: 2 } })} />,
		);
		expect(screen.queryByTestId("table-preview-toggle")).toBeNull();
	});

	it("keeps text cells on one line in a wide card", () => {
		const twoTextColumns: TableSpec = {
			...table,
			columns: [{ key: "item", label: "Món", kind: "text" }, ...table.columns],
			rows: [{ id: "a", cells: { item: "Trà", store: "Quán Một" } }],
		};
		const cellsOf = () =>
			within(screen.getByRole("table", { name: "Doanh thu thuần" }))
				.getAllByRole("cell")
				.slice(0, 2);
		const { unmount } = renderWithLanguage(
			<ReportCard {...props({ table: twoTextColumns })} />,
		);
		expect(
			cellsOf().map((cell) => cell.className.includes("whitespace-nowrap")),
		).toEqual([false, false]);
		unmount();
		renderWithLanguage(
			<ReportCard {...props({ table: twoTextColumns, wide: true })} />,
		);
		const [first, second] = cellsOf();
		expect(first?.className).toContain("md:whitespace-nowrap");
		expect(first?.className.split(" ")).not.toContain("whitespace-nowrap");
		expect(second?.className.split(" ")).toContain("whitespace-nowrap");
	});

	it("shows change columns with their sign", () => {
		renderWithLanguage(<ReportCard {...props()} />);
		const dataTable = screen.getByRole("table", { name: "Doanh thu thuần" });
		expect(within(dataTable).getByText("+25,0%")).toBeInTheDocument();
		expect(within(dataTable).getByText("-10,0%")).toBeInTheDocument();
	});

	it("builds CSV from the given rows only", () => {
		expect(
			csvOfRows(
				table.columns,
				table.rows.slice(0, 1),
				(label) => `${label} (%)`,
			),
		).toBe(
			"﻿Cửa hàng,Doanh thu thuần,Chênh lệch (%)\r\nQuán Một,2500000,25\r\n",
		);
	});

	it("keeps the metric explanation collapsed", () => {
		renderWithLanguage(<ReportCard {...props()} />);
		const details = screen.getByText("Giải thích chỉ số").closest("details");
		expect(details?.open).toBe(false);
		expect(details?.textContent).toContain("Công thức");
	});

	it("marks unverified and sample data", () => {
		renderWithLanguage(
			<ReportCard {...props({ verification: "unverified" })} />,
		);
		expect(screen.getByText("chưa đối soát")).toBeInTheDocument();
		renderWithLanguage(<ReportCard {...props({ verification: "sample" })} />);
		expect(screen.getByText("dữ liệu mẫu")).toBeInTheDocument();
	});

	it("marks provisional metrics whose inputs are missing", () => {
		const provisional = {
			...metricRegistry.net_revenue,
			missingKey: "metric.net_revenue.convention" as const,
		};
		renderWithLanguage(<ReportCard {...props({ metric: provisional })} />);
		expect(screen.getByText("tạm tính")).toBeInTheDocument();
	});

	it("switches every visible string with the language", () => {
		renderWithLanguage(<ReportCard {...props()} />, "en");
		expect(screen.getByText("About these numbers")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /^Download CSV/ }),
		).toBeInTheDocument();
	});
});
