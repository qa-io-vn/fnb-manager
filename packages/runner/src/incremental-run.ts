import { ConnectorAuthError } from "@fnb/connector-core";
import type { FetchLike } from "@fnb/connector-ipos";
import {
	type AccountRecord,
	type IncrementalOptions,
	IncrementalRunError,
	type IncrementalSummary,
	incrementalWindow,
	type Redactor,
	type StoreRecord,
	SyncEngine,
	type SyncRepository,
	safeErrorMessage,
} from "@fnb/sync";
import {
	AccountConfigError,
	type AccountEntry,
	entryForKey,
} from "./accounts.js";
import {
	connectAccount,
	type RunnerEnvironment,
	repositoryTokenStore,
} from "./connectors.js";
import type { RunnerDatabase } from "./database.js";
import { DEAD_MAN_THRESHOLD_MINUTES, isStale } from "./dead-man.js";
import {
	type IposApiMode,
	type IposSnapshots,
	iposApiMode,
} from "./ipos-mode.js";
import { guardIposTenant, IposSourceError } from "./ipos-source.js";
import { accountLabel, storeLabel } from "./labels.js";
import {
	type LoyaltyStepOutcome,
	loyaltyLine,
	reconcileLoyaltySafely,
} from "./loyalty.js";
import {
	authFailedNotification,
	type NotificationSubject,
	type Notifier,
	notifySafely,
	runFailedNotification,
	staleSyncNotification,
} from "./notifier.js";

export type SkipReason =
	| "store_unknown"
	| "store_inactive"
	| "account_paused"
	| "account_auth_failed";

export type FailureStage = "config" | "connect" | "auth" | "run";

export type IncrementalStoreOutcome =
	| { kind: "skipped"; label: string; reason: SkipReason }
	| {
			kind: "failed";
			label: string;
			stage: FailureStage;
			error: string;
			summary: IncrementalSummary | null;
			minutesWithoutSync: number | null;
			httpRequests: number;
			ipos: IposApiMode | null;
	  }
	| {
			kind: "ran";
			label: string;
			summary: IncrementalSummary;
			minutesWithoutSync: number | null;
			httpRequests: number;
			ipos: IposApiMode | null;
			loyalty?: LoyaltyStepOutcome;
	  };

export interface IncrementalStoreRunInput {
	repository: SyncRepository;
	database: RunnerDatabase;
	entries: readonly AccountEntry[];
	environment: RunnerEnvironment;
	storeId: string;
	notifier: Notifier;
	redact: Redactor;
	triggeredBy: string;
	now?: () => Date;
	fetch?: FetchLike;
	snapshots?: IposSnapshots;
	incremental?: IncrementalOptions;
	retryAuthFailed?: boolean;
	deadManThresholdMinutes?: number;
	log?: (line: string) => void;
}

function skipReason(
	account: AccountRecord,
	store: StoreRecord,
	retryAuthFailed: boolean,
): SkipReason | null {
	if (!store.active) {
		return "store_inactive";
	}
	if (account.status === "paused") {
		return "account_paused";
	}
	return account.status === "auth_failed" && !retryAuthFailed
		? "account_auth_failed"
		: null;
}

export async function markAuthFailed(
	repository: Pick<SyncRepository, "updateAccountStatus">,
	accountId: string,
): Promise<boolean> {
	return repository.updateAccountStatus(accountId, "auth_failed", [
		"active",
		"error",
	]);
}

export async function clearAuthFailure(
	repository: Pick<SyncRepository, "updateAccountStatus">,
	account: Pick<AccountRecord, "id" | "status">,
): Promise<boolean> {
	return account.status === "auth_failed"
		? repository.updateAccountStatus(account.id, "active", ["auth_failed"])
		: false;
}

async function recordFailedRun(
	input: IncrementalStoreRunInput,
	account: AccountRecord,
	store: StoreRecord,
	stage: FailureStage,
	error: string,
	at: Date,
): Promise<string> {
	const window = incrementalWindow(store, at, input.incremental?.days);
	const runId = await input.repository.openRun({
		tenant_id: account.tenant_id,
		pos_account_id: account.id,
		store_id: store.id,
		store_ids: [store.id],
		kind: "incremental",
		range_start: window.fromDate,
		range_end: window.toDate,
		started_at: at.toISOString(),
		triggered_by: input.triggeredBy,
	});
	await input.repository.closeRun(runId, {
		status: "failed",
		finished_at: (input.now ?? (() => new Date()))().toISOString(),
		error_message: error,
		rows_upserted: { summary: { stage, connector_calls: 0 } },
	});
	return runId;
}

async function sourceRefusal(
	input: IncrementalStoreRunInput,
	tenantId: string,
): Promise<string | null> {
	try {
		await guardIposTenant(
			input.database,
			tenantId,
			iposApiMode(input.environment),
			{ claim: true },
		);
		return null;
	} catch (error) {
		if (
			error instanceof IposSourceError ||
			error instanceof AccountConfigError
		) {
			return safeErrorMessage(error, input.redact);
		}
		throw error;
	}
}

export async function runIncrementalStore(
	input: IncrementalStoreRunInput,
): Promise<IncrementalStoreOutcome> {
	const now = input.now ?? (() => new Date());
	const log = input.log ?? ((line: string) => console.warn(line));
	const threshold = input.deadManThresholdMinutes ?? DEAD_MAN_THRESHOLD_MINUTES;
	const context = await input.repository.findStore(input.storeId);
	if (!context) {
		return {
			kind: "skipped",
			label: "an unknown store",
			reason: "store_unknown",
		};
	}
	const { account, store } = context;
	const stores = await input.repository.listStores(account.id);
	const label = `${accountLabel(input.entries, account.account_key)} ${storeLabel(stores, store.id)}`;
	const skipped = skipReason(account, store, input.retryAuthFailed ?? false);
	if (skipped) {
		return { kind: "skipped", label, reason: skipped };
	}
	const numbered = entryForKey(input.entries, account.account_key);
	if (numbered?.entry.connector === "ipos-fabi") {
		const refused = await sourceRefusal(input, account.tenant_id);
		if (refused !== null) {
			return {
				kind: "failed",
				label,
				stage: "config",
				error: refused,
				summary: null,
				minutesWithoutSync: null,
				httpRequests: 0,
				ipos: null,
			};
		}
	}
	const subject: NotificationSubject = {
		tenantId: account.tenant_id,
		accountId: account.id,
		storeId: store.id,
	};
	const startedAt = now();
	const minutesWithoutSync = await input.database.syncGapMinutes(
		store.id,
		startedAt,
	);
	if (isStale(minutesWithoutSync, threshold)) {
		await notifySafely(
			input.notifier,
			staleSyncNotification({
				subject,
				label,
				occurredAt: startedAt,
				minutes: minutesWithoutSync,
				thresholdMinutes: threshold,
				facts: { scope: "now" },
			}),
			log,
		);
	}

	const fail = async (
		stage: FailureStage,
		message: string,
		summary: IncrementalSummary | null,
		httpRequests: number,
		ipos: IposApiMode | null = null,
	): Promise<IncrementalStoreOutcome> => {
		const runId =
			summary?.runId ??
			(await recordFailedRun(input, account, store, stage, message, startedAt));
		if (stage !== "auth") {
			await notifySafely(
				input.notifier,
				runFailedNotification({
					subject: { ...subject, runId },
					label,
					occurredAt: now(),
					error: message,
					facts: {
						stage,
						connector_calls: summary?.connectorCalls ?? 0,
					},
				}),
				log,
			);
		}
		return {
			kind: "failed",
			label,
			stage,
			error: message,
			summary,
			minutesWithoutSync,
			httpRequests,
			ipos,
		};
	};

	if (!numbered) {
		return fail(
			"config",
			"the store's account has no POS_ACCOUNTS_JSON entry in this runner",
			null,
			0,
		);
	}
	let session: Awaited<ReturnType<typeof connectAccount>>;
	try {
		session = await connectAccount(numbered.entry, input.environment, {
			tokenStore: repositoryTokenStore(input.repository, account.id),
			...(input.fetch ? { fetch: input.fetch } : {}),
			...(input.snapshots ? { snapshots: input.snapshots } : {}),
		});
	} catch (error) {
		const message = safeErrorMessage(error, input.redact);
		if (error instanceof ConnectorAuthError) {
			const outcome = await fail("auth", message, null, 0);
			if (await markAuthFailed(input.repository, account.id)) {
				await notifySafely(
					input.notifier,
					authFailedNotification({ subject, label, occurredAt: now() }),
					log,
				);
			}
			return outcome;
		}
		return fail(
			error instanceof AccountConfigError ? "config" : "connect",
			message,
			null,
			0,
		);
	}
	await clearAuthFailure(input.repository, account);
	const engine = new SyncEngine({
		repository: input.repository,
		connector: session.connector,
		now,
		redact: input.redact,
		triggeredBy: input.triggeredBy,
	});
	try {
		const summary = await engine.syncIncremental(
			account,
			store,
			input.incremental ?? {},
		);
		const reconcile = input.database.reconcileLoyalty?.bind(input.database);
		const loyalty = await reconcileLoyaltySafely(
			reconcile ? { reconcileLoyalty: reconcile } : undefined,
			account.tenant_id,
			summary.window,
			now(),
			input.redact,
		);
		if (loyalty.status !== "skipped" || loyalty.reason !== "not_wired") {
			log(`${label} ${loyaltyLine(loyalty)}`);
		}
		return {
			kind: "ran",
			label,
			summary,
			minutesWithoutSync,
			httpRequests: session.httpRequests(),
			ipos: session.ipos,
			loyalty,
		};
	} catch (error) {
		if (error instanceof IncrementalRunError) {
			return fail(
				"run",
				error.summary.error ?? "incremental sync failed",
				error.summary,
				session.httpRequests(),
				session.ipos,
			);
		}
		return fail(
			"run",
			safeErrorMessage(error, input.redact),
			null,
			session.httpRequests(),
			session.ipos,
		);
	}
}
