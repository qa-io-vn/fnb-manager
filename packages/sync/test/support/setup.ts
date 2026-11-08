import type { PosConnector } from "@fnb/connector-core";
import {
	type AccountRecord,
	type InMemoryRepositoryOptions,
	InMemorySyncRepository,
	type StoreRecord,
	SyncEngine,
	type SyncEngineOptions,
} from "../../src/index.js";

export const FIXED_NOW = new Date("2026-11-05T03:00:00.000Z");

export interface TestBed {
	repository: InMemorySyncRepository;
	account: AccountRecord;
	store: StoreRecord;
	engine: (
		connector: PosConnector,
		options?: Partial<SyncEngineOptions>,
	) => SyncEngine;
	sleeps: number[];
}

export interface TestBedOptions extends InMemoryRepositoryOptions {
	storeExternalId?: string;
	dayStartMinutes?: number;
	timezone?: string;
}

export async function createTestBed(
	options: TestBedOptions = {},
): Promise<TestBed> {
	const repository = new InMemorySyncRepository({
		now: () => FIXED_NOW,
		...options,
	});
	const tenant = repository.addTenant("tenant-test");
	const account = await repository.upsertAccount({
		tenant_id: tenant.id,
		connector: "fake",
		account_key: "account-test",
		display_name: "Test account",
	});
	const store = repository.addStore(account, {
		external_id: options.storeExternalId ?? "STORE-1",
		name: "Cửa hàng thử",
		address: null,
		timezone: options.timezone ?? "Asia/Ho_Chi_Minh",
		business_day_start_minutes: options.dayStartMinutes ?? 0,
		opened_on: null,
		raw: null,
	});
	const sleeps: number[] = [];
	return {
		repository,
		account,
		store,
		sleeps,
		engine: (connector, overrides = {}) =>
			new SyncEngine({
				repository,
				connector,
				now: () => FIXED_NOW,
				calls: {
					sleep: async (milliseconds) => {
						sleeps.push(milliseconds);
					},
				},
				triggeredBy: "test",
				...overrides,
			}),
	};
}
