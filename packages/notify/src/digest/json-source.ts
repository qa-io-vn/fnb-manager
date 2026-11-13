import {
	type AnalyticsFunctionName,
	argumentNames,
	isAnalyticsFunctionName,
	type RpcClient,
} from "@fnb/reports";

export const ARGUMENT_TYPES: Readonly<Record<string, string>> = {
	store_ids: "uuid[]",
	grain: "text",
	anchor: "date",
	from_date: "date",
	to_date: "date",
	compare_from: "date",
	compare_to: "date",
	metric_ids: "text[]",
	target_date: "date",
	weeks: "integer",
	as_of_date: "date",
	as_of: "date",
	month_start: "date",
	days: "integer",
	abs_threshold: "numeric",
	rel_threshold: "numeric",
	period_kind: "public.period_kind",
	period_start: "date",
	include_stores: "boolean",
};

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

export interface JsonStatement {
	readonly text: string;
	readonly params: readonly string[];
}

export class JsonCallError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "JsonCallError";
		this.code = code;
	}
}

function quotedElement(value: unknown): string {
	const text = String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
	return `"${text}"`;
}

function arrayLiteral(values: readonly unknown[]): string {
	return `{${values.map(quotedElement).join(",")}}`;
}

function parameterText(value: unknown): string {
	if (Array.isArray(value)) {
		return arrayLiteral(value);
	}
	if (typeof value === "boolean") {
		return value ? "true" : "false";
	}
	if (typeof value === "number" || typeof value === "string") {
		return String(value);
	}
	throw new JsonCallError(
		"invalid_call",
		"an analytics argument has an unsupported type",
	);
}

export function jsonStatementFor(
	fn: string,
	args: Readonly<Record<string, unknown>>,
): JsonStatement {
	if (!isAnalyticsFunctionName(fn) || !SQL_IDENTIFIER.test(fn)) {
		throw new JsonCallError("invalid_call", "not an analytics function");
	}
	const name: AnalyticsFunctionName = fn;
	const known = new Set(argumentNames(name));
	const params: string[] = [];
	const parts: string[] = [];
	for (const [argument, value] of Object.entries(args)) {
		if (value === undefined) {
			continue;
		}
		const type = ARGUMENT_TYPES[argument];
		if (!known.has(argument) || type === undefined) {
			throw new JsonCallError(
				"invalid_call",
				`${name} takes no argument named ${argument}`,
			);
		}
		params.push(parameterText(value));
		parts.push(`${argument} => $${params.length}::${type}`);
	}
	return {
		text: `select coalesce(jsonb_agg(to_jsonb(r) - 'ordinality' order by r.ordinality), '[]'::jsonb) as rows from public.${name}(${parts.join(", ")}) with ordinality as r`,
		params,
	};
}

export interface UnsafeQueryable {
	unsafe(
		query: string,
		parameters?: never[],
	): PromiseLike<readonly Record<string, unknown>[]>;
}

function errorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null) {
		return undefined;
	}
	const code = (error as { readonly code?: unknown }).code;
	return typeof code === "string" ? code : undefined;
}

export function jsonRpcClient(queryable: UnsafeQueryable): RpcClient {
	return {
		async rpc(fn, args) {
			let statement: JsonStatement;
			try {
				statement = jsonStatementFor(fn, args);
			} catch (error) {
				return {
					data: null,
					error: {
						message:
							error instanceof Error ? error.message : "invalid analytics call",
						code: "invalid_call",
					},
				};
			}
			try {
				const rows = await queryable.unsafe(
					statement.text,
					statement.params as unknown as never[],
				);
				const data = rows[0]?.rows;
				return { data: Array.isArray(data) ? data : [], error: null };
			} catch (error) {
				const code = errorCode(error);
				return {
					data: null,
					error: {
						message: `${fn} failed in the database`,
						...(code === undefined ? {} : { code }),
					},
				};
			}
		},
	};
}
