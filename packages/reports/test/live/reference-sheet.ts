import { basename, dirname, resolve } from "node:path";
import { addDays, type IsoDate } from "../../src/index.js";

export class SheetError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SheetError";
	}
}

export type ValueUnit = "amount" | "count" | "share";

export interface SheetValue {
	readonly value: number;
	readonly tolerance: number;
	readonly unit: ValueUnit;
}

export interface PaymentShare {
	readonly label: string;
	readonly share: SheetValue;
}

export type RowKind =
	| { readonly kind: "invoices" }
	| { readonly kind: "net" }
	| { readonly kind: "averageTicket" }
	| { readonly kind: "hourNet"; readonly hour: number }
	| { readonly kind: "hourShare"; readonly from: number; readonly to: number }
	| { readonly kind: "weekendShare" }
	| { readonly kind: "sundayNet" }
	| { readonly kind: "paymentMix" }
	| { readonly kind: "skipped" };

export type ValueRowKind = Exclude<
	RowKind,
	{ readonly kind: "paymentMix" | "skipped" }
>;

export type ReferenceRow =
	| {
			readonly index: number;
			readonly form: "value";
			readonly kind: ValueRowKind;
			readonly cells: readonly SheetValue[];
	  }
	| {
			readonly index: number;
			readonly form: "payment";
			readonly cells: readonly (readonly PaymentShare[])[];
	  }
	| { readonly index: number; readonly form: "skipped" };

export interface DateWindow {
	readonly from: IsoDate;
	readonly to: IsoDate;
}

export interface ReferenceSheet {
	readonly window: DateWindow;
	readonly columns: readonly string[];
	readonly rows: readonly ReferenceRow[];
	readonly hourlyFile: string | null;
}

export interface StoreSeries {
	readonly name: string;
	readonly values: ReadonlyMap<number, SheetValue>;
}

export interface HourlyReference {
	readonly hours: readonly StoreSeries[];
	readonly weekdays: readonly StoreSeries[];
}

export interface TopSeller {
	readonly name: string;
	readonly quantity: SheetValue;
	readonly net: SheetValue;
}

export interface ModifierShare {
	readonly name: string;
	readonly modifierLines: SheetValue;
	readonly lines: SheetValue;
}

export interface MenuChecks {
	readonly store: string;
	readonly window: DateWindow;
	readonly topSellers: readonly TopSeller[];
	readonly modifierDate: IsoDate | null;
	readonly modifierShares: readonly ModifierShare[];
}

export interface StoreName {
	readonly id: string;
	readonly name: string;
}

const MONTHS = [
	"jan",
	"feb",
	"mar",
	"apr",
	"may",
	"jun",
	"jul",
	"aug",
	"sep",
	"oct",
	"nov",
	"dec",
] as const;

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const MILLION = 1_000_000;
const RELATIVE_TOLERANCE = 0.005;
const SHARE_TOLERANCE = 0.01;
const DASH = "[–-]";
const NUMBER = "\\d[\\d,]*(?:\\.\\d+)?";
const DAY_MONTH = "(\\d{1,2})\\s+([A-Za-z]{3})[a-z]*\\.?";

const VALUE_UNITS: Readonly<Record<ValueRowKind["kind"], ValueUnit>> = {
	invoices: "count",
	net: "amount",
	averageTicket: "amount",
	hourNet: "amount",
	hourShare: "share",
	weekendShare: "share",
	sundayNet: "amount",
};

export const REQUIRED_ROW_KINDS: readonly Exclude<
	RowKind["kind"],
	"skipped"
>[] = [
	"invoices",
	"net",
	"averageTicket",
	"hourNet",
	"hourShare",
	"weekendShare",
	"sundayNet",
	"paymentMix",
];

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

function monthOf(name: string): number {
	const index = MONTHS.indexOf(
		name.slice(0, 3).toLowerCase() as (typeof MONTHS)[number],
	);
	if (index === -1) throw new SheetError("a month name cannot be read");
	return index + 1;
}

function isoDate(year: number, month: number, day: number): IsoDate {
	const text = `${year}-${pad(month)}-${pad(day)}`;
	const parsed = new Date(`${text}T00:00:00Z`);
	if (
		Number.isNaN(parsed.getTime()) ||
		parsed.toISOString().slice(0, 10) !== text
	) {
		throw new SheetError("a date does not exist");
	}
	return text;
}

export function windowOf(heading: string): DateWindow {
	const match = new RegExp(
		`${DAY_MONTH}\\s*${DASH}\\s*${DAY_MONTH}\\s+(\\d{4})`,
	).exec(heading);
	if (match === null) throw new SheetError("the window's dates cannot be read");
	const [, fromDay, fromMonth, toDay, toMonth, toYear] = match;
	const startMonth = monthOf(fromMonth ?? "");
	const endMonth = monthOf(toMonth ?? "");
	const endYear = Number(toYear);
	const startYear = startMonth > endMonth ? endYear - 1 : endYear;
	const window = {
		from: isoDate(startYear, startMonth, Number(fromDay)),
		to: isoDate(endYear, endMonth, Number(toDay)),
	};
	if (window.from > window.to) {
		throw new SheetError("the window ends before it starts");
	}
	return window;
}

function decimalsOf(digits: string): number {
	const point = digits.indexOf(".");
	return point === -1 ? 0 : digits.length - point - 1;
}

function numberOf(text: string): number {
	const digits = text.replaceAll(",", "");
	const value = Number(digits);
	if (digits === "" || !Number.isFinite(value)) {
		throw new SheetError("a value cannot be read");
	}
	return value;
}

function tolerated(value: number, unit: number, kind: ValueUnit): SheetValue {
	return {
		value,
		tolerance: Math.max(unit / 2, Math.abs(value) * RELATIVE_TOLERANCE),
		unit: kind,
	};
}

function exactly(suffix: string): RegExp {
	return new RegExp(`^(${NUMBER})${suffix}$`);
}

export function parseSheetValue(text: string, millions = false): SheetValue {
	const cleaned = text.replaceAll("**", "").trim().replace(/^≈\s*/, "");
	const share = exactly("\\s*%").exec(cleaned);
	if (share !== null) {
		return {
			value: numberOf(share[1] ?? "") / 100,
			tolerance: SHARE_TOLERANCE,
			unit: "share",
		};
	}
	const inMillions =
		exactly("\\s*M₫").exec(cleaned) ??
		(millions ? exactly("").exec(cleaned) : null);
	if (inMillions !== null) {
		const digits = (inMillions[1] ?? "").replaceAll(",", "");
		return tolerated(
			numberOf(digits) * MILLION,
			10 ** -decimalsOf(digits) * MILLION,
			"amount",
		);
	}
	const dong = exactly("\\s*₫").exec(cleaned);
	if (dong !== null) {
		const digits = (dong[1] ?? "").replaceAll(",", "");
		return tolerated(numberOf(digits), 10 ** -decimalsOf(digits), "amount");
	}
	const count = /^(\d[\d,]*)$/.exec(cleaned);
	if (count !== null) return tolerated(numberOf(count[1] ?? ""), 1, "count");
	throw new SheetError("a value cannot be read");
}

export function within(actual: number | null, expected: SheetValue): boolean {
	return (
		actual !== null &&
		Number.isFinite(actual) &&
		Math.abs(actual - expected.value) <= expected.tolerance + 1e-9
	);
}

function hourOf(text: string | undefined): number {
	const hour = Number(text);
	if (text === undefined || !Number.isInteger(hour) || hour < 0 || hour > 23) {
		throw new SheetError("an hour cannot be read");
	}
	return hour;
}

export function rowKindOf(label: string): RowKind {
	const text = label.replaceAll("**", "").trim().toLowerCase();
	if (text === "invoices") return { kind: "invoices" };
	if (text === "net") return { kind: "net" };
	if (text === "average ticket") return { kind: "averageTicket" };
	if (text === "sunday net") return { kind: "sundayNet" };
	if (text === "payment mix") return { kind: "paymentMix" };
	if (new RegExp(`^fri\\s*${DASH}\\s*sun share$`).test(text)) {
		return { kind: "weekendShare" };
	}
	const hour = /^(\d{1,2})h revenue$/.exec(text);
	if (hour !== null) return { kind: "hourNet", hour: hourOf(hour[1]) };
	const span = new RegExp(
		`^(\\d{1,2})\\s*${DASH}\\s*(\\d{1,2})h share of net$`,
	).exec(text);
	if (span !== null) {
		const from = hourOf(span[1]);
		const to = hourOf(span[2]);
		if (from > to) throw new SheetError("an hour span runs backwards");
		return { kind: "hourShare", from, to };
	}
	return { kind: "skipped" };
}

function cellsOf(line: string): string[] {
	return line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((cell) => cell.trim());
}

function isDivider(line: string): boolean {
	return /^\|\s*:?-{3,}/.test(line.trim());
}

function sectionAfter(lines: readonly string[], start: number): string[] {
	const section: string[] = [];
	for (let index = start + 1; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (/^#{1,2} /.test(line)) break;
		section.push(line);
	}
	return section;
}

function firstTable(section: readonly string[]): string[][] {
	const start = section.findIndex((line) => line.trim().startsWith("|"));
	if (start === -1) throw new SheetError("the section has no table");
	const rows: string[][] = [];
	for (let index = start; index < section.length; index += 1) {
		const line = section[index] ?? "";
		if (!line.trim().startsWith("|")) break;
		if (!isDivider(line)) rows.push(cellsOf(line));
	}
	return rows;
}

export function parsePaymentMix(text: string): PaymentShare[] {
	return text.split("·").map((item) => {
		const match = new RegExp(`^(.*?)\\s+(?:≈\\s*)?(${NUMBER})\\s*%$`).exec(
			item.trim(),
		);
		const label = (match?.[1] ?? "").trim();
		if (match === null || label === "") {
			throw new SheetError("a payment share cannot be read");
		}
		return { label, share: parseSheetValue(`${match[2]} %`) };
	});
}

export function parseReferenceSheet(text: string): ReferenceSheet {
	const lines = text.split(/\r?\n/);
	const headingIndex = lines.findIndex(
		(line) => line.startsWith("## ") && /reference window/i.test(line),
	);
	if (headingIndex === -1) {
		throw new SheetError("the reference-window section is missing");
	}
	const window = windowOf(lines[headingIndex] ?? "");
	const section = sectionAfter(lines, headingIndex);
	const [header, ...body] = firstTable(section);
	if (header === undefined || header[0]?.toLowerCase() !== "metric") {
		throw new SheetError("the table does not start with a Metric column");
	}
	const columns = header.slice(1);
	if (columns.length === 0 || columns.some((column) => column === "")) {
		throw new SheetError("the table has an empty store column");
	}
	const rows = body.map((cells, position): ReferenceRow => {
		const index = position + 1;
		const kind = rowKindOf(cells[0] ?? "");
		if (kind.kind === "skipped") return { index, form: "skipped" };
		const values = cells.slice(1);
		if (
			values.length !== columns.length ||
			values.some((value) => value === "")
		) {
			throw new SheetError(`row ${index} has a missing column`);
		}
		if (kind.kind === "paymentMix") {
			return { index, form: "payment", cells: values.map(parsePaymentMix) };
		}
		const parsed = values.map((value) => parseSheetValue(value));
		if (parsed.some((cell) => cell.unit !== VALUE_UNITS[kind.kind])) {
			throw new SheetError(`row ${index} holds a value of the wrong form`);
		}
		return { index, form: "value", kind, cells: parsed };
	});
	const present = new Set(
		rows.flatMap((row) =>
			row.form === "value"
				? [row.kind.kind]
				: row.form === "payment"
					? ["paymentMix"]
					: [],
		),
	);
	const missing = REQUIRED_ROW_KINDS.filter((kind) => !present.has(kind));
	if (missing.length > 0) {
		throw new SheetError(`the table has no ${missing.join(", ")} row`);
	}
	const pointer = /see\s+`([^`]+)`/i.exec(section.join("\n"));
	return { window, columns, rows, hourlyFile: pointer?.[1] ?? null };
}

function weekdayOf(name: string): number {
	const index = WEEKDAYS.indexOf(
		name.slice(0, 3).toLowerCase() as (typeof WEEKDAYS)[number],
	);
	if (index === -1) throw new SheetError("a weekday cannot be read");
	return index + 1;
}

function hourlyRows(lines: readonly string[]): StoreSeries[] {
	const start = lines.findIndex((line) => /^\|\s*Hour\s*\|/i.test(line.trim()));
	if (start === -1) throw new SheetError("the hourly table is missing");
	const [header, ...body] = firstTable(lines.slice(start));
	const hours = (header ?? []).slice(1).map(hourOf);
	if (hours.length === 0 || body.length === 0) {
		throw new SheetError("the hourly table is empty");
	}
	return body.map((cells) => {
		const values = cells.slice(1);
		if (values.length !== hours.length) {
			throw new SheetError("an hourly row has a missing hour");
		}
		return {
			name: (cells[0] ?? "").replaceAll("**", "").trim(),
			values: new Map(
				values.map((value, index) => [
					hours[index] ?? 0,
					parseSheetValue(value, true),
				]),
			),
		};
	});
}

function weekdayRows(lines: readonly string[]): StoreSeries[] {
	const line = lines.find((candidate) =>
		/^weekdays?\b[^:\n]*:/i.test(candidate.trim()),
	);
	if (line === undefined) throw new SheetError("the weekday line is missing");
	const content = line.slice(line.indexOf(":") + 1);
	const dayValue = new RegExp(`^\\s*([A-Za-z]{3})\\s+(${NUMBER})`);
	const series = content
		.split(/\.\s+(?=[^·]+?\s+Mon\s)/)
		.filter((segment) => /\sMon\s/.test(` ${segment}`))
		.map((segment) => {
			const padded = ` ${segment}`;
			const at = padded.search(/\sMon\s/);
			return {
				name: padded.slice(0, at).trim(),
				values: new Map(
					padded
						.slice(at)
						.split("·")
						.map((day) => {
							const match = dayValue.exec(day);
							if (match === null) {
								throw new SheetError("a weekday value cannot be read");
							}
							return [
								weekdayOf(match[1] ?? ""),
								parseSheetValue(match[2] ?? "", true),
							] as const;
						}),
				),
			};
		});
	if (series.length === 0 || series.some((store) => store.name === "")) {
		throw new SheetError("the weekday line names no store");
	}
	return series;
}

export function parseHourlyReference(text: string): HourlyReference {
	const lines = text.split(/\r?\n/);
	return { hours: hourlyRows(lines), weekdays: weekdayRows(lines) };
}

function topSellersOf(section: string): TopSeller[] {
	const line = /top sellers[^:\n]*:\s*([^\n]+)/i.exec(section);
	if (line === null) return [];
	const item = new RegExp(`^(.*?)\\s+(\\d[\\d,]*)\\s*/\\s*(${NUMBER}\\s*M₫)$`);
	return (line[1] ?? "")
		.replace(/\.\s*$/, "")
		.split("·")
		.filter((text) => text.trim() !== "")
		.map((text) => {
			const match = item.exec(text.trim());
			if (match === null || (match[1] ?? "").trim() === "") {
				throw new SheetError("a top seller cannot be read");
			}
			return {
				name: (match[1] ?? "").trim(),
				quantity: parseSheetValue(match[2] ?? ""),
				net: parseSheetValue(match[3] ?? ""),
			};
		});
}

function modifierSharesOf(section: string): {
	date: IsoDate | null;
	shares: ModifierShare[];
} {
	const line = /modifier share[^:\n]*?(\d{4}-\d{2}-\d{2}):([^\n]*)/i.exec(
		section,
	);
	if (line === null) return { date: null, shares: [] };
	const shares = [
		...(line[2] ?? "").matchAll(/([^,.:()]+?)\s+(\d[\d,]*)\s+of\s+(\d[\d,]*)/g),
	].map((match) => ({
		name: (match[1] ?? "").trim(),
		modifierLines: parseSheetValue(match[2] ?? ""),
		lines: parseSheetValue(match[3] ?? ""),
	}));
	if (shares.length === 0) {
		throw new SheetError("the modifier share names no store");
	}
	return { date: line[1] ?? null, shares };
}

export function parseMenuChecks(text: string): MenuChecks | null {
	const lines = text.split(/\r?\n/);
	const headingIndex = lines.findIndex(
		(line) => line.startsWith("## ") && /menu checks/i.test(line),
	);
	if (headingIndex === -1) return null;
	const scope = new RegExp(
		`\\(([^,()]+),\\s*(\\d+)\\s+days? to\\s+${DAY_MONTH}\\s+(\\d{4})\\)`,
		"i",
	).exec(lines[headingIndex] ?? "");
	if (scope === null) {
		throw new SheetError("the menu checks' scope cannot be read");
	}
	const days = Number(scope[2]);
	if (days < 1) throw new SheetError("the menu checks' scope has no day");
	const to = isoDate(
		Number(scope[5]),
		monthOf(scope[4] ?? ""),
		Number(scope[3]),
	);
	const section = sectionAfter(lines, headingIndex).join("\n");
	const modifiers = modifierSharesOf(section);
	return {
		store: (scope[1] ?? "").trim(),
		window: { from: addDays(to, 1 - days), to },
		topSellers: topSellersOf(section),
		modifierDate: modifiers.date,
		modifierShares: modifiers.shares,
	};
}

function comparable(text: string): string {
	return text.normalize("NFC").toLowerCase().trim();
}

export function namesMatch(left: string, right: string): boolean {
	const a = comparable(left);
	const b = comparable(right);
	return a !== "" && b !== "" && (a.includes(b) || b.includes(a));
}

export function siblingPath(sheetPath: string, name: string): string {
	if (name === "" || basename(name) !== name || name === "..") {
		throw new SheetError("the hourly file is not in the sheet's folder");
	}
	return resolve(dirname(sheetPath), name);
}

export function storeFor(name: string, stores: readonly StoreName[]): string {
	const matches = stores.filter((store) => namesMatch(name, store.name));
	const [match] = matches;
	if (matches.length !== 1 || match === undefined) {
		throw new SheetError(`a store column matches ${matches.length} stores`);
	}
	return match.id;
}
