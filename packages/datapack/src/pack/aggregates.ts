import type { PackIssue } from "./invariants.js";
import { type PathSegment, pathText } from "./path.js";
import type { DataPack } from "./schema.js";
import { PACK_GRAINS } from "./units.js";

export const MAX_TABLE_ROWS = 400;

const ALLOWED_GRAINS = new Set<string>(PACK_GRAINS);

const ROW_LEVEL_GRAIN =
	/(?:^|-)(?:invoice|line|payment|shift|customer|cashier)s?(?:-|$)/;

const PERSON = "(?:customer|employee|cashier|staff|member|membership|user)s?";

export const FORBIDDEN_COLUMNS: readonly (readonly [string, RegExp])[] = [
	["person", new RegExp(`^${PERSON}$`)],
	[
		"person_name",
		new RegExp(
			`(?:^|_)${PERSON}_(?:full_)?names?(?:_|$)|(?:^|_)full_names?(?:_|$)`,
		),
	],
	["person_id", new RegExp(`(?:^|_)${PERSON}_(?:id|ids|code|codes)(?:_|$)`)],
	["phone", /(?:^|_)(?:phone|phones|mobile|tel|telephone)(?:_|$)/],
	["email", /(?:^|_)e_?mails?(?:_|$)/],
	["receipt", /(?:^|_)receipts?(?:_|$)/],
	["voucher_code", /(?:^|_)voucher_codes?(?:_|$)/],
	["external_id", /(?:^|_)(?:external|ext|pos)(?:_|$)/],
	["invoice_id", /(?:^|_)invoice_(?:id|ids|no|number|code)(?:_|$)/],
	["shift_id", /(?:^|_)shift_(?:id|ids|no|number|code|name|names)(?:_|$)/],
	["note", /(?:^|_)notes?(?:_|$)/],
	["reference", /(?:^|_)(?:ref|refs|reference|references)(?:_|$)/],
	["address", /(?:^|_)(?:address|addresses|addr)(?:_|$)/],
];

export const PERSONAL_TEXT: readonly (readonly [string, RegExp])[] = [
	["text_email", /[^\s@]{1,64}@[^\s@]+\.[^\s@]+/],
	[
		"text_phone",
		/(?<![\d+]|\d[.,])(?:\+84|84|0)[\s.()-]{0,2}[235789](?:[\s.()-]{0,2}\d){8,9}(?![\s.()-]?\d)/,
	],
	["text_digit_run", /\d{9,}/],
	[
		"text_uuid",
		/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
	],
];

export function personalTextRules(text: string): readonly string[] {
	return PERSONAL_TEXT.filter(([, pattern]) => pattern.test(text)).map(
		([code]) => code,
	);
}

export function forbiddenColumnRule(name: string): string | null {
	return (
		FORBIDDEN_COLUMNS.find(([, pattern]) => pattern.test(name))?.[0] ?? null
	);
}

function issue(
	code: string,
	path: readonly PathSegment[],
	detail: string | null,
): PackIssue {
	return { code, path: pathText(path), detail };
}

function scanText(
	text: string | null,
	path: readonly PathSegment[],
	issues: PackIssue[],
): void {
	if (text === null) return;
	for (const code of personalTextRules(text)) {
		issues.push(issue(code, path, null));
	}
}

function scanNumbers(
	value: unknown,
	path: PathSegment[],
	issues: PackIssue[],
): void {
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			issues.push(issue("number_not_finite", path, String(value)));
		}
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			path.push(index);
			scanNumbers(item, path, issues);
			path.pop();
		});
		return;
	}
	if (typeof value === "object" && value !== null) {
		for (const [key, item] of Object.entries(value)) {
			path.push(key);
			scanNumbers(item, path, issues);
			path.pop();
		}
	}
}

export function aggregatesOnlyIssues(pack: DataPack): readonly PackIssue[] {
	const issues: PackIssue[] = [];
	scanText(pack.request.focus, ["request", "focus"], issues);
	scanText(pack.request.owner_note, ["request", "owner_note"], issues);
	for (const [tableId, table] of Object.entries(pack.tables)) {
		const at = ["tables", tableId];
		if (!ALLOWED_GRAINS.has(table.grain) || ROW_LEVEL_GRAIN.test(table.grain)) {
			issues.push(issue("grain_not_allowed", [...at, "grain"], table.grain));
		}
		table.columns.forEach((column, index) => {
			const rule = forbiddenColumnRule(column.name);
			if (rule !== null) {
				issues.push(
					issue(
						"column_forbidden",
						[...at, "columns", index, "name"],
						`${column.name}: ${rule}`,
					),
				);
			}
		});
		const rowCount = Object.keys(table.rows).length;
		if (rowCount > MAX_TABLE_ROWS) {
			issues.push(
				issue(
					"table_too_long",
					[...at, "rows"],
					`${rowCount} rows, at most ${MAX_TABLE_ROWS}`,
				),
			);
		}
		scanText(table.title, [...at, "title"], issues);
		scanText(table.notes, [...at, "notes"], issues);
		for (const [rowKey, row] of Object.entries(table.rows)) {
			row.forEach((cell, index) => {
				const unit = table.columns[index]?.unit;
				if (typeof cell === "string" && unit !== "date") {
					scanText(cell, [...at, "rows", rowKey, index], issues);
				}
			});
		}
	}
	scanNumbers(pack, [], issues);
	return issues;
}
