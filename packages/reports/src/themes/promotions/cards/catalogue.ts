import type { DateRange } from "../../../contract/values.js";
import type {
	CardModel,
	NoticeModel,
	TableModel,
} from "../../../model/card.js";
import { promotionKindKey, reportKeys } from "../../../model/keys.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	partValue,
	type SentencePart,
	textValue,
} from "../../../model/values.js";
import { daysBetween } from "../../../period/dates.js";
import type { ThemeRow } from "../../contract.js";
import type {
	ThemeCallResults,
	ThemeCardDefinition,
	ThemeCardInput,
} from "../../definition.js";
import {
	type LuckyDrawMatch,
	luckyDrawMatches,
	ruleInForce,
} from "../../rules.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { promotionsKeys } from "../keys.js";
import { legalBasisValue, themePromotionRules } from "../rules.js";
import {
	promotionId,
	promotionsCalls,
	promotionsCsvName,
	promotionsNeeds,
} from "../support.js";

export const CATALOGUE_ID = "catalogue";
export const CATALOGUE_METRIC = "promotions_used";
export const CATALOGUE_UNUSED_DAYS = 90;
export const CATALOGUE_PREVIEW_ROWS = 10;

export type CatalogueRow = ThemeRow<"promotion_catalogue">;

export interface LuckyDrawFinding {
	readonly row: CatalogueRow;
	readonly match: LuckyDrawMatch;
}

export function catalogueRows(
	results: ThemeCallResults,
): readonly CatalogueRow[] {
	return results.rows(promotionsCalls.catalogue, "promotion_catalogue") ?? [];
}

export function promotionUsedIn(row: CatalogueRow, range: DateRange): boolean {
	return (
		row.last_used_on !== null &&
		row.last_used_on >= range.from &&
		row.last_used_on <= range.to
	);
}

function activeInCatalogue(row: CatalogueRow): boolean {
	return row.in_catalogue && row.catalogue_active !== false;
}

export function unusedInCatalogue(
	row: CatalogueRow,
	asOf: DateRange["to"],
): boolean {
	return (
		activeInCatalogue(row) &&
		(row.last_used_on === null ||
			daysBetween(row.last_used_on, asOf) > CATALOGUE_UNUSED_DAYS)
	);
}

export function luckyDrawFindings(
	rows: readonly CatalogueRow[],
	range: DateRange,
	keywords: readonly string[],
): LuckyDrawFinding[] {
	return rows.flatMap((row): LuckyDrawFinding[] => {
		if (!promotionUsedIn(row, range) && !activeInCatalogue(row)) return [];
		const matches = luckyDrawMatches(row.promotion_name, keywords);
		const match = matches.find((entry) => entry.exact) ?? matches[0];
		return match === undefined ? [] : [{ row, match }];
	});
}

function findingPart(finding: LuckyDrawFinding): SentencePart {
	return part(
		finding.match.exact
			? promotionsKeys.catalogue.luckyDrawMatch
			: promotionsKeys.catalogue.luckyDrawPossible,
		{
			promotion: textValue("text", finding.row.promotion_name),
			keyword: textValue("text", finding.match.keyword),
		},
	);
}

function luckyDrawNotice(input: ThemeCardInput): NoticeModel | null {
	const { range } = input.context;
	const rule = ruleInForce(
		themePromotionRules(),
		"lucky_draw_registration",
		range.to,
	);
	if (rule === null) return null;
	const findings = luckyDrawFindings(
		catalogueRows(input.results),
		range,
		rule.parameters.keywords,
	);
	const [first] = findings;
	if (first === undefined) return null;
	const matches =
		findings.length === 1
			? findingPart(first)
			: part(promotionsKeys.catalogue.luckyDrawMore, {
					first: partValue(findingPart(first)),
					others: numberValue("count", findings.length - 1),
				});
	return {
		tone: "warning",
		part: part(promotionsKeys.catalogue.luckyDraw, {
			matches: partValue(matches),
			basis: legalBasisValue(rule.legalBasis),
			checked: textValue("date", rule.checkedOn),
		}),
		action: null,
	};
}

function catalogueTable(rows: readonly CatalogueRow[]): TableModel {
	return tableModel({
		captionKey: promotionsKeys.catalogue.table,
		columns: [
			column("kind", reportKeys.table.promotionKind, "message"),
			column("promotion", reportKeys.table.promotion, "text"),
			column("inCatalogue", promotionsKeys.table.inCatalogue, "message"),
			column("active", promotionsKeys.table.active, "message"),
			column("lastUsed", promotionsKeys.table.lastUsed, "date"),
			column("daysUsed", promotionsKeys.table.daysUsed365, "count"),
			column("discount", promotionsKeys.table.discount365, "money"),
		],
		rows: rows.map((row) => ({
			id: promotionId(row),
			cells: {
				kind: promotionKindKey(row.promotion_kind),
				promotion: row.promotion_name,
				inCatalogue: row.in_catalogue
					? promotionsKeys.catalogue.listed
					: promotionsKeys.catalogue.unlisted,
				active:
					!row.in_catalogue || row.catalogue_active === null
						? null
						: row.catalogue_active
							? promotionsKeys.catalogue.active
							: promotionsKeys.catalogue.inactive,
				lastUsed: row.last_used_on,
				daysUsed: row.days_used_365,
				discount: row.discount_365,
			},
		})),
		previewRows: CATALOGUE_PREVIEW_ROWS,
	});
}

function cataloguePart(
	rows: readonly CatalogueRow[],
	asOf: DateRange["to"],
): SentencePart {
	if (!rows.some(activeInCatalogue)) {
		return part(promotionsKeys.catalogue.noCatalogue);
	}
	const unused = rows.filter((row) => unusedInCatalogue(row, asOf)).length;
	const values = {
		days: numberValue("count", CATALOGUE_UNUSED_DAYS),
		date: textValue("date", asOf),
	};
	return unused === 0
		? part(promotionsKeys.catalogue.allRecent, values)
		: part(promotionsKeys.catalogue.stale, {
				...values,
				count: numberValue("count", unused),
			});
}

export function buildCatalogueCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const rows = catalogueRows(input.results);
	const used = rows.filter((row) => promotionUsedIn(row, context.range)).length;
	const range = rangeValue(context);
	const main =
		used === 0
			? part(promotionsKeys.catalogue.none, { range })
			: part(promotionsKeys.catalogue.used, {
					range,
					count: numberValue("count", used),
				});
	return {
		id: CATALOGUE_ID,
		titleKey: promotionsKeys.catalogue.title,
		subtitle: null,
		metricId: CATALOGUE_METRIC,
		relatedMetricIds: [],
		headline: {
			value: used,
			unit: "count",
			caption: part(promotionsKeys.catalogue.caption),
		},
		comparisons: [],
		decomposition: null,
		narrative: [main, cataloguePart(rows, context.range.to)],
		tables: rows.length === 0 ? [] : [catalogueTable(rows)],
		chart: null,
		notice: luckyDrawNotice(input),
		markers: themeMarkers(input, false),
		csvName: promotionsCsvName(context, CATALOGUE_ID),
	};
}

export const catalogueCard: ThemeCardDefinition = {
	id: CATALOGUE_ID,
	needs: promotionsNeeds.catalogue,
	visible: () => true,
	build: buildCatalogueCard,
};
