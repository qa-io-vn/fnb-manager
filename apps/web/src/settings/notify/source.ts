export const CHANNEL_KINDS = [
	"zalo_bot",
	"email",
	"telegram",
	"webhook",
	"zalo_oa",
	"zalo_gmf",
	"zalo_zbs",
	"mini_app",
	"sms",
] as const;

export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export const LINKABLE_KINDS = ["zalo_bot", "email", "telegram"] as const;

export type LinkableKind = (typeof LINKABLE_KINDS)[number];

export const DESTINATION_STATUSES = [
	"pending",
	"active",
	"failing",
	"disabled",
] as const;

export type DestinationStatus = (typeof DESTINATION_STATUSES)[number];

export const MESSAGE_STATUSES = [
	"queued",
	"held",
	"sending",
	"sent",
	"delivered",
	"failed",
	"cancelled",
	"uncertain",
] as const;

export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_KINDS = [
	"digest",
	"digest_correction",
	"alert",
	"alert_reminder",
	"alert_resolved",
	"test",
	"link_code",
	"link_notice",
	"link_confirmation",
] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const RESENDABLE_KINDS: ReadonlySet<string> = new Set([
	"digest",
	"digest_correction",
	"alert",
	"alert_reminder",
	"alert_resolved",
]);

export const SEVERITIES = ["info", "warning", "critical"] as const;

export type Severity = (typeof SEVERITIES)[number];

export const RULE_ROLES = ["owner", "manager", "staff", "viewer"] as const;

export const ZALO_BOT_MONTHLY_QUOTA = 3000;

export const TEST_POLL_MS = 2000;

export const TEST_POLL_LIMIT_MS = 60_000;

export const LINK_POLL_MS = 3000;

export const LINK_ANSWER_LIMIT_MS = 60_000;

export const HISTORY_PAGE_SIZE = 25;

export const DIGEST_LIMIT = 31;

export interface Destination {
	readonly id: string;
	readonly kind: ChannelKind;
	readonly provider: string;
	readonly label: string;
	readonly status: DestinationStatus;
	readonly enabled: boolean;
	readonly disabledReason: string | null;
	readonly addressHint: string | null;
	readonly mine: boolean;
	readonly hasMember: boolean;
	readonly memberRole: string | null;
	readonly memberEmail: string | null;
	readonly storeIds: readonly string[] | null;
	readonly mutedRules: readonly string[];
	readonly timezone: string | null;
	readonly linkedAt: string | null;
	readonly lastOkAt: string | null;
	readonly lastErrorCode: string | null;
	readonly lastErrorAt: string | null;
	readonly consecutiveFailures: number;
	readonly secretReported: boolean;
}

export interface NotifyOverview {
	readonly role: string;
	readonly storeLimited: boolean;
	readonly scheduleEnabled: boolean;
	readonly lastTickAt: string | null;
	readonly lastDispatchAt: string | null;
	readonly dispatcherSecrets: readonly string[];
	readonly destinations: readonly Destination[];
	readonly held24h: number;
	readonly uncertain24h: number;
	readonly failed24h: number;
	readonly pendingLinks: number;
	readonly zaloBotMonth: number;
	readonly zaloBotQuota: number;
}

export type ParamType = "number" | "integer" | "boolean" | "time" | "enum";

export interface ParamSchema {
	readonly type: ParamType;
	readonly min?: number | undefined;
	readonly max?: number | undefined;
	readonly values?: readonly string[] | undefined;
}

export interface CatalogueRule {
	readonly ruleKey: string;
	readonly category: string;
	readonly delivery: "digest" | "immediate";
	readonly defaultParams: Readonly<Record<string, unknown>>;
	readonly paramsSchema: Readonly<Record<string, ParamSchema>>;
	readonly storeScoped: boolean;
	readonly sortOrder: number;
}

export type RuleSource = "catalogue" | "tenant" | "store";

export interface EffectiveRule {
	readonly ruleKey: string;
	readonly category: string;
	readonly delivery: string;
	readonly enabled: boolean;
	readonly severity: Severity;
	readonly roles: readonly string[];
	readonly params: Readonly<Record<string, unknown>>;
	readonly cooldownHours: number;
	readonly source: RuleSource;
	readonly overrideId: string | null;
	readonly storeScoped: boolean;
}

export interface RuleChange {
	readonly ruleKey: string;
	readonly storeId: string | null;
	readonly overrideId: string | null;
	readonly enabled: boolean;
	readonly severity: Severity;
	readonly params: Readonly<Record<string, unknown>>;
	readonly cooldownHours: number;
}

export type PolicySource = "global" | "tenant";

export interface EffectivePolicy {
	readonly channelKind: ChannelKind;
	readonly messageClass: "operational" | "transactional" | "advertising";
	readonly allowed: boolean;
	readonly windowStart: string | null;
	readonly windowEnd: string | null;
	readonly maxPerDay: number | null;
	readonly maxPerMonth: number | null;
	readonly criticalBypass: boolean;
	readonly source: PolicySource;
	readonly policyId: string;
	readonly note: string;
}

export interface PolicyChange {
	readonly channelKind: ChannelKind;
	readonly overrideId: string | null;
	readonly windowStart: string | null;
	readonly windowEnd: string | null;
	readonly maxPerDay: number | null;
	readonly criticalBypass: boolean;
}

export interface AlertEpisode {
	readonly id: string;
	readonly ruleKey: string;
	readonly storeId: string | null;
	readonly severity: Severity;
	readonly state: "open" | "resolved";
	readonly openedAt: string;
	readonly lastSeenAt: string;
	readonly resolvedAt: string | null;
	readonly resolution: string | null;
	readonly occurrences: number;
	readonly foldedOccurrences: number;
	readonly facts: Readonly<Record<string, unknown>>;
}

export interface LogMessage {
	readonly id: string;
	readonly kind: MessageKind;
	readonly channel: string;
	readonly channelId: string | null;
	readonly status: MessageStatus;
	readonly decision: string | null;
	readonly holdReason: string | null;
	readonly notBefore: string | null;
	readonly sentAt: string | null;
	readonly createdAt: string;
	readonly body: string | null;
	readonly bodyVisible: boolean;
	readonly resendOf: string | null;
	readonly lastErrorCode: string | null;
}

export interface DigestDelivery {
	readonly messageId: string;
	readonly channelId: string | null;
	readonly kind: MessageKind;
	readonly status: MessageStatus;
	readonly sentAt: string | null;
	readonly body: string | null;
}

export interface DigestRecord {
	readonly id: string;
	readonly businessDate: string;
	readonly storeIds: readonly string[];
	readonly allStores: boolean;
	readonly dataState: string | null;
	readonly revision: number;
	readonly builtAt: string | null;
	readonly net: number | null;
	readonly invoices: number | null;
	readonly deliveries: readonly DigestDelivery[];
}

export interface LinkStart {
	readonly channelId: string;
	readonly status: DestinationStatus;
	readonly linkCode: string | null;
	readonly expiresAt: string | null;
	readonly botName: string | null;
}

export interface DestinationChange {
	readonly enabled?: boolean;
	readonly label?: string;
	readonly storeIds?: readonly string[] | null;
	readonly mutedRules?: readonly string[];
	readonly timezone?: string;
}

export interface MessageState {
	readonly id: string;
	readonly status: MessageStatus;
	readonly decision: string | null;
	readonly holdReason: string | null;
	readonly notBefore: string | null;
	readonly sentAt: string | null;
	readonly lastErrorCode: string | null;
}

export interface NotifySource {
	readonly kind: "supabase" | "demo";
	overview(tenantId: string): Promise<NotifyOverview>;
	catalogue(): Promise<CatalogueRule[]>;
	rules(tenantId: string, storeId: string | null): Promise<EffectiveRule[]>;
	saveRule(tenantId: string, change: RuleChange): Promise<void>;
	resetRule(tenantId: string, overrideId: string): Promise<void>;
	policies(tenantId: string): Promise<EffectivePolicy[]>;
	savePolicy(tenantId: string, change: PolicyChange): Promise<void>;
	resetPolicy(tenantId: string, overrideId: string): Promise<void>;
	alertHistory(tenantId: string, page: number): Promise<AlertEpisode[]>;
	messageLog(tenantId: string, page: number): Promise<LogMessage[]>;
	digests(tenantId: string): Promise<DigestRecord[]>;
	startLink(
		tenantId: string,
		kind: LinkableKind,
		label: string | null,
	): Promise<LinkStart>;
	updateDestination(
		channelId: string,
		change: DestinationChange,
	): Promise<void>;
	removeDestination(channelId: string): Promise<number>;
	sendTest(channelId: string): Promise<string>;
	messageStatus(messageId: string): Promise<MessageState | null>;
	resend(messageId: string): Promise<string>;
	stopMine(tenantId: string): Promise<number>;
}

export const RATE_LIMITED = "rate_limited";
