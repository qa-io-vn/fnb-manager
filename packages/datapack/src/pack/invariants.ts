import { isValidIsoDate } from "@fnb/reports";
import { aggregatesOnlyIssues } from "./aggregates.js";
import { TRIM_STEP_IDS } from "./budget.js";
import { calendarOf, PACK_WINDOWS, type PackCalendar } from "./calendar.js";
import {
	type CanonicalValue,
	canonicalJson,
	compareCodeUnits,
} from "./canonical.js";
import { decimalPlaces } from "./decimal.js";
import { estimateTokens, TOKEN_LIMIT } from "./estimate.js";
import { packIdOf } from "./hash.js";
import { type PathSegment, pathText } from "./path.js";
import {
	type DataPack,
	dataPackSchema,
	LIVE_STORE_ID_PATTERN,
	type PackCell,
	type PackTable,
	ROW_KEY_PATTERN,
	rowScope,
	SAMPLE_STORE_ID_PATTERN,
	STORE_LABEL_PATTERN,
} from "./schema.js";
import { isNumericUnit, UNIT_KINDS, unitDigits } from "./units.js";

export interface PackIssue {
	readonly code: string;
	readonly path: string | null;
	readonly detail: string | null;
}

export interface PackValidation {
	readonly valid: boolean;
	readonly pack: DataPack | null;
	readonly issues: readonly PackIssue[];
}

export interface PackParseResult extends PackValidation {
	readonly packId: string | null;
}

export interface PackComparison {
	readonly valid: boolean;
	readonly identical_apart_from_generated_at: boolean;
	readonly pack_id_equal: boolean;
	readonly tables_differing: readonly string[];
}

type JsonRecord = { readonly [key: string]: CanonicalValue };

function issue(
	code: string,
	path: readonly PathSegment[],
	detail: string | null = null,
): PackIssue {
	return { code, path: pathText(path), detail };
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function labelNumber(label: string): number {
	return Number(label.slice(1));
}

function cellIssue(
	cell: PackCell,
	unit: PackTable["columns"][number]["unit"],
	currency: string,
): string | null {
	if (cell === null) return null;
	switch (UNIT_KINDS[unit]) {
		case "text":
			return typeof cell === "string" ? null : "cell_unit";
		case "flag":
			return typeof cell === "boolean" ? null : "cell_unit";
		case "date":
			return typeof cell === "string" && isValidIsoDate(cell)
				? null
				: "cell_unit";
		case "number": {
			if (typeof cell !== "number" || !isNumericUnit(unit)) return "cell_unit";
			const digits = unitDigits(unit, currency);
			return digits !== null && decimalPlaces(cell) > digits
				? "cell_digits"
				: null;
		}
	}
}

function checkTables(pack: DataPack, issues: PackIssue[]): void {
	const labels = new Set(pack.request.stores.map((store) => store.label));
	for (const [tableId, table] of Object.entries(pack.tables)) {
		const at: PathSegment[] = ["tables", tableId];
		const names = new Set<string>();
		table.columns.forEach((column, index) => {
			if (names.has(column.name)) {
				issues.push(
					issue("column_duplicate", [...at, "columns", index], column.name),
				);
			}
			names.add(column.name);
		});
		for (const [rowKey, row] of Object.entries(table.rows)) {
			const rowAt = [...at, "rows", rowKey];
			if (!ROW_KEY_PATTERN.test(rowKey)) issues.push(issue("row_key", rowAt));
			const scope = rowScope(rowKey);
			if (STORE_LABEL_PATTERN.test(scope) && !labels.has(scope)) {
				issues.push(issue("row_scope_unknown", rowAt, scope));
			}
			if (row.length !== table.columns.length) {
				issues.push(
					issue(
						"row_length",
						rowAt,
						`${row.length} cells for ${table.columns.length} columns`,
					),
				);
			}
			row.forEach((cell, index) => {
				const column = table.columns[index];
				if (column === undefined) return;
				const code = cellIssue(cell, column.unit, pack.request.currency);
				if (code !== null) {
					issues.push(issue(code, [...rowAt, index], column.unit));
				}
			});
		}
	}
}

function checkStores(pack: DataPack, issues: PackIssue[]): void {
	const ids = new Set<string>();
	const idPattern = pack.sample
		? SAMPLE_STORE_ID_PATTERN
		: LIVE_STORE_ID_PATTERN;
	pack.request.stores.forEach((store, index) => {
		const at = ["request", "stores", index];
		if (ids.has(store.id)) issues.push(issue("store_duplicate", [...at, "id"]));
		ids.add(store.id);
		if (!idPattern.test(store.id)) {
			issues.push(
				issue(
					"sample_ids",
					[...at, "id"],
					pack.sample
						? "a sample pack uses MOCK ids"
						: "a live pack uses UUIDs",
				),
			);
		}
		const previous = pack.request.stores[index - 1];
		if (
			previous !== undefined &&
			labelNumber(previous.label) >= labelNumber(store.label)
		) {
			issues.push(issue("store_order", [...at, "label"], store.label));
		}
	});
}

function checkCalendar(pack: DataPack, issues: PackIssue[]): void {
	const { as_of: asOf, horizon } = pack.request;
	if (!isValidIsoDate(asOf)) {
		issues.push(issue("as_of_invalid", ["request", "as_of"], asOf));
		return;
	}
	let expected: PackCalendar;
	try {
		expected = calendarOf(asOf, horizon);
	} catch (error) {
		issues.push(issue("calendar_unavailable", ["calendar"], messageOf(error)));
		return;
	}
	for (const window of PACK_WINDOWS) {
		const actual = pack.calendar[window];
		const wanted = expected[window];
		if (actual.from !== wanted.from || actual.to !== wanted.to) {
			issues.push(
				issue(
					"calendar_mismatch",
					["calendar", window],
					`${wanted.from}..${wanted.to}`,
				),
			);
		}
	}
}

function checkBudget(pack: DataPack, issues: PackIssue[]): void {
	const { budget } = pack;
	if (budget.limit !== TOKEN_LIMIT) {
		issues.push(
			issue("budget_limit", ["budget", "limit"], String(TOKEN_LIMIT)),
		);
	}
	let last = -1;
	budget.trimmed.forEach((step, index) => {
		const position = TRIM_STEP_IDS.indexOf(step);
		if (position <= last) {
			issues.push(issue("budget_trimmed", ["budget", "trimmed", index], step));
		}
		last = Math.max(last, position);
	});
	const measured = estimateTokens(canonicalJson(pack));
	if (measured !== budget.estimated_tokens) {
		issues.push(
			issue(
				"budget_estimate",
				["budget", "estimated_tokens"],
				`${budget.estimated_tokens} declared, ${measured} measured`,
			),
		);
	}
	if (measured > TOKEN_LIMIT) {
		issues.push(
			issue(
				"budget_over",
				["budget", "estimated_tokens"],
				`${measured} above ${TOKEN_LIMIT}`,
			),
		);
	}
}

export async function checkPackInvariants(
	pack: DataPack,
): Promise<readonly PackIssue[]> {
	const issues: PackIssue[] = [];
	checkTables(pack, issues);
	checkStores(pack, issues);
	checkCalendar(pack, issues);
	checkBudget(pack, issues);
	if ((await packIdOf(pack)) !== pack.pack_id) {
		issues.push(issue("pack_id_mismatch", ["pack_id"]));
	}
	return issues;
}

export async function validatePack(value: unknown): Promise<PackValidation> {
	let text: string;
	let canonical: unknown;
	try {
		text = canonicalJson(value as CanonicalValue);
		canonical = JSON.parse(text);
	} catch (error) {
		return {
			valid: false,
			pack: null,
			issues: [issue("not_json", [], messageOf(error))],
		};
	}
	const parsed = dataPackSchema.safeParse(canonical);
	if (!parsed.success) {
		return {
			valid: false,
			pack: null,
			issues: parsed.error.issues.map((problem) =>
				issue(
					`schema:${problem.code}`,
					problem.path.map((segment) =>
						typeof segment === "number" ? segment : String(segment),
					),
					problem.message,
				),
			),
		};
	}
	const pack = parsed.data;
	if (canonicalJson(pack) !== text) {
		return {
			valid: false,
			pack: null,
			issues: [
				issue(
					"schema:changed",
					[],
					"the schema reader changed the pack, as it does with a key named __proto__",
				),
			],
		};
	}
	const issues = [
		...(await checkPackInvariants(pack)),
		...aggregatesOnlyIssues(pack),
	];
	return { valid: issues.length === 0, pack, issues };
}

function parseJson(text: string): { readonly value: unknown } | null {
	try {
		return { value: JSON.parse(text) };
	} catch {
		return null;
	}
}

function canonicalOrNull(value: unknown): string | null {
	try {
		return canonicalJson(value as CanonicalValue);
	} catch {
		return null;
	}
}

async function recomputedPackId(value: unknown): Promise<string | null> {
	if (!isRecord(value)) return null;
	try {
		return await packIdOf(value);
	} catch {
		return null;
	}
}

export async function parsePack(text: string): Promise<PackParseResult> {
	const parsed = parseJson(text);
	if (parsed === null) {
		return {
			valid: false,
			pack: null,
			issues: [issue("not_json", [], "the text is not JSON")],
			packId: null,
		};
	}
	const validation = await validatePack(parsed.value);
	return { ...validation, packId: await recomputedPackId(parsed.value) };
}

function tablesOf(value: unknown): JsonRecord {
	return isRecord(value) && isRecord(value.tables) ? value.tables : {};
}

function tablesDiffering(left: unknown, right: unknown): string[] {
	const one = tablesOf(left);
	const two = tablesOf(right);
	const ids = new Set([...Object.keys(one), ...Object.keys(two)]);
	return [...ids]
		.filter((id) => {
			const a = Object.hasOwn(one, id) ? canonicalOrNull(one[id]) : null;
			const b = Object.hasOwn(two, id) ? canonicalOrNull(two[id]) : null;
			return a === null || b === null || a !== b;
		})
		.sort(compareCodeUnits);
}

function sameApartFromGeneratedAt(
	left: string,
	right: string,
	one: unknown,
	two: unknown,
): boolean {
	if (!isRecord(one) || !isRecord(two)) return false;
	if (canonicalOrNull(one) !== left || canonicalOrNull(two) !== right) {
		return false;
	}
	const blankOne = canonicalOrNull({ ...one, generated_at: "" });
	return (
		blankOne !== null &&
		blankOne === canonicalOrNull({ ...two, generated_at: "" })
	);
}

export async function comparePackTexts(
	left: string,
	right: string,
): Promise<PackComparison> {
	const [one, two] = await Promise.all([parsePack(left), parsePack(right)]);
	const leftValue = parseJson(left)?.value;
	const rightValue = parseJson(right)?.value;
	return {
		valid: one.valid && two.valid,
		identical_apart_from_generated_at: sameApartFromGeneratedAt(
			left,
			right,
			leftValue,
			rightValue,
		),
		pack_id_equal: one.packId !== null && one.packId === two.packId,
		tables_differing: tablesDiffering(leftValue, rightValue),
	};
}
