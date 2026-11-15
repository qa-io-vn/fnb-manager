export type CsvCell = string | number | null;

export const CSV_DIALECTS = ["comma", "semicolon"] as const;

export type CsvDialect = (typeof CSV_DIALECTS)[number];

export const DEFAULT_CSV_DIALECT: CsvDialect = "comma";

export function isCsvDialect(value: unknown): value is CsvDialect {
	return (
		typeof value === "string" &&
		(CSV_DIALECTS as readonly string[]).includes(value)
	);
}

const SEPARATORS: Readonly<Record<CsvDialect, string>> = {
	comma: ",",
	semicolon: ";",
};

const DECIMAL_MARKS: Readonly<Record<CsvDialect, string>> = {
	comma: ".",
	semicolon: ",",
};

export interface CsvColumn {
	key: string;
	label: string;
}

export const UTF8_BOM = "﻿";

const FORMULA_START = /^[=+\-@\t\r]/;

export function neutralisedText(text: string): string {
	return FORMULA_START.test(text) ? `'${text}` : text;
}

function numberText(value: number, dialect: CsvDialect): string {
	return String(value).replace(".", DECIMAL_MARKS[dialect]);
}

function escapeCell(cell: CsvCell, dialect: CsvDialect): string {
	if (cell === null) return "";
	if (typeof cell === "number") return numberText(cell, dialect);
	const text = neutralisedText(cell);
	if (/[",;\r\n]/.test(text)) {
		return `"${text.replace(/"/g, '""')}"`;
	}
	return text;
}

export function buildCsv(
	columns: readonly CsvColumn[],
	rows: readonly Readonly<Record<string, CsvCell>>[],
	dialect: CsvDialect = DEFAULT_CSV_DIALECT,
): string {
	const separator = SEPARATORS[dialect];
	const header = columns
		.map((column) => escapeCell(column.label, dialect))
		.join(separator);
	const lines = rows.map((row) =>
		columns
			.map((column) => escapeCell(row[column.key] ?? null, dialect))
			.join(separator),
	);
	return `${UTF8_BOM}${[header, ...lines].join("\r\n")}\r\n`;
}

export function downloadTextFile(
	fileName: string,
	content: string,
	mimeType: string,
): void {
	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = fileName;
	anchor.rel = "noopener";
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
