import {
	argumentNames,
	isAnalyticsFunctionName,
} from "../contract/functions.js";
import { argumentSqlType } from "../themes/argument-types.js";
import { isThemeFunctionName, themeArgumentNames } from "../themes/contract.js";
import { ARGUMENT_LIMIT_CODE, type RpcClient } from "./source.js";

export const INVALID_CALL_CODE = "invalid_call";

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

export interface ReportJsonStatement {
	readonly text: string;
	readonly params: readonly (string | null)[];
}

export interface UnsafeQueryable {
	unsafe(
		query: string,
		parameters?: never[],
	): PromiseLike<readonly Record<string, unknown>[]>;
}

export class ReportJsonCallError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "ReportJsonCallError";
		this.code = code;
	}
}

function invalidCall(message: string): never {
	throw new ReportJsonCallError(INVALID_CALL_CODE, message);
}

function arrayElement(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	if (
		typeof value !== "string" &&
		typeof value !== "number" &&
		typeof value !== "boolean"
	) {
		invalidCall("an array argument holds an unsupported value");
	}
	const text = String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
	return `"${text}"`;
}

function parameterText(value: unknown): string | null {
	if (value === null) return null;
	if (Array.isArray(value)) {
		return `{${value.map(arrayElement).join(",")}}`;
	}
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			invalidCall("a number argument is not finite");
		}
		return String(value);
	}
	if (typeof value === "string") return value;
	return invalidCall("an argument has an unsupported type");
}

function knownArguments(fn: string): ReadonlySet<string> {
	if (!SQL_IDENTIFIER.test(fn)) {
		return invalidCall("not a report function");
	}
	if (isAnalyticsFunctionName(fn)) return new Set(argumentNames(fn));
	if (isThemeFunctionName(fn)) return new Set(themeArgumentNames(fn));
	return invalidCall("not a report function");
}

export function reportJsonStatement(
	fn: string,
	args: Readonly<Record<string, unknown>>,
): ReportJsonStatement {
	const known = knownArguments(fn);
	const params: (string | null)[] = [];
	const parts: string[] = [];
	for (const [argument, value] of Object.entries(args)) {
		if (value === undefined) continue;
		const type = argumentSqlType(argument);
		if (!known.has(argument) || type === undefined) {
			invalidCall(`${fn} takes no argument named ${argument}`);
		}
		params.push(parameterText(value));
		parts.push(`${argument} => $${params.length}::${type}`);
	}
	return {
		text: `select coalesce(jsonb_agg(to_jsonb(r) - 'ordinality' order by r.ordinality), '[]'::jsonb) as rows from public.${fn}(${parts.join(", ")}) with ordinality as r`,
		params,
	};
}

function errorField(error: unknown, field: "code" | "message"): string | null {
	if (typeof error !== "object" || error === null) return null;
	const value = (error as Readonly<Record<string, unknown>>)[field];
	return typeof value === "string" ? value : null;
}

function databaseMessage(fn: string, error: unknown): string {
	const code = errorField(error, "code");
	const message = errorField(error, "message");
	return code === ARGUMENT_LIMIT_CODE && message !== null
		? message
		: `${fn} failed in the database`;
}

export function createJsonRpcClient(queryable: UnsafeQueryable): RpcClient {
	return {
		async rpc(fn, args) {
			let statement: ReportJsonStatement;
			try {
				statement = reportJsonStatement(fn, args);
			} catch (error) {
				return {
					data: null,
					error: {
						message:
							error instanceof Error ? error.message : "invalid report call",
						code: INVALID_CALL_CODE,
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
				const code = errorField(error, "code");
				return {
					data: null,
					error: {
						message: databaseMessage(fn, error),
						...(code === null ? {} : { code }),
					},
				};
			}
		},
	};
}
