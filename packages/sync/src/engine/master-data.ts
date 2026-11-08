import type { CanonicalCatalog, CanonicalStore } from "@fnb/core";
import { mapCatalog, mergeCatalogs } from "../mapping/catalog.js";
import { toCanonicalStore, toStoreUpsert } from "../mapping/store.js";
import type { AccountRecord, StoreRecord, TableCounts } from "../rows.js";
import { ConnectorCaller } from "./connector-calls.js";
import { addCounts, sortedCounts } from "./counts.js";
import { FlagCollector } from "./flags.js";
import { createRedactor, safeErrorMessage } from "./redact.js";
import { runRows } from "./run-record.js";
import {
	MasterDataRunError,
	type MasterDataSummary,
	type SyncEngineOptions,
} from "./types.js";

function byExternalId(left: CanonicalStore, right: CanonicalStore): number {
	return left.externalId < right.externalId
		? -1
		: left.externalId > right.externalId
			? 1
			: 0;
}

export async function runSyncMasterData(
	options: SyncEngineOptions,
	account: AccountRecord,
): Promise<MasterDataSummary> {
	const now = options.now ?? (() => new Date());
	const redact = options.redact ?? createRedactor();
	const startedAt = now();
	const caller = new ConnectorCaller(options.calls);
	const flags = new FlagCollector();
	const tables: TableCounts = {};
	const stores = { discovered: 0, active: 0, deactivated: 0 };
	const runId = await options.repository.openRun({
		tenant_id: account.tenant_id,
		pos_account_id: account.id,
		kind: "master_data",
		range_start: null,
		range_end: null,
		started_at: startedAt.toISOString(),
		triggered_by: options.triggeredBy ?? null,
	});

	const finish = async (
		status: MasterDataSummary["status"],
		error: string | null,
	): Promise<MasterDataSummary> => {
		const finishedAt = now();
		const summary: MasterDataSummary = {
			runId,
			status,
			error,
			startedAt: startedAt.toISOString(),
			finishedAt: finishedAt.toISOString(),
			durationMs: finishedAt.getTime() - startedAt.getTime(),
			connectorCalls: caller.calls,
			retries: caller.retried,
			stores,
			tables: sortedCounts(tables),
			flags: flags.list(),
		};
		await options.repository.closeRun(runId, {
			status,
			finished_at: summary.finishedAt,
			error_message: error,
			rows_upserted: runRows(tables, {
				connectorCalls: caller.calls,
				retries: caller.retried,
				flags,
			}),
		});
		return summary;
	};

	try {
		const { connector } = options;
		const discovered = [
			...(await caller.call("stores", () => connector.discoverStores())),
		].sort(byExternalId);
		stores.discovered = discovered.length;
		if (discovered.length === 0) {
			throw new Error(
				"the connector discovered no store; refusing to mark every store of the account inactive",
			);
		}
		for (const store of discovered) {
			if (store.currency !== account.tenant_currency) {
				flags.add("store_currency_differs_from_tenant", "warn");
			}
		}
		const upserted = await options.repository.upsertStores(
			account,
			discovered.map(toStoreUpsert),
		);
		addCounts(tables, upserted.counts);
		const active = upserted.stores.filter((store: StoreRecord) => store.active);
		stores.active = active.length;
		stores.deactivated = upserted.stores.length - active.length;
		const catalogs: CanonicalCatalog[] = [];
		for (const store of active) {
			catalogs.push(
				await caller.call("catalog", () =>
					connector.fetchCatalog(
						toCanonicalStore(store, account.tenant_currency),
					),
				),
			);
		}
		const capabilities = connector.describe().capabilities;
		const write = mapCatalog(mergeCatalogs(catalogs), {
			tenantId: account.tenant_id,
			posAccountId: account.id,
			includeCosts: capabilities.costs,
			...(options.paymentKinds ? { paymentKinds: options.paymentKinds } : {}),
		});
		addCounts(tables, await options.repository.replaceCatalog(write));
	} catch (error) {
		const summary = await finish("failed", safeErrorMessage(error, redact));
		throw new MasterDataRunError(
			summary.error ?? "master data sync failed",
			summary,
			{
				cause: error,
			},
		);
	}
	return finish("succeeded", null);
}
