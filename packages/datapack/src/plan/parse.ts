import { DataPackError } from "../pack/errors.js";
import type { PackLanguage } from "../pack/request.js";
import { analyzeLine, type LineAnalysis } from "./citations.js";
import {
	type FrontMatterRead,
	type PlanFrontMatter,
	readFrontMatter,
} from "./front-matter.js";
import { normalizePlan } from "./normalize.js";
import type { NumberReading } from "./numbers.js";
import {
	fieldLine,
	headingOf,
	type InitiativeFieldId,
	initiativeHeading,
	type PlanSectionId,
	sectionHeading,
} from "./sections.js";

export interface PlanSectionBlock {
	readonly id: PlanSectionId | null;
	readonly number: number | null;
	readonly heading: string;
	readonly line: number;
	readonly body: string;
}

export interface PlanField {
	readonly text: string;
	readonly line: number;
}

export interface PlanInitiative {
	readonly number: number;
	readonly title: string;
	readonly line: number;
	readonly fields: Readonly<Partial<Record<InitiativeFieldId, PlanField>>>;
}

export interface PlanCitation {
	readonly ref: string;
	readonly table: string;
	readonly row: string;
	readonly column: string;
	readonly line: number;
	readonly written: string | null;
}

export interface ParsedPlan {
	readonly text: string;
	readonly frontMatter: PlanFrontMatter;
	readonly extraFrontMatterKeys: readonly string[];
	readonly sections: readonly PlanSectionBlock[];
	readonly initiatives: readonly PlanInitiative[];
	readonly citations: readonly PlanCitation[];
}

export interface LineRange {
	readonly start: number;
	readonly end: number;
}

export interface BodyCitation {
	readonly citation: PlanCitation;
	readonly wellFormed: boolean;
	readonly readings: readonly NumberReading[] | null;
}

export interface PlanBody {
	readonly sections: readonly PlanSectionBlock[];
	readonly sectionRanges: readonly LineRange[];
	readonly initiatives: readonly PlanInitiative[];
	readonly initiativeRanges: readonly LineRange[];
	readonly fieldRanges: readonly Readonly<
		Partial<Record<InitiativeFieldId, LineRange>>
	>[];
	readonly citations: readonly BodyCitation[];
	readonly analyses: readonly (LineAnalysis | null)[];
	readonly headingLines: ReadonlySet<number>;
	readonly words: number;
}

interface OpenField {
	readonly id: InitiativeFieldId;
	readonly start: number;
	readonly parts: string[];
}

interface OpenInitiative {
	readonly number: number;
	readonly title: string;
	readonly start: number;
	readonly fields: Partial<Record<InitiativeFieldId, PlanField>>;
	readonly ranges: Partial<Record<InitiativeFieldId, LineRange>>;
	field: OpenField | null;
}

const WORD_TOKEN = /[\p{L}\p{N}]/u;

export function textLines(text: string): string[] {
	const lines = text.split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	return lines;
}

function trimmedBlock(lines: readonly string[]): string {
	return lines
		.join("\n")
		.replace(/^\s*\n/, "")
		.trimEnd();
}

export function parseBody(
	lines: readonly string[],
	bodyStart: number,
	language: PackLanguage,
): PlanBody {
	const sections: PlanSectionBlock[] = [];
	const sectionRanges: LineRange[] = [];
	const initiatives: PlanInitiative[] = [];
	const initiativeRanges: LineRange[] = [];
	const fieldRanges: Partial<Record<InitiativeFieldId, LineRange>>[] = [];
	const citations: BodyCitation[] = [];
	const analyses: (LineAnalysis | null)[] = lines.map(() => null);
	const headingLines = new Set<number>();
	let words = 0;
	let section: { heading: string; start: number } | null = null;
	let initiative: OpenInitiative | null = null;

	const closeField = (end: number) => {
		if (initiative === null || initiative.field === null) return;
		const field = initiative.field;
		const text = trimmedBlock(field.parts).trim();
		if (text !== "") {
			initiative.fields[field.id] = { text, line: field.start + 1 };
			initiative.ranges[field.id] = { start: field.start, end };
		}
		initiative.field = null;
	};
	const closeInitiative = (end: number) => {
		if (initiative === null) return;
		closeField(end);
		initiatives.push({
			number: initiative.number,
			title: initiative.title,
			line: initiative.start + 1,
			fields: initiative.fields,
		});
		initiativeRanges.push({ start: initiative.start, end });
		fieldRanges.push(initiative.ranges);
		initiative = null;
	};
	const closeSection = (end: number) => {
		if (section === null) return;
		const heading = sectionHeading(section.heading);
		sections.push({
			id: heading.section?.id ?? null,
			number: heading.number,
			heading: section.heading,
			line: section.start + 1,
			body: trimmedBlock(lines.slice(section.start + 1, end)),
		});
		sectionRanges.push({ start: section.start, end });
		section = null;
	};

	for (let index = bodyStart; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		words += line.split(/\s+/).filter((token) => WORD_TOKEN.test(token)).length;
		const analysis = analyzeLine(line, language);
		analyses[index] = analysis;
		for (const found of analysis.citations) {
			citations.push({
				citation: {
					ref: found.ref.ref,
					table: found.ref.table,
					row: found.ref.row,
					column: found.ref.column,
					line: index + 1,
					written: found.written?.text ?? null,
				},
				wellFormed: found.ref.wellFormed,
				readings: found.written?.readings ?? null,
			});
		}
		const heading = headingOf(line);
		if (heading !== null && heading.level <= 3) {
			headingLines.add(index);
			closeInitiative(index);
			if (heading.level <= 2) {
				closeSection(index);
				section = { heading: heading.text, start: index };
				continue;
			}
			const opened =
				heading.level === 3 ? initiativeHeading(heading.text) : null;
			if (opened !== null) {
				initiative = {
					number: opened.number,
					title: opened.title,
					start: index,
					fields: {},
					ranges: {},
					field: null,
				};
			}
			continue;
		}
		if (heading !== null) headingLines.add(index);
		if (initiative === null) continue;
		const field = fieldLine(line);
		if (field !== null) {
			closeField(index);
			if (initiative.fields[field.id] === undefined) {
				initiative.field = { id: field.id, start: index, parts: [field.text] };
			}
			continue;
		}
		initiative.field?.parts.push(line);
	}
	closeInitiative(lines.length);
	closeSection(lines.length);
	return {
		sections,
		sectionRanges,
		initiatives,
		initiativeRanges,
		fieldRanges,
		citations,
		analyses,
		headingLines,
		words,
	};
}

export function planOf(
	text: string,
	read: FrontMatterRead,
	body: PlanBody,
): ParsedPlan | null {
	if (read.frontMatter === null) return null;
	return {
		text,
		frontMatter: read.frontMatter,
		extraFrontMatterKeys: read.extraKeys,
		sections: body.sections,
		initiatives: body.initiatives,
		citations: body.citations.map((entry) => entry.citation),
	};
}

export function parsePlan(text: string): ParsedPlan {
	const normalized = normalizePlan(text).text;
	const lines = textLines(normalized);
	const read = readFrontMatter(lines);
	if (read.status === "missing") {
		throw new DataPackError(
			"front_matter_missing",
			"the plan does not start with its front matter",
		);
	}
	if (read.frontMatter === null) {
		throw new DataPackError(
			"front_matter_invalid",
			`the front matter is invalid at ${read.invalidPaths.map((path) => path || "(root)").join(", ")}`,
		);
	}
	const plan = planOf(
		normalized,
		read,
		parseBody(lines, read.bodyStart, read.frontMatter.language),
	);
	if (plan === null) {
		throw new DataPackError(
			"front_matter_invalid",
			"the front matter is invalid",
		);
	}
	return plan;
}
