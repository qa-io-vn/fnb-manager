import {
	createDemoAnalyticsSource,
	DemoDayCache,
	demoStores,
	youngStoreOpenedOn,
} from "@fnb/demo-analytics";
import {
	type CardModel,
	type IsoDate,
	isLabelKey,
	periodContaining,
	REPORT_KINDS,
	type ReportContext,
	type ReportKind,
	type ReportPeriod,
	reportDefinitions,
	runReport,
	type SentencePart,
	stepPeriod,
} from "@fnb/reports";
import { describe, expect, it } from "vitest";
import { isWebMetricId } from "../metrics/registry";
import { toReportCardProps } from "../reports/card-adapter";
import { vndFormatters } from "../test/render";
import { isMessageKey, messages, translate } from "./index";

const NOW = new Date("2026-11-04T05:30:00.000Z");
const days = new DemoDayCache({ now: () => NOW });
const source = createDemoAnalyticsSource({
	now: () => NOW,
	days,
	validateRows: true,
});
const asOf = days.asOf();
const stores = demoStores(asOf);
const SELECTIONS: readonly (readonly string[])[] = [
	["MOCK-S1"],
	["MOCK-S2"],
	["MOCK-S1", "MOCK-S2"],
];
const RAW_KEY = /\b(report|metric)\.[a-z]+[A-Za-z_]*\./;

function contextOf(
	storeIds: readonly string[],
	period: ReportPeriod,
): ReportContext {
	return {
		tenantId: "demo-tenant",
		stores: stores
			.filter((store) => storeIds.includes(store.id))
			.map((store) => ({
				id: store.id,
				name: store.name,
				timeZone: store.timeZone,
				businessDayStartMinutes: store.businessDayStartMinutes,
			})),
		allStoresSelected: storeIds.length === stores.length,
		period,
		sample: true,
	};
}

function periodsOf(kind: ReportKind): ReportPeriod[] {
	const current = periodContaining(kind, asOf, asOf);
	const previous = stepPeriod(current, -1);
	const youngStart: IsoDate = youngStoreOpenedOn(asOf);
	return [
		current,
		...(previous === null ? [] : [previous]),
		periodContaining(kind, youngStart, asOf),
	];
}

function partKeys(part: SentencePart | null): string[] {
	if (part === null) return [];
	return [
		part.key,
		...Object.values(part.values).flatMap((value) =>
			value.kind === "message"
				? [value.value]
				: value.kind === "part"
					? partKeys(value.value)
					: [],
		),
	];
}

function modelKeys(card: CardModel): string[] {
	return [
		card.titleKey,
		...partKeys(card.subtitle),
		...partKeys(card.headline.caption),
		...partKeys(card.notice?.part ?? null),
		...card.narrative.flatMap(partKeys),
		...card.comparisons.flatMap((comparison) => [
			...partKeys(comparison.label),
			...(comparison.unavailable === null
				? []
				: [`report.unavailable.${comparison.unavailable}.${comparison.kind}`]),
		]),
		...(card.decomposition === null
			? []
			: [
					card.decomposition.metric === "net_revenue"
						? "report.decomposition.net"
						: "report.decomposition.ticket",
				]),
		...card.tables.flatMap((table) => [
			table.captionKey,
			...table.columns.map((column) => column.labelKey),
			...table.columns
				.filter((column) => column.kind === "message")
				.flatMap((column) =>
					table.rows.flatMap((row) => {
						const cell = row.cells[column.key];
						return typeof cell === "string" ? [cell] : [];
					}),
				),
			...table.columns
				.filter((column) => column.kind === "label")
				.flatMap((column) =>
					table.rows.flatMap((row) => {
						const cell = row.cells[column.key];
						return isLabelKey(cell) ? [cell] : [];
					}),
				),
		]),
		...(card.chart === null
			? []
			: [
					card.chart.labelKey,
					...card.chart.series.flatMap((series) => partKeys(series.label)),
					...card.chart.markLines.flatMap((line) => partKeys(line.label)),
					...card.chart.markAreas.flatMap((area) => partKeys(area.label)),
					...card.chart.categories.flatMap((category) =>
						category.kind === "message" ? [category.value] : [],
					),
				]),
	];
}

const runs = REPORT_KINDS.flatMap((kind) =>
	SELECTIONS.flatMap((selection) =>
		periodsOf(kind).map((period) => ({ kind, selection, period })),
	),
);

describe("report keys", () => {
	it.each(REPORT_KINDS)(
		"declares the %s report title in both languages",
		(kind) => {
			const key = reportDefinitions[kind].titleKey;
			expect(isMessageKey(key), key).toBe(true);
		},
	);

	it.each(
		runs.map(
			(run) =>
				[run.kind, run.selection.join("+"), run.period.key, run] as const,
		),
	)(
		"translates every key of %s for %s in %s",
		async (_kind, _selection, _period, run) => {
			const context = contextOf(run.selection, run.period);
			const cards = await runReport(
				reportDefinitions[run.kind],
				context,
				source,
			);
			const missing = [...new Set(cards.flatMap(modelKeys))].filter(
				(key) => !isMessageKey(key) || messages.en[key].trim() === "",
			);
			expect(missing).toEqual([]);
			for (const card of cards) {
				expect(isWebMetricId(card.metricId), card.metricId).toBe(true);
				for (const related of card.relatedMetricIds) {
					expect(isWebMetricId(related), related).toBe(true);
				}
				for (const language of ["vi", "en"] as const) {
					const props = toReportCardProps(
						card,
						run.kind,
						(key, params) => translate(language, key, params),
						vndFormatters(language === "vi" ? "vi-VN" : "en-GB"),
					);
					const visible = JSON.stringify([
						props.title,
						props.sentence,
						props.headline.caption ?? "",
						props.chips.map((chip) => chip.label),
						props.notice?.text ?? "",
						props.decomposition?.label ?? "",
						props.table?.caption ?? "",
						props.table?.columns.map((column) => column.label) ?? [],
						props.chart?.label ?? "",
						props.chart?.series.map((series) => series.name) ?? [],
						props.table?.rows.map((row) => row.cells) ?? [],
						props.secondaryTable?.rows.map((row) => row.cells) ?? [],
					]);
					expect(RAW_KEY.test(visible), `${card.id} ${visible}`).toBe(false);
					expect(props.sentence.trim(), card.id).not.toBe("");
				}
			}
		},
		60_000,
	);
});
