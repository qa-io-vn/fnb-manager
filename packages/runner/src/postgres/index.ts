import type { ISql } from "postgres";
import type {
	IncrementalTicket,
	RunnerDatabase,
	TicketSource,
} from "../database.js";

interface TicketRow {
	tenant_id: string;
	store_id: string;
	due_at: Date;
	source: TicketSource;
}

export class PostgresRunnerDatabase implements RunnerDatabase {
	private readonly sql: ISql;

	constructor(sql: ISql) {
		this.sql = sql;
	}

	async claimIncrementalTicket(
		ticket: string,
	): Promise<IncrementalTicket | null> {
		const rows = await this.sql<TicketRow[]>`
			select tenant_id, store_id, due_at, source
			from app.claim_incremental_sync_ticket(${ticket}::uuid)
		`;
		const [row] = rows;
		return row
			? {
					tenantId: row.tenant_id,
					storeId: row.store_id,
					dueAt: row.due_at.toISOString(),
					source: row.source,
				}
			: null;
	}

	async storeWatched(storeId: string): Promise<boolean> {
		const [row] = await this.sql<{ watched: boolean }[]>`
			select app.incremental_sync_watched(${storeId}::uuid) as watched
		`;
		return row?.watched ?? false;
	}

	async syncGapMinutes(storeId: string, at: Date): Promise<number | null> {
		const [row] = await this.sql<{ minutes: number | null }[]>`
			select app.sync_gap_minutes(${storeId}::uuid, ${at.toISOString()}::timestamptz) as minutes
		`;
		return row?.minutes ?? null;
	}

	async longestSyncGapMinutes(
		storeId: string,
		from: Date,
		to: Date,
	): Promise<number | null> {
		const [row] = await this.sql<{ minutes: number | null }[]>`
			select app.longest_sync_gap_minutes(
				${storeId}::uuid, ${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz
			) as minutes
		`;
		return row?.minutes ?? null;
	}

	async incrementalScheduleEnabled(): Promise<boolean> {
		const [row] = await this.sql<{ enabled: boolean }[]>`
			select coalesce((select enabled from app.incremental_sync_settings), false) as enabled
		`;
		return row?.enabled ?? false;
	}
}
