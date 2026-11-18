import {
	buildDataPack,
	chatBundle,
	type DataPack,
	DataPackError,
	type DataPackRequest,
	type GapSeverity,
	type Horizon,
	PACK_GAPS,
	type PackClock,
	type PackGapCode,
	type PackLanguage,
	type PackStoreRef,
	validatePack,
} from "@fnb/datapack";
import type { NoticeAction, ReportSource, RpcClient } from "@fnb/reports";

export interface PackGapView {
	readonly code: PackGapCode;
	readonly scope: string;
	readonly value: number | null;
	readonly severity: GapSeverity;
	readonly setting: NoticeAction | null;
}

export interface PackTableView {
	readonly id: string;
	readonly title: string;
	readonly rows: number;
}

export interface BrowserPack {
	readonly text: string;
	readonly bundle: string;
	readonly packId: string;
	readonly estimatedTokens: number;
	readonly trimmed: readonly string[];
	readonly asOf: string;
	readonly horizon: Horizon;
	readonly language: PackLanguage;
	readonly sample: boolean;
	readonly stores: readonly PackStoreRef[];
	readonly gaps: readonly PackGapView[];
	readonly tables: readonly PackTableView[];
}

export interface BrowserPackOptions {
	readonly source: ReportSource;
	readonly rpc: RpcClient | null;
	readonly signal: AbortSignal;
	readonly onProgress: (done: number, total: number) => void;
	readonly clock?: PackClock;
}

export type BuildBrowserPack = (
	request: DataPackRequest,
	options: BrowserPackOptions,
) => Promise<BrowserPack>;

const SEVERITY_ORDER: readonly GapSeverity[] = ["high", "medium", "low"];

function stopped(): DOMException {
	return new DOMException("The pack build was stopped", "AbortError");
}

async function guarded<T>(
	signal: AbortSignal,
	run: () => Promise<T>,
): Promise<T> {
	if (signal.aborted) throw stopped();
	const result = await run();
	if (signal.aborted) throw stopped();
	return result;
}

export function stoppableSource(
	source: ReportSource,
	signal: AbortSignal,
): ReportSource {
	return {
		kind: source.kind,
		call: (name, args) => guarded(signal, () => source.call(name, args)),
		callTheme: (name, args) =>
			guarded(signal, () => source.callTheme(name, args)),
	};
}

export function packFence(
	rpc: RpcClient,
	storeIds: readonly string[],
): () => Promise<string> {
	return async () => {
		const { data, error } = await rpc.rpc("pack_fence", {
			store_ids: [...storeIds],
		});
		if (error) throw new Error(`pack_fence: ${error.message}`);
		if (typeof data !== "string") {
			throw new Error("pack_fence returned no text");
		}
		return data;
	};
}

function isGapCode(code: string): code is PackGapCode {
	return Object.hasOwn(PACK_GAPS, code);
}

export function packGaps(pack: DataPack): PackGapView[] {
	const table = pack.tables.gaps;
	if (table === undefined) return [];
	const valueAt = table.columns.findIndex((column) => column.name === "value");
	const gaps: PackGapView[] = [];
	for (const [key, cells] of Object.entries(table.rows)) {
		const slash = key.indexOf("/");
		const code = slash < 0 ? key : key.slice(0, slash);
		if (!isGapCode(code)) continue;
		const value = valueAt < 0 ? null : cells[valueAt];
		gaps.push({
			code,
			scope: slash < 0 ? "" : key.slice(slash + 1),
			value: typeof value === "number" ? value : null,
			severity: PACK_GAPS[code].severity,
			setting: PACK_GAPS[code].setting,
		});
	}
	return gaps
		.map((gap, index) => ({ gap, index }))
		.sort(
			(left, right) =>
				SEVERITY_ORDER.indexOf(left.gap.severity) -
					SEVERITY_ORDER.indexOf(right.gap.severity) ||
				left.index - right.index,
		)
		.map(({ gap }) => gap);
}

export function packTables(pack: DataPack): PackTableView[] {
	return Object.entries(pack.tables).map(([id, table]) => ({
		id,
		title: table.title,
		rows: Object.keys(table.rows).length,
	}));
}

export const buildBrowserPack: BuildBrowserPack = async (request, options) => {
	const { signal } = options;
	const fence =
		options.rpc === null ? null : packFence(options.rpc, request.storeIds);
	const built = await buildDataPack(request, {
		source: stoppableSource(options.source, signal),
		clock: options.clock ?? { now: () => new Date() },
		fence: fence === null ? null : () => guarded(signal, fence),
		onProgress: options.onProgress,
	});
	if (signal.aborted) throw stopped();
	const validation = await validatePack(built.pack);
	if (!validation.valid) {
		throw new DataPackError(
			"pack_invalid",
			validation.issues.map((issue) => issue.code).join(", "),
		);
	}
	const { pack } = built;
	return {
		text: built.text,
		bundle: chatBundle(pack),
		packId: built.packId,
		estimatedTokens: built.estimatedTokens,
		trimmed: pack.budget.trimmed,
		asOf: pack.request.as_of,
		horizon: pack.request.horizon,
		language: pack.request.language,
		sample: pack.sample,
		stores: pack.request.stores,
		gaps: packGaps(pack),
		tables: packTables(pack),
	};
};
