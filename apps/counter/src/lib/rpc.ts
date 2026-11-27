import type { SupabaseClient } from "@supabase/supabase-js";

/** A database refusal of a call: the SQLSTATE (42501 not allowed, 22023 malformed) or "network" when nothing answered. */
export class RpcError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = "RpcError";
		this.code = code;
	}
	get forbidden(): boolean {
		return this.code === "42501";
	}
	get network(): boolean {
		return this.code === "network";
	}
}

export async function rpc<T>(
	client: SupabaseClient,
	fn: string,
	args: Readonly<Record<string, unknown>> = {},
): Promise<T> {
	let answer: {
		data: unknown;
		error: { code?: string; message: string } | null;
	};
	try {
		answer = await client.rpc(fn, args);
	} catch (error) {
		throw new RpcError(
			"network",
			error instanceof Error ? error.message : "failed",
		);
	}
	if (answer.error !== null) {
		const code = answer.error.code ?? "";
		const network =
			code === "" && /fetch|network|Load failed/i.test(answer.error.message);
		throw new RpcError(
			network ? "network" : code || "unknown",
			answer.error.message,
		);
	}
	return answer.data as T;
}

/** A table read or write through PostgREST under RLS, with the same error shape. */
export async function query<T>(
	run: PromiseLike<{
		data: unknown;
		error: { code?: string; message: string } | null;
	}>,
): Promise<T> {
	let answer: {
		data: unknown;
		error: { code?: string; message: string } | null;
	};
	try {
		answer = await run;
	} catch (error) {
		throw new RpcError(
			"network",
			error instanceof Error ? error.message : "failed",
		);
	}
	if (answer.error !== null) {
		const code = answer.error.code ?? "";
		const network =
			code === "" && /fetch|network|Load failed/i.test(answer.error.message);
		throw new RpcError(
			network ? "network" : code || "unknown",
			answer.error.message,
		);
	}
	return answer.data as T;
}
