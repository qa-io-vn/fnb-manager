import {
	createDemoReportSource,
	DemoDayCache,
	demoStores,
} from "@fnb/demo-analytics";
import {
	type NamedPreset,
	parseThemeParams,
	rangeOfPreset,
	runTheme,
	type ThemeContext,
	type ThemeDefinition,
	themeDefinitions,
	themeKeys,
} from "@fnb/reports";
import { describe, expect, it } from "vitest";
import type { TableSpec } from "../components/report-card/types";
import { isWebMetricId } from "../metrics/registry";
import { toReportCardProps } from "../reports/card-adapter";
import { modelKeys } from "../test/card-keys";
import { vndFormatters } from "../test/render";
import { isMessageKey, messages, translate } from "./index";

const NOW = new Date("2026-11-04T05:30:00.000Z");
const days = new DemoDayCache({ now: () => NOW });
const source = createDemoReportSource({ now: () => NOW, validateRows: true });
const asOf = days.asOf();
const stores = demoStores(asOf);
const SELECTIONS: readonly (readonly string[])[] = [
	["MOCK-S1"],
	["MOCK-S2"],
	["MOCK-S1", "MOCK-S2"],
];
const PRESETS: readonly NamedPreset[] = ["7d", "28d", "this_year"];
const RAW_KEY = /\b(report|metric|theme)\.[a-z]+[A-Za-z_]*\./;

function stringsOf(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (value !== null && typeof value === "object") {
		return Object.values(value).flatMap(stringsOf);
	}
	return [];
}

function shownCells(table: TableSpec | null | undefined): unknown[] {
	if (table === null || table === undefined) return [];
	return table.rows.map((row) =>
		table.columns.map((column) => row.cells[column.key] ?? null),
	);
}

function contextOf(
	definition: ThemeDefinition,
	storeIds: readonly string[],
	preset: NamedPreset,
): ThemeContext {
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
		range: rangeOfPreset(preset, asOf),
		sample: true,
		params: parseThemeParams(definition.params, {}),
		catchUpPending: null,
	};
}

const definitions = Object.values(themeDefinitions).filter(
	(definition): definition is ThemeDefinition => definition !== undefined,
);

const runs = definitions.flatMap((definition) =>
	SELECTIONS.flatMap((selection) =>
		PRESETS.map((preset) => ({ definition, selection, preset })),
	),
);

describe("theme keys", () => {
	it("declares every shared theme key in both languages", () => {
		const missing = stringsOf(themeKeys).filter(
			(key) => !isMessageKey(key) || messages.en[key].trim() === "",
		);
		expect(missing).toEqual([]);
	});

	it.each(
		definitions.map((definition) => [definition.kind, definition] as const),
	)("declares the %s theme title in both languages", (_kind, definition) => {
		expect(isMessageKey(definition.titleKey), definition.titleKey).toBe(true);
	});

	it.each(
		runs.map(
			(run) =>
				[
					run.definition.kind,
					run.selection.join("+"),
					run.preset,
					run,
				] as const,
		),
	)(
		"translates every key of %s for %s over %s",
		async (_kind, _selection, _preset, run) => {
			const context = contextOf(run.definition, run.selection, run.preset);
			const cards = await runTheme(run.definition, context, source);
			expect(cards.length).toBeGreaterThan(0);
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
						run.definition.kind,
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
						shownCells(props.table),
						shownCells(props.secondaryTable),
						props.secondaryTable?.caption ?? "",
						props.secondaryTable?.columns.map((column) => column.label) ?? [],
					]);
					expect(RAW_KEY.test(visible), `${card.id} ${visible}`).toBe(false);
					expect(props.sentence.trim(), card.id).not.toBe("");
				}
			}
		},
		60_000,
	);
});
