import { readFileSync } from "node:fs";
import {
	type DataPack,
	DataPackError,
	lintPlan,
	type PlanIssue,
	type PlanLintResult,
	parsePack,
	planRecord,
} from "@fnb/datapack";
import {
	type CommandContext,
	flag,
	type OptionValues,
	stringOption,
	UsageError,
} from "../context.js";
import {
	PACK_ID_PREFIX_LENGTH,
	resolveUserPath,
	shownPath,
} from "../datapack/files.js";
import { planIssueMessage } from "./publish-plan-messages.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";

export const EXIT_USAGE = 2;
export const EXIT_PLAN_INVALID = 3;
export const EXIT_PACK_INVALID = 4;

const BYTE_ORDER_MARK = "﻿";

export interface PublishPlanOptions {
	readonly plan: string;
	readonly pack: string;
	readonly json: boolean;
}

interface ReadFile {
	readonly path: string;
	readonly text: string;
}

class CommandExit extends Error {
	readonly code: number;

	constructor(code: number) {
		super(`exit ${code}`);
		this.name = "CommandExit";
		this.code = code;
	}
}

function fileOption(values: OptionValues, name: string): string {
	const value = stringOption(values, name);
	if (value === undefined) throw new UsageError(`--${name} is required`);
	if (value.trim() === "") throw new UsageError(`--${name} needs a file`);
	return value;
}

export function publishPlanOptions(values: OptionValues): PublishPlanOptions {
	if (!flag(values, "check")) {
		throw new UsageError(
			"only --check is available: signing in and publishing a plan come with phase 11b",
		);
	}
	return {
		plan: fileOption(values, "plan"),
		pack: fileOption(values, "pack"),
		json: flag(values, "json"),
	};
}

function shown(context: CommandContext, path: string): string {
	return shownPath(path, context.rootDir, context.output.ci);
}

function readUserFile(
	context: CommandContext,
	option: string,
	path: string,
): ReadFile {
	const absolute = resolveUserPath(path, context.env);
	let text: string;
	try {
		text = readFileSync(absolute, "utf8");
	} catch {
		context.output.error(`${option}: cannot read ${shown(context, absolute)}`);
		throw new CommandExit(EXIT_USAGE);
	}
	return {
		path: absolute,
		text: text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text,
	};
}

function packIdShown(context: CommandContext, packId: string): string {
	return context.output.ci ? packId.slice(0, PACK_ID_PREFIX_LENGTH) : packId;
}

function printFields(
	context: CommandContext,
	fields: Readonly<Record<string, string | number | boolean | null>>,
): void {
	for (const [key, value] of Object.entries(fields)) {
		context.output.line(`${key}: ${value === null ? "–" : String(value)}`);
	}
}

function issueLine(context: CommandContext, issue: PlanIssue): string {
	const line = issue.line === null ? "–" : String(issue.line);
	const detail =
		context.output.ci || issue.detail === null
			? ""
			: ` (detail: ${issue.detail})`;
	return `issue: ${issue.level} ${issue.code} at line ${line}: ${planIssueMessage(issue.code)}${detail}`;
}

function issueObject(
	context: CommandContext,
	issue: PlanIssue,
): Readonly<Record<string, string | number | null>> {
	return {
		level: issue.level,
		code: issue.code,
		line: issue.line,
		message: planIssueMessage(issue.code),
		...(context.output.ci ? {} : { detail: issue.detail }),
	};
}

interface Publishability {
	readonly publishable: boolean;
	readonly refusal: string | null;
}

function publishability(lint: PlanLintResult, pack: DataPack): Publishability {
	if (!lint.ok || lint.plan === null) {
		return { publishable: false, refusal: null };
	}
	try {
		planRecord(lint.plan, pack, lint, "skill");
		return { publishable: true, refusal: null };
	} catch (error) {
		if (error instanceof DataPackError) {
			return { publishable: false, refusal: error.code };
		}
		throw error;
	}
}

async function checkPlan(
	context: CommandContext,
	options: PublishPlanOptions,
): Promise<number> {
	const plan = readUserFile(context, "--plan", options.plan);
	const packFile = readUserFile(context, "--pack", options.pack);
	const parsed = await parsePack(packFile.text);
	if (!parsed.valid || parsed.pack === null || parsed.packId === null) {
		const codes = parsed.issues.map((issue) => issue.code);
		if (options.json) {
			context.output.line(
				JSON.stringify({ ok: false, pack_valid: false, pack_issues: codes }),
			);
		} else {
			context.output.line(
				`publish-plan: ${shown(context, packFile.path)} is not a valid pack, so the plan was not checked`,
			);
			printFields(context, { ok: false, pack_valid: false });
			for (const issue of parsed.issues) {
				const detail =
					context.output.ci || issue.detail === null
						? ""
						: ` (${issue.detail})`;
				context.output.line(
					`pack_issue: ${issue.code} at ${issue.path ?? "the pack"}${detail}`,
				);
			}
		}
		return EXIT_PACK_INVALID;
	}
	const pack = parsed.pack;
	const lint = lintPlan(plan.text, pack);
	const outcome = publishability(lint, pack);
	const errors = lint.issues.filter((issue) => issue.level === "error").length;
	const fields = {
		ok: lint.ok,
		pack_valid: true,
		pack_id: packIdShown(context, parsed.packId),
		sample: pack.sample,
		publishable: outcome.publishable,
		not_publishable: outcome.refusal,
		errors,
		warnings: lint.issues.length - errors,
		initiatives: lint.summary.initiatives,
		cited_initiatives: lint.summary.citedInitiatives,
		citations: lint.summary.citations,
		valid_citations: lint.summary.validCitations,
		kpis: lint.summary.kpis,
		uncited_numbers: lint.summary.uncitedNumbers,
		words: lint.summary.words,
	};
	if (options.json) {
		context.output.line(
			JSON.stringify({
				...fields,
				issues: lint.issues.map((issue) => issueObject(context, issue)),
			}),
		);
	} else {
		context.output.line(
			`publish-plan: checked ${shown(context, plan.path)} against ${shown(context, packFile.path)}`,
		);
		printFields(context, fields);
		for (const issue of lint.issues) {
			context.output.line(issueLine(context, issue));
		}
	}
	return lint.ok ? 0 : EXIT_PLAN_INVALID;
}

export async function runPublishPlan(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const options = publishPlanOptions(values);
	try {
		return await checkPlan(context, options);
	} catch (error) {
		if (error instanceof CommandExit) return error.code;
		throw error;
	}
}

export const publishPlanCommand: CommandSpec = {
	path: ["publish-plan"],
	summary:
		"Check a strategy plan against the data pack it was written from, offline (publishing comes with phase 11b)",
	usage:
		"fnb publish-plan --check --plan <plan.md> --pack <pack.json> [--json]",
	options: {
		...HELP_OPTION,
		check: { type: "boolean" },
		plan: { type: "string" },
		pack: { type: "string" },
		json: { type: "boolean" },
	},
	details: [
		"--check reads the two files only: it needs no credential, opens no connection and accepts sample packs.",
		"The pack is read with the same checks as fnb datapack --check; a pack edited by hand, whose pack_id no longer recomputes, is refused with exit 4 and the plan is not checked.",
		"The plan is checked by the same lint as the paste box on Kế hoạch: the front matter, the ten sections, five to seven initiatives with their seven fields, every [[table:row:column]] citation against the pack, and the KPIs.",
		"Prints ok, the pack id, whether the pack is a sample and whether the plan could be published, the counts of errors, warnings, initiatives, citations and KPIs, then one line per issue: level, code (its parameter after the first colon), line in the normalised plan and a fixed message. --json prints one object.",
		"Relative paths start from the folder where the command was typed (INIT_CWD under pnpm); a byte order mark is ignored.",
		"In CI (CI or GITHUB_ACTIONS set) the output names no path or value: base names only, the pack id as an 8-character prefix and no issue detail.",
		"Without --check, signing in and publishing come with phase 11b.",
		"Exit codes: 0 no lint error (warnings allowed); 2 usage or a file it cannot read; 3 the plan has lint errors; 4 the pack is invalid.",
	],
	run: (context, values) => runPublishPlan(context, values),
};
