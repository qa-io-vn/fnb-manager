import { hasAtMostFractionDigits, type ReportSettingLimit } from "@fnb/reports";
import type { z } from "zod";
import { issueOf, type ValidationIssue } from "./validation";

export interface NumberSeparators {
	readonly group: string;
	readonly decimal: string;
}

const SAMPLE_NUMBER = 12345.6;
const PERCENT_SCALE = 100;
const PERCENT_DIGITS = 2;

export function separatorsOf(locale: string): NumberSeparators {
	const parts = new Intl.NumberFormat(locale).formatToParts(SAMPLE_NUMBER);
	return {
		group: parts.find((part) => part.type === "group")?.value ?? ",",
		decimal: parts.find((part) => part.type === "decimal")?.value ?? ".",
	};
}

export interface NumberTextOptions {
	readonly affixes?: readonly string[];
	readonly grouping?: boolean;
}

const BLANK = "[\\s\\u00a0\\u202f]";
const LOOSE_DECIMAL = /^-?\d+(?:[.,]\d+)?$/;

function escaped(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function withoutAffixes(
	text: string,
	affixes: readonly string[] = [],
): string {
	const longestFirst = [...affixes].sort((a, b) => b.length - a.length);
	let result = text.trim();
	let changed = true;
	while (changed) {
		changed = false;
		for (const affix of longestFirst) {
			if (affix !== "" && result.startsWith(affix)) {
				result = result.slice(affix.length).trim();
				changed = true;
			}
			if (affix !== "" && result.endsWith(affix)) {
				result = result.slice(0, -affix.length).trim();
				changed = true;
			}
		}
	}
	return result;
}

function finiteOrNull(normalized: string): number | null {
	const parsed = Number(normalized);
	return Number.isFinite(parsed) ? parsed : null;
}

export function parseNumberText(
	text: string,
	locale: string,
	{ affixes = [], grouping = true }: NumberTextOptions = {},
): number | null {
	const value = withoutAffixes(text, affixes);
	if (value === "") return null;
	if (!grouping) {
		return LOOSE_DECIMAL.test(value)
			? finiteOrNull(value.replace(",", "."))
			: null;
	}
	const { group, decimal } = separatorsOf(locale);
	const groupMark = `${escaped(group)}|${BLANK}`;
	const fraction = `(?:${escaped(decimal)}\\d+)?`;
	const grouped = new RegExp(
		`^-?[1-9]\\d{0,2}(${groupMark})\\d{3}(?:\\1\\d{3})*${fraction}$`,
	);
	const plain = new RegExp(`^-?\\d+${fraction}$`);
	if (grouped.test(value)) {
		return finiteOrNull(
			value.replace(new RegExp(groupMark, "g"), "").replace(decimal, "."),
		);
	}
	return plain.test(value) ? finiteOrNull(value.replace(decimal, ".")) : null;
}

export function formatNumberText(
	value: number,
	locale: string,
	fractionDigits: number,
	grouping = true,
): string {
	return new Intl.NumberFormat(locale, {
		maximumFractionDigits: fractionDigits,
		useGrouping: grouping,
	}).format(value);
}

export function reformatNumberText(
	text: string,
	locale: string,
	fractionDigits: number,
	options: NumberTextOptions = {},
): string | null {
	const value = parseNumberText(text, locale, options);
	if (value === null || !hasAtMostFractionDigits(value, fractionDigits)) {
		return null;
	}
	return formatNumberText(value, locale, fractionDigits, options.grouping);
}

export interface NumberDraft {
	readonly value: number | null;
	readonly issue: ValidationIssue | null;
}

export function readNumberDraft(
	text: string,
	locale: string,
	schema: z.ZodType,
	{
		required = true,
		...options
	}: NumberTextOptions & { readonly required?: boolean } = {},
): NumberDraft {
	if (withoutAffixes(text, options.affixes) === "") {
		return {
			value: null,
			issue: required ? { key: "required" } : null,
		};
	}
	const value = parseNumberText(text, locale, options);
	if (value === null) return { value: null, issue: { key: "number" } };
	return { value, issue: issueOf(schema, value) };
}

function roundTo(value: number, fractionDigits: number): number {
	return Number(value.toFixed(fractionDigits));
}

export function percentLimitOf(
	fractionLimit: ReportSettingLimit,
): ReportSettingLimit {
	const fractionDigits = Math.max(
		0,
		fractionLimit.fractionDigits - PERCENT_DIGITS,
	);
	return {
		min: roundTo(fractionLimit.min * PERCENT_SCALE, fractionDigits),
		max: roundTo(fractionLimit.max * PERCENT_SCALE, fractionDigits),
		fractionDigits,
	};
}

export function fractionToPercent(
	fraction: number,
	fractionDigits: number,
): number {
	return roundTo(
		fraction * PERCENT_SCALE,
		Math.max(0, fractionDigits - PERCENT_DIGITS),
	);
}

export function percentToFraction(
	percent: number,
	fractionDigits: number,
): number {
	return roundTo(percent / PERCENT_SCALE, fractionDigits);
}
