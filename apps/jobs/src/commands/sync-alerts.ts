import { ConnectorAuthError } from "@fnb/connector-core";
import {
	type AccountEntry,
	accountLabel,
	authFailedNotification,
	checkPreviousDayFreshness,
	markAuthFailed,
	notifySafely,
	type PreviousDayFreshness,
	runFailedNotification,
	type StoreToWatch,
	storeLabel,
} from "@fnb/runner";
import type { AccountRecord, StoreRecord, WindowSummary } from "@fnb/sync";
import type { CommandContext } from "../context.js";

function writeError(context: CommandContext): (line: string) => void {
	return (line) => context.output.error(line);
}

export function alertLabel(
	entries: readonly AccountEntry[],
	account: Pick<AccountRecord, "account_key">,
): string {
	return accountLabel(entries, account.account_key);
}

export async function reportAuthFailure(
	context: CommandContext,
	entries: readonly AccountEntry[],
	account: AccountRecord,
	error: unknown,
): Promise<void> {
	if (!(error instanceof ConnectorAuthError)) {
		return;
	}
	const { repository } = context.services.db();
	if (await markAuthFailed(repository, account.id)) {
		await notifySafely(
			context.notifier,
			authFailedNotification({
				subject: { tenantId: account.tenant_id, accountId: account.id },
				label: alertLabel(entries, account),
				occurredAt: context.now(),
			}),
			writeError(context),
		);
	}
}

export async function reportRunFailure(
	context: CommandContext,
	entries: readonly AccountEntry[],
	account: AccountRecord,
	summary: WindowSummary,
): Promise<void> {
	if (summary.status !== "failed" || summary.dryRun) {
		return;
	}
	await notifySafely(
		context.notifier,
		runFailedNotification({
			subject: {
				tenantId: account.tenant_id,
				accountId: account.id,
				runId: summary.runId,
			},
			label: alertLabel(entries, account),
			occurredAt: context.now(),
			error: summary.error ?? "sync failed",
			facts: { kind: summary.kind, connector_calls: summary.connectorCalls },
		}),
		writeError(context),
	);
}

export function freshnessLine(reading: PreviousDayFreshness): string {
	if (!reading.watched) {
		return `${reading.label}: not watched (inactive, paused or opted out of the incremental sync), yesterday's dead-man's check skipped`;
	}
	return reading.longestGapMinutes === null
		? `${reading.label}: no successful sync by the end of the last business day, nothing to measure`
		: `${reading.label}: longest stretch without a successful sync on the last business day ${reading.longestGapMinutes} min of opening hours${reading.stale ? " (over the 90-minute threshold)" : ""}`;
}

export async function checkYesterdayFreshness(
	context: CommandContext,
	entries: readonly AccountEntry[],
	account: AccountRecord,
	stores: readonly StoreRecord[],
): Promise<void> {
	const { runner } = context.services.db();
	const label = alertLabel(entries, account);
	const watched: StoreToWatch[] = stores.map((store) => ({
		store,
		label: `${label} ${storeLabel(stores, store.id)}`,
		tenantId: account.tenant_id,
		accountId: account.id,
	}));
	const readings = await checkPreviousDayFreshness({
		database: runner,
		notifier: context.notifier,
		stores: watched,
		at: context.now(),
		onError: writeError(context),
	});
	if (readings === null) {
		context.output.line(
			`${label}: incremental schedule disabled; yesterday's dead-man's check skipped`,
		);
		return;
	}
	for (const reading of readings) {
		context.output.line(freshnessLine(reading));
	}
}
