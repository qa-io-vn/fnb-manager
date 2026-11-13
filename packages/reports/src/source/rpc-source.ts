import { z } from "zod";
import {
	type AnalyticsArgs,
	type AnalyticsFunctionName,
	type AnalyticsRow,
	analyticsFunctions,
} from "../contract/functions.js";
import {
	AnalyticsCallError,
	type AnalyticsSource,
	INVALID_ARGUMENTS_CODE,
	INVALID_ROWS_CODE,
	POSSIBLE_TRUNCATION_CODE,
	type RpcClient,
} from "./source.js";

export const TRUNCATION_ROW_LIMIT = 1000;

export function withoutUndefined(
	values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(values).filter(([, value]) => value !== undefined),
	);
}

function issuesText(error: z.ZodError): string {
	return error.issues
		.slice(0, 3)
		.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`)
		.join("; ");
}

export function parseAnalyticsArgs<N extends AnalyticsFunctionName>(
	name: N,
	args: AnalyticsArgs<N>,
): Record<string, unknown> {
	const parsed = analyticsFunctions[name].args.safeParse(args);
	if (!parsed.success) {
		throw new AnalyticsCallError(
			name,
			INVALID_ARGUMENTS_CODE,
			issuesText(parsed.error),
		);
	}
	return withoutUndefined(parsed.data as Record<string, unknown>);
}

export function parseAnalyticsRows<N extends AnalyticsFunctionName>(
	name: N,
	data: unknown,
): AnalyticsRow<N>[] {
	const schema = z.array(analyticsFunctions[name].row as z.ZodType);
	const parsed = schema.safeParse(data ?? []);
	if (!parsed.success) {
		throw new AnalyticsCallError(
			name,
			INVALID_ROWS_CODE,
			issuesText(parsed.error),
		);
	}
	return parsed.data as AnalyticsRow<N>[];
}

export function createRpcAnalyticsSource(
	client: RpcClient,
	kind: "supabase" | "postgres" = "supabase",
): AnalyticsSource {
	return {
		kind,
		async call<N extends AnalyticsFunctionName>(
			name: N,
			args: AnalyticsArgs<N>,
		): Promise<AnalyticsRow<N>[]> {
			const payload = parseAnalyticsArgs(name, args);
			const { data, error } = await client.rpc(name, payload);
			if (error) {
				throw new AnalyticsCallError(name, error.code ?? null, error.message);
			}
			const rows = parseAnalyticsRows(name, data);
			if (rows.length >= TRUNCATION_ROW_LIMIT) {
				throw new AnalyticsCallError(
					name,
					POSSIBLE_TRUNCATION_CODE,
					`returned ${rows.length} rows, the response may be truncated`,
				);
			}
			return rows;
		},
	};
}
