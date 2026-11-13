import type {
	AnalyticsArgs,
	AnalyticsFunctionName,
	AnalyticsRow,
} from "../contract/functions.js";

export type AnalyticsSourceKind = "supabase" | "demo" | "postgres";

export interface AnalyticsSource {
	readonly kind: AnalyticsSourceKind;
	call<N extends AnalyticsFunctionName>(
		name: N,
		args: AnalyticsArgs<N>,
	): Promise<AnalyticsRow<N>[]>;
}

export interface RpcError {
	readonly message: string;
	readonly code?: string;
}

export interface RpcClient {
	rpc(
		fn: string,
		args: Record<string, unknown>,
	): PromiseLike<{ data: unknown; error: RpcError | null }>;
}

export const INVALID_ARGUMENTS_CODE = "invalid_arguments";
export const INVALID_ROWS_CODE = "invalid_rows";
export const POSSIBLE_TRUNCATION_CODE = "possible_truncation";
export const NOT_IMPLEMENTED_CODE = "not_implemented";
export const ARGUMENT_LIMIT_CODE = "22023";

export function isArgumentLimitError(error: unknown): boolean {
	return error instanceof AnalyticsCallError
		? error.code === ARGUMENT_LIMIT_CODE
		: typeof error === "object" &&
				error !== null &&
				(error as { code?: unknown }).code === ARGUMENT_LIMIT_CODE;
}

export class AnalyticsCallError extends Error {
	readonly functionName: AnalyticsFunctionName;
	readonly code: string | null;

	constructor(
		functionName: AnalyticsFunctionName,
		code: string | null,
		message?: string,
	) {
		super(
			message === undefined
				? `${functionName} failed${code === null ? "" : ` (${code})`}`
				: `${functionName}: ${message}`,
		);
		this.name = "AnalyticsCallError";
		this.functionName = functionName;
		this.code = code;
	}
}
