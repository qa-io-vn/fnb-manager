import type { PackLanguage } from "../pack/request.js";
import type { PackCell } from "../pack/schema.js";
import type { PackUnit } from "../pack/units.js";

export interface NumberReading {
	readonly value: number;
	readonly unit: number;
}

export type LineTokenKind = "number" | "word" | "masked" | "citation";

export interface LineToken {
	readonly kind: LineTokenKind;
	readonly start: number;
	readonly end: number;
	readonly text: string;
	readonly readings: readonly NumberReading[];
}

export interface TextSpan {
	readonly start: number;
	readonly end: number;
}

interface Mantissa {
	readonly digits: string;
	readonly fractionDigits: number;
}

interface Numeric {
	readonly end: number;
	readonly mantissas: readonly Mantissa[];
}

interface Units {
	readonly end: number;
	readonly shift: number;
}

export const RELATIVE_TOLERANCE = 1e-9;

const THOUSANDS_SEPARATORS: Readonly<Record<PackLanguage, string>> = {
	vi: ". \u00A0\u202F",
	en: ",",
};

const DECIMAL_MARK: Readonly<Record<PackLanguage, string>> = {
	vi: ",",
	en: ".",
};

const GAP = "[ \\u00A0\\u202F]?";
const WORD_END = "(?![\\p{L}\\p{N}\\p{M}_])";
const LEFT = "(?<![\\p{L}\\p{N}\\p{M}_])(?<![0-9][.,:/-])";
const RIGHT = "(?![\\p{L}\\p{N}\\p{M}_])(?![.,:/-][0-9])";

const SCALE_WORDS = new RegExp(
	`${GAP}(nghìn|ngàn|thousand|triệu|million|tỷ|tỉ|billion|tr|mn|bn|k|m)${WORD_END}`,
	"iuy",
);
const CURRENCY_WORDS = new RegExp(`${GAP}(đồng|vnđ|vnd|đ|₫)${WORD_END}`, "iuy");
const PERCENT_WORDS = new RegExp(
	`${GAP}(điểm phần trăm|điểm ?%|điểm|phần trăm|percentage points?|per ?cent|points?|pts|pp|p\\.p\\.|%)${WORD_END}`,
	"iuy",
);

const SCALE_SHIFTS: Readonly<Record<string, number>> = {
	nghìn: 3,
	ngàn: 3,
	thousand: 3,
	k: 3,
	triệu: 6,
	million: 6,
	tr: 6,
	mn: 6,
	m: 6,
	tỷ: 9,
	tỉ: 9,
	billion: 9,
	bn: 9,
};

const PERCENT_SHIFT = -2;

const HOUR = "[0-9]{1,2}(?::[0-9]{2}|h(?:[0-9]{2})?)?";
const HOUR_MARK = /[:h]|giờ|am|pm/iu;

const ORDINAL_WORDS =
	"tháng|tuần|ngày|thứ|quý|month|week|day|quarter|sáng kiến|initiative|mục|section";

const MASKS: readonly RegExp[] = [
	new RegExp(`${LEFT}[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}${RIGHT}`, "gu"),
	new RegExp(`${LEFT}[0-9]{4}-w[0-9]{1,2}${RIGHT}`, "giu"),
	new RegExp(`${LEFT}[0-9]{4}-[0-9]{1,2}${RIGHT}`, "gu"),
	new RegExp(`${LEFT}[0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}${RIGHT}`, "gu"),
	new RegExp(`${LEFT}[0-9]{1,2}/[0-9]{1,4}${RIGHT}`, "gu"),
	new RegExp(`${LEFT}[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?${RIGHT}`, "gu"),
	new RegExp(`${LEFT}[0-9]{1,2}h(?:[0-9]{2})?${RIGHT}`, "giu"),
	new RegExp(`${LEFT}[0-9]{1,2}(?::[0-9]{2})? ?(?:am|pm)${RIGHT}`, "giu"),
	new RegExp(`${LEFT}(?:19|20)[0-9]{2}${RIGHT}`, "gu"),
	new RegExp(
		`(?<=(?<![\\p{L}\\p{N}\\p{M}_])(?:${ORDINAL_WORDS})[ \\u00A0])[0-9]{1,2}${RIGHT}`,
		"giu",
	),
];

const HOUR_RANGE = new RegExp(
	`${LEFT}${HOUR} ?[–—-] ?${HOUR}(?: ?(?:giờ|am|pm))?${RIGHT}`,
	"giu",
);

const LIST_NUMBER = /^(\s*(?:[-*+]\s+)?)([0-9]{1,3})[.)](?=\s|$)/u;

const WORD_CHAR = /[\p{L}\p{N}\p{M}_]/u;

function isDigit(character: string | undefined): boolean {
	return character !== undefined && character >= "0" && character <= "9";
}

function isWordChar(character: string | undefined): boolean {
	return character !== undefined && WORD_CHAR.test(character);
}

function digitRunEnd(text: string, from: number): number {
	let end = from;
	while (isDigit(text[end])) end += 1;
	return end;
}

function scanNumeric(
	text: string,
	start: number,
	language: PackLanguage,
): Numeric {
	const thousands = THOUSANDS_SEPARATORS[language];
	const decimal = DECIMAL_MARK[language];
	const integerEnd = digitRunEnd(text, start);
	const groups = [text.slice(start, integerEnd)];
	let position = integerEnd;
	let separator: string | null = null;
	if (integerEnd - start <= 3) {
		for (;;) {
			const character = text[position];
			if (
				character !== undefined &&
				thousands.includes(character) &&
				(separator === null || separator === character) &&
				digitRunEnd(text, position + 1) === position + 4
			) {
				separator = character;
				groups.push(text.slice(position + 1, position + 4));
				position += 4;
			} else {
				break;
			}
		}
	}
	let fraction = "";
	if (text[position] === decimal && isDigit(text[position + 1])) {
		const fractionEnd = digitRunEnd(text, position + 1);
		fraction = text.slice(position + 1, fractionEnd);
		position = fractionEnd;
	}
	if (
		(text[position] === "." || text[position] === ",") &&
		isDigit(text[position + 1])
	) {
		let end = position;
		while (
			isDigit(text[end]) ||
			((text[end] === "." || text[end] === ",") && isDigit(text[end + 1]))
		) {
			end += 1;
		}
		return { end, mantissas: [] };
	}
	const integer = groups.join("");
	const mantissas: Mantissa[] = [
		{ digits: integer + fraction, fractionDigits: fraction.length },
	];
	if (
		groups.length === 2 &&
		fraction === "" &&
		(separator === "." || separator === ",")
	) {
		mantissas.push({ digits: integer, fractionDigits: 3 });
	}
	if (groups.length === 1 && integer.length <= 3 && fraction.length === 3) {
		mantissas.push({ digits: integer + fraction, fractionDigits: 0 });
	}
	return { end: position, mantissas };
}

function stickyMatch(pattern: RegExp, text: string, from: number) {
	pattern.lastIndex = from;
	return pattern.exec(text);
}

function scanUnits(text: string, from: number): Units {
	let end = from;
	let shift = 0;
	const scale = stickyMatch(SCALE_WORDS, text, end);
	if (scale !== null) {
		const word = (scale[1] ?? "").toLowerCase();
		shift += Object.hasOwn(SCALE_SHIFTS, word) ? (SCALE_SHIFTS[word] ?? 0) : 0;
		end += scale[0].length;
	}
	const currency = stickyMatch(CURRENCY_WORDS, text, end);
	if (currency !== null) end += currency[0].length;
	const percent = stickyMatch(PERCENT_WORDS, text, end);
	if (percent !== null) {
		shift += PERCENT_SHIFT;
		end += percent[0].length;
	}
	return { end, shift };
}

function scaled(value: number, exponent: number): number {
	return exponent >= 0 ? value * 10 ** exponent : value / 10 ** -exponent;
}

function readingOf(mantissa: Mantissa, shift: number): NumberReading {
	const digits = mantissa.digits.replace(/^0+(?=[0-9])/, "");
	let unitExponent = -mantissa.fractionDigits;
	if (mantissa.fractionDigits === 0 && !/^0+$/.test(digits)) {
		unitExponent = digits.length - digits.replace(/0+$/, "").length;
	}
	return {
		value: scaled(Number(digits), shift - mantissa.fractionDigits),
		unit: scaled(1, unitExponent + shift),
	};
}

function wordEnd(text: string, from: number): number {
	let end = from;
	while (isWordChar(text[end])) end += 1;
	return end;
}

function numberToken(
	text: string,
	start: number,
	language: PackLanguage,
): LineToken {
	const numeric = scanNumeric(text, start, language);
	const units = scanUnits(text, numeric.end);
	if (units.end === numeric.end && isWordChar(text[numeric.end])) {
		const end = wordEnd(text, start);
		return {
			kind: "word",
			start,
			end,
			text: text.slice(start, end),
			readings: [],
		};
	}
	return {
		kind: "number",
		start,
		end: units.end,
		text: text.slice(start, units.end),
		readings: numeric.mantissas.map((mantissa) =>
			readingOf(mantissa, units.shift),
		),
	};
}

function blanked(text: string, spans: readonly TextSpan[]): string {
	let result = text;
	for (const span of spans) {
		result =
			result.slice(0, span.start) +
			" ".repeat(span.end - span.start) +
			result.slice(span.end);
	}
	return result;
}

export function maskedSpans(text: string): readonly TextSpan[] {
	const spans: TextSpan[] = [];
	for (const pattern of MASKS) {
		for (const match of text.matchAll(pattern)) {
			spans.push({ start: match.index, end: match.index + match[0].length });
		}
	}
	for (const match of text.matchAll(HOUR_RANGE)) {
		if (HOUR_MARK.test(match[0])) {
			spans.push({ start: match.index, end: match.index + match[0].length });
		}
	}
	const list = LIST_NUMBER.exec(text);
	if (list !== null) {
		const start = (list[1] ?? "").length;
		spans.push({ start, end: start + (list[2] ?? "").length + 1 });
	}
	spans.sort((left, right) => left.start - right.start || right.end - left.end);
	const merged: TextSpan[] = [];
	for (const span of spans) {
		const last = merged[merged.length - 1];
		if (last !== undefined && span.start < last.end) {
			merged[merged.length - 1] = {
				start: last.start,
				end: Math.max(last.end, span.end),
			};
		} else {
			merged.push(span);
		}
	}
	return merged;
}

export function tokenizeLine(
	text: string,
	citations: readonly TextSpan[],
	language: PackLanguage,
): readonly LineToken[] {
	const citationAt = new Map(citations.map((span) => [span.start, span]));
	const maskAt = new Map(
		maskedSpans(blanked(text, citations)).map((span) => [span.start, span]),
	);
	const tokens: LineToken[] = [];
	let position = 0;
	while (position < text.length) {
		const citation = citationAt.get(position);
		if (citation !== undefined) {
			tokens.push({
				kind: "citation",
				start: citation.start,
				end: citation.end,
				text: text.slice(citation.start, citation.end),
				readings: [],
			});
			position = citation.end;
			continue;
		}
		const mask = maskAt.get(position);
		if (mask !== undefined) {
			tokens.push({
				kind: "masked",
				start: mask.start,
				end: mask.end,
				text: text.slice(mask.start, mask.end),
				readings: [],
			});
			position = mask.end;
			continue;
		}
		const character = text[position];
		if (isDigit(character) && !isWordChar(text[position - 1])) {
			const token = numberToken(text, position, language);
			tokens.push(token);
			position = token.end;
			continue;
		}
		if (isWordChar(character)) {
			const end = wordEnd(text, position);
			tokens.push({
				kind: "word",
				start: position,
				end,
				text: text.slice(position, end),
				readings: [],
			});
			position = end;
			continue;
		}
		position += 1;
	}
	return tokens;
}

export function readNumberText(
	text: string,
	language: PackLanguage,
): readonly NumberReading[] | null {
	const [first] = tokenizeLine(text, [], language);
	return first !== undefined &&
		first.kind === "number" &&
		first.start === 0 &&
		first.end === text.length
		? first.readings
		: null;
}

export function jsonNumberReading(value: number): NumberReading {
	const absolute = Math.abs(value);
	const match = /^([0-9]+)(?:\.([0-9]+))?(?:e([+-][0-9]+))?$/.exec(
		String(absolute),
	);
	if (match === null) return { value: absolute, unit: 0 };
	const fraction = match[2] ?? "";
	return readingOf(
		{ digits: (match[1] ?? "") + fraction, fractionDigits: fraction.length },
		Number(match[3] ?? "0"),
	);
}

export function readingMatches(reading: NumberReading, value: number): boolean {
	const target = Math.abs(value);
	return (
		Math.abs(reading.value - target) <=
		reading.unit / 2 + RELATIVE_TOLERANCE * Math.max(reading.value, target)
	);
}

export function cellCandidates(cell: PackCell, unit: PackUnit): number[] {
	if (typeof cell !== "number" || !Number.isFinite(cell)) return [];
	return unit === "money_thousands" ? [cell, cell * 1000] : [cell];
}

export function writtenMatchesCell(
	readings: readonly NumberReading[],
	cell: PackCell,
	unit: PackUnit,
): boolean {
	const candidates = cellCandidates(cell, unit);
	return readings.some((reading) =>
		candidates.some((candidate) => readingMatches(reading, candidate)),
	);
}
