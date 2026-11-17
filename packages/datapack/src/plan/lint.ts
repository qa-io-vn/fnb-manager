import { isMetricId } from "@fnb/metrics";
import { utf8Length } from "../pack/estimate.js";
import { trackableMetricIds } from "../pack/kpi-ids.js";
import type { DataPack } from "../pack/schema.js";
import { isNumericUnit } from "../pack/units.js";
import {
	ALL_SCOPE,
	BASELINE_COLUMN,
	kpiValue,
	resolveCell,
} from "./citations.js";
import {
	type PlanIssueLevel,
	type PlanLintCode,
	planIssueCode,
	planIssueLevel,
} from "./codes.js";
import {
	type FrontMatterRead,
	frontMatterKeyLine,
	type PlanFrontMatter,
	readFrontMatter,
} from "./front-matter.js";
import { normalizePlan } from "./normalize.js";
import {
	jsonNumberReading,
	type NumberReading,
	readingMatches,
	writtenMatchesCell,
} from "./numbers.js";
import {
	type ParsedPlan,
	type PlanBody,
	parseBody,
	planOf,
	textLines,
} from "./parse.js";
import {
	INITIATIVE_FIELD_IDS,
	MAX_INITIATIVES,
	MAX_PLAN_CONTENT_BYTES,
	MAX_PLAN_KPIS,
	MIN_INITIATIVES,
	PLAN_SECTIONS,
	type PlanSectionId,
} from "./sections.js";

export interface PlanIssue {
	readonly code: string;
	readonly level: "error" | "warning";
	readonly line: number | null;
	readonly detail: string | null;
}

export interface PlanLintSummary {
	readonly initiatives: number;
	readonly citedInitiatives: number;
	readonly citations: number;
	readonly validCitations: number;
	readonly kpis: number;
	readonly uncitedNumbers: number;
	readonly words: number;
}

export interface PlanLintResult {
	readonly ok: boolean;
	readonly normalized: string;
	readonly issues: readonly PlanIssue[];
	readonly plan: ParsedPlan | null;
	readonly summary: PlanLintSummary;
}

interface CollectedIssue {
	readonly issue: PlanIssue;
	readonly order: number;
}

interface IssueCollector {
	add(
		code: PlanLintCode,
		parameter: string | number | null,
		line: number | null,
		detail: string | null,
	): void;
	sorted(): PlanIssue[];
}

interface CitationCheck {
	readonly valid: boolean;
	readonly grounds: boolean;
}

interface UncitedNumber {
	readonly line: number;
	readonly text: string;
}

const UNCITED_SECTIONS: ReadonlySet<PlanSectionId> = new Set([
	"summary",
	"strengths_weaknesses",
]);
const ESTIMATE_MARK = /ước tính|estimate/iu;
const LEVEL_ORDER: Readonly<Record<PlanIssueLevel, number>> = {
	error: 0,
	warning: 1,
};

function issueCollector(): IssueCollector {
	const collected: CollectedIssue[] = [];
	const seen = new Set<string>();
	return {
		add(code, parameter, line, detail) {
			const issue: PlanIssue = {
				code: planIssueCode(code, parameter),
				level: planIssueLevel(code),
				line,
				detail,
			};
			const key = `${issue.code}\u0000${line}\u0000${detail}`;
			if (seen.has(key)) return;
			seen.add(key);
			collected.push({ issue, order: collected.length });
		},
		sorted() {
			return [...collected]
				.sort(
					(left, right) =>
						LEVEL_ORDER[left.issue.level] - LEVEL_ORDER[right.issue.level] ||
						(left.issue.line ?? 0) - (right.issue.line ?? 0) ||
						left.order - right.order,
				)
				.map((entry) => entry.issue);
		},
	};
}

function invalidPathLine(read: FrontMatterRead, path: string): number {
	if (path === "") return 1;
	const [top = "", second] = path.split(".");
	return top === "kpis" && second !== undefined
		? frontMatterKeyLine(read, second)
		: frontMatterKeyLine(read, top);
}

function checkFrontMatter(
	read: FrontMatterRead,
	pack: DataPack,
	issues: IssueCollector,
): void {
	if (read.status === "missing") {
		issues.add("front_matter_missing", null, null, null);
		return;
	}
	for (const path of read.invalidPaths) {
		issues.add(
			"front_matter_invalid",
			null,
			invalidPathLine(read, path),
			path === "" ? null : path,
		);
	}
	if (read.extraKeys.length > 0) {
		issues.add("front_matter_extra_fields", null, 1, read.extraKeys.join(", "));
	}
	const frontMatter = read.frontMatter;
	if (frontMatter === null) return;
	if (frontMatter.pack !== pack.pack_id) {
		issues.add(
			"pack_mismatch",
			null,
			frontMatterKeyLine(read, "pack"),
			frontMatter.pack,
		);
	}
	if (frontMatter.horizon !== pack.request.horizon) {
		issues.add(
			"horizon_mismatch",
			null,
			frontMatterKeyLine(read, "horizon"),
			frontMatter.horizon,
		);
	}
}

function checkSections(body: PlanBody, issues: IssueCollector): void {
	const present = new Set(body.sections.map((section) => section.id));
	for (const section of PLAN_SECTIONS) {
		if (!present.has(section.id)) {
			issues.add("section_missing", section.number, null, null);
		}
	}
}

function checkInitiatives(body: PlanBody, issues: IssueCollector): void {
	const count = body.initiatives.length;
	if (count < MIN_INITIATIVES || count > MAX_INITIATIVES) {
		const heading = body.sections.find(
			(section) => section.id === "initiatives",
		);
		issues.add("initiatives_count", count, heading?.line ?? null, null);
	}
	const misplaced = body.initiatives.find(
		(initiative, index) => initiative.number !== index + 1,
	);
	if (misplaced !== undefined) {
		issues.add("initiative_number", misplaced.number, misplaced.line, null);
	}
	for (const initiative of body.initiatives) {
		for (const field of INITIATIVE_FIELD_IDS) {
			if (initiative.fields[field] === undefined) {
				issues.add(
					"initiative_field_missing",
					`${initiative.number}:${field}`,
					initiative.line,
					null,
				);
			}
		}
	}
}

function checkCitations(
	body: PlanBody,
	pack: DataPack,
	issues: IssueCollector,
): CitationCheck[] {
	return body.citations.map((entry) => {
		const { citation } = entry;
		const resolved = entry.wellFormed
			? resolveCell(pack, citation.table, citation.row, citation.column)
			: null;
		if (resolved === null) {
			issues.add("citation_unknown", citation.ref, citation.line, null);
			return { valid: false, grounds: false };
		}
		if (entry.readings === null || !isNumericUnit(resolved.unit)) {
			return { valid: true, grounds: false };
		}
		if (!writtenMatchesCell(entry.readings, resolved.cell, resolved.unit)) {
			issues.add(
				"citation_mismatch",
				citation.ref,
				citation.line,
				citation.written,
			);
			return { valid: false, grounds: false };
		}
		return { valid: true, grounds: true };
	});
}

function checkInitiativeCitations(
	body: PlanBody,
	checks: readonly CitationCheck[],
	issues: IssueCollector,
): number {
	let cited = 0;
	body.initiatives.forEach((initiative, index) => {
		const range = body.initiativeRanges[index];
		const grounded =
			range !== undefined &&
			body.citations.some((entry, position) => {
				const at = entry.citation.line - 1;
				return (
					at >= range.start &&
					at < range.end &&
					checks[position]?.grounds === true
				);
			});
		if (grounded) {
			cited += 1;
		} else {
			issues.add(
				"initiative_uncited",
				initiative.number,
				initiative.line,
				null,
			);
		}
	});
	return cited;
}

function mentions(text: string, id: string): boolean {
	return new RegExp(`(?<![A-Za-z0-9_])${id}(?![A-Za-z0-9_])`).test(text);
}

function checkKpis(
	frontMatter: PlanFrontMatter,
	read: FrontMatterRead,
	body: PlanBody,
	pack: DataPack,
	issues: IssueCollector,
): void {
	const ids = Object.keys(frontMatter.kpis);
	if (ids.length < 1 || ids.length > MAX_PLAN_KPIS) {
		issues.add(
			"kpis_count",
			ids.length,
			frontMatterKeyLine(read, "kpis"),
			null,
		);
	}
	const trackable = new Set<string>(trackableMetricIds());
	const labels = new Set(pack.request.stores.map((store) => store.label));
	const byNumber = new Map<number, number>();
	body.initiatives.forEach((initiative, index) => {
		if (!byNumber.has(initiative.number))
			byNumber.set(initiative.number, index);
	});
	for (const id of ids) {
		const kpi = frontMatter.kpis[id];
		if (kpi === undefined) continue;
		const line = frontMatterKeyLine(read, id);
		if (!isMetricId(id)) {
			issues.add("kpi_unknown", id, line, null);
			continue;
		}
		if (!trackable.has(id)) {
			issues.add("kpi_untracked", id, line, null);
			continue;
		}
		if (kpi.scope !== ALL_SCOPE && !labels.has(kpi.scope)) {
			issues.add("kpi_scope_unknown", id, line, kpi.scope);
		} else {
			const baseline = kpiValue(pack, kpi.scope, id, BASELINE_COLUMN);
			if (baseline === null) {
				issues.add("kpi_unmeasured", id, line, kpi.scope);
			} else {
				if (
					kpi.baseline !== undefined &&
					!readingMatches(jsonNumberReading(kpi.baseline), baseline)
				) {
					issues.add("kpi_baseline_mismatch", id, line, String(baseline));
				}
				if (kpi.target === baseline) {
					issues.add("kpi_target_unchanged", id, line, String(baseline));
				}
			}
		}
		const unknown = kpi.initiatives.find((number) => !byNumber.has(number));
		if (unknown !== undefined) {
			issues.add("kpi_initiative_unknown", id, line, String(unknown));
		}
		const unlinked = kpi.initiatives.find((number) => {
			const index = byNumber.get(number);
			const field =
				index === undefined ? undefined : body.initiatives[index]?.fields.kpi;
			return field !== undefined && !mentions(field.text, id);
		});
		if (unlinked !== undefined) {
			issues.add("kpi_initiative_unlinked", id, line, String(unlinked));
		}
	}
}

function scannedLines(body: PlanBody): number[] {
	const scanned = new Set<number>();
	body.sections.forEach((section, index) => {
		const range = body.sectionRanges[index];
		if (range === undefined || section.id === null) return;
		if (!UNCITED_SECTIONS.has(section.id)) return;
		for (let line = range.start + 1; line < range.end; line += 1) {
			scanned.add(line);
		}
	});
	for (const ranges of body.fieldRanges) {
		const evidence = ranges.evidence;
		if (evidence === undefined) continue;
		for (let line = evidence.start; line < evidence.end; line += 1) {
			scanned.add(line);
		}
	}
	return [...scanned]
		.filter((line) => !body.headingLines.has(line))
		.sort((left, right) => left - right);
}

function isTarget(
	readings: readonly NumberReading[],
	targets: readonly number[],
): boolean {
	return readings.some((reading) =>
		targets.some((target) => readingMatches(reading, target)),
	);
}

function uncitedNumbers(
	body: PlanBody,
	lines: readonly string[],
	frontMatter: PlanFrontMatter | null,
): UncitedNumber[] {
	const targets =
		frontMatter === null
			? []
			: Object.values(frontMatter.kpis).map((kpi) => kpi.target);
	const found: UncitedNumber[] = [];
	for (const index of scannedLines(body)) {
		const analysis = body.analyses[index];
		if (analysis === null || analysis === undefined) continue;
		const text = lines[index] ?? "";
		const estimate = ESTIMATE_MARK.exec(text);
		const cut = estimate === null ? text.length : estimate.index;
		for (const token of analysis.tokens) {
			if (
				token.kind === "number" &&
				token.start < cut &&
				!analysis.citedNumbers.has(token) &&
				!isTarget(token.readings, targets)
			) {
				found.push({ line: index + 1, text: token.text });
			}
		}
	}
	return found;
}

export function lintPlan(text: string, pack: DataPack): PlanLintResult {
	const normalized = normalizePlan(text);
	const lines = textLines(normalized.text);
	const read = readFrontMatter(lines);
	const frontMatter = read.frontMatter;
	const body = parseBody(
		lines,
		read.bodyStart,
		frontMatter?.language ?? pack.request.language,
	);
	const issues = issueCollector();
	if (normalized.preamble) issues.add("preamble_text", null, null, null);
	const bytes = utf8Length(normalized.text);
	if (bytes > MAX_PLAN_CONTENT_BYTES) {
		issues.add("content_too_large", null, null, String(bytes));
	}
	checkFrontMatter(read, pack, issues);
	checkSections(body, issues);
	checkInitiatives(body, issues);
	const checks = checkCitations(body, pack, issues);
	const citedInitiatives = checkInitiativeCitations(body, checks, issues);
	if (frontMatter !== null) checkKpis(frontMatter, read, body, pack, issues);
	const uncited = uncitedNumbers(body, lines, frontMatter);
	if (uncited.length > 0) {
		issues.add(
			"uncited_numbers",
			uncited.length,
			null,
			uncited.map((entry) => `${entry.line}:${entry.text}`).join("; "),
		);
	}
	const sorted = issues.sorted();
	return {
		ok: sorted.every((issue) => issue.level !== "error"),
		normalized: normalized.text,
		issues: sorted,
		plan: planOf(normalized.text, read, body),
		summary: {
			initiatives: body.initiatives.length,
			citedInitiatives,
			citations: body.citations.length,
			validCitations: checks.filter((check) => check.valid).length,
			kpis: frontMatter === null ? 0 : Object.keys(frontMatter.kpis).length,
			uncitedNumbers: uncited.length,
			words: body.words,
		},
	};
}
