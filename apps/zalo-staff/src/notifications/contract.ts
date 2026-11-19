import {
	count,
	type IsoInstant,
	instant,
	instantOrNull,
	invalid,
	isRecord,
	knownOrNull,
	oneOf,
	rows,
	single,
	text,
	textOrNull,
} from "../team/read";

export const NOTIFY_FUNCTIONS = {
	settings: "my_notifications",
	startBotLink: "start_bot_link",
	setMutedRules: "set_my_muted_rules",
	stop: "stop_my_notifications",
	followTarget: "my_follow_oa",
} as const;

export const NOTICE_VERSION = "ops-notifications-v1";
export const LINK_CODE = /^FNB-[A-Z0-9]{8}$/;

export const DESTINATION_STATUSES = [
	"pending",
	"active",
	"failing",
	"disabled",
] as const;
export type DestinationStatus = (typeof DESTINATION_STATUSES)[number];

export const DESTINATION_KINDS = [
	"zalo_bot",
	"telegram",
	"email",
	"zalo_oa",
	"zalo_gmf",
	"mini_app",
] as const;
export type DestinationKind = (typeof DESTINATION_KINDS)[number];

export const DISABLED_REASONS = [
	"blocked_by_user",
	"member_request",
	"owner_request",
	"consent_withdrawn",
] as const;
export type DisabledReason = (typeof DISABLED_REASONS)[number];

export const LINK_STAGES = ["code", "acceptance"] as const;
export type LinkStage = (typeof LINK_STAGES)[number];

export const CONSENT_STATES = ["active", "withdrawn", "none"] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];

export const RULE_CATEGORIES = [
	"digest",
	"business",
	"data_quality",
	"sync",
	"operations",
	"channel",
] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export const RULE_KEYS = [
	"daily_digest",
	"revenue_below_baseline",
	"ticket_drop",
	"drawer_variance",
	"unverified_day",
	"zero_sales_day",
	"zero_sales_open",
	"sync_failed",
	"auth_failed",
	"sync_stale",
	"sync_dispatch_failed",
	"nightly_missing",
	"job_failed",
	"channel_failed",
	"digest_failed",
	"zalo_webhook_unverified",
	"zalo_token_failed",
	"oa_package_expiring",
	"cash_count_variance",
	"redemption_mismatch",
	"staff_sync_stale",
	"abnormal_voids",
	"voucher_spike",
	"checklist_unfinished",
	"staff_daily_digest",
	"oa_inactive",
	"mini_app_visits_low",
] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

export interface Destination {
	readonly id: string;
	readonly kind: DestinationKind | null;
	readonly label: string;
	readonly hint: string | null;
	readonly status: DestinationStatus;
	readonly paused: boolean;
	readonly mutedRules: readonly string[];
	readonly linkedAt: IsoInstant | null;
	readonly disabledReason: DisabledReason | null;
	readonly linkStage: LinkStage | null;
	readonly linkExpiresAt: IsoInstant | null;
}

export interface MutableRule {
	readonly key: string;
	readonly category: RuleCategory | null;
}

export interface NotificationConsent {
	readonly state: ConsentState;
	readonly grantedAt: IsoInstant | null;
	readonly revokedAt: IsoInstant | null;
}

export interface LinkNotice {
	readonly version: string;
	readonly text: string;
}

export interface NotificationSettings {
	readonly consent: NotificationConsent;
	readonly destinations: readonly Destination[];
	readonly rules: readonly MutableRule[];
	readonly notice: LinkNotice | null;
	readonly botName: string | null;
}

export interface LinkCode {
	readonly channelId: string;
	readonly noticeVersion: string;
	readonly code: string;
	readonly expiresAt: IsoInstant;
	readonly botName: string | null;
}

export interface NotificationsApi {
	notificationSettings(tenantId: string): Promise<NotificationSettings>;
	startBotLink(tenantId: string, noticeVersion: string): Promise<LinkCode>;
	setMutedRules(
		channelId: string,
		rules: readonly string[],
	): Promise<readonly string[]>;
	stopNotifications(tenantId: string): Promise<number>;
	followTarget(tenantId: string): Promise<string | null>;
}

export const NO_SETTINGS: NotificationSettings = {
	consent: { state: "none", grantedAt: null, revokedAt: null },
	destinations: [],
	rules: [],
	notice: null,
	botName: null,
};

function ruleKeys(value: unknown, what: string): string[] {
	if (!Array.isArray(value)) return invalid(what);
	return value.map((key) => text(key, what));
}

export function readDestinations(value: unknown): Destination[] {
	return rows(value, "destinations").map((row) => ({
		id: text(row.id, "destination id"),
		kind: knownOrNull(DESTINATION_KINDS, row.kind),
		label: text(row.label, "destination label"),
		hint: textOrNull(row.address_hint, "destination hint"),
		status: oneOf(DESTINATION_STATUSES, row.status, "destination status"),
		paused: row.enabled === false,
		mutedRules: ruleKeys(row.muted_rules ?? [], "muted rules"),
		linkedAt: instantOrNull(row.linked_at, "link time"),
		disabledReason: knownOrNull(DISABLED_REASONS, row.disabled_reason),
		linkStage: knownOrNull(LINK_STAGES, row.link_stage),
		linkExpiresAt: instantOrNull(row.link_expires_at, "link expiry"),
	}));
}

function readConsent(value: unknown): NotificationConsent {
	if (!isRecord(value)) return invalid("consent");
	return {
		state: oneOf(CONSENT_STATES, value.state, "consent state"),
		grantedAt: instantOrNull(value.granted_at, "consent time"),
		revokedAt: instantOrNull(value.revoked_at, "withdrawal time"),
	};
}

function readNotice(value: unknown): LinkNotice | null {
	if (value === null || value === undefined) return null;
	if (!isRecord(value)) return invalid("notice");
	const noticeText = textOrNull(value.text, "notice text");
	return noticeText === null
		? null
		: { version: text(value.version, "notice version"), text: noticeText };
}

export function readSettings(value: unknown): NotificationSettings {
	const answer = single(value, "notification settings");
	return {
		consent: readConsent(answer.consent),
		destinations: readDestinations(answer.destinations),
		rules: rows(answer.rules, "rules").map((rule) => ({
			key: text(rule.rule_key, "rule key"),
			category: knownOrNull(RULE_CATEGORIES, rule.category),
		})),
		notice: readNotice(answer.notice),
		botName: textOrNull(answer.bot_name, "bot name"),
	};
}

export function readLinkCode(value: unknown): LinkCode {
	const answer = single(value, "link code");
	const code = text(answer.code, "link code");
	if (!LINK_CODE.test(code)) return invalid("link code");
	return {
		channelId: text(answer.channel_id, "destination id"),
		noticeVersion: text(answer.notice_version, "notice version"),
		code,
		expiresAt: instant(answer.expires_at, "code expiry"),
		botName: textOrNull(answer.bot_name, "bot name"),
	};
}

export function readMutedRules(value: unknown): string[] {
	return ruleKeys(value, "muted rules");
}

export function readCancelled(value: unknown): number {
	return count(value, "cancelled messages");
}

export function readFollowTarget(value: unknown): string | null {
	return textOrNull(value, "OA id");
}

export function tenantArgs(tenantId: string): Record<string, string> {
	return { p_tenant_id: tenantId };
}

export function startArgs(
	tenantId: string,
	noticeVersion: string,
): Record<string, string> {
	return { p_tenant_id: tenantId, p_notice_version: noticeVersion };
}

export function muteArgs(
	channelId: string,
	rules: readonly string[],
): Record<string, unknown> {
	return { p_channel_id: channelId, p_muted_rules: [...rules] };
}

export function ruleLabelKey(rule: MutableRule): string {
	if ((RULE_KEYS as readonly string[]).includes(rule.key))
		return `notify.rule.${rule.key}`;
	return rule.category === null
		? "notify.rule.other"
		: `notify.category.${rule.category}`;
}

export const DESTINATION_STATES_SHOWN = [
	"receiving",
	"waiting",
	"failing",
	"stopped",
] as const;
export type DestinationState = (typeof DESTINATION_STATES_SHOWN)[number];

export function destinationState(destination: Destination): DestinationState {
	if (destination.status === "disabled" || destination.paused) return "stopped";
	if (destination.status === "pending") return "waiting";
	if (destination.status === "failing") return "failing";
	return "receiving";
}

export function linkedBot(
	destinations: readonly Destination[],
): Destination | null {
	return (
		destinations.find(
			(destination) =>
				destination.kind === "zalo_bot" &&
				(destination.status === "active" || destination.status === "failing"),
		) ?? null
	);
}

export function receiving(settings: NotificationSettings): boolean {
	return (
		settings.consent.state === "active" ||
		settings.destinations.some(
			(destination) => destination.status !== "disabled",
		)
	);
}

export function mutableDestinations(
	destinations: readonly Destination[],
): Destination[] {
	return destinations.filter(
		(destination) => destination.status !== "disabled",
	);
}

export function toggled(
	muted: readonly string[],
	key: string,
	receive: boolean,
): string[] {
	const rest = muted.filter((rule) => rule !== key);
	return receive ? rest : [...rest, key];
}

export function secondsLeft(expiresAt: IsoInstant, now: number): number {
	return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}

export function clockText(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
