import type { MessageKey } from "../../i18n";
import type { SettingsWriteCode } from "../source";
import {
	type ChannelKind,
	type DestinationStatus,
	type MessageKind,
	type MessageState,
	type MessageStatus,
	RATE_LIMITED,
	RESENDABLE_KINDS,
	type Severity,
} from "./source";

export const RULE_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
	daily_digest: "settings.notify.rule.daily_digest",
	revenue_below_baseline: "settings.notify.rule.revenue_below_baseline",
	ticket_drop: "settings.notify.rule.ticket_drop",
	drawer_variance: "settings.notify.rule.drawer_variance",
	unverified_day: "settings.notify.rule.unverified_day",
	zero_sales_day: "settings.notify.rule.zero_sales_day",
	zero_sales_open: "settings.notify.rule.zero_sales_open",
	sync_failed: "settings.notify.rule.sync_failed",
	auth_failed: "settings.notify.rule.auth_failed",
	sync_stale: "settings.notify.rule.sync_stale",
	sync_dispatch_failed: "settings.notify.rule.sync_dispatch_failed",
	nightly_missing: "settings.notify.rule.nightly_missing",
	job_failed: "settings.notify.rule.job_failed",
	channel_failed: "settings.notify.rule.channel_failed",
	digest_failed: "settings.notify.rule.digest_failed",
	zalo_webhook_unverified: "settings.notify.rule.zalo_webhook_unverified",
	zalo_token_failed: "settings.notify.rule.zalo_token_failed",
	oa_package_expiring: "settings.notify.rule.oa_package_expiring",
	cash_count_variance: "settings.notify.rule.cash_count_variance",
	redemption_mismatch: "settings.notify.rule.redemption_mismatch",
	zbs_report_rate: "settings.notify.rule.zbs_report_rate",
	dsr_due_soon: "settings.notify.rule.dsr_due_soon",
	staff_sync_stale: "settings.notify.rule.staff_sync_stale",
	abnormal_voids: "settings.notify.rule.abnormal_voids",
	voucher_spike: "settings.notify.rule.voucher_spike",
	checklist_unfinished: "settings.notify.rule.checklist_unfinished",
	staff_daily_digest: "settings.notify.rule.staff_daily_digest",
	oa_inactive: "settings.notify.rule.oa_inactive",
	mini_app_visits_low: "settings.notify.rule.mini_app_visits_low",
	code_guessing_lockout: "settings.notify.rule.code_guessing_lockout",
};

export const CATEGORY_ORDER = [
	"digest",
	"business",
	"data_quality",
	"sync",
	"operations",
	"channel",
] as const;

const CATEGORY_KEYS: Readonly<Record<string, MessageKey>> = {
	digest: "settings.notify.category.digest",
	business: "settings.notify.category.business",
	data_quality: "settings.notify.category.data_quality",
	sync: "settings.notify.category.sync",
	operations: "settings.notify.category.operations",
	channel: "settings.notify.category.channel",
};

export function categoryKey(category: string): MessageKey {
	return CATEGORY_KEYS[category] ?? "settings.notify.category.other";
}

export const STATUS_KEYS: Readonly<Record<DestinationStatus, MessageKey>> = {
	pending: "settings.notify.status.pending",
	active: "settings.notify.status.active",
	failing: "settings.notify.status.failing",
	disabled: "settings.notify.status.disabled",
};

const KIND_KEYS: Readonly<Partial<Record<ChannelKind, MessageKey>>> = {
	zalo_bot: "settings.notify.kind.zalo_bot",
	email: "settings.notify.kind.email",
	telegram: "settings.notify.kind.telegram",
	webhook: "settings.notify.kind.webhook",
};

export function kindKey(kind: string): MessageKey {
	return KIND_KEYS[kind as ChannelKind] ?? "settings.notify.kind.other";
}

const DISABLED_KEYS: Readonly<Record<string, MessageKey>> = {
	blocked_by_user: "settings.notify.disabled.blocked_by_user",
	member_request: "settings.notify.disabled.member_request",
	owner_request: "settings.notify.disabled.owner_request",
	consent_withdrawn: "settings.notify.disabled.consent_withdrawn",
};

export function disabledKey(reason: string | null): MessageKey {
	return (
		(reason === null ? undefined : DISABLED_KEYS[reason]) ??
		"settings.notify.disabled.other"
	);
}

const REASON_KEYS: Readonly<Record<string, MessageKey>> = {
	token_invalid: "settings.notify.reason.token_invalid",
	unauthorized: "settings.notify.reason.unauthorized",
	not_found: "settings.notify.reason.not_found",
	blocked_by_user: "settings.notify.reason.blocked_by_user",
	secret_missing: "settings.notify.reason.secret_missing",
	sender_missing: "settings.notify.reason.sender_missing",
	no_credit: "settings.notify.reason.no_credit",
};

export function reasonOf(code: string | null): {
	key: MessageKey;
	params: { code: string };
} {
	const known = code === null ? undefined : REASON_KEYS[code];
	return known
		? { key: known, params: { code: code ?? "" } }
		: { key: "settings.notify.reason.other", params: { code: code ?? "?" } };
}

export const MESSAGE_STATUS_KEYS: Readonly<Record<MessageStatus, MessageKey>> =
	{
		queued: "settings.notify.message.status.queued",
		held: "settings.notify.message.status.held",
		sending: "settings.notify.message.status.sending",
		sent: "settings.notify.message.status.sent",
		delivered: "settings.notify.message.status.delivered",
		failed: "settings.notify.message.status.failed",
		cancelled: "settings.notify.message.status.cancelled",
		uncertain: "settings.notify.message.status.uncertain",
	};

export const MESSAGE_KIND_KEYS: Readonly<Record<MessageKind, MessageKey>> = {
	digest: "settings.notify.message.kind.digest",
	digest_correction: "settings.notify.message.kind.digest_correction",
	alert: "settings.notify.message.kind.alert",
	alert_reminder: "settings.notify.message.kind.alert_reminder",
	alert_resolved: "settings.notify.message.kind.alert_resolved",
	test: "settings.notify.message.kind.test",
	link_code: "settings.notify.message.kind.link_code",
	link_notice: "settings.notify.message.kind.link_notice",
	link_confirmation: "settings.notify.message.kind.link_confirmation",
};

const DECISION_KEYS: Readonly<Record<string, MessageKey>> = {
	outside_window: "settings.notify.decision.outside_window",
	daily_cap: "settings.notify.decision.daily_cap",
	monthly_cap: "settings.notify.decision.monthly_cap",
	expired: "settings.notify.decision.expired",
	no_dispatcher_secret: "settings.notify.decision.no_dispatcher_secret",
	resolved_before_send: "settings.notify.decision.resolved_before_send",
	destination_inactive: "settings.notify.decision.destination_inactive",
	destination_removed: "settings.notify.decision.destination_removed",
	no_consent: "settings.notify.decision.no_consent",
	unsubscribed: "settings.notify.decision.unsubscribed",
};

export function decisionKey(decision: string | null): MessageKey | null {
	if (decision === null || decision === "send") return null;
	return DECISION_KEYS[decision] ?? "settings.notify.decision.other";
}

export const SEVERITY_KEYS: Readonly<Record<Severity, MessageKey>> = {
	info: "settings.notify.severity.info",
	warning: "settings.notify.severity.warning",
	critical: "settings.notify.severity.critical",
};

const ROLE_KEYS: Readonly<Record<string, MessageKey>> = {
	owner: "settings.notify.role.owner",
	manager: "settings.notify.role.manager",
	staff: "settings.notify.role.staff",
	viewer: "settings.notify.role.viewer",
};

export function roleKeys(roles: readonly string[]): MessageKey[] {
	return roles.flatMap((role) => {
		const key = ROLE_KEYS[role];
		return key === undefined ? [] : [key];
	});
}

export function writeErrorKey(
	code: SettingsWriteCode,
	constraint: string | null,
): MessageKey {
	if (constraint === RATE_LIMITED) return "settings.notify.error.rateLimited";
	switch (code) {
		case "forbidden":
			return "settings.notify.error.forbidden";
		case "duplicate":
			return "settings.notify.error.duplicate";
		case "network":
			return "settings.notify.error.network";
		default:
			return constraint !== null &&
				/(floor|advertising|consent|policies_)/.test(constraint)
				? "settings.notify.error.floor"
				: "settings.notify.error.invalid";
	}
}

export type TestOutcome =
	| { readonly kind: "waiting" }
	| { readonly kind: "sent"; readonly at: string | null }
	| { readonly kind: "held"; readonly until: string | null }
	| { readonly kind: "failed"; readonly code: string | null }
	| { readonly kind: "cancelled"; readonly decision: string | null }
	| { readonly kind: "uncertain" }
	| { readonly kind: "stillQueued"; readonly scheduleOff: boolean };

export function testOutcomeOf(
	state: MessageState | null,
	elapsedMs: number,
	limitMs: number,
	scheduleEnabled: boolean,
): TestOutcome {
	if (state !== null) {
		switch (state.status) {
			case "sent":
			case "delivered":
				return { kind: "sent", at: state.sentAt };
			case "failed":
				return { kind: "failed", code: state.lastErrorCode };
			case "cancelled":
				return { kind: "cancelled", decision: state.decision };
			case "uncertain":
				return { kind: "uncertain" };
			case "held":
				return { kind: "held", until: state.notBefore };
			default:
				break;
		}
	}
	if (!scheduleEnabled) return { kind: "stillQueued", scheduleOff: true };
	return elapsedMs >= limitMs
		? { kind: "stillQueued", scheduleOff: false }
		: { kind: "waiting" };
}

export function isFinalOutcome(outcome: TestOutcome): boolean {
	return outcome.kind !== "waiting";
}

export function canResend(
	message: { kind: string; status: MessageStatus },
	unlimitedManager: boolean,
): boolean {
	return (
		unlimitedManager &&
		RESENDABLE_KINDS.has(message.kind) &&
		(message.status === "uncertain" || message.status === "failed")
	);
}

export function ageParts(
	instant: string | null,
	now: number,
): { key: MessageKey; count: number } | null {
	if (instant === null) return null;
	const minutes = Math.max(
		0,
		Math.floor((now - new Date(instant).getTime()) / 60_000),
	);
	if (minutes < 1) return { key: "settings.notify.age.now", count: 0 };
	if (minutes < 60)
		return { key: "settings.notify.age.minutes", count: minutes };
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return { key: "settings.notify.age.hours", count: hours };
	return { key: "settings.notify.age.days", count: Math.floor(hours / 24) };
}

export function isIanaZone(zone: string): boolean {
	if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(zone)) return false;
	try {
		new Intl.DateTimeFormat("en", { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

export function parseParamValue(
	type: string,
	text: string,
): number | boolean | string | null {
	switch (type) {
		case "boolean":
			return text === "true";
		case "time":
		case "enum":
			return text;
		default: {
			const trimmed = text.trim().replace(",", ".");
			if (trimmed === "") return null;
			const value = Number(trimmed);
			return Number.isFinite(value) ? value : null;
		}
	}
}

export function paramValid(
	schema: {
		type: string;
		min?: number | undefined;
		max?: number | undefined;
		values?: readonly string[] | undefined;
	},
	value: unknown,
): boolean {
	switch (schema.type) {
		case "boolean":
			return typeof value === "boolean";
		case "time":
			return (
				typeof value === "string" &&
				/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)
			);
		case "enum":
			return typeof value === "string" && (schema.values ?? []).includes(value);
		default:
			if (typeof value !== "number" || !Number.isFinite(value)) return false;
			if (schema.type === "integer" && !Number.isInteger(value)) return false;
			if (schema.min !== undefined && value < schema.min) return false;
			if (schema.max !== undefined && value > schema.max) return false;
			return true;
	}
}

export function windowValid(start: string, end: string): boolean {
	const pattern = /^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$/;
	if (start === "" && end === "") return true;
	return pattern.test(start) && pattern.test(end) && start !== "24:00";
}

export function capValid(text: string): boolean {
	if (text.trim() === "") return true;
	const value = Number(text.trim());
	return Number.isInteger(value) && value >= 1 && value <= 1000;
}
