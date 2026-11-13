import { createRpcAnalyticsSource, type RpcClient } from "@fnb/reports";
import type { Sql, TransactionSql } from "postgres";
import { jsonRpcClient, type UnsafeQueryable } from "../digest/json-source.js";
import {
	type RecordingSource,
	recordingSource,
} from "../digest/recording-source.js";

export function memberClaims(memberUserId: string): string {
	return JSON.stringify({ sub: memberUserId, role: "authenticated" });
}

async function actAsMember(
	transaction: TransactionSql,
	memberUserId: string,
): Promise<void> {
	await transaction.unsafe("set local role authenticated");
	await transaction.unsafe("set local time zone 'UTC'");
	await transaction.unsafe(
		"select set_config('request.jwt.claims', $1, true)",
		[memberClaims(memberUserId)],
	);
}

export function withMemberSnapshot<T>(
	sql: Sql,
	memberUserId: string,
	run: (source: RecordingSource, transaction: TransactionSql) => Promise<T>,
): Promise<T> {
	return sql.begin(
		"isolation level repeatable read read only",
		async (transaction) => {
			await actAsMember(transaction, memberUserId);
			const client = jsonRpcClient(transaction as unknown as UnsafeQueryable);
			return run(
				recordingSource(createRpcAnalyticsSource(client, "postgres")),
				transaction,
			);
		},
	) as Promise<T>;
}

export function perCallMemberClient(sql: Sql, memberUserId: string): RpcClient {
	return {
		rpc(fn, args) {
			return sql.begin("read only", async (transaction) => {
				await actAsMember(transaction, memberUserId);
				return jsonRpcClient(transaction as unknown as UnsafeQueryable).rpc(
					fn,
					args,
				);
			}) as Promise<Awaited<ReturnType<RpcClient["rpc"]>>>;
		},
	};
}

export async function asMember<T>(
	sql: Sql,
	memberUserId: string,
	run: (transaction: TransactionSql) => Promise<T>,
): Promise<T> {
	return sql.begin("read only", async (transaction) => {
		await actAsMember(transaction, memberUserId);
		return run(transaction);
	}) as Promise<T>;
}
