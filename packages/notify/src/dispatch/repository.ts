import type {
	ChannelKind,
	FailureScope,
	MessageKind,
	ProviderId,
} from "../channels/types.js";

import type { CycleBudget } from "./budget.js";

export type TickSummary = Readonly<Record<string, unknown>>;

export interface DigestBuildCounts {
	readonly built: number;
	readonly failed: number;
	readonly messages: number;
}

export interface DigestBuilder {
	buildDue(
		at: Date,
		tenantId: string | null,
		budget: CycleBudget,
	): Promise<DigestBuildCounts>;
}

export interface ClaimedMessage {
	readonly messageId: string;
	readonly claimedAt: string;
	readonly tenantId: string;
	readonly kind: MessageKind;
	readonly templateRef: string | null;
	readonly params: Readonly<Record<string, unknown>>;
	readonly title: string | null;
	readonly body: string | null;
	readonly severity: "info" | "warning" | "critical" | null;
	readonly attempts: number;
	readonly businessDate: string | null;
	readonly channelId: string;
	readonly channelKind: ChannelKind;
	readonly provider: ProviderId;
	readonly secretName: string;
	readonly address: string | null;
	readonly config: Readonly<Record<string, unknown>>;
	readonly channelLabel: string;
	readonly readerTimezone: string;
	readonly tenantName: string;
	readonly currencyCode: string;
	readonly storeName: string | null;
	readonly accountName: string | null;
	readonly ruleKey: string | null;
}

export interface ClaimRequest {
	readonly worker: string;
	readonly secretNames: readonly string[];
	readonly leaseSeconds: number;
	readonly at: Date;
	readonly tenantId: string | null;
}

export interface BeginSendResult {
	readonly ok: boolean;
	readonly title: string | null;
	readonly body: string | null;
}

export type FinishOutcome = "sent" | "retry" | "failed" | "uncertain";

export interface FinishRequest {
	readonly messageId: string;
	readonly claimedAt: string;
	readonly outcome: FinishOutcome;
	readonly scope: FailureScope | null;
	readonly code: string | null;
	readonly providerMessageId: string | null;
	readonly retryAfterSeconds: number | null;
	readonly idempotent: boolean;
	readonly at: Date;
}

export interface PendingLinkBot {
	readonly secretName: string;
	readonly kind: ChannelKind;
}

export interface NotifyRepository {
	tick(at: Date, post: boolean, tenantId: string | null): Promise<TickSummary>;
	claimNext(request: ClaimRequest): Promise<ClaimedMessage | null>;
	beginSend(
		messageId: string,
		claimedAt: string,
		title: string | null,
		body: string,
		bodySha256: string,
		at: Date,
	): Promise<BeginSendResult>;
	finishSend(request: FinishRequest): Promise<string>;
	recordDispatch(
		at: Date,
		runtime: "edge" | "cli",
		secretNames: readonly string[],
		counts: Readonly<Record<string, number>>,
	): Promise<void>;
	pendingLinkBots(at: Date, tenantId: string | null): Promise<PendingLinkBot[]>;
	takePollLease(
		secretName: string,
		kind: ChannelKind,
		worker: string,
		leaseSeconds: number,
		at: Date,
	): Promise<boolean>;
	releasePollLease(secretName: string, worker: string): Promise<void>;
	pollCursor(secretName: string): Promise<number | null>;
	savePollState(
		secretName: string,
		worker: string,
		cursor: number | null,
		at: Date,
	): Promise<void>;
	completeChannelLink(
		kind: ChannelKind,
		secretName: string,
		code: string,
		address: string,
		addressHint: string,
		at: Date,
	): Promise<string | null>;
	acceptChannelLink(
		kind: ChannelKind,
		secretName: string,
		address: string,
		at: Date,
	): Promise<string | null>;
}
