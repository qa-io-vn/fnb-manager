import type { IsoDate } from "../../lib/business-dates";
import { buildCsv, type CsvCell, type CsvDialect } from "../../lib/csv";
import {
	type CsvParseError,
	type DateOrder,
	type DateOrderOutcome,
	detectDateOrder,
	parseCsv,
	parseDateCell,
	parseMoneyCell,
} from "../../lib/csv-parse";
import { settingsAccess } from "../access";
import { readDateDraft } from "../forms/date-field";
import type { ItemEntry, Membership } from "../source";
import { FIRST_BUSINESS_DATE, ITEM_COST_MAX } from "../validation";
import {
	type CostItem,
	type CostSale,
	type CostScope,
	currentCostOf,
} from "./costs";
import type { ItemCostChange, ItemCostRow } from "./source";

export const COST_IMPORT_MAX_ROWS = 2_000;
export const COST_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_DATE_ORDER: DateOrder = "dmy";

export const COST_CSV_COLUMNS = [
	"ma_mon",
	"ten_mon",
	"size",
	"ma_cua_hang",
	"gia_von",
	"tu_ngay",
] as const;

export type CostCsvColumn = (typeof COST_CSV_COLUMNS)[number];

const REQUIRED_COLUMNS: readonly CostCsvColumn[] = ["ma_mon", "gia_von"];
const NEUTRALISED_FORMULA = /^'(?=[=+\-@\t\r])/;
const LEADING_MINUS = /^[-−]\s*/;
const ANY_FRACTION_DIGITS = 6;
const EXACT_DIGITS = 15;
const MONEY_UNIT = /₫|vnđ|vnd|đ/gi;
const MONEY_MARKS = /[\s.,\u00a0\u202f]/g;
const DIGITS_ONLY = /^\d+$/;

export interface CostTemplateInput {
	readonly items: readonly CostItem[];
	readonly storeId: CostScope;
	readonly storeCode: string | null;
	readonly rows: readonly ItemCostRow[];
	readonly today: IsoDate;
}

export function costTemplateRows({
	items,
	storeId,
	storeCode,
	rows,
	today,
}: CostTemplateInput): Record<CostCsvColumn, CsvCell>[] {
	const code = storeId === null ? "" : (storeCode?.trim() ?? "");
	return items.map((item) => {
		const current = currentCostOf(rows, storeId, item.itemExternalId, today);
		const own = current === null || current.inherited ? null : current.row;
		return {
			ma_mon: item.itemExternalId,
			ten_mon: item.name,
			size: item.sizeLabel ?? "",
			ma_cua_hang: code,
			gia_von: own?.costAmount ?? null,
			tu_ngay: own?.effectiveFrom ?? "",
		};
	});
}

export function costTemplateCsv(
	input: CostTemplateInput,
	dialect: CsvDialect,
): string {
	return buildCsv(
		COST_CSV_COLUMNS.map((column) => ({ key: column, label: column })),
		costTemplateRows(input),
		dialect,
	);
}

function asciiSlug(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[đĐ]/g, "d")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function costTemplateFileName(
	storeId: CostScope,
	storeCode: string | null,
	today: IsoDate,
): string {
	const scope =
		storeId === null
			? "tat-ca-cua-hang"
			: asciiSlug(storeCode ?? "") || "cua-hang";
	return `gia-von-${scope}-${today}.csv`;
}

export interface CostFileLine {
	readonly line: number;
	readonly cells: Readonly<Record<CostCsvColumn, string>>;
}

export type CostFileProblem =
	| { readonly kind: "oversized" }
	| {
			readonly kind: "unreadable";
			readonly error: CsvParseError;
			readonly line: number;
	  }
	| {
			readonly kind: "missingColumns";
			readonly columns: readonly CostCsvColumn[];
	  }
	| { readonly kind: "noRows" };

export type CostFile =
	| { readonly ok: true; readonly lines: readonly CostFileLine[] }
	| { readonly ok: false; readonly problem: CostFileProblem };

function headerPositions(
	header: readonly string[],
): Map<CostCsvColumn, number> {
	const positions = new Map<CostCsvColumn, number>();
	header.forEach((cell, index) => {
		const name = cell.trim().toLowerCase();
		const column = COST_CSV_COLUMNS.find((known) => known === name);
		if (column !== undefined && !positions.has(column)) {
			positions.set(column, index);
		}
	});
	return positions;
}

export function readCostFile(text: string): CostFile {
	const parsed = parseCsv(text);
	if (!parsed.ok) {
		return {
			ok: false,
			problem: { kind: "unreadable", error: parsed.error, line: parsed.line },
		};
	}
	const [header, ...body] = parsed.rows;
	if (header === undefined) return { ok: false, problem: { kind: "noRows" } };
	const positions = headerPositions(header);
	const missing = REQUIRED_COLUMNS.filter((column) => !positions.has(column));
	if (missing.length > 0) {
		return { ok: false, problem: { kind: "missingColumns", columns: missing } };
	}
	if (body.length === 0) return { ok: false, problem: { kind: "noRows" } };
	return {
		ok: true,
		lines: body.map((cells, index) => ({
			line: parsed.lines[index + 1] ?? index + 2,
			cells: Object.fromEntries(
				COST_CSV_COLUMNS.map((column) => {
					const position = positions.get(column);
					return [
						column,
						position === undefined ? "" : (cells[position] ?? ""),
					];
				}),
			) as Record<CostCsvColumn, string>,
		})),
	};
}

export const COST_IMPORT_OUTCOMES = [
	"ok",
	"cost_above_price",
	"unchanged",
	"unknown_item",
	"unknown_store",
	"ambiguous_store",
	"out_of_scope",
	"invalid_cost",
	"invalid_date",
	"duplicate_in_file",
] as const;

export type CostImportOutcome = (typeof COST_IMPORT_OUTCOMES)[number];

const SAVED_OUTCOMES: ReadonlySet<CostImportOutcome> = new Set([
	"ok",
	"cost_above_price",
]);

const PROBLEM_OUTCOMES: ReadonlySet<CostImportOutcome> = new Set([
	"unknown_item",
	"unknown_store",
	"ambiguous_store",
	"out_of_scope",
	"invalid_cost",
	"invalid_date",
]);

export function isSavedOutcome(outcome: CostImportOutcome): boolean {
	return SAVED_OUTCOMES.has(outcome);
}

export function isProblemOutcome(outcome: CostImportOutcome): boolean {
	return PROBLEM_OUTCOMES.has(outcome);
}

export type CostImportIssue =
	| { readonly key: "itemNotListed" }
	| { readonly key: "costRequired" }
	| { readonly key: "costNotAmount" }
	| { readonly key: "costWholeDong" }
	| { readonly key: "costDecimals"; readonly digits: number }
	| { readonly key: "costAtLeast"; readonly min: number }
	| { readonly key: "costAtMost"; readonly max: number }
	| { readonly key: "dateBlank" }
	| { readonly key: "dateBlankInherited" }
	| { readonly key: "dateUnreadable" }
	| { readonly key: "dateOtherOrder" }
	| { readonly key: "dateRange"; readonly min: IsoDate; readonly max: IsoDate };

export interface CostImportStore {
	readonly id: string;
	readonly name: string;
	readonly code: string | null;
	readonly posAccountId: string;
}

export interface CostImportItem {
	readonly itemExternalId: string;
	readonly name: string;
	readonly sizeLabel: string | null;
}

export interface CostImportContext {
	readonly scope: CostScope;
	readonly stores: readonly CostImportStore[];
	readonly canWrite: (storeId: CostScope) => boolean;
	readonly items: ReadonlyMap<string, CostImportItem>;
	readonly isListed: (itemExternalId: string, storeId: CostScope) => boolean;
	readonly listPriceOf: (
		itemExternalId: string,
		storeId: CostScope,
	) => number | null;
	readonly rows: readonly ItemCostRow[];
	readonly today: IsoDate;
	readonly fractionDigits: number;
}

export interface CostImportRow {
	readonly line: number;
	readonly itemExternalId: string;
	readonly fileItemName: string;
	readonly item: CostImportItem | null;
	readonly storeCode: string;
	readonly storeId: CostScope | undefined;
	readonly costText: string;
	readonly costAmount: number | null;
	readonly dateText: string;
	readonly effectiveFrom: IsoDate | null;
	readonly outcome: CostImportOutcome;
	readonly issue: CostImportIssue | null;
	readonly listPrice: number | null;
	readonly usedLine: number | null;
	readonly replacesLines: readonly number[];
}

export interface CostDateReading {
	readonly detected: DateOrderOutcome;
	readonly used: DateOrder;
	readonly needsChoice: boolean;
	readonly rejected: DateOrder | null;
}

export interface CostImportPreview {
	readonly rows: readonly CostImportRow[];
	readonly blankCount: number;
	readonly blankCodeCount: number;
	readonly changes: readonly ItemCostChange[];
	readonly counts: Readonly<Record<CostImportOutcome, number>>;
	readonly tooMany: boolean;
	readonly dates: CostDateReading;
}

type DateEvidence = DateOrder | "both" | "same" | "none";

function evidenceOf(cell: string): DateEvidence {
	const dayFirst = parseDateCell(cell, "dmy");
	const monthFirst = parseDateCell(cell, "mdy");
	if (dayFirst !== null && monthFirst === null) return "dmy";
	if (monthFirst !== null && dayFirst === null) return "mdy";
	if (dayFirst === null || monthFirst === null) return "none";
	return dayFirst === monthFirst ? "same" : "both";
}

function otherOrder(order: DateOrder): DateOrder {
	return order === "dmy" ? "mdy" : "dmy";
}

export function readDateOrder(
	cells: readonly string[],
	chosen: DateOrder,
): CostDateReading {
	const detected = detectDateOrder(cells);
	if (detected === "dmy" || detected === "mdy") {
		return { detected, used: detected, needsChoice: false, rejected: null };
	}
	const evidence = cells.map(evidenceOf);
	if (detected === "conflict") {
		const dayFirst = evidence.filter((each) => each === "dmy").length;
		const monthFirst = evidence.filter((each) => each === "mdy").length;
		const used =
			dayFirst === monthFirst ? chosen : dayFirst > monthFirst ? "dmy" : "mdy";
		return {
			detected,
			used,
			needsChoice: dayFirst === monthFirst,
			rejected: otherOrder(used),
		};
	}
	return {
		detected,
		used: chosen,
		needsChoice: evidence.includes("both"),
		rejected: null,
	};
}

function unneutralised(text: string): string {
	return text.replace(NEUTRALISED_FORMULA, "").trim();
}

type CostReading =
	| { readonly amount: number; readonly issue: null }
	| { readonly amount: null; readonly issue: CostImportIssue };

function refused(issue: CostImportIssue): CostReading {
	return { amount: null, issue };
}

function hasTooManyDigits(text: string): boolean {
	const digits = text.replace(MONEY_UNIT, "").replace(MONEY_MARKS, "");
	return DIGITS_ONLY.test(digits) && digits.length > EXACT_DIGITS;
}

export function readCostCell(
	text: string,
	fractionDigits: number,
): CostReading {
	const trimmed = text.trim();
	if (trimmed === "") return refused({ key: "costRequired" });
	const unsigned = trimmed.replace(LEADING_MINUS, "");
	if (
		unsigned !== trimmed &&
		(parseMoneyCell(unsigned, ANY_FRACTION_DIGITS) !== null ||
			hasTooManyDigits(unsigned))
	) {
		return refused({ key: "costAtLeast", min: 0 });
	}
	const amount = parseMoneyCell(trimmed, fractionDigits);
	if (amount === null) {
		if (hasTooManyDigits(trimmed)) {
			return refused({ key: "costAtMost", max: ITEM_COST_MAX });
		}
		if (parseMoneyCell(trimmed, ANY_FRACTION_DIGITS) === null) {
			return refused({ key: "costNotAmount" });
		}
		return refused(
			fractionDigits === 0
				? { key: "costWholeDong" }
				: { key: "costDecimals", digits: fractionDigits },
		);
	}
	if (amount > ITEM_COST_MAX) {
		return refused({ key: "costAtMost", max: ITEM_COST_MAX });
	}
	return { amount, issue: null };
}

type StoreReading =
	| { readonly kind: "store"; readonly storeId: CostScope }
	| { readonly kind: "unknown_store" | "ambiguous_store" };

function readStore(code: string, context: CostImportContext): StoreReading {
	if (code === "") return { kind: "store", storeId: context.scope };
	const wanted = code.toUpperCase();
	const matches = context.stores.filter(
		(store) => store.code?.trim().toUpperCase() === wanted,
	);
	const [only] = matches;
	if (only === undefined) return { kind: "unknown_store" };
	if (matches.length > 1) return { kind: "ambiguous_store" };
	return { kind: "store", storeId: only.id };
}

function scopeItemKey(storeId: CostScope, itemExternalId: string): string {
	return `${storeId ?? ""}|${itemExternalId}`;
}

function costKey(
	storeId: CostScope,
	itemExternalId: string,
	effectiveFrom: IsoDate,
): string {
	return `${scopeItemKey(storeId, itemExternalId)}|${effectiveFrom}`;
}

interface SavedCosts {
	readonly hasOwnCost: (storeId: CostScope, itemExternalId: string) => boolean;
	readonly amountAt: (key: string) => number | undefined;
}

function savedCostsOf(rows: readonly ItemCostRow[]): SavedCosts {
	const scopes = new Set<string>();
	const amounts = new Map<string, number>();
	for (const row of rows) {
		scopes.add(scopeItemKey(row.storeId, row.itemExternalId));
		amounts.set(
			costKey(row.storeId, row.itemExternalId, row.effectiveFrom),
			row.costAmount,
		);
	}
	return {
		hasOwnCost: (storeId, itemExternalId) =>
			scopes.has(scopeItemKey(storeId, itemExternalId)),
		amountAt: (key) => amounts.get(key),
	};
}

type DateResult =
	| { readonly date: IsoDate; readonly issue: null }
	| { readonly date: null; readonly issue: CostImportIssue };

function blankDate(
	storeId: CostScope,
	itemExternalId: string,
	saved: SavedCosts,
): DateResult {
	if (saved.hasOwnCost(storeId, itemExternalId)) {
		return { date: null, issue: { key: "dateBlank" } };
	}
	if (storeId !== null && saved.hasOwnCost(null, itemExternalId)) {
		return { date: null, issue: { key: "dateBlankInherited" } };
	}
	return { date: FIRST_BUSINESS_DATE, issue: null };
}

function readDate(
	text: string,
	storeId: CostScope,
	itemExternalId: string,
	dates: CostDateReading,
	saved: SavedCosts,
	today: IsoDate,
): DateResult {
	if (text === "") return blankDate(storeId, itemExternalId, saved);
	if (dates.rejected !== null && evidenceOf(text) === dates.rejected) {
		return { date: null, issue: { key: "dateOtherOrder" } };
	}
	const date = parseDateCell(text, dates.used);
	if (date === null) return { date: null, issue: { key: "dateUnreadable" } };
	const bounds = readDateDraft(date, today);
	if (bounds?.key === "dateRange") {
		return {
			date: null,
			issue: {
				key: "dateRange",
				min: String(bounds.min) as IsoDate,
				max: String(bounds.max) as IsoDate,
			},
		};
	}
	if (bounds !== null) return { date: null, issue: { key: "dateUnreadable" } };
	return { date, issue: null };
}

type RowShown = Omit<CostImportRow, "outcome">;

interface Problem {
	readonly outcome: CostImportOutcome;
	readonly issue: CostImportIssue | null;
}

interface Prepared {
	readonly shown: RowShown;
	readonly problem: Problem | null;
}

interface Resolved {
	readonly row: CostImportRow;
	readonly key: string | null;
}

function shownRow(line: CostFileLine): RowShown {
	return {
		line: line.line,
		itemExternalId: unneutralised(line.cells.ma_mon),
		fileItemName: line.cells.ten_mon.trim(),
		item: null,
		storeCode: unneutralised(line.cells.ma_cua_hang),
		storeId: undefined,
		costText: line.cells.gia_von.trim(),
		costAmount: null,
		dateText: line.cells.tu_ngay.trim(),
		effectiveFrom: null,
		issue: null,
		listPrice: null,
		usedLine: null,
		replacesLines: [],
	};
}

function problemOf(
	shown: RowShown,
	store: StoreReading,
	cost: CostReading,
	context: CostImportContext,
): Problem | null {
	if (shown.item === null) return { outcome: "unknown_item", issue: null };
	if (store.kind !== "store") return { outcome: store.kind, issue: null };
	if (!context.canWrite(store.storeId)) {
		return { outcome: "out_of_scope", issue: null };
	}
	if (!context.isListed(shown.item.itemExternalId, store.storeId)) {
		return { outcome: "unknown_item", issue: { key: "itemNotListed" } };
	}
	if (cost.issue !== null) {
		return { outcome: "invalid_cost", issue: cost.issue };
	}
	return null;
}

function prepareLine(line: CostFileLine, context: CostImportContext): Prepared {
	const base = shownRow(line);
	const store = readStore(base.storeCode, context);
	const cost = readCostCell(base.costText, context.fractionDigits);
	const shown: RowShown = {
		...base,
		item: context.items.get(base.itemExternalId) ?? null,
		storeId: store.kind === "store" ? store.storeId : undefined,
		costAmount: cost.amount,
	};
	return { shown, problem: problemOf(shown, store, cost, context) };
}

function shownDate(text: string, dates: CostDateReading): IsoDate | null {
	if (text === "") return null;
	if (dates.rejected !== null && evidenceOf(text) === dates.rejected) {
		return null;
	}
	return parseDateCell(text, dates.used);
}

function resolvePrepared(
	{ shown, problem }: Prepared,
	context: CostImportContext,
	dates: CostDateReading,
	saved: SavedCosts,
): Resolved {
	const withShownDate = {
		...shown,
		effectiveFrom: shownDate(shown.dateText, dates),
	};
	const { item, storeId, costAmount } = shown;
	if (
		problem !== null ||
		item === null ||
		storeId === undefined ||
		costAmount === null
	) {
		return {
			row: {
				...withShownDate,
				outcome: problem?.outcome ?? "unknown_item",
				issue: problem?.issue ?? null,
			},
			key: null,
		};
	}
	const date = readDate(
		shown.dateText,
		storeId,
		item.itemExternalId,
		dates,
		saved,
		context.today,
	);
	if (date.issue !== null) {
		return {
			row: { ...withShownDate, outcome: "invalid_date", issue: date.issue },
			key: null,
		};
	}
	const row = { ...shown, effectiveFrom: date.date };
	const key = costKey(storeId, item.itemExternalId, date.date);
	if (saved.amountAt(key) === costAmount) {
		return { row: { ...row, outcome: "unchanged" }, key };
	}
	const listPrice = context.listPriceOf(item.itemExternalId, storeId);
	const above = listPrice !== null && listPrice > 0 && costAmount > listPrice;
	return {
		row: {
			...row,
			outcome: above ? "cost_above_price" : "ok",
			listPrice: above ? listPrice : null,
		},
		key,
	};
}

function withDuplicates(resolved: readonly Resolved[]): CostImportRow[] {
	const linesByKey = new Map<string, number[]>();
	for (const { row, key } of resolved) {
		if (key === null) continue;
		const lines = linesByKey.get(key) ?? [];
		lines.push(row.line);
		linesByKey.set(key, lines);
	}
	return resolved.map(({ row, key }) => {
		const lines = key === null ? undefined : linesByKey.get(key);
		if (lines === undefined || lines.length < 2) return row;
		const used = lines[lines.length - 1] ?? row.line;
		if (row.line === used) {
			return {
				...row,
				replacesLines: lines.filter((line) => line !== used),
			};
		}
		return {
			...row,
			outcome: "duplicate_in_file",
			issue: null,
			listPrice: null,
			usedLine: used,
		};
	});
}

function countsOf(
	rows: readonly CostImportRow[],
): Record<CostImportOutcome, number> {
	const counts = Object.fromEntries(
		COST_IMPORT_OUTCOMES.map((outcome) => [outcome, 0]),
	) as Record<CostImportOutcome, number>;
	for (const row of rows) counts[row.outcome] += 1;
	return counts;
}

function isBlank(line: CostFileLine): boolean {
	return line.cells.gia_von.trim() === "" && line.cells.tu_ngay.trim() === "";
}

function changeOf(row: CostImportRow): ItemCostChange[] {
	if (
		!isSavedOutcome(row.outcome) ||
		row.item === null ||
		row.storeId === undefined ||
		row.costAmount === null ||
		row.effectiveFrom === null
	) {
		return [];
	}
	return [
		{
			storeId: row.storeId,
			itemExternalId: row.item.itemExternalId,
			costAmount: row.costAmount,
			effectiveFrom: row.effectiveFrom,
		},
	];
}

export function costImportPreview(
	lines: readonly CostFileLine[],
	chosenOrder: DateOrder,
	context: CostImportContext,
): CostImportPreview {
	const filled = lines.filter((line) => !isBlank(line));
	const prepared = filled.map((line) => prepareLine(line, context));
	const dates = readDateOrder(
		prepared
			.filter((each) => each.problem === null)
			.map((each) => each.shown.dateText)
			.filter((cell) => cell !== ""),
		chosenOrder,
	);
	const saved = savedCostsOf(context.rows);
	const rows = withDuplicates(
		prepared.map((each) => resolvePrepared(each, context, dates, saved)),
	);
	const changes = rows.flatMap(changeOf);
	return {
		rows,
		blankCount: lines.length - filled.length,
		blankCodeCount: rows.filter((row) => row.storeCode === "").length,
		changes,
		counts: countsOf(rows),
		tooMany: changes.length > COST_IMPORT_MAX_ROWS,
		dates,
	};
}

export function shownImportRows(
	rows: readonly CostImportRow[],
): CostImportRow[] {
	return rows.filter(
		(row) =>
			row.outcome !== "unchanged" ||
			row.replacesLines.length > 0 ||
			row.usedLine !== null,
	);
}

export function costImportItemsOf(
	entries: readonly ItemEntry[],
	sales: readonly CostSale[],
	rows: readonly ItemCostRow[],
): Map<string, CostImportItem> {
	const items = new Map<string, CostImportItem>();
	const add = (item: CostImportItem) => {
		if (!items.has(item.itemExternalId)) items.set(item.itemExternalId, item);
	};
	const ordered = [...entries].sort(
		(left, right) =>
			Number(right.inCatalogue) - Number(left.inCatalogue) ||
			Number(right.active) - Number(left.active),
	);
	for (const entry of ordered) add(entry);
	for (const sale of sales) add(sale);
	for (const row of rows) {
		add({
			itemExternalId: row.itemExternalId,
			name: row.itemExternalId,
			sizeLabel: null,
		});
	}
	return items;
}

export interface CostImportSources {
	readonly scope: CostScope;
	readonly stores: readonly CostImportStore[];
	readonly membership: Membership | null | undefined;
	readonly entries: readonly ItemEntry[];
	readonly sales: readonly CostSale[];
	readonly rows: readonly ItemCostRow[];
	readonly today: IsoDate;
	readonly fractionDigits: number;
}

function lowestPrice(entries: readonly ItemEntry[]): number | null {
	const prices = entries
		.map((entry) => entry.listPrice)
		.filter((price): price is number => price !== null && price > 0);
	return prices.length === 0 ? null : Math.min(...prices);
}

function groupedByItem(
	entries: readonly ItemEntry[],
): Map<string, ItemEntry[]> {
	const grouped = new Map<string, ItemEntry[]>();
	for (const entry of entries) {
		const known = grouped.get(entry.itemExternalId) ?? [];
		known.push(entry);
		grouped.set(entry.itemExternalId, known);
	}
	return grouped;
}

export function costImportContextOf({
	scope,
	stores,
	membership,
	entries,
	sales,
	rows,
	today,
	fractionDigits,
}: CostImportSources): CostImportContext {
	const entriesOf = groupedByItem(entries);
	const catalogueOf = groupedByItem(
		entries.filter((entry) => entry.inCatalogue && !entry.isModifier),
	);
	const sold = new Set(sales.map((sale) => sale.itemExternalId));
	const costed = new Set(
		rows.map((row) => scopeItemKey(row.storeId, row.itemExternalId)),
	);
	const accountOf = new Map(
		stores.map((store) => [store.id, store.posAccountId]),
	);
	const accountEntries = (
		candidates: readonly ItemEntry[],
		storeId: CostScope,
	): readonly ItemEntry[] => {
		if (storeId === null) return candidates;
		const account = accountOf.get(storeId);
		return candidates.filter((entry) => entry.posAccountId === account);
	};
	return {
		scope,
		stores,
		canWrite: (storeId) =>
			settingsAccess("manualData", membership, storeId).canWrite,
		items: costImportItemsOf(entries, sales, rows),
		isListed: (itemExternalId, storeId) =>
			accountEntries(catalogueOf.get(itemExternalId) ?? [], storeId).length >
				0 ||
			((storeId === null || storeId === scope) && sold.has(itemExternalId)) ||
			costed.has(scopeItemKey(storeId, itemExternalId)),
		listPriceOf: (itemExternalId, storeId) => {
			const candidates = entriesOf.get(itemExternalId) ?? [];
			return (
				lowestPrice(
					storeId === null ? [] : accountEntries(candidates, storeId),
				) ?? lowestPrice(candidates)
			);
		},
		rows,
		today,
		fractionDigits,
	};
}
