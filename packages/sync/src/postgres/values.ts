import { stripNul, toJson } from "../json.js";
import type { JsonValue } from "../rows.js";

export type SqlValue = string | number | boolean | null | JsonValue;
export type SqlRow = Record<string, SqlValue>;

const PARAMETER_BUDGET = 30_000;

export function jsonParameter(value: JsonValue | null): SqlValue {
	return typeof value === "string" ? JSON.stringify(value) : value;
}

function toSqlValue(value: unknown): JsonValue | null {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value === "string") {
		return stripNul(value);
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	return toJson(value);
}

function fieldOf(row: object, column: string): unknown {
	return Object.getOwnPropertyDescriptor(row, column)?.value;
}

export function toSqlRow(
	row: object,
	columns: readonly string[],
	jsonColumns: ReadonlySet<string> = new Set(["raw"]),
): SqlRow {
	return Object.fromEntries(
		columns.map((column) => {
			const value = toSqlValue(fieldOf(row, column));
			return [column, jsonColumns.has(column) ? jsonParameter(value) : value];
		}),
	);
}

export function chunkRows<T>(rows: readonly T[], columnCount: number): T[][] {
	const size = Math.max(
		1,
		Math.floor(PARAMETER_BUDGET / Math.max(1, columnCount)),
	);
	const chunks: T[][] = [];
	for (let start = 0; start < rows.length; start += size) {
		chunks.push(rows.slice(start, start + size));
	}
	return chunks;
}

export function isoOrNull(value: unknown): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	return value instanceof Date ? value.toISOString() : String(value);
}

export function excludedAssignments(columns: readonly string[]): string {
	return columns.map((column) => `${column} = excluded.${column}`).join(", ");
}

export function columnTuple(alias: string, columns: readonly string[]): string {
	return `(${columns.map((column) => `${alias}.${column}`).join(", ")})`;
}
