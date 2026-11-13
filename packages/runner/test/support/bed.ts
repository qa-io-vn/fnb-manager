import {
	type AccountRecord,
	InMemorySyncRepository,
	type StoreRecord,
} from "@fnb/sync";
import type {
	AccountEntry,
	IncrementalTicket,
	RunnerDatabase,
} from "../../src/index.js";

export const FIXED_NOW = new Date("2026-11-05T03:00:00.000Z");

export class FakeRunnerDatabase implements RunnerDatabase {
	gap: number | null = null;
	enabled = true;
	readonly unwatched = new Set<string>();
	readonly longest = new Map<string, number | null>();
	readonly tickets = new Map<string, IncrementalTicket>();
	readonly gapQueries: { storeId: string; at: string }[] = [];
	readonly longestQueries: { storeId: string; from: string; to: string }[] = [];

	async claimIncrementalTicket(
		ticket: string,
	): Promise<IncrementalTicket | null> {
		const claimed = this.tickets.get(ticket) ?? null;
		this.tickets.delete(ticket);
		return claimed;
	}

	async storeWatched(storeId: string): Promise<boolean> {
		return !this.unwatched.has(storeId);
	}

	async syncGapMinutes(storeId: string, at: Date): Promise<number | null> {
		this.gapQueries.push({ storeId, at: at.toISOString() });
		return this.gap;
	}

	async longestSyncGapMinutes(
		storeId: string,
		from: Date,
		to: Date,
	): Promise<number | null> {
		this.longestQueries.push({
			storeId,
			from: from.toISOString(),
			to: to.toISOString(),
		});
		return this.longest.get(storeId) ?? null;
	}

	async incrementalScheduleEnabled(): Promise<boolean> {
		return this.enabled;
	}
}

export interface RunnerBed {
	repository: InMemorySyncRepository;
	database: FakeRunnerDatabase;
	account: AccountRecord;
	store: StoreRecord;
	entries: AccountEntry[];
}

export async function createRunnerBed(): Promise<RunnerBed> {
	const repository = new InMemorySyncRepository({ now: () => FIXED_NOW });
	const tenant = repository.addTenant("tenant-runner");
	const account = await repository.upsertAccount({
		tenant_id: tenant.id,
		connector: "mock",
		account_key: "account-key-runner",
		display_name: "Runner account",
	});
	const store = repository.addStore(account, {
		external_id: "MOCK-S1",
		name: "Cửa hàng mẫu 1",
		address: null,
		timezone: "Asia/Ho_Chi_Minh",
		business_day_start_minutes: 0,
		opened_on: "2024-01-01",
		raw: null,
	});
	return {
		repository,
		database: new FakeRunnerDatabase(),
		account,
		store,
		entries: [
			{ key: "another-key", connector: "mock", seed: 9 },
			{ key: "account-key-runner", connector: "mock", seed: 7 },
		],
	};
}
