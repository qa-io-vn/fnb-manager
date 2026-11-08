import type {
	ChartSpec,
	ChipSpec,
	TableSpec,
} from "../../components/report-card/types";
import type { PaymentKind } from "../../data/row-source";
import type { MessageKey, Translate } from "../../i18n";
import type { MetricId } from "../../metrics/registry";
import { metricRegistry } from "../../metrics/registry";
import type { DayMetric, SentencePart } from "../../metrics/sentences";
import { changeFraction } from "../../metrics/statistics";
import type {
	DayReport,
	ItemSummary,
	PaymentSplit,
	StoreDayReport,
} from "../../metrics/today";

export function renderSentence(
	t: Translate,
	parts: readonly SentencePart[],
): string {
	return parts.map((part) => t(part.key, part.params)).join(" ");
}

export function hourLabel(hour: number): string {
	return `${String(hour).padStart(2, "0")}:00`;
}

interface DayMetricAccess {
	current: (totals: StoreDayReport["current"]) => number | null;
	baseline: (baseline: StoreDayReport["baseline"]) => number | null;
	kind: "money" | "count";
	column: MessageKey;
}

export const dayMetricAccess: Record<DayMetric, DayMetricAccess> = {
	net_revenue: {
		current: (totals) => totals.net,
		baseline: (baseline) => baseline.net,
		kind: "money",
		column: "table.net",
	},
	invoices: {
		current: (totals) => totals.invoices,
		baseline: (baseline) => baseline.invoices,
		kind: "count",
		column: "table.invoices",
	},
	avg_ticket: {
		current: (totals) => totals.avgTicket,
		baseline: (baseline) => baseline.avgTicket,
		kind: "money",
		column: "table.avgTicket",
	},
};

export function baselineChip(
	id: MetricId,
	current: number | null,
	baseline: number | null,
	label: string,
	emptyLabel: string,
): ChipSpec {
	const change = changeFraction(current, baseline);
	return {
		id: `${id}-baseline`,
		label: change === null ? emptyLabel : label,
		change,
		direction: metricRegistry[id].direction,
	};
}

export function storeTable(
	metric: DayMetric,
	day: DayReport,
	t: Translate,
	caption: string,
): TableSpec {
	const access = dayMetricAccess[metric];
	return {
		caption,
		columns: [
			{ key: "store", label: t("table.store"), kind: "text" },
			{ key: "value", label: t(access.column), kind: access.kind },
			{ key: "baseline", label: t("table.baseline"), kind: access.kind },
			{ key: "change", label: t("table.change"), kind: "signedPercent" },
		],
		rows: day.stores.map((store) => {
			const current = access.current(store.current);
			const baseline = access.baseline(store.baseline);
			return {
				id: store.storeId,
				cells: {
					store: store.storeName,
					value: current,
					baseline,
					change: changeFraction(current, baseline),
				},
			};
		}),
		initialSort: { key: "value", direction: "descending" },
	};
}

export function storeNetChart(day: DayReport, t: Translate): ChartSpec {
	return {
		label: t("today.chart.netByStore"),
		categories: day.stores.map((store) => store.storeName),
		series: [
			{
				name: t("table.net"),
				kind: "bar",
				tone: "primary",
				values: day.stores.map((store) => store.current.net),
			},
			{
				name: t("table.baseline"),
				kind: "bar",
				tone: "secondary",
				values: day.stores.map((store) => store.baseline.net),
			},
		],
		valueKind: "money",
	};
}

export function hourlyChart(day: DayReport, t: Translate): ChartSpec {
	return {
		label: t("today.chart.hourly"),
		categories: day.hourly.map((point) => hourLabel(point.hour)),
		series: [
			{
				name: t("table.today"),
				kind: "line",
				tone: "primary",
				values: day.hourly.map((point) => point.current),
			},
			{
				name: t("table.baselineHourly"),
				kind: "line",
				tone: "secondary",
				values: day.hourly.map((point) => point.baseline),
			},
		],
		valueKind: "money",
	};
}

export function hourlyTable(day: DayReport, t: Translate): TableSpec {
	return {
		caption: t("today.hourly.title"),
		columns: [
			{ key: "hour", label: t("table.hour"), kind: "text" },
			{ key: "current", label: t("table.today"), kind: "money" },
			{ key: "baseline", label: t("table.baselineHourly"), kind: "money" },
		],
		rows: day.hourly.map((point) => ({
			id: String(point.hour),
			cells: {
				hour: hourLabel(point.hour),
				current: point.current,
				baseline: point.baseline,
			},
		})),
	};
}

export function itemsTable(
	items: readonly ItemSummary[],
	t: Translate,
): TableSpec {
	return {
		caption: t("today.items.title"),
		columns: [
			{ key: "item", label: t("table.item"), kind: "text" },
			{ key: "quantity", label: t("table.quantity"), kind: "count" },
			{ key: "net", label: t("table.net"), kind: "money" },
			{ key: "share", label: t("table.itemShare"), kind: "percent" },
		],
		rows: items.map((item) => ({
			id: item.key,
			cells: {
				item: item.name,
				quantity: item.quantity,
				net: item.net,
				share: item.share,
			},
		})),
		initialSort: { key: "net", direction: "descending" },
	};
}

export const paymentKindLabel: Record<PaymentKind, MessageKey> = {
	cash: "payment.kind.cash",
	card: "payment.kind.card",
	bank_transfer: "payment.kind.bank_transfer",
	ewallet: "payment.kind.ewallet",
	voucher: "payment.kind.voucher",
	other: "payment.kind.other",
};

export function kindLabelOf(t: Translate): (kind: PaymentKind) => string {
	return (kind) => t(paymentKindLabel[kind]);
}

export function paymentsTable(split: PaymentSplit, t: Translate): TableSpec {
	const kindLabel = kindLabelOf(t);
	return {
		caption: t("today.payments.title"),
		columns: [
			{ key: "method", label: t("table.method"), kind: "text" },
			{ key: "kind", label: t("table.kind"), kind: "text" },
			{ key: "amount", label: t("table.amount"), kind: "money" },
			{ key: "share", label: t("table.share"), kind: "percent" },
		],
		rows: split.methods.map((method) => ({
			id: method.key,
			cells: {
				method: method.name ?? kindLabel(method.kind),
				kind: kindLabel(method.kind),
				amount: method.amount,
				share: method.share,
			},
		})),
		initialSort: { key: "amount", direction: "descending" },
	};
}
