import { BarChart, LineChart } from "echarts/charts";
import {
	GridComponent,
	LegendComponent,
	MarkAreaComponent,
	MarkLineComponent,
	TooltipComponent,
} from "echarts/components";
import { type EChartsType, init, use } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useLayoutEffect, useRef } from "react";
import {
	type ChartPalette,
	toneColor,
	useChartPalette,
	usePrinting,
} from "./chart-theme";
import type { ChartAxis, ChartSeries, ChartSpec } from "./types";

export const PRINT_CHART_WIDTH_PX = 660;
const LEGEND_HEIGHT_PX = 32;
const PLAIN_TOP_PX = 12;
const TIDY_SIGNIFICANT_DIGITS = 2;

use([
	BarChart,
	LineChart,
	GridComponent,
	LegendComponent,
	MarkAreaComponent,
	MarkLineComponent,
	TooltipComponent,
	SVGRenderer,
]);

export interface AxisFormat {
	axis: (value: number) => string;
	tooltip: (value: number) => string;
}

export interface EChartsViewProps {
	spec: ChartSpec;
	formats: Readonly<Record<ChartAxis, AxisFormat>>;
}

function usesRightAxis(spec: ChartSpec): boolean {
	return (
		spec.rightValueKind !== undefined ||
		spec.series.some((series) => series.axis === "right") ||
		(spec.markLines ?? []).some((line) => line.axis === "right")
	);
}

function axisIndex(axis: ChartAxis | undefined, twoAxes: boolean): number {
	return twoAxes && axis === "right" ? 1 : 0;
}

function markLineOf(
	spec: ChartSpec,
	series: ChartSeries,
	palette: ChartPalette,
	props: EChartsViewProps,
) {
	const lines = (spec.markLines ?? []).filter(
		(line) => line.axis === (series.axis ?? "left"),
	);
	if (lines.length === 0) return undefined;
	return {
		symbol: "none",
		silent: true,
		lineStyle: { color: palette.inkMuted, type: "dashed" as const },
		label: {
			color: palette.ink,
			position: "insideEndTop" as const,
			formatter: (entry: { name?: string }) => entry.name ?? "",
		},
		data: lines.map((line) => ({
			name: `${line.label} ${props.formats[line.axis].tooltip(line.value)}`,
			yAxis: line.value,
		})),
	};
}

const MARK_AREA_LABEL_POSITIONS = ["insideTop", "insideBottom"] as const;

export function markAreaLabelPosition(index: number) {
	return MARK_AREA_LABEL_POSITIONS[index % MARK_AREA_LABEL_POSITIONS.length];
}

function markAreaOf(spec: ChartSpec, palette: ChartPalette) {
	const areas = spec.markAreas ?? [];
	if (areas.length === 0) return undefined;
	return {
		silent: true,
		itemStyle: { color: palette.line, opacity: 0.35 },
		label: { color: palette.ink, position: "insideTop" as const },
		data: areas.map((area, index) => [
			{
				name: area.label,
				xAxis: spec.categories[area.from] ?? area.from,
				label: { position: markAreaLabelPosition(index) },
			},
			{ xAxis: spec.categories[area.to] ?? area.to },
		]),
	};
}

export function tidyCeiling(value: number): number {
	if (value <= 0) return value;
	const step =
		10 ** (Math.floor(Math.log10(value)) - TIDY_SIGNIFICANT_DIGITS + 1);
	return Math.ceil(value / step - 1e-9) * step;
}

export function tidyFloor(value: number): number {
	return value >= 0 ? value : -tidyCeiling(-value);
}

function finite(values: readonly (number | null)[]): number[] {
	return values.filter(
		(value): value is number => value !== null && Number.isFinite(value),
	);
}

export function dataExtent(
	spec: ChartSpec,
	axis: ChartAxis,
): { min: number; max: number } | null {
	const onAxis = spec.series.filter(
		(series) => (series.axis ?? "left") === axis,
	);
	const totals: number[] = [];
	const stacks = new Map<string, ChartSeries[]>();
	for (const series of onAxis) {
		if (series.stack === undefined) {
			totals.push(...finite(series.values));
			continue;
		}
		stacks.set(series.stack, [...(stacks.get(series.stack) ?? []), series]);
	}
	for (const members of stacks.values()) {
		const length = Math.max(...members.map((series) => series.values.length));
		for (let index = 0; index < length; index += 1) {
			const values = finite(
				members.map((series) => series.values[index] ?? null),
			);
			totals.push(
				values
					.filter((value) => value > 0)
					.reduce((sum, value) => sum + value, 0),
				values
					.filter((value) => value < 0)
					.reduce((sum, value) => sum + value, 0),
			);
		}
	}
	if (totals.length === 0) return null;
	return { min: Math.min(...totals), max: Math.max(...totals) };
}

export function markLineBounds(
	spec: ChartSpec,
	axis: ChartAxis,
): { min?: number; max?: number } {
	const lines = (spec.markLines ?? [])
		.filter((line) => line.axis === axis)
		.map((line) => line.value);
	if (lines.length === 0) return {};
	const extent = dataExtent(spec, axis) ?? { min: 0, max: 0 };
	const highest = Math.max(...lines);
	const lowest = Math.min(...lines);
	return {
		...(highest > extent.max ? { max: tidyCeiling(highest) } : {}),
		...(lowest < Math.min(extent.min, 0) ? { min: tidyFloor(lowest) } : {}),
	};
}

function axisKind(spec: ChartSpec, axis: ChartAxis) {
	return axis === "right"
		? (spec.rightValueKind ?? spec.valueKind)
		: spec.valueKind;
}

export function optionOf(
	spec: ChartSpec,
	palette: ChartPalette,
	props: EChartsViewProps,
) {
	const twoAxes = usesRightAxis(spec);
	const firstOnAxis = (axis: ChartAxis) =>
		spec.series.findIndex((series) => (series.axis ?? "left") === axis);
	const valueAxis = (axis: ChartAxis) => ({
		type: "value" as const,
		scale: spec.zeroBased === false,
		...(axisKind(spec, axis) === "count" ? { minInterval: 1 } : {}),
		...markLineBounds(spec, axis),
		axisLabel: {
			color: palette.inkMuted,
			formatter: (value: number) => props.formats[axis].axis(value),
		},
		splitLine: {
			show: axis === "left",
			lineStyle: { color: palette.line },
		},
	});
	return {
		animation: false,
		grid: {
			left: 8,
			right: 8,
			top: spec.series.length > 1 ? LEGEND_HEIGHT_PX : PLAIN_TOP_PX,
			bottom: 4,
		},
		legend: {
			show: spec.series.length > 1,
			type: "scroll" as const,
			top: 0,
			left: 0,
			right: 0,
			textStyle: { color: palette.ink },
			pageTextStyle: { color: palette.inkMuted },
		},
		tooltip: { trigger: "axis" },
		xAxis: {
			type: "category",
			data: [...spec.categories],
			axisLabel: { color: palette.inkMuted, hideOverlap: true },
			axisLine: { lineStyle: { color: palette.line } },
		},
		yAxis: twoAxes
			? [valueAxis("left"), valueAxis("right")]
			: valueAxis("left"),
		series: spec.series.map((series, index) => {
			const axis = series.axis ?? "left";
			const color = toneColor(palette, series.tone);
			return {
				name: series.name,
				type: series.kind,
				data: [...series.values],
				yAxisIndex: axisIndex(axis, twoAxes),
				...(series.stack === undefined ? {} : { stack: series.stack }),
				itemStyle: { color },
				lineStyle: series.kind === "line" ? { color, width: 2 } : undefined,
				showSymbol: false,
				barMaxWidth: 40,
				tooltip: {
					valueFormatter: (value: unknown) =>
						typeof value === "number"
							? props.formats[axis].tooltip(value)
							: "—",
				},
				...(index === firstOnAxis(axis)
					? { markLine: markLineOf(spec, series, palette, props) }
					: {}),
				...(index === 0 ? { markArea: markAreaOf(spec, palette) } : {}),
			};
		}),
	};
}

export function chartSizeFor(printing: boolean): {
	width: number | "auto";
} {
	return { width: printing ? PRINT_CHART_WIDTH_PX : "auto" };
}

export function initialChartSizeFor(printing: boolean): { width?: number } {
	return printing ? { width: PRINT_CHART_WIDTH_PX } : {};
}

export default function EChartsView(props: EChartsViewProps) {
	const container = useRef<HTMLDivElement>(null);
	const chart = useRef<EChartsType | null>(null);
	const palette = useChartPalette();
	const printing = usePrinting();
	const printingNow = useRef(printing);
	printingNow.current = printing;

	useEffect(() => {
		const element = container.current;
		if (!element) return;
		const instance = init(element, undefined, {
			renderer: "svg",
			...initialChartSizeFor(printingNow.current),
		});
		chart.current = instance;
		const observer = new ResizeObserver(() =>
			instance.resize(chartSizeFor(printingNow.current)),
		);
		observer.observe(element);
		return () => {
			observer.disconnect();
			instance.dispose();
			chart.current = null;
		};
	}, []);

	useLayoutEffect(() => {
		chart.current?.resize(chartSizeFor(printing));
	}, [printing]);

	useEffect(() => {
		chart.current?.setOption(optionOf(props.spec, palette, props), true);
	}, [props, palette]);

	return (
		<div
			ref={container}
			className="h-56 w-full"
			aria-hidden="true"
			data-testid="echarts"
		/>
	);
}
