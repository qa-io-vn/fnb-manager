import type { PaymentKind } from "../data/row-source";
import type { MessageKey, MessageParams } from "../i18n";
import type { Formatters } from "../lib/format";
import { changeFraction } from "./statistics";
import type { DayReport, ItemSummary, PaymentSplit } from "./today";

export interface SentencePart {
	key: MessageKey;
	params: MessageParams;
}

export type DayMetric = "net_revenue" | "invoices" | "avg_ticket";

const FLAT_THRESHOLD = 0.005;

interface MetricAccess {
	current: (day: DayReport) => number | null;
	baseline: (day: DayReport) => number | null;
	format: (formatters: Formatters, value: number) => string;
	templates: Record<"above" | "below" | "flat" | "noBaseline", MessageKey>;
}

const metricAccess: Record<DayMetric, MetricAccess> = {
	net_revenue: {
		current: (day) => day.totals.net,
		baseline: (day) => day.baseline.net,
		format: (formatters, value) => formatters.moneyCompact(value),
		templates: {
			above: "sentence.net.above",
			below: "sentence.net.below",
			flat: "sentence.net.flat",
			noBaseline: "sentence.net.noBaseline",
		},
	},
	invoices: {
		current: (day) => day.totals.invoices,
		baseline: (day) => day.baseline.invoices,
		format: (formatters, value) => formatters.count(value),
		templates: {
			above: "sentence.invoices.above",
			below: "sentence.invoices.below",
			flat: "sentence.invoices.flat",
			noBaseline: "sentence.invoices.noBaseline",
		},
	},
	avg_ticket: {
		current: (day) => day.totals.avgTicket,
		baseline: (day) => day.baseline.avgTicket,
		format: (formatters, value) => formatters.moneyCompact(value),
		templates: {
			above: "sentence.avgTicket.above",
			below: "sentence.avgTicket.below",
			flat: "sentence.avgTicket.flat",
			noBaseline: "sentence.avgTicket.noBaseline",
		},
	},
};

function signed(text: string, value: number): string {
	return value > 0 ? `+${text}` : text;
}

function mainClause(
	metric: DayMetric,
	day: DayReport,
	dayLabel: string,
	formatters: Formatters,
): SentencePart {
	const access = metricAccess[metric];
	const current = access.current(day);
	const baseline = access.baseline(day);
	if (day.totals.invoices === 0 || current === null) {
		return { key: "sentence.noInvoices", params: { day: dayLabel } };
	}
	const change = changeFraction(current, baseline);
	if (change === null) {
		return {
			key: access.templates.noBaseline,
			params: { day: dayLabel, value: access.format(formatters, current) },
		};
	}
	if (Math.abs(change) < FLAT_THRESHOLD) {
		return { key: access.templates.flat, params: { day: dayLabel } };
	}
	return {
		key: change > 0 ? access.templates.above : access.templates.below,
		params: { day: dayLabel, delta: formatters.percent(Math.abs(change)) },
	};
}

function storeDriver(
	metric: DayMetric,
	day: DayReport,
	formatters: Formatters,
): SentencePart | null {
	const active = day.stores.filter((store) => store.current.invoices > 0);
	if (active.length < 2) return null;
	if (metric === "avg_ticket") {
		const highest = [...active].sort(
			(left, right) =>
				(right.current.avgTicket ?? 0) - (left.current.avgTicket ?? 0),
		)[0];
		if (!highest || highest.current.avgTicket === null) return null;
		return {
			key: "sentence.driver.highestTicket",
			params: {
				name: highest.storeName,
				value: formatters.moneyCompact(highest.current.avgTicket),
			},
		};
	}
	const metricValue = (store: (typeof active)[number]) =>
		metric === "net_revenue" ? store.current.net : store.current.invoices;
	const baselineOf = (store: (typeof active)[number]) =>
		metric === "net_revenue" ? store.baseline.net : store.baseline.invoices;
	const format = (value: number) =>
		metricAccess[metric].format(formatters, value);
	const movers = active
		.flatMap((store) => {
			const reference = baselineOf(store);
			return reference === null
				? []
				: [{ store, delta: metricValue(store) - reference }];
		})
		.sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
	const mover = movers[0];
	if (mover && mover.delta !== 0) {
		return {
			key: "sentence.driver.storeChange",
			params: {
				name: mover.store.storeName,
				delta: signed(format(mover.delta), mover.delta),
			},
		};
	}
	const total = active.reduce((sum, store) => sum + metricValue(store), 0);
	const leader = [...active].sort(
		(left, right) => metricValue(right) - metricValue(left),
	)[0];
	if (!leader || total === 0) return null;
	return {
		key: "sentence.driver.storeShare",
		params: {
			name: leader.storeName,
			share: formatters.percent(metricValue(leader) / total),
		},
	};
}

interface ElapsedHour {
	hour: number;
	current: number;
	baseline: number;
}

function elapsedHours(day: DayReport): ElapsedHour[] {
	return day.hourly.flatMap((point) =>
		point.current === null
			? []
			: [
					{
						hour: point.hour,
						current: point.current,
						baseline: point.baseline,
					},
				],
	);
}

export function peakHourOf(day: DayReport): ElapsedHour | null {
	const peak = [...elapsedHours(day)].sort(
		(left, right) => right.current - left.current,
	)[0];
	return peak && peak.current > 0 ? peak : null;
}

function hourDriver(
	day: DayReport,
	formatters: Formatters,
): SentencePart | null {
	const hours = elapsedHours(day);
	const hasBaseline = day.baseline.sampleDays > 0;
	if (hasBaseline) {
		const mover = [...hours].sort(
			(left, right) =>
				Math.abs(right.current - right.baseline) -
				Math.abs(left.current - left.baseline),
		)[0];
		if (mover && mover.current !== mover.baseline) {
			const delta = mover.current - mover.baseline;
			return {
				key: "sentence.driver.hourChange",
				params: {
					hour: mover.hour,
					delta: signed(formatters.moneyCompact(delta), delta),
				},
			};
		}
	}
	const peak = peakHourOf(day);
	if (!peak) return null;
	return {
		key: "sentence.driver.peakHour",
		params: { hour: peak.hour, value: formatters.moneyCompact(peak.current) },
	};
}

export function daySentence(
	metric: DayMetric,
	day: DayReport,
	dayLabel: string,
	formatters: Formatters,
): SentencePart[] {
	const main = mainClause(metric, day, dayLabel, formatters);
	if (main.key === "sentence.noInvoices") return [main];
	const driver =
		storeDriver(metric, day, formatters) ??
		(metric === "net_revenue" ? hourDriver(day, formatters) : null);
	return driver ? [main, driver] : [main];
}

export function hourlySentence(
	day: DayReport,
	formatters: Formatters,
): SentencePart[] {
	const peak = peakHourOf(day);
	if (!peak) {
		return [{ key: "sentence.hourly.empty", params: {} }];
	}
	const parts: SentencePart[] = [
		{
			key: "sentence.hourly.peak",
			params: { hour: peak.hour, value: formatters.moneyCompact(peak.current) },
		},
	];
	const mover = hourDriver(day, formatters);
	if (mover && mover.key === "sentence.driver.hourChange") parts.push(mover);
	return parts;
}

export function itemsSentence(
	items: readonly ItemSummary[],
	formatters: Formatters,
): SentencePart[] {
	const leader = items[0];
	if (!leader) return [{ key: "sentence.items.empty", params: {} }];
	return [
		{
			key: "sentence.items.leader",
			params: {
				name: leader.name,
				quantity: formatters.count(leader.quantity),
				share: leader.share === null ? "" : formatters.percent(leader.share),
			},
		},
	];
}

export function paymentsSentence(
	split: PaymentSplit,
	kindLabel: (kind: PaymentKind) => string,
	formatters: Formatters,
): SentencePart[] {
	const leader = split.kinds[0];
	if (!leader || split.total === 0) {
		return [{ key: "sentence.payments.empty", params: {} }];
	}
	return [
		{
			key: "sentence.payments.leader",
			params: {
				method: kindLabel(leader.kind),
				share: leader.share === null ? "" : formatters.percent(leader.share),
			},
		},
		{
			key: "sentence.payments.cash",
			params: { cash: formatters.moneyExact(split.cashToCount) },
		},
	];
}
