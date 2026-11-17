import {
	type AnalyticsArgs,
	type AnalyticsFunctionName,
	isAnalyticsFunctionName,
	type ReportFunctionName,
	type ReportSource,
	type RpcClient,
	type ThemeArgs,
	type ThemeFunctionName,
} from "@fnb/reports";
import { formatDecimal } from "../../../src/pack/decimal.js";

export type RowsOverride = (
	rows: readonly Record<string, unknown>[],
	args: Readonly<Record<string, unknown>>,
) => readonly Record<string, unknown>[];

export function overriddenSource(
	base: ReportSource,
	overrides: Partial<Record<ReportFunctionName, RowsOverride>>,
): ReportSource {
	const apply = <Row>(
		name: ReportFunctionName,
		args: object,
		rows: Row[],
	): Row[] => {
		const override = overrides[name];
		return override === undefined
			? rows
			: (override(
					rows as unknown as Record<string, unknown>[],
					args as Record<string, unknown>,
				) as unknown as Row[]);
	};
	return {
		kind: base.kind,
		async call<N extends AnalyticsFunctionName>(
			name: N,
			args: AnalyticsArgs<N>,
		) {
			return apply(name, args, await base.call(name, args));
		},
		async callTheme<N extends ThemeFunctionName>(name: N, args: ThemeArgs<N>) {
			return apply(name, args, await base.callTheme(name, args));
		},
	};
}

export function shuffled<Row>(rows: readonly Row[], seed: number): Row[] {
	const copy = [...rows];
	let state = seed >>> 0;
	for (let index = copy.length - 1; index > 0; index -= 1) {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		const other = state % (index + 1);
		const swap = copy[index] as Row;
		copy[index] = copy[other] as Row;
		copy[other] = swap;
	}
	return copy;
}

export function shuffledSource(base: ReportSource, seed: number): ReportSource {
	const shuffle = (rows: readonly Record<string, unknown>[]) =>
		shuffled(rows, seed + rows.length);
	return {
		kind: base.kind,
		async call<N extends AnalyticsFunctionName>(
			name: N,
			args: AnalyticsArgs<N>,
		) {
			return shuffle(
				(await base.call(name, args)) as unknown as Record<string, unknown>[],
			) as never;
		},
		async callTheme<N extends ThemeFunctionName>(name: N, args: ThemeArgs<N>) {
			return shuffle(
				(await base.callTheme(name, args)) as unknown as Record<
					string,
					unknown
				>[],
			) as never;
		},
	};
}

export type RowShape = "postgrest" | "jsonb";

function mapIds(value: unknown, map: ReadonlyMap<string, string>): unknown {
	if (typeof value === "string") return map.get(value) ?? value;
	if (Array.isArray(value)) return value.map((item) => mapIds(item, map));
	return value;
}

function numberText(value: number): string {
	const text = formatDecimal(value);
	return text.includes(".") ? `${text}0` : text;
}

function reshape(
	row: Record<string, unknown>,
	shape: RowShape,
	toLive: ReadonlyMap<string, string>,
): Record<string, unknown> {
	const entries = Object.entries(row).map(([key, value]): [string, unknown] => {
		if (key === "store_id") return [key, mapIds(value, toLive)];
		if (typeof value === "string" && value.endsWith(".000Z")) {
			return [key, `${value.slice(0, -5)}+00:00`];
		}
		if (shape === "jsonb" && typeof value === "number") {
			return [key, numberText(value)];
		}
		return [key, value];
	});
	if (shape === "postgrest") entries.reverse();
	else
		entries.sort(
			([left], [right]) =>
				left.length - right.length || (left < right ? -1 : 1),
		);
	return Object.fromEntries(entries);
}

export function rpcClientOver(
	base: ReportSource,
	shape: RowShape,
	liveIds: ReadonlyMap<string, string>,
): RpcClient {
	const toBase = new Map([...liveIds].map(([demo, live]) => [live, demo]));
	return {
		async rpc(fn, args) {
			const baseArgs = Object.fromEntries(
				Object.entries(args).map(([key, value]) => [
					key,
					key === "store_ids" ? mapIds(value, toBase) : value,
				]),
			);
			try {
				const rows = isAnalyticsFunctionName(fn)
					? await base.call(fn, baseArgs as never)
					: await base.callTheme(fn as ThemeFunctionName, baseArgs as never);
				return {
					data: (rows as unknown as Record<string, unknown>[]).map((row) =>
						reshape(row, shape, liveIds),
					),
					error: null,
				};
			} catch (error) {
				return {
					data: null,
					error: {
						message: (error as Error).message,
						code: (error as { code?: string }).code ?? "XX000",
					},
				};
			}
		},
	};
}
