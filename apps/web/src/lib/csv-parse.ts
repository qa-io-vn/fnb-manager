import { type IsoDate, isIsoDate } from "./business-dates";
import { UTF8_BOM } from "./csv";

export type CsvDelimiter = "," | ";" | "\t";

export type CsvParseError = "unterminatedQuote" | "textAfterQuote";

export type ParsedCsv =
	| {
			readonly ok: true;
			readonly delimiter: CsvDelimiter;
			readonly rows: readonly (readonly string[])[];
	  }
	| {
			readonly ok: false;
			readonly error: CsvParseError;
			readonly line: number;
	  };

const DELIMITERS: readonly CsvDelimiter[] = [",", ";", "\t"];
const QUOTE = '"';

function withoutBom(text: string): string {
	return text.startsWith(UTF8_BOM) ? text.slice(UTF8_BOM.length) : text;
}

function isDelimiter(char: string | undefined): char is CsvDelimiter {
	return char === "," || char === ";" || char === "\t";
}

function isLineBreak(char: string | undefined): boolean {
	return char === "\n" || char === "\r";
}

function headerDelimiterCounts(text: string): Record<CsvDelimiter, number> {
	const counts: Record<CsvDelimiter, number> = { ",": 0, ";": 0, "\t": 0 };
	let inQuotes = false;
	let atFieldStart = true;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (inQuotes) {
			if (char === QUOTE && text[index + 1] === QUOTE) index += 1;
			else if (char === QUOTE) inQuotes = false;
			continue;
		}
		if (isLineBreak(char)) break;
		if (char === QUOTE && atFieldStart) {
			inQuotes = true;
			atFieldStart = false;
		} else if (isDelimiter(char)) {
			counts[char] += 1;
			atFieldStart = true;
		} else {
			atFieldStart = false;
		}
	}
	return counts;
}

export function detectDelimiter(text: string): CsvDelimiter {
	const counts = headerDelimiterCounts(withoutBom(text));
	let best: CsvDelimiter = ",";
	for (const delimiter of DELIMITERS) {
		if (counts[delimiter] > counts[best]) best = delimiter;
	}
	return best;
}

export function parseCsv(input: string): ParsedCsv {
	const text = withoutBom(input);
	const delimiter = detectDelimiter(text);
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let fieldStarted = false;
	let inQuotes = false;
	let quoteClosed = false;
	let line = 1;
	let quoteLine = 1;
	const endField = () => {
		row.push(field);
		field = "";
		fieldStarted = false;
		quoteClosed = false;
	};
	const endLine = () => {
		if (row.length === 0 && !fieldStarted) return;
		endField();
		rows.push(row);
		row = [];
	};
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index] ?? "";
		const startsCrLf = char === "\r" && text[index + 1] === "\n";
		if (inQuotes) {
			if (char === QUOTE && text[index + 1] === QUOTE) {
				field += QUOTE;
				index += 1;
			} else if (char === QUOTE) {
				inQuotes = false;
				quoteClosed = true;
			} else {
				if (isLineBreak(char) && !startsCrLf) line += 1;
				field += char;
			}
		} else if (char === delimiter) {
			endField();
		} else if (isLineBreak(char)) {
			if (startsCrLf) index += 1;
			endLine();
			line += 1;
		} else if (quoteClosed) {
			return { ok: false, error: "textAfterQuote", line: quoteLine };
		} else if (char === QUOTE && !fieldStarted) {
			inQuotes = true;
			fieldStarted = true;
			quoteLine = line;
		} else {
			field += char;
			fieldStarted = true;
		}
	}
	if (inQuotes) {
		return { ok: false, error: "unterminatedQuote", line: quoteLine };
	}
	endLine();
	return { ok: true, delimiter, rows };
}

const UNIT_AT_AN_END = /^(?:₫|vnđ|vnd|đ)|(?:₫|vnđ|vnd|đ)$/gi;
const DIGITS = /^\d+$/;
const BLANK_MARK = " \\u00a0\\u202f";

function groupedBy(marks: string): RegExp {
	return new RegExp(`^[1-9]\\d{0,2}([${marks}])\\d{3}(?:\\1\\d{3})*$`);
}

const GROUPED_WHOLE = groupedBy(`.,${BLANK_MARK}`);
const MARKS = new RegExp(`[.,${BLANK_MARK}]`, "g");

const EXACT_DIGITS = 15;

function wholeDigitsOf(
	text: string,
	grouped: RegExp = GROUPED_WHOLE,
): string | null {
	if (DIGITS.test(text)) return text;
	return grouped.test(text) ? text.replace(MARKS, "") : null;
}

function exactNumber(whole: string | null, fraction = ""): number | null {
	if (whole === null || whole.length + fraction.length > EXACT_DIGITS) {
		return null;
	}
	return Number(fraction === "" ? whole : `${whole}.${fraction}`);
}

function wholeOf(text: string): number | null {
	return exactNumber(wholeDigitsOf(text));
}

function withDecimalMark(text: string, fractionDigits: number): number | null {
	const decimalAt = Math.max(text.lastIndexOf("."), text.lastIndexOf(","));
	if (decimalAt === -1) return null;
	const tail = text.slice(decimalAt + 1);
	if (!DIGITS.test(tail) || tail.length > fractionDigits) return null;
	const otherMark = text[decimalAt] === "." ? "," : ".";
	return exactNumber(
		wholeDigitsOf(
			text.slice(0, decimalAt),
			groupedBy(`${otherMark}${BLANK_MARK}`),
		),
		tail,
	);
}

export function parseMoneyCell(
	text: string,
	fractionDigits: number,
): number | null {
	const value = text.trim().replace(UNIT_AT_AN_END, "").trim();
	if (value === "") return null;
	if (fractionDigits === 0) return wholeOf(value);
	return withDecimalMark(value, fractionDigits) ?? wholeOf(value);
}

export type DateOrder = "dmy" | "mdy";
export type DateOrderOutcome = DateOrder | "conflict" | "unknown";

const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

export function parseDateCell(text: string, order: DateOrder): IsoDate | null {
	const trimmed = text.trim();
	if (isIsoDate(trimmed)) return trimmed;
	const match = SLASH_DATE.exec(trimmed);
	if (match === null) return null;
	const first = Number(match[1]);
	const second = Number(match[2]);
	const [day, month] = order === "dmy" ? [first, second] : [second, first];
	const iso = `${match[3]}-${pad(month)}-${pad(day)}`;
	return isIsoDate(iso) ? iso : null;
}

export function detectDateOrder(cells: readonly string[]): DateOrderOutcome {
	let provesDmy = false;
	let provesMdy = false;
	for (const cell of cells) {
		const readsAsDmy = parseDateCell(cell, "dmy") !== null;
		const readsAsMdy = parseDateCell(cell, "mdy") !== null;
		if (readsAsDmy && !readsAsMdy) provesDmy = true;
		if (readsAsMdy && !readsAsDmy) provesMdy = true;
	}
	if (provesDmy && provesMdy) return "conflict";
	if (provesDmy) return "dmy";
	if (provesMdy) return "mdy";
	return "unknown";
}
