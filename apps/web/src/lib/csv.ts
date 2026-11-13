export type CsvCell = string | number | null;

export interface CsvColumn {
	key: string;
	label: string;
}

export const UTF8_BOM = "﻿";

const FORMULA_START = /^[=+\-@\t\r]/;

export function neutralisedText(text: string): string {
	return FORMULA_START.test(text) ? `'${text}` : text;
}

function escapeCell(cell: CsvCell): string {
	if (cell === null) return "";
	const text = typeof cell === "number" ? String(cell) : neutralisedText(cell);
	if (/[",;\r\n]/.test(text)) {
		return `"${text.replace(/"/g, '""')}"`;
	}
	return text;
}

export function buildCsv(
	columns: readonly CsvColumn[],
	rows: readonly Readonly<Record<string, CsvCell>>[],
): string {
	const header = columns.map((column) => escapeCell(column.label)).join(",");
	const lines = rows.map((row) =>
		columns.map((column) => escapeCell(row[column.key] ?? null)).join(","),
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
