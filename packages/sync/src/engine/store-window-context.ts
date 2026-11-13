import type {
	BusinessDateWindow,
	ConnectorCapabilities,
	PosConnector,
} from "@fnb/connector-core";
import type { PaymentKind } from "@fnb/core";
import type { SyncRepository } from "../repository.js";
import type { AccountRecord, StoreRecord, TableCounts } from "../rows.js";
import type { CheckTolerance } from "./checks.js";
import type { ConnectorCaller } from "./connector-calls.js";
import type { FlagCollector } from "./flags.js";

export interface StoreWindowContext {
	repository: SyncRepository;
	connector: PosConnector;
	caller: ConnectorCaller;
	flags: FlagCollector;
	account: AccountRecord;
	window: BusinessDateWindow;
	dryRun: boolean;
	detectedAt: string;
	tolerance: CheckTolerance;
	paymentKinds: Readonly<Record<string, PaymentKind>>;
	tables: TableCounts;
	signal?: AbortSignal;
}

export interface StoreScope {
	context: StoreWindowContext;
	store: StoreRecord;
	capabilities: ConnectorCapabilities;
	dates: readonly string[];
}

export function byExternalIdText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
