import type { Sql } from "postgres";
import { asMemberWriting } from "./member-snapshot.js";

export async function resendMessageAs(
	sql: Sql,
	memberUserId: string,
	messageId: string,
): Promise<string | null> {
	return asMemberWriting(sql, memberUserId, async (transaction) => {
		const [row] = await transaction<{ id: string | null }[]>`
			select public.resend_message(${messageId}::uuid)::text as id
		`;
		return row?.id ?? null;
	});
}
