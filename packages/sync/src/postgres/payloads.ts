import type { ISql } from "postgres";
import { salePayloadRecord } from "../payloads.js";
import type { StoreDayWrite } from "../rows.js";

export async function storeSalePayloads(
	sql: ISql,
	write: StoreDayWrite,
): Promise<number> {
	if (write.sales.length === 0) {
		return 0;
	}
	const [result] = await sql<{ records: number }[]>`
		select app.store_sale_payloads(
			${write.tenant_id}::uuid,
			${write.store_id}::uuid,
			${write.business_date}::date,
			${write.sales.map(salePayloadRecord)}::text[]
		) as records
	`;
	return result?.records ?? 0;
}
