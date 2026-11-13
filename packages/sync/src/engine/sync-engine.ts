import type { BusinessDateWindow } from "@fnb/connector-core";
import type { AccountRecord, StoreRecord } from "../rows.js";
import { runSyncIncremental } from "./incremental.js";
import { runSyncMasterData } from "./master-data.js";
import type {
	IncrementalOptions,
	IncrementalSummary,
	MasterDataSummary,
	SyncEngineOptions,
	SyncWindowKind,
	WindowOptions,
	WindowSummary,
} from "./types.js";
import { runSyncWindow } from "./window.js";

export class SyncEngine {
	private readonly options: SyncEngineOptions;

	constructor(options: SyncEngineOptions) {
		this.options = options;
	}

	syncMasterData(account: AccountRecord): Promise<MasterDataSummary> {
		return runSyncMasterData(this.options, account);
	}

	syncWindow(
		account: AccountRecord,
		stores: readonly StoreRecord[],
		window: BusinessDateWindow,
		kind: SyncWindowKind,
		options: WindowOptions = {},
	): Promise<WindowSummary> {
		return runSyncWindow(this.options, account, stores, window, kind, options);
	}

	syncIncremental(
		account: AccountRecord,
		store: StoreRecord,
		options: IncrementalOptions = {},
	): Promise<IncrementalSummary> {
		return runSyncIncremental(this.options, account, store, options);
	}
}
