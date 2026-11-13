import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type CardModel,
	coverageCall,
	coverageModel,
	runReport,
	type SentencePart,
	weekKeys,
	weekReport,
} from "@fnb/reports";
import { describe, expect, it } from "vitest";
import { createDemoAnalyticsSource } from "../../src/index.js";
import {
	SMOKE_NOW,
	STORE_SELECTIONS,
	smokeContext,
	unknownKeys,
} from "./report-keys.js";

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

function messageFile(
	name: string,
	language: "vi" | "en",
): Readonly<Record<string, string>> {
	return JSON.parse(
		readFileSync(join(messagesRoot, `${name}.${language}.json`), "utf8"),
	) as Record<string, string>;
}

function catalog(language: "vi" | "en"): Readonly<Record<string, string>> {
	return {
		...messageFile("reports", language),
		...messageFile("report-week", language),
	};
}

const catalogs = { vi: catalog("vi"), en: catalog("en") };

function stringsOf(value: unknown): string[] {
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
	return [
		card.subtitle,
		card.headline.caption,
		card.notice?.part ?? null,
		...card.narrative,
		...card.comparisons.map((comparison) => comparison.label),
		...(card.chart?.series.map((series) => series.label) ?? []),
	].filter((entry): entry is SentencePart => entry !== null);
}

function unfilledPlaceholders(cards: readonly CardModel[]): string[] {
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
				for (const value of Object.values(sentence.values)) {
					if (value.kind !== "message") continue;
					const nested = catalogs[language][value.value] ?? "";
					if (placeholdersOf(nested).length > 0) {
						problems.push(
							`${card.id} ${value.value} needs values (${language})`,
						);
					}
				}
			}
		}
	}
	return problems;
}

const PERIODS: readonly { readonly name: string; readonly date?: string }[] = [
	{ name: "the running week" },
	{ name: "the week before", date: "2026-10-28" },
	{ name: "the young store's opening week", date: "2026-08-31" },
	{ name: "the week of Tết 2026", date: "2026-02-18" },
	{ name: "the week after Tết 2026", date: "2026-02-25" },
];

describe("the Tuần message files", () => {
	it("hold exactly the keys of the Tuần model in both languages", () => {
		const modelKeys = stringsOf(weekKeys).sort();
		for (const language of ["vi", "en"] as const) {
			expect(Object.keys(messageFile("report-week", language)).sort()).toEqual(
				modelKeys,
			);
		}
	});
});

describe("Tuần on the demo engine", () => {
	const source = createDemoAnalyticsSource({
		now: () => SMOKE_NOW,
		validateRows: true,
	});

	for (const period of PERIODS) {
		for (const stores of STORE_SELECTIONS) {
			it(`builds every visible card for ${stores.join(" + ")} in ${period.name}`, async () => {
				const context = smokeContext("week", stores, period.date);
				const cards = await runReport(weekReport, context, source);
				const coverage = coverageModel(
					await source.call("store_coverage", coverageCall(context).args),
					context,
				);
				const visible = weekReport.cards.filter((card) =>
					card.visible({ context, coverage }),
				);
				expect(cards.map((card) => card.id)).toEqual(
					visible.map((card) => card.id),
				);
				expect(cards).toHaveLength(8);
				expect(
					cards.every((card) => card.markers.verification === "sample"),
				).toBe(true);
				expect(unknownKeys(cards, "report.week.")).toEqual([]);
				expect(unfilledPlaceholders(cards)).toEqual([]);
				for (const card of cards) {
					expect(card.narrative.length, card.id).toBeGreaterThan(0);
					expect(card.narrative.length, card.id).toBeLessThanOrEqual(3);
					expect(card.csvName, card.id).toMatch(/^tuan-[a-z-]+-\d{4}-W\d{2}$/);
					if (card.headline.value === null) {
						expect(
							card.notice,
							`${card.id} explains its empty headline`,
						).not.toBeNull();
					}
				}
			}, 60_000);
		}
	}

	it("shows the 4-week average and a full set of comparisons on the running week", async () => {
		const context = smokeContext("week", ["MOCK-S1", "MOCK-S2"]);
		const cards = await runReport(weekReport, context, source);
		const net = cards.find((card) => card.id === "net_revenue");
		expect(net?.comparisons.map((entry) => entry.kind)).toEqual([
			"previous",
			"average_4_weeks",
			"last_year",
		]);
		const average = net?.comparisons[1];
		expect(average?.unavailable).toBeNull();
		expect(average?.label.values.weeks).toEqual({ kind: "count", value: 4 });
		expect(net?.comparisons[2]?.basis).toBe("like_for_like");
		expect(net?.decomposition?.against).toBe("previous");
		const movers = cards.find((card) => card.id === "movers");
		expect(movers?.headline.value).not.toBeNull();
		expect(movers?.tables[0]?.rows.length).toBeGreaterThan(0);
	}, 60_000);

	it("skips the Tết week in the 4-week average after Tết", async () => {
		const context = smokeContext("week", ["MOCK-S1"], "2026-02-25");
		const cards = await runReport(weekReport, context, source);
		const average = cards
			.find((card) => card.id === "net_revenue")
			?.comparisons.find((entry) => entry.kind === "average_4_weeks");
		expect(average?.unavailable).toBeNull();
		expect(average?.label.values.weeks).toEqual({ kind: "count", value: 3 });
	}, 60_000);
});
