import { type ReportSource, runPlannedCalls } from "@fnb/reports";
import { type StrategyPrompt, strategyPrompt } from "../prompt/prompt.js";
import { aggregatesOnlyIssues } from "./aggregates.js";
import { calendarOf, kpiWindowsOf } from "./calendar.js";
import {
	BROWSER_CONCURRENCY,
	CALL_KEYS,
	distinctCallCount,
	limitedReportSource,
	packCalls,
	profilesCall,
	SNAPSHOT_CONCURRENCY,
} from "./calls.js";
import { generatedAt, type PackClock } from "./clock.js";
import { packContext } from "./context.js";
import { packScopes, scopeCoverage } from "./coverage.js";
import { DataPackError } from "./errors.js";
import { TOKEN_LIMIT } from "./estimate.js";
import { validatePack } from "./invariants.js";
import type { RecordedCall } from "./record.js";
import type { DataPackRequest, PackLanguage } from "./request.js";
import {
	type CheckedPackRequest,
	checkPackRequest,
	type PackRequestResolution,
	resolvePackRequest,
	type StoreProfileRow,
} from "./resolve.js";
import {
	DATA_PACK_BUILDER_VERSION,
	DATA_PACK_FORMAT,
	DATA_PACK_SCHEMA_VERSION,
	type DataPack,
} from "./schema.js";
import { sealPack } from "./seal.js";
import { packTables } from "./tables/index.js";
import { resultsOf } from "./tables/support.js";

export interface BuildDataPackOptions {
	readonly source: ReportSource;
	readonly clock: PackClock;
	readonly fence: (() => Promise<string>) | null;
	readonly onProgress?: (done: number, total: number) => void;
}

export interface BuiltPack {
	readonly pack: DataPack;
	readonly text: string;
	readonly packId: string;
	readonly estimatedTokens: number;
	readonly calls: readonly RecordedCall[];
}

export const PACK_ATTEMPTS = 3;

const ISSUES_IN_MESSAGE = 3;

export type PromptOf = (language: PackLanguage) => StrategyPrompt;

interface Gathered {
	readonly resolution: PackRequestResolution;
	readonly entries: ReadonlyMap<string, readonly unknown[]>;
	readonly calls: readonly RecordedCall[];
}

function promptFor(promptOf: PromptOf, language: PackLanguage): StrategyPrompt {
	const prompt = promptOf(language);
	if (prompt.language !== language) {
		throw new DataPackError(
			"pack_invalid",
			`the prompt is in ${prompt.language}, the pack in ${language}`,
		);
	}
	return prompt;
}

async function gather(
	checked: CheckedPackRequest,
	options: BuildDataPackOptions,
): Promise<Gathered> {
	let done = 0;
	let total = 1;
	const progress = () => {
		done += 1;
		options.onProgress?.(Math.min(done, total), total);
	};
	const source = limitedReportSource(
		options.source,
		options.source.kind === "postgres"
			? SNAPSHOT_CONCURRENCY
			: BROWSER_CONCURRENCY,
		progress,
	);
	const entries = new Map<string, readonly unknown[]>();
	const first = profilesCall(checked.storeIds);
	await runPlannedCalls([first], source, entries);
	const resolution = resolvePackRequest(
		checked,
		(entries.get(CALL_KEYS.profiles) ?? []) as readonly StoreProfileRow[],
		options.clock.now(),
	);
	const calls = packCalls(resolution.request);
	total = distinctCallCount(calls);
	options.onProgress?.(done, total);
	await runPlannedCalls(calls.slice(1), source, entries);
	return {
		resolution,
		entries,
		calls: calls.map((spec) => ({
			key: spec.key,
			name: spec.name,
			args: spec.args,
			rows: entries.get(spec.key) ?? [],
		})),
	};
}

function draftOf(
	gathered: Gathered,
	prompt: StrategyPrompt,
	clock: PackClock,
): DataPack {
	const { request, country, profiles } = gathered.resolution;
	const calendar = calendarOf(request.asOf, request.horizon);
	const windows = kpiWindowsOf(request.asOf);
	const tables = packTables({
		request,
		calendar,
		windows,
		scopes: packScopes(request.stores),
		profiles,
		results: resultsOf(gathered.entries),
		coverage: scopeCoverage(
			(gathered.entries.get(CALL_KEYS.coverage) ?? []) as Parameters<
				typeof scopeCoverage
			>[0],
			windows,
			request.asOf,
		),
	});
	return {
		budget: { estimated_tokens: 0, limit: TOKEN_LIMIT, trimmed: [] },
		builder_version: DATA_PACK_BUILDER_VERSION,
		calendar,
		context: packContext(request.language, country, request.asOf),
		format: DATA_PACK_FORMAT,
		generated_at: generatedAt(clock),
		pack_id: "",
		prompt: {
			id: prompt.id,
			language: prompt.language,
			text: prompt.text,
			version: prompt.version,
		},
		request: {
			as_of: request.asOf,
			currency: request.currency,
			focus: request.focus,
			horizon: request.horizon,
			language: request.language,
			owner_note: request.ownerNote,
			stores: request.stores.map((store) => ({
				id: store.id,
				label: store.label,
			})),
		},
		sample: request.sample,
		schema_version: DATA_PACK_SCHEMA_VERSION,
		tables,
	};
}

function issueText(
	issues: readonly { code: string; path: string | null }[],
): string {
	const shown = issues
		.slice(0, ISSUES_IN_MESSAGE)
		.map((issue) => `${issue.code} at ${issue.path ?? "the pack"}`)
		.join(", ");
	return issues.length > ISSUES_IN_MESSAGE
		? `${shown} and ${issues.length - ISSUES_IN_MESSAGE} more`
		: shown;
}

async function sealed(
	gathered: Gathered,
	prompt: StrategyPrompt,
	clock: PackClock,
): Promise<BuiltPack> {
	const draft = draftOf(gathered, prompt, clock);
	const refused = aggregatesOnlyIssues(draft);
	if (refused.length > 0) {
		throw new DataPackError("pack_not_aggregate", issueText(refused));
	}
	const pack = await sealPack(draft);
	const validation = await validatePack(pack.pack);
	if (!validation.valid) {
		throw new DataPackError("pack_invalid", issueText(validation.issues));
	}
	return { ...pack, calls: gathered.calls };
}

export async function buildPackWith(
	request: DataPackRequest,
	options: BuildDataPackOptions,
	promptOf: PromptOf,
): Promise<BuiltPack> {
	const checked = checkPackRequest(request, options.source.kind);
	const prompt = promptFor(promptOf, checked.language);
	for (let attempt = 1; attempt <= PACK_ATTEMPTS; attempt += 1) {
		const before = options.fence === null ? null : await options.fence();
		const gathered = await gather(checked, options);
		const after = options.fence === null ? null : await options.fence();
		if (before === after) return sealed(gathered, prompt, options.clock);
	}
	throw new DataPackError(
		"pack_data_changed",
		`the data changed during each of ${PACK_ATTEMPTS} attempts`,
	);
}

export async function buildDataPack(
	request: DataPackRequest,
	options: BuildDataPackOptions,
): Promise<BuiltPack> {
	return buildPackWith(request, options, strategyPrompt);
}
