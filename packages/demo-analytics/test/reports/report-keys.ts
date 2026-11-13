import {
	type CardModel,
	periodContaining,
	type ReportContext,
	type ReportKind,
	sentenceKeys,
	sharedReportKeys,
	tableKeys,
} from "@fnb/reports";
import { DemoDayCache, demoStores } from "../../src/index.js";

export const SMOKE_NOW = new Date("2026-11-04T05:30:00.000Z");

export const STORE_SELECTIONS: readonly (readonly ("MOCK-S1" | "MOCK-S2")[])[] =
	[["MOCK-S1"], ["MOCK-S2"], ["MOCK-S1", "MOCK-S2"]];

export function smokeContext(
	kind: ReportKind,
	storeIds: readonly string[],
	date?: string,
): ReportContext {
	const days = new DemoDayCache({ now: () => SMOKE_NOW });
	const asOf = days.asOf();
	const stores = demoStores(asOf).filter((store) =>
		storeIds.includes(store.id),
	);
	return {
		tenantId: "demo-tenant",
		stores: stores.map((store) => ({
			id: store.id,
			name: store.name,
			timeZone: store.timeZone,
			businessDayStartMinutes: store.businessDayStartMinutes,
		})),
		allStoresSelected: stores.length === 2,
		period: periodContaining(kind, date ?? asOf, asOf),
		sample: true,
	};
}

export function cardKeys(card: CardModel): string[] {
	return [
		card.titleKey,
		...sentenceKeys([
			card.subtitle,
			card.headline.caption,
			card.notice?.part ?? null,
			...card.narrative,
			...card.comparisons.map((comparison) => comparison.label),
		]),
		...card.tables.flatMap((table) => tableKeys(table)),
		...(card.chart === null
			? []
			: [
					card.chart.labelKey,
					...sentenceKeys(card.chart.series.map((series) => series.label)),
				]),
	];
}

export function unknownKeys(
	cards: readonly CardModel[],
	reportPrefix: string,
): string[] {
	const shared = new Set(sharedReportKeys());
	return cards
		.flatMap(cardKeys)
		.filter((key) => !shared.has(key) && !key.startsWith(reportPrefix));
}
