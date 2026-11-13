import type { Sql } from "postgres";
import {
	hasBaseUrlOverride,
	type NotifyEnvironment,
} from "../channels/secrets.js";
import type { NotifyRepository } from "../dispatch/repository.js";
import * as statements from "./statements.js";

export interface NotifyRepositoryOptions {
	readonly environment: NotifyEnvironment;
	readonly simulatedClock?: boolean;
}

export class TenantFilterRequiredError extends Error {
	constructor(operation: string) {
		super(
			`${operation} needs a tenant filter while a provider base-URL override, NOTIFY_INTEGRATION=1 or a simulated clock is in effect`,
		);
		this.name = "TenantFilterRequiredError";
	}
}

export function tenantFilterRequired(
	options: NotifyRepositoryOptions,
): boolean {
	return (
		options.simulatedClock === true ||
		options.environment.NOTIFY_INTEGRATION === "1" ||
		hasBaseUrlOverride(options.environment)
	);
}

export function guardScan(
	options: NotifyRepositoryOptions,
	operation: string,
	tenantId: string | null,
): void {
	if (tenantId === null && tenantFilterRequired(options)) {
		throw new TenantFilterRequiredError(operation);
	}
}

export function createPostgresNotifyRepository(
	sql: Sql,
	options: NotifyRepositoryOptions,
): NotifyRepository {
	return {
		async tick(at, post, tenantId) {
			guardScan(options, "the notify tick", tenantId);
			return statements.notifyTick(sql, at, post, tenantId);
		},
		async claimNext(request) {
			guardScan(options, "a message claim", request.tenantId);
			return statements.claimNextMessage(sql, request);
		},
		beginSend: (messageId, claimedAt, title, body, bodySha256, at) =>
			statements.beginSend(
				sql,
				messageId,
				claimedAt,
				title,
				body,
				bodySha256,
				at,
			),
		finishSend: (request) => statements.finishSend(sql, request),
		async recordDispatch(at, runtime, secretNames, counts) {
			if (tenantFilterRequired(options)) {
				return;
			}
			await statements.recordDispatch(sql, at, runtime, secretNames, counts);
		},
		async pendingLinkBots(at, tenantId) {
			guardScan(options, "link polling", tenantId);
			return statements.pendingLinkBots(sql, at, tenantId);
		},
		takePollLease: (secretName, kind, worker, leaseSeconds, at) =>
			statements.takePollLease(sql, secretName, kind, worker, leaseSeconds, at),
		releasePollLease: (secretName, worker) =>
			statements.releasePollLease(sql, secretName, worker),
		pollCursor: (secretName) => statements.pollCursor(sql, secretName),
		savePollState: (secretName, worker, cursor, at) =>
			statements.savePollState(sql, secretName, worker, cursor, at),
		completeChannelLink: (kind, secretName, code, address, addressHint, at) =>
			statements.completeChannelLink(
				sql,
				kind,
				secretName,
				code,
				address,
				addressHint,
				at,
			),
		acceptChannelLink: (kind, secretName, address, at) =>
			statements.acceptChannelLink(sql, kind, secretName, address, at),
	};
}
