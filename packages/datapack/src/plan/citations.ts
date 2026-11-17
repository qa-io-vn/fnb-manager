import type { PackLanguage } from "../pack/request.js";
import {
	COLUMN_NAME_PATTERN,
	type DataPack,
	type PackCell,
	ROW_KEY_PATTERN,
	TABLE_ID_PATTERN,
} from "../pack/schema.js";
import type { PackUnit } from "../pack/units.js";
import { type LineToken, type TextSpan, tokenizeLine } from "./numbers.js";

export const CITATION_PATTERN = /\[\[([^[\]\n]*)\]\]/g;
export const ALL_SCOPE = "ALL";
export const CONTEXT_TABLE = "context";
export const MAX_WORDS_BEFORE_CITATION = 3;
export const KPI_TABLE = "kpi";
export const BASELINE_COLUMN = "w28";
export const BAND_LOW_COLUMN = "lo";
export const BAND_HIGH_COLUMN = "hi";

const ONE_STORE_LABEL = "S1";

export interface CitationRef {
	readonly ref: string;
	readonly table: string;
	readonly row: string;
	readonly column: string;
	readonly wellFormed: boolean;
}

export interface ResolvedCell {
	readonly row: string;
	readonly cell: PackCell;
	readonly unit: PackUnit;
}

export interface LineCitation extends TextSpan {
	readonly ref: CitationRef;
	readonly written: LineToken | null;
}

export interface LineAnalysis {
	readonly tokens: readonly LineToken[];
	readonly citations: readonly LineCitation[];
	readonly citedNumbers: ReadonlySet<LineToken>;
}

export function parseCitationRef(inner: string): CitationRef {
	const parts = inner.split(":").map((part) => part.trim());
	const [table = "", row = "", ...rest] = parts;
	const column = rest.join(":");
	const wellFormed =
		parts.length === 3 &&
		TABLE_ID_PATTERN.test(table) &&
		ROW_KEY_PATTERN.test(row) &&
		COLUMN_NAME_PATTERN.test(column);
	return {
		ref: wellFormed ? `${table}:${row}:${column}` : inner.trim(),
		table,
		row,
		column,
		wellFormed,
	};
}

function rowKeyIn(
	rows: Readonly<Record<string, readonly PackCell[]>>,
	row: string,
	storeCount: number,
): string | null {
	if (Object.hasOwn(rows, row)) return row;
	if (
		storeCount === 1 &&
		(row === ONE_STORE_LABEL || row.startsWith(`${ONE_STORE_LABEL}/`))
	) {
		const all = ALL_SCOPE + row.slice(ONE_STORE_LABEL.length);
		if (Object.hasOwn(rows, all)) return all;
	}
	return null;
}

export function resolveCell(
	pack: DataPack,
	table: string,
	row: string,
	column: string,
): ResolvedCell | null {
	if (table === CONTEXT_TABLE || !Object.hasOwn(pack.tables, table)) {
		return null;
	}
	const found = pack.tables[table];
	if (found === undefined) return null;
	const index = found.columns.findIndex((entry) => entry.name === column);
	const key = rowKeyIn(found.rows, row, pack.request.stores.length);
	if (index === -1 || key === null) return null;
	const cells = found.rows[key];
	const unit = found.columns[index]?.unit;
	if (cells === undefined || unit === undefined || index >= cells.length) {
		return null;
	}
	return { row: key, cell: cells[index] ?? null, unit };
}

export function kpiValue(
	pack: DataPack,
	scope: string,
	metricId: string,
	column: string,
): number | null {
	const resolved = resolveCell(pack, KPI_TABLE, `${scope}/${metricId}`, column);
	return resolved !== null &&
		typeof resolved.cell === "number" &&
		Number.isFinite(resolved.cell)
		? resolved.cell
		: null;
}

export function analyzeLine(
	text: string,
	language: PackLanguage,
): LineAnalysis {
	const found: { span: TextSpan; ref: CitationRef }[] = [];
	for (const match of text.matchAll(CITATION_PATTERN)) {
		found.push({
			span: { start: match.index, end: match.index + match[0].length },
			ref: parseCitationRef(match[1] ?? ""),
		});
	}
	const tokens = tokenizeLine(
		text,
		found.map((entry) => entry.span),
		language,
	);
	const citations: LineCitation[] = [];
	const citedNumbers = new Set<LineToken>();
	let citationIndex = 0;
	tokens.forEach((token, index) => {
		if (token.kind !== "citation") return;
		const entry = found[citationIndex];
		citationIndex += 1;
		if (entry === undefined) return;
		let written: LineToken | null = null;
		let words = 0;
		for (let back = index - 1; back >= 0; back -= 1) {
			const previous = tokens[back];
			if (previous === undefined || previous.kind === "citation") break;
			if (previous.kind === "number") {
				written = previous;
				break;
			}
			words += 1;
			if (words > MAX_WORDS_BEFORE_CITATION) break;
		}
		if (written !== null) citedNumbers.add(written);
		citations.push({ ...entry.span, ref: entry.ref, written });
	});
	return { tokens, citations, citedNumbers };
}
