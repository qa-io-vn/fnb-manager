import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type BenchmarkContextEntry,
	type MetricDefinition,
	type MetricGroup,
	type MetricStatus,
	metricDirections,
	metricGrains,
	metricGroups,
	metricStatuses,
	metricUnits,
	periodicReports,
	type ReportId,
	reportNames,
} from "../../src/index.js";

export const repositoryRoot = join(import.meta.dirname, "..", "..", "..", "..");
export const metricsDocumentPath = join(repositoryRoot, "docs", "metrics.md");

const metricColumns = [
	"id",
	"Tiếng Việt",
	"English",
	"Unit",
	"Formula",
	"Grain",
	"Direction",
	"Source",
	"Reports",
	"Status",
];
const contextColumns = ["id", "Figure", "Year", "Source"];
const reportAliases: Readonly<Record<string, ReportId>> = {
	"Khuyến mãi": "promotions",
};
const everyPeriodicReport = "every periodic report";
const absoluteValueNote = "absolute value";
const statusesLongestFirst = [...metricStatuses].sort(
	(left, right) => right.length - left.length,
);

export interface MetricsDocument {
	metrics: MetricDefinition[];
	context: BenchmarkContextEntry[];
	grainVocabulary: string[];
	statusVocabulary: string[];
	problems: string[];
}

interface MarkdownRow {
	line: number;
	cells: readonly string[];
}

interface MarkdownTable {
	heading: string;
	line: number;
	columns: readonly string[];
	separator: readonly string[];
	rows: readonly MarkdownRow[];
}

interface NotedText {
	text: string;
	note?: string;
}

export function splitTableRow(line: string): string[] {
	return line
		.trim()
		.replace(/^\|/, "")
		.replace(/(?<!\\)\|$/, "")
		.split(/(?<!\\)\|/)
		.map((cell) => cell.trim().replaceAll("\\|", "|"));
}

function markdownTables(markdown: string): MarkdownTable[] {
	const lines = markdown.split("\n");
	const tables: MarkdownTable[] = [];
	let heading = "";
	let index = 0;
	while (index < lines.length) {
		const line = lines[index] ?? "";
		if (line.startsWith("## ")) heading = line.slice(3).trim();
		if (!line.startsWith("|")) {
			index += 1;
			continue;
		}
		const header = index;
		const rows: MarkdownRow[] = [];
		index += 2;
		while ((lines[index] ?? "").startsWith("|")) {
			rows.push({ line: index + 1, cells: splitTableRow(lines[index] ?? "") });
			index += 1;
		}
		tables.push({
			heading,
			line: header + 1,
			columns: splitTableRow(line),
			separator: splitTableRow(lines[header + 1] ?? ""),
			rows,
		});
	}
	return tables;
}

function sameColumns(
	columns: readonly string[],
	expected: readonly string[],
): boolean {
	return (
		columns.length === expected.length &&
		columns.every((column, position) => column === expected[position])
	);
}

function isOneOf<Value extends string>(
	values: readonly Value[],
	candidate: string,
): candidate is Value {
	return (values as readonly string[]).includes(candidate);
}

function closingParenthesis(text: string, opening: number): number {
	let depth = 0;
	for (let position = opening; position < text.length; position += 1) {
		if (text[position] === "(") depth += 1;
		if (text[position] === ")") depth -= 1;
		if (depth === 0) return position;
	}
	return -1;
}

function withTrailingNote(cell: string): NotedText {
	if (!cell.endsWith(")")) return { text: cell };
	let opening = cell.lastIndexOf("(");
	while (opening > 0 && closingParenthesis(cell, opening) !== cell.length - 1) {
		opening = cell.lastIndexOf("(", opening - 1);
	}
	if (opening <= 0 || cell[opening - 1] !== " ") return { text: cell };
	return {
		text: cell.slice(0, opening).trimEnd(),
		note: cell.slice(opening + 1, -1),
	};
}

function splitTopLevel(cell: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let position = 0; position < cell.length; position += 1) {
		const character = cell[position];
		if (character === "(") depth += 1;
		if (character === ")") depth -= 1;
		if (depth === 0 && cell.startsWith(", ", position)) {
			parts.push(cell.slice(start, position));
			start = position + 2;
		}
	}
	parts.push(cell.slice(start));
	return parts;
}

function codeId(cell: string): string | undefined {
	return /^`([^`]+)`$/.exec(cell)?.[1];
}

function groupOfHeading(heading: string): MetricGroup | undefined {
	return (Object.keys(metricGroups) as MetricGroup[]).find(
		(group) => metricGroups[group] === heading,
	);
}

function reportOfName(name: string): ReportId | undefined {
	return (
		reportAliases[name] ??
		(Object.keys(reportNames) as ReportId[]).find(
			(report) => reportNames[report] === name,
		)
	);
}

function readStatus(cell: string): { status: MetricStatus; note?: string } {
	const status = statusesLongestFirst.find(
		(candidate) =>
			cell === candidate ||
			cell.startsWith(`${candidate} `) ||
			cell.startsWith(`${candidate};`),
	);
	if (status === undefined) throw new Error(`unknown status "${cell}"`);
	const rest = cell.slice(status.length);
	if (rest === "") return { status };
	if (rest.startsWith("; ")) return { status, note: rest.slice(2) };
	const note = rest.trim();
	if (note.startsWith("(") && closingParenthesis(note, 0) === note.length - 1) {
		return { status, note: note.slice(1, -1) };
	}
	return { status, note };
}

function readReports(cell: string): {
	reports: ReportId[];
	notes: Partial<Record<ReportId, string>>;
} {
	const reports: ReportId[] = [];
	const notes: Partial<Record<ReportId, string>> = {};
	for (const part of splitTopLevel(cell)) {
		const { text, note } = withTrailingNote(part);
		const named = text === everyPeriodicReport ? null : reportOfName(text);
		if (named === undefined) throw new Error(`unknown report "${text}"`);
		const ids = named === null ? [...periodicReports] : [named];
		for (const id of ids) {
			if (reports.includes(id)) throw new Error(`report "${text}" repeats`);
			reports.push(id);
			if (note !== undefined) notes[id] = note;
		}
	}
	return { reports, notes };
}

function readDirection(
	cell: string,
): Pick<MetricDefinition, "direction" | "directionOnAbsoluteValue"> {
	const { text, note } = withTrailingNote(cell);
	if (!isOneOf(metricDirections, text)) {
		throw new Error(`unknown direction "${cell}"`);
	}
	if (note === undefined) return { direction: text };
	if (note !== absoluteValueNote) {
		throw new Error(`unknown direction note "${note}"`);
	}
	return { direction: text, directionOnAbsoluteValue: true };
}

function readGrains(
	cell: string,
): Pick<MetricDefinition, "grains" | "grainNote"> {
	const { text, note } = withTrailingNote(cell);
	const grains = text.split(", ");
	const unknown = grains.filter((grain) => !isOneOf(metricGrains, grain));
	if (unknown.length > 0) throw new Error(`unknown grain "${unknown[0]}"`);
	const known = grains.filter((grain) => isOneOf(metricGrains, grain));
	return note === undefined
		? { grains: known }
		: { grains: known, grainNote: note };
}

function readMetricRow(
	cells: readonly string[],
	group: MetricGroup,
): MetricDefinition {
	const [id, vi, en, unit, formula, grain, direction, source, reports, status] =
		cells;
	if (status === undefined || cells.length !== metricColumns.length) {
		throw new Error(`has ${cells.length} cells`);
	}
	const metricId = codeId(id ?? "");
	if (metricId === undefined) throw new Error(`id ${id} is not code`);
	if (!isOneOf(metricUnits, unit ?? "")) {
		throw new Error(`unknown unit "${unit}"`);
	}
	const readings = readReports(reports ?? "");
	const readStatusCell = readStatus(status);
	return {
		id: metricId,
		group,
		label: { vi: vi ?? "", en: en ?? "" },
		unit: unit as MetricDefinition["unit"],
		formula: formula ?? "",
		...readGrains(grain ?? ""),
		...readDirection(direction ?? ""),
		source: source ?? "",
		reports: readings.reports,
		...(Object.keys(readings.notes).length > 0
			? { reportNotes: readings.notes }
			: {}),
		status: readStatusCell.status,
		...(readStatusCell.note === undefined
			? {}
			: { statusNote: readStatusCell.note }),
	};
}

function readContextRow(cells: readonly string[]): BenchmarkContextEntry {
	const [id, figure, year, source] = cells;
	if (source === undefined || cells.length !== contextColumns.length) {
		throw new Error(`has ${cells.length} cells`);
	}
	const entryId = codeId(id ?? "");
	if (entryId === undefined) throw new Error(`id ${id} is not code`);
	return { id: entryId, figure: figure ?? "", year: year ?? "", source };
}

function conventionText(markdown: string, term: string): string {
	const prefix = `- **${term}**: `;
	const line = markdown.split("\n").find((entry) => entry.startsWith(prefix));
	return line === undefined ? "" : line.slice(prefix.length);
}

function withoutParentheses(text: string): string {
	return text.replace(/\s*\([^()]*\)/g, "");
}

export function readMetricsDocument(
	markdown: string = readFileSync(metricsDocumentPath, "utf8"),
): MetricsDocument {
	const reading: MetricsDocument = {
		metrics: [],
		context: [],
		grainVocabulary: withoutParentheses(
			conventionText(markdown, "Grains").split(". ")[0] ?? "",
		)
			.split(", ")
			.map((grain) => grain.trim()),
		statusVocabulary: [
			...withoutParentheses(conventionText(markdown, "Status")).matchAll(
				/`([^`]+)`/g,
			),
		].map((match) => match[1] ?? ""),
		problems: [],
	};
	for (const table of markdownTables(markdown)) {
		const isMetricTable = sameColumns(table.columns, metricColumns);
		const isContextTable = sameColumns(table.columns, contextColumns);
		if (!isMetricTable && !isContextTable) {
			if (table.columns[0] === "id") {
				reading.problems.push(
					`line ${table.line}: a table of ids with unexpected columns ${table.columns.join(", ")}`,
				);
			}
			continue;
		}
		if (!table.separator.every((cell) => /^:?-{3,}:?$/.test(cell))) {
			reading.problems.push(`line ${table.line + 1}: not a table separator`);
		}
		const group = groupOfHeading(table.heading);
		if (isMetricTable && group === undefined) {
			reading.problems.push(
				`line ${table.line}: section "${table.heading}" is not a metric group`,
			);
			continue;
		}
		for (const row of table.rows) {
			try {
				if (group !== undefined && isMetricTable) {
					reading.metrics.push(readMetricRow(row.cells, group));
				} else {
					reading.context.push(readContextRow(row.cells));
				}
			} catch (error) {
				reading.problems.push(
					`line ${row.line}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}
	return reading;
}
