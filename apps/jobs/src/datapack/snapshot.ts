import { memberClaims } from "@fnb/notify/postgres";
import {
	createJsonRpcClient,
	createRpcReportSource,
	type ReportSource,
	type UnsafeQueryable,
} from "@fnb/reports";
import type { Sql, TransactionSql } from "postgres";

export const SNAPSHOT_MODE = "isolation level repeatable read read only";

export async function actAsMember(
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

export function withReportSnapshot<T>(
	sql: Sql,
	memberUserId: string,
	run: (source: ReportSource, transaction: TransactionSql) => Promise<T>,
): Promise<T> {
	return sql.begin(SNAPSHOT_MODE, async (transaction) => {
		await actAsMember(transaction, memberUserId);
		const client = createJsonRpcClient(
			transaction as unknown as UnsafeQueryable,
		);
		return run(createRpcReportSource(client, "postgres"), transaction);
	}) as Promise<T>;
}
