import { BarChart, LineChart } from "echarts/charts";
import {
	GridComponent,
	LegendComponent,
	TooltipComponent,
} from "echarts/components";
import { type EChartsType, init, use } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { type ChartPalette, useChartPalette } from "./chart-theme";
import type { ChartSpec } from "./types";

use([
	BarChart,
	LineChart,
	GridComponent,
	LegendComponent,
	TooltipComponent,
	SVGRenderer,
]);

export interface EChartsViewProps {
	spec: ChartSpec;
	formatAxis: (value: number) => string;
	formatTooltip: (value: number) => string;
}

function optionOf(
	spec: ChartSpec,
	palette: ChartPalette,
	props: EChartsViewProps,
) {
	const colorOf = (tone: "primary" | "secondary") =>
		tone === "primary" ? palette.primary : palette.secondary;
	return {
		animation: false,
		grid: {
			left: 8,
			right: 8,
			top: spec.series.length > 1 ? 32 : 12,
			bottom: 4,
		},
		legend: {
			show: spec.series.length > 1,
			top: 0,
			left: 0,
			textStyle: { color: palette.ink },
		},
		tooltip: {
			trigger: "axis",
			valueFormatter: (value: unknown) =>
				typeof value === "number" ? props.formatTooltip(value) : "—",
		},
		xAxis: {
			type: "category",
			data: [...spec.categories],
			axisLabel: { color: palette.inkMuted, hideOverlap: true },
			axisLine: { lineStyle: { color: palette.line } },
		},
		yAxis: {
			type: "value",
			axisLabel: {
				color: palette.inkMuted,
				formatter: (value: number) => props.formatAxis(value),
			},
			splitLine: { lineStyle: { color: palette.line } },
		},
		series: spec.series.map((series) => ({
			name: series.name,
			type: series.kind,
			data: [...series.values],
			itemStyle: { color: colorOf(series.tone) },
			lineStyle:
				series.kind === "line"
					? { color: colorOf(series.tone), width: 2 }
					: undefined,
			showSymbol: false,
			barMaxWidth: 40,
		})),
	};
}

export default function EChartsView(props: EChartsViewProps) {
	const container = useRef<HTMLDivElement>(null);
	const chart = useRef<EChartsType | null>(null);
	const palette = useChartPalette();

	useEffect(() => {
		const element = container.current;
		if (!element) return;
		const instance = init(element, undefined, { renderer: "svg" });
		chart.current = instance;
		const observer = new ResizeObserver(() => instance.resize());
		observer.observe(element);
		return () => {
			observer.disconnect();
			instance.dispose();
			chart.current = null;
		};
	}, []);

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
