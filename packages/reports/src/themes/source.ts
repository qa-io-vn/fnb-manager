import { z } from "zod";
import {
	type AnalyticsFunctionName,
	isAnalyticsFunctionName,
} from "../contract/functions.js";
import {
	createRpcAnalyticsSource,
	TRUNCATION_ROW_LIMIT,
	withoutUndefined,
} from "../source/rpc-source.js";
import {
	type AnalyticsSource,
	type AnalyticsSourceKind,
	INVALID_ARGUMENTS_CODE,
	INVALID_ROWS_CODE,
	POSSIBLE_TRUNCATION_CODE,
	type RpcClient,
} from "../source/source.js";
import {
	type ThemeArgs,
	type ThemeFunctionName,
	type ThemeRow,
	themeFunctions,
} from "./contract.js";

export interface ThemeSource {
	readonly kind: AnalyticsSourceKind;
	callTheme<N extends ThemeFunctionName>(
		name: N,
		args: ThemeArgs<N>,
	): Promise<ThemeRow<N>[]>;
}

export type ReportSource = AnalyticsSource & ThemeSource;
export type ReportFunctionName = AnalyticsFunctionName | ThemeFunctionName;

export class ThemeCallError extends Error {
	readonly functionName: ThemeFunctionName;
	readonly code: string | null;

	constructor(
		functionName: ThemeFunctionName,
		code: string | null,
		message?: string,
	) {
		super(
			message === undefined
				? `${functionName} failed${code === null ? "" : ` (${code})`}`
				: `${functionName}: ${message}`,
		);
		this.name = "ThemeCallError";
		this.functionName = functionName;
		this.code = code;
	}
}

function issuesText(error: z.ZodError): string {
	return error.issues
		.slice(0, 3)
		.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`)
		.join("; ");
}

export function parseThemeArgs<N extends ThemeFunctionName>(
	name: N,
	args: ThemeArgs<N>,
): Record<string, unknown> {
	const parsed = themeFunctions[name].args.safeParse(args);
	if (!parsed.success) {
		throw new ThemeCallError(
			name,
			INVALID_ARGUMENTS_CODE,
			issuesText(parsed.error),
		);
	}
	return withoutUndefined(parsed.data as Record<string, unknown>);
}

export function parseThemeRows<N extends ThemeFunctionName>(
	name: N,
	data: unknown,
): ThemeRow<N>[] {
	const schema = z.array(themeFunctions[name].row as z.ZodType);
	const parsed = schema.safeParse(data ?? []);
	if (!parsed.success) {
		throw new ThemeCallError(name, INVALID_ROWS_CODE, issuesText(parsed.error));
	}
	return parsed.data as ThemeRow<N>[];
}

export function createRpcReportSource(
	client: RpcClient,
	kind: "supabase" | "postgres" = "supabase",
): ReportSource {
	const analytics = createRpcAnalyticsSource(client, kind);
	return {
		kind,
		call: analytics.call,
		async callTheme<N extends ThemeFunctionName>(
			name: N,
			args: ThemeArgs<N>,
		): Promise<ThemeRow<N>[]> {
			const payload = parseThemeArgs(name, args);
			const { data, error } = await client.rpc(name, payload);
			if (error) {
				throw new ThemeCallError(name, error.code ?? null, error.message);
			}
			const rows = parseThemeRows(name, data);
			if (rows.length >= TRUNCATION_ROW_LIMIT) {
				throw new ThemeCallError(
					name,
					POSSIBLE_TRUNCATION_CODE,
					`returned ${rows.length} rows, the response may be truncated`,
				);
			}
			return rows;
		},
	};
}

export function isReportFunctionName(name: string): name is ReportFunctionName {
	return isAnalyticsFunctionName(name) || Object.hasOwn(themeFunctions, name);
}
