import type postgres from "postgres";
import {
	argumentNames,
	argumentSqlType,
	isAnalyticsFunctionName,
	isThemeFunctionName,
	type RpcClient,
	themeArgumentNames,
} from "../../src/index.js";

const rawText = (value: string) => value;

export const LIVE_CONNECTION_OPTIONS: postgres.Options<
	Record<string, postgres.PostgresType>
> = {
	max: 2,
	onnotice: () => {},
	types: {
		rawDates: {
			to: 1082,
			from: [1082, 1114, 1184],
			serialize: rawText,
			parse: rawText,
		},
	},
};

export interface TimedCall {
	readonly fn: string;
	readonly milliseconds: number;
}

export interface PostgresRpcClient extends RpcClient {
	readonly calls: TimedCall[];
}

function arrayLiteral(values: readonly unknown[]): string {
	return `{${values
		.map(
			(value) =>
				`"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
		)
		.join(",")}}`;
}

function knownArguments(fn: string): readonly string[] {
	if (isAnalyticsFunctionName(fn)) return argumentNames(fn);
	if (isThemeFunctionName(fn)) return themeArgumentNames(fn);
	throw new Error(`${fn} is not a report function`);
}

export function statementFor(
	fn: string,
	args: Readonly<Record<string, unknown>>,
): { text: string; params: unknown[] } {
	const known = new Set(knownArguments(fn));
	const params: unknown[] = [];
	const parts: string[] = [];
	for (const [name, value] of Object.entries(args)) {
		if (value === undefined) continue;
		const type = argumentSqlType(name);
		if (!known.has(name) || type === undefined) {
			throw new Error(`${fn} takes no argument named ${name}`);
		}
		params.push(
			value === null
				? null
				: Array.isArray(value)
					? arrayLiteral(value)
					: typeof value === "number"
						? String(value)
						: value,
		);
		parts.push(`${name} => $${params.length}::${type}`);
	}
	return {
		text: `select * from public.${fn}(${parts.join(", ")})`,
		params,
	};
}

export function asMember<Result>(
	sql: postgres.Sql,
	userId: string,
	run: (transaction: postgres.TransactionSql) => Promise<Result>,
): Promise<Result> {
	const claims = JSON.stringify({ sub: userId, role: "authenticated" });
	return sql.begin("read only", async (transaction) => {
		await transaction.unsafe("set local role authenticated");
		await transaction.unsafe(
			"select set_config('request.jwt.claims', $1, true)",
			[claims],
		);
		return run(transaction);
	}) as Promise<Result>;
}

export function createPostgresRpcClient(
	sql: postgres.Sql,
	userId: string,
): PostgresRpcClient {
	const calls: TimedCall[] = [];
	return {
		calls,
		async rpc(fn, args) {
			let statement: { text: string; params: unknown[] };
			try {
				statement = statementFor(fn, args);
			} catch (error) {
				return {
					data: null,
					error: { message: (error as Error).message, code: "invalid_call" },
				};
			}
			const started = performance.now();
			try {
				const rows = await asMember(sql, userId, (transaction) =>
					transaction.unsafe(
						statement.text,
						statement.params as postgres.ParameterOrJSON<never>[],
					),
				);
				calls.push({ fn, milliseconds: performance.now() - started });
				return { data: [...rows], error: null };
			} catch (error) {
				calls.push({ fn, milliseconds: performance.now() - started });
				const failure = error as { message?: string; code?: string };
				return {
					data: null,
					error: {
						message: failure.message ?? "the call failed",
						...(failure.code === undefined ? {} : { code: failure.code }),
					},
				};
			}
		},
	};
}

export function serialRpcClient(client: PostgresRpcClient): PostgresRpcClient {
	let queue: Promise<unknown> = Promise.resolve();
	return {
		calls: client.calls,
		rpc(fn, args) {
			const next = queue.then(() => client.rpc(fn, args));
			queue = next.catch(() => undefined);
			return next;
		},
	};
}
