import { Component, lazy, type ReactNode, Suspense } from "react";
import { useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import { TableScroller } from "./table-scroller";
import type { ChartSpec } from "./types";

const EChartsView = lazy(() => import("./echarts-view"));

class ChartErrorBoundary extends Component<
	{ fallback: ReactNode; children: ReactNode },
	{ failed: boolean }
> {
	override state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	override render() {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}

function ChartFallbackTable({
	spec,
	formatters,
	visible,
}: {
	spec: ChartSpec;
	formatters: Formatters;
	visible: boolean;
}) {
	const t = useT();
	const format = (value: number | null) => {
		if (value === null) return "—";
		return spec.valueKind === "money"
			? formatters.moneyExact(value)
			: formatters.count(value);
	};
	const table = (
		<table className="w-full text-sm">
			<caption className={visible ? "text-left text-ink-muted" : undefined}>
				{t("reportCard.chartFallback", { title: spec.label })}
			</caption>
			<thead>
				<tr>
					<th scope="col" className="px-1 text-left">
						{t("reportCard.category")}
					</th>
					{spec.series.map((series) => (
						<th key={series.name} scope="col" className="px-1 text-right">
							{series.name}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{spec.categories.map((category, index) => (
					<tr key={category}>
						<th scope="row" className="px-1 text-left font-normal">
							{category}
						</th>
						{spec.series.map((series) => (
							<td
								key={series.name}
								className="whitespace-nowrap px-1 text-right tabular-nums"
							>
								{format(series.values[index] ?? null)}
							</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	);
	return (
		<div
			className={visible ? undefined : "sr-only"}
			data-testid="chart-fallback"
		>
			{visible ? <TableScroller>{table}</TableScroller> : table}
		</div>
	);
}

export function LazyChart({
	spec,
	formatters,
}: {
	spec: ChartSpec;
	formatters: Formatters;
}) {
	const t = useT();
	const formatAxis =
		spec.valueKind === "money" ? formatters.moneyCompact : formatters.count;
	const formatTooltip =
		spec.valueKind === "money" ? formatters.moneyExact : formatters.count;
	return (
		<figure className="space-y-1">
			<figcaption className="sr-only">
				{t("reportCard.chart", { title: spec.label })}
			</figcaption>
			<ChartErrorBoundary
				fallback={
					<ChartFallbackTable spec={spec} formatters={formatters} visible />
				}
			>
				<Suspense
					fallback={
						<div className="flex h-56 items-center justify-center text-sm text-ink-muted">
							{t("reportCard.chartLoading")}
						</div>
					}
				>
					<EChartsView
						spec={spec}
						formatAxis={formatAxis}
						formatTooltip={formatTooltip}
					/>
				</Suspense>
				<ChartFallbackTable
					spec={spec}
					formatters={formatters}
					visible={false}
				/>
			</ChartErrorBoundary>
		</figure>
	);
}
