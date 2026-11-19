import type { BusinessDateWindow } from "@fnb/connector-core";
import type { ISql } from "postgres";
import type {
	IncrementalTicket,
	RunnerDatabase,
	TicketSource,
} from "../database.js";
import type { IposDataSource } from "../ipos-source.js";
import type {
	FastLaneRun,
	LoyaltyCounts,
	LoyaltyDatabase,
} from "../loyalty.js";

const MISSING_OBJECT_CODES = new Set(["42P01", "42883"]);

function isMissingObject(error: unknown): boolean {
	return (
		error !== null &&
		typeof error === "object" &&
		"code" in error &&
		MISSING_OBJECT_CODES.has(String(error.code))
	);
}

interface TicketRow {
	tenant_id: string;
	store_id: string;
	due_at: Date;
	source: TicketSource;
}

function countsOnly(value: unknown): LoyaltyCounts {
	const counts: Record<string, number> = {};
	if (value !== null && typeof value === "object") {
		for (const [key, entry] of Object.entries(value)) {
			if (typeof entry === "number" && Number.isFinite(entry)) {
				counts[key] = entry;
			}
		}
	}
	return counts;
}

export class PostgresRunnerDatabase implements RunnerDatabase, LoyaltyDatabase {
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

	async iposSource(tenantId: string): Promise<IposDataSource | null> {
		try {
			const [row] = await this.sql<{ source: IposDataSource }[]>`
				select source from app.tenant_ipos_sources where tenant_id = ${tenantId}::uuid
			`;
			return row?.source ?? null;
		} catch (error) {
			if (isMissingObject(error)) {
				return null;
			}
			throw error;
		}
	}

	async claimIposSource(
		tenantId: string,
		source: IposDataSource,
	): Promise<IposDataSource | null> {
		try {
			const [row] = await this.sql<{ source: IposDataSource }[]>`
				select app.claim_ipos_source(${tenantId}::uuid, ${source}) as source
			`;
			return row?.source ?? null;
		} catch (error) {
			if (isMissingObject(error)) {
				return null;
			}
			throw error;
		}
	}

	async reconcileLoyalty(
		tenantId: string,
		window: BusinessDateWindow,
		at: Date,
	): Promise<LoyaltyCounts | null> {
		try {
			const [row] = await this.sql<{ counts: Record<string, unknown> }[]>`
				select app.reconcile_loyalty(
					${tenantId}::uuid, ${window.fromDate}::date, ${window.toDate}::date, ${at.toISOString()}::timestamptz
				) as counts
			`;
			if (!row || typeof row.counts.skipped === "string") {
				return null;
			}
			return countsOnly(row.counts);
		} catch (error) {
			if (isMissingObject(error)) {
				return null;
			}
			throw error;
		}
	}

	async loyaltyNightly(tenantId: string, at: Date): Promise<LoyaltyCounts> {
		const [row] = await this.sql<{ counts: Record<string, unknown> }[]>`
			select app.loyalty_nightly(${tenantId}::uuid, ${at.toISOString()}::timestamptz) as counts
		`;
		return countsOnly(row?.counts);
	}

	async loyaltyTenants(): Promise<{ tenantId: string; slug: string }[]> {
		const rows = await this.sql<{ tenant_id: string; slug: string }[]>`
			select tenant_id, slug from app.loyalty_tenants()
		`;
		return rows.map((row) => ({ tenantId: row.tenant_id, slug: row.slug }));
	}

	async claimFastLaneRuns(at: Date, limit: number): Promise<FastLaneRun[]> {
		const rows = await this.sql<
			{
				run_id: string;
				tenant_id: string;
				store_id: string;
				window_from: Date;
				window_to: Date;
			}[]
		>`
			select run_id, tenant_id, store_id, window_from, window_to
			from app.claim_fast_lane_runs(${at.toISOString()}::timestamptz, ${limit}::integer)
		`;
		return rows.map((row) => ({
			runId: row.run_id,
			tenantId: row.tenant_id,
			storeId: row.store_id,
			windowFrom: row.window_from.toISOString(),
			windowTo: row.window_to.toISOString(),
		}));
	}

	async finishFastLaneRun(
		runId: string,
		outcome: string,
		at: Date,
	): Promise<void> {
		await this.sql`
			select app.finish_fast_lane_run(${runId}::uuid, ${outcome}, ${at.toISOString()}::timestamptz)
		`;
	}
}
