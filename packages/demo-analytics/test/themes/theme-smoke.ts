import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type CardModel,
	coverageModel,
	type NamedPreset,
	rangeOfPreset,
	type SentencePart,
	type ThemeContext,
	type ThemeDefinition,
	themeCoverageCall,
} from "@fnb/reports";
import {
	createDemoReportSource,
	DemoDayCache,
	type DemoReportSource,
	demoStores,
} from "../../src/index.js";
import { cardKeys, SMOKE_NOW } from "../reports/report-keys.js";

const messagesRoot = join(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"..",
	"apps",
	"web",
	"src",
	"i18n",
	"messages",
);

export function messageFile(
	name: string,
	language: "vi" | "en",
): Readonly<Record<string, string>> {
	return JSON.parse(
		readFileSync(join(messagesRoot, `${name}.${language}.json`), "utf8"),
	) as Record<string, string>;
}

export function themeCatalog(
	themeFile: string,
	language: "vi" | "en",
): Readonly<Record<string, string>> {
	return {
		...messageFile("reports", language),
		...messageFile("themes", language),
		...messageFile(themeFile, language),
	};
}

export function stringsOf(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (value !== null && typeof value === "object") {
		return Object.values(value).flatMap(stringsOf);
	}
	return [];
}

function placeholdersOf(template: string): string[] {
	return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "");
}

function sentenceParts(card: CardModel): SentencePart[] {
	const nested = (part: SentencePart): SentencePart[] => [
		part,
		...Object.values(part.values).flatMap((value) =>
			value.kind === "part" ? nested(value.value) : [],
		),
	];
	return [
		card.subtitle,
		card.headline.caption,
		card.notice?.part ?? null,
		...card.narrative,
		...card.comparisons.map((comparison) => comparison.label),
		...(card.chart?.series.map((series) => series.label) ?? []),
	]
		.filter((entry): entry is SentencePart => entry !== null)
		.flatMap(nested);
}

export function missingKeys(
	cards: readonly CardModel[],
	catalogs: Readonly<Record<"vi" | "en", Readonly<Record<string, string>>>>,
): string[] {
	const keys = new Set(
		cards.flatMap((card) => [
			...cardKeys(card),
			...sentenceParts(card).map((part) => part.key),
		]),
	);
	return [...keys].flatMap((key) =>
		(["vi", "en"] as const)
			.filter((language) => catalogs[language][key] === undefined)
			.map((language) => `${key} (${language})`),
	);
}

export function unfilledPlaceholders(
	cards: readonly CardModel[],
	catalogs: Readonly<Record<"vi" | "en", Readonly<Record<string, string>>>>,
): string[] {
	const problems: string[] = [];
	for (const card of cards) {
		for (const sentence of sentenceParts(card)) {
			for (const language of ["vi", "en"] as const) {
				const template = catalogs[language][sentence.key];
				if (template === undefined) continue;
				for (const name of placeholdersOf(template)) {
					if (!(name in sentence.values)) {
						problems.push(`${card.id} ${sentence.key} {${name}} (${language})`);
					}
				}
			}
		}
	}
	return problems;
}

export function themeSource(): DemoReportSource {
	return createDemoReportSource({ now: () => SMOKE_NOW, validateRows: true });
}

export function themeSmokeContext(
	storeIds: readonly string[],
	preset: NamedPreset,
): ThemeContext {
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
		range: rangeOfPreset(preset, asOf),
		sample: true,
		params: {},
		catchUpPending: null,
	};
}

export async function visibleCardIds(
	definition: ThemeDefinition,
	context: ThemeContext,
	source: DemoReportSource,
): Promise<string[]> {
	const coverage = coverageModel(
		await source.call("store_coverage", themeCoverageCall(context).args),
		context,
	);
	return definition.cards
		.filter((card) => card.visible({ context, coverage }))
		.map((card) => card.id);
}
