import {
	Component,
	lazy,
	type ReactNode,
	type RefObject,
	Suspense,
	useEffect,
	useRef,
	useState,
} from "react";
import { useT } from "../../i18n";
import { afterPaintWhenIdle } from "../../lib/after-paint";
import type { Formatters } from "../../lib/format";
import { usePrinting } from "./chart-theme";
import type { AxisFormat } from "./echarts-view";
import { TableScroller } from "./table-scroller";
import type { ChartAxis, ChartSpec, ChartValueKind } from "./types";

const EChartsView = lazy(() => import("./echarts-view"));

export const CHART_MOUNT_MARGIN_PX = 200;

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

export function axisFormat(
	kind: ChartValueKind,
	formatters: Formatters,
): AxisFormat {
	switch (kind) {
		case "money":
			return { axis: formatters.moneyCompact, tooltip: formatters.moneyExact };
		case "count":
			return { axis: formatters.count, tooltip: formatters.count };
		case "decimal":
			return { axis: formatters.decimal, tooltip: formatters.decimal };
		case "ratio":
			return { axis: formatters.ratio, tooltip: formatters.ratio };
		case "percent":
			return { axis: formatters.percent, tooltip: formatters.percent };
	}
}

export function axisFormats(
	spec: ChartSpec,
	formatters: Formatters,
): Readonly<Record<ChartAxis, AxisFormat>> {
	return {
		left: axisFormat(spec.valueKind, formatters),
		right: axisFormat(spec.rightValueKind ?? spec.valueKind, formatters),
	};
}

interface FallbackRow {
	readonly key: string;
	readonly category: string;
	readonly cells: readonly { readonly key: string; readonly text: string }[];
}

export function fallbackRows(
	spec: ChartSpec,
	format: (value: number | null, axis: ChartAxis) => string,
): FallbackRow[] {
	const seen = new Map<string, number>();
	return spec.categories.map((category, position) => {
		const count = (seen.get(category) ?? 0) + 1;
		seen.set(category, count);
		return {
			key: count === 1 ? category : `${category}\u0000${count}`,
			category,
			cells: spec.series.map((series, column) => ({
				key: `${column}`,
				text: format(series.values[position] ?? null, series.axis ?? "left"),
			})),
		};
	});
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
	const formats = axisFormats(spec, formatters);
	const format = (value: number | null, axis: ChartAxis) =>
		value === null ? "—" : formats[axis].tooltip(value);
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
				{fallbackRows(spec, format).map((row) => (
					<tr key={row.key}>
						<th scope="row" className="px-1 text-left font-normal">
							{row.category}
						</th>
						{row.cells.map((cell) => (
							<td
								key={cell.key}
								className="whitespace-nowrap px-1 text-right tabular-nums"
							>
								{cell.text}
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

function canObserve(): boolean {
	return typeof IntersectionObserver === "function";
}

function useNearViewport(
	target: RefObject<HTMLElement | null>,
	immediately: boolean,
): boolean {
	const [near, setNear] = useState(() => immediately || !canObserve());
	useEffect(() => {
		if (near) return;
		if (immediately || !canObserve()) {
			setNear(true);
			return;
		}
		const element = target.current;
		if (!element) return;
		let cancelPending: () => void = () => undefined;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				observer.disconnect();
				cancelPending = afterPaintWhenIdle(() => setNear(true));
			},
			{ rootMargin: `${CHART_MOUNT_MARGIN_PX}px` },
		);
		observer.observe(element);
		return () => {
			observer.disconnect();
			cancelPending();
		};
	}, [near, immediately, target]);
	return near;
}

export function LazyChart({
	spec,
	formatters,
}: {
	spec: ChartSpec;
	formatters: Formatters;
}) {
	const t = useT();
	const figure = useRef<HTMLElement>(null);
	const printing = usePrinting();
	const mounted = useNearViewport(figure, printing);
	return (
		<figure ref={figure} className="space-y-1">
			<figcaption className="sr-only">
				{t("reportCard.chart", { title: spec.label })}
			</figcaption>
			<ChartErrorBoundary
				fallback={
					<ChartFallbackTable spec={spec} formatters={formatters} visible />
				}
			>
				{mounted ? (
					<Suspense
						fallback={
							<div className="flex h-56 items-center justify-center text-sm text-ink-muted">
								{t("reportCard.chartLoading")}
							</div>
						}
					>
						<EChartsView spec={spec} formats={axisFormats(spec, formatters)} />
					</Suspense>
				) : (
					<div className="h-56 w-full" data-testid="chart-placeholder" />
				)}
				<ChartFallbackTable
					spec={spec}
					formatters={formatters}
					visible={false}
				/>
			</ChartErrorBoundary>
		</figure>
	);
}
