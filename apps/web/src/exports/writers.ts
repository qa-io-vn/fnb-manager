import { buildCsv, type CsvCell, type CsvDialect } from "../lib/csv";
import type { ExportCell, ExportRow } from "./columns";
import type { ExportFormat, ExportTableId, MonthKey } from "./plan";

export const EXPORT_FILE_FORMAT = "fnb-export";
export const EXPORT_FILE_VERSION = 1;

const encoder = new TextEncoder();

function csvCell(value: ExportCell): CsvCell {
	if (typeof value === "boolean") return value ? "true" : "false";
	return value;
}

export function csvText(
	columns: readonly string[],
	rows: readonly ExportRow[],
	dialect: CsvDialect,
): string {
	return buildCsv(
		columns.map((key) => ({ key, label: key })),
		rows.map((row) => {
			const cells: Record<string, CsvCell> = {};
			for (const column of columns)
				cells[column] = csvCell(row[column] ?? null);
			return cells;
		}),
		dialect,
	);
}

export interface JsonFileMeta {
	readonly table: ExportTableId;
	readonly store: string | null;
	readonly month: MonthKey;
}

export function jsonText(
	meta: JsonFileMeta,
	columns: readonly string[],
	rows: readonly ExportRow[],
): string {
	const document = {
		format: EXPORT_FILE_FORMAT,
		version: EXPORT_FILE_VERSION,
		table: meta.table,
		store: meta.store,
		month: meta.month,
		columns,
		rows: rows.map((row) => {
			const picked: Record<string, ExportCell> = {};
			for (const column of columns) picked[column] = row[column] ?? null;
			return picked;
		}),
	};
	return `${JSON.stringify(document)}\n`;
}

export interface WriteFileInput {
	readonly format: ExportFormat;
	readonly dialect: CsvDialect;
	readonly meta: JsonFileMeta;
	readonly columns: readonly string[];
	readonly rows: readonly ExportRow[];
}

export function fileBytes(input: WriteFileInput): Uint8Array {
	const text =
		input.format === "csv"
			? csvText(input.columns, input.rows, input.dialect)
			: jsonText(input.meta, input.columns, input.rows);
	return encoder.encode(text);
}
