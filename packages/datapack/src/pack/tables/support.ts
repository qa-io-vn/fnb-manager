import type { ReportFunctionName, ReportRow, ThemeRow } from "@fnb/reports";
import type { KpiWindows, PackCalendar, PackWindowName } from "../calendar.js";
import { compareCodeUnits } from "../canonical.js";
import type { PackScope, ScopeCoverage } from "../coverage.js";
import type { ResolvedPackRequest } from "../request.js";
import type { StoreProfileRow } from "../resolve.js";
import {
	ALL_SCOPE,
	type PackCell,
	type PackColumn,
	type PackTable,
} from "../schema.js";
import {
	isNumericUnit,
	type PackGrain,
	type PackUnit,
	roundToUnit,
} from "../units.js";
import { TABLE_TEXT, type TableId } from "./text.js";

export type CellValue = number | string | boolean | null | undefined;

export type SettingsRow = ThemeRow<"report_settings_of">;

export interface PackResults {
	rows<N extends ReportFunctionName>(
		key: string,
		name: N,
	): readonly ReportRow<N>[];
}

export interface TableContext {
	readonly request: ResolvedPackRequest;
	readonly calendar: PackCalendar;
	readonly windows: KpiWindows;
	readonly scopes: readonly PackScope[];
	readonly profiles: readonly StoreProfileRow[];
	readonly results: PackResults;
	readonly coverage: ScopeCoverage;
}

export interface TableSpec {
	readonly grain: PackGrain;
	readonly window: PackWindowName | null;
	readonly columns: readonly PackColumn[];
}

export type PackRows = Record<string, PackCell[]>;

export function resultsOf(
	entries: ReadonlyMap<string, readonly unknown[]>,
): PackResults {
	return {
		rows<N extends ReportFunctionName>(key: string, _name: N) {
			const rows = entries.get(key);
			if (rows === undefined) {
				throw new Error(`the pack call ${key} has no result`);
			}
			return rows as readonly ReportRow<N>[];
		},
	};
}

export function columns(
	entries: readonly (readonly [string, PackUnit])[],
): readonly PackColumn[] {
	return entries.map(([name, unit]) => ({ name, unit }));
}

function cellOf(value: CellValue, unit: PackUnit, currency: string): PackCell {
	if (value === null || value === undefined) return null;
	if (typeof value === "number") {
		if (!isNumericUnit(unit)) {
			throw new Error(`a number in the ${unit} column`);
		}
		return roundToUnit(value, unit, currency);
	}
	return value;
}

export function packRow(
	spec: Pick<TableSpec, "columns">,
	values: readonly CellValue[],
	currency: string,
): PackCell[] {
	if (values.length !== spec.columns.length) {
		throw new Error(
			`${values.length} values for ${spec.columns.length} columns`,
		);
	}
	return spec.columns.map((column, index) =>
		cellOf(values[index], column.unit, currency),
	);
}

export function packTable(
	id: TableId,
	context: Pick<TableContext, "request">,
	spec: TableSpec,
	rows: PackRows,
): PackTable {
	const text = TABLE_TEXT[id][context.request.language];
	return {
		title: text.title,
		grain: spec.grain,
		window: spec.window,
		notes: text.notes,
		columns: spec.columns.map((column) => ({ ...column })),
		rows,
	};
}

export function rankKey(scope: string, index: number, count: number): string {
	const width = Math.max(2, String(count).length);
	return `${scope}/r${String(index + 1).padStart(width, "0")}`;
}

export function byText(
	left: string | null | undefined,
	right: string | null | undefined,
): number {
	if (left === right) return 0;
	if (left === null || left === undefined) return 1;
	if (right === null || right === undefined) return -1;
	return compareCodeUnits(left, right);
}

export function byNumberDescending(
	left: number | null | undefined,
	right: number | null | undefined,
): number {
	const one = left ?? Number.NEGATIVE_INFINITY;
	const two = right ?? Number.NEGATIVE_INFINITY;
	return one === two ? 0 : one > two ? -1 : 1;
}

export function storeScopeLabel(
	context: Pick<TableContext, "request">,
	storeId: string | null,
): string | null {
	if (storeId === null) return ALL_SCOPE;
	const store = context.request.stores.find((entry) => entry.id === storeId);
	return store === undefined ? null : store.label;
}

export function scopeOfStoreLabel(
	context: Pick<TableContext, "request">,
	label: string,
): string {
	return context.request.stores.length === 1 ? ALL_SCOPE : label;
}

export function scopeByLabel(
	context: Pick<TableContext, "scopes">,
	label: string,
): PackScope | undefined {
	return context.scopes.find((scope) => scope.label === label);
}

export function sumOf(values: readonly (number | null | undefined)[]): number {
	let total = 0;
	for (const value of values) total += value ?? 0;
	return total;
}

export function ratioOf(
	numerator: number | null | undefined,
	denominator: number | null | undefined,
): number | null {
	if (
		numerator === null ||
		numerator === undefined ||
		denominator === null ||
		denominator === undefined ||
		denominator === 0
	) {
		return null;
	}
	return numerator / denominator;
}
