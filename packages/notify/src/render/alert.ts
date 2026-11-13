import { CHANNEL_WORDS } from "../messages/notice.js";
import type { MessageKey } from "../messages/vi.js";
import {
	formatClockTime,
	formatViCount,
	formatViDate,
	localIsoDate,
} from "./format.js";
import { message, type TemplateValues } from "./template.js";

export type AlertMessageKind = "alert" | "alert_reminder" | "alert_resolved";

export interface AlertFacts {
	readonly kind: AlertMessageKind;
	readonly ruleKey: string | null;
	readonly templateRef: string | null;
	readonly params: Readonly<Record<string, unknown>>;
	readonly storeName: string | null;
	readonly accountName: string | null;
	readonly readerTimezone: string;
	readonly at: Date;
}

export interface RenderedAlert {
	readonly title: string;
	readonly text: string;
}

export const WORKFLOW_KEYS = [
	"sync",
	"backup",
	"migrate",
	"deploy_web",
	"deploy_functions",
	"notify",
	"workflows_active",
	"other",
] as const;

export type WorkflowKey = (typeof WORKFLOW_KEYS)[number];

const WORKFLOW_NAMES: Readonly<Record<string, WorkflowKey>> = {
	Sync: "sync",
	"Backup database": "backup",
	"Migrate database": "migrate",
	"Deploy web app": "deploy_web",
	"Deploy Edge Functions": "deploy_functions",
	Notify: "notify",
	"Scheduled workflows active": "workflows_active",
};

export function workflowKeyOf(name: string): WorkflowKey {
	const trimmed = name.trim();
	if ((WORKFLOW_KEYS as readonly string[]).includes(trimmed)) {
		return trimmed as WorkflowKey;
	}
	return WORKFLOW_NAMES[trimmed] ?? "other";
}

export function workflowLabel(key: string): string {
	const known = (WORKFLOW_KEYS as readonly string[]).includes(key)
		? (key as WorkflowKey)
		: "other";
	return message(`workflow.${known}` as MessageKey);
}

const STAGE_KEYS: Readonly<Record<string, MessageKey>> = {
	config: "alert.sync_failed.stage.config",
	connect: "alert.sync_failed.stage.connect",
	run: "alert.sync_failed.stage.run",
};

const RUN_KIND_KEYS: Readonly<Record<string, MessageKey>> = {
	nightly: "alert.sync_failed.kind.nightly",
	backfill: "alert.sync_failed.kind.backfill",
	reconciliation: "alert.sync_failed.kind.reconciliation",
	incremental: "alert.sync_failed.kind.incremental",
};

const REASON_KEYS: ReadonlySet<string> = new Set([
	"token_invalid",
	"unauthorized",
	"no_credit",
	"not_found",
	"blocked_by_user",
	"secret_missing",
	"sender_missing",
	"permission_denied",
	"account_under_validation",
]);

const UNKNOWN = "?";
const STORE_FALLBACK = "cửa hàng";
const ACCOUNT_FALLBACK = "tài khoản POS";

function numberParam(
	params: Readonly<Record<string, unknown>>,
	...keys: readonly string[]
): number | null {
	for (const key of keys) {
		const value = params[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
		if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
			return Number(value);
		}
	}
	return null;
}

function textParam(
	params: Readonly<Record<string, unknown>>,
	...keys: readonly string[]
): string | null {
	for (const key of keys) {
		const value = params[key];
		if (typeof value === "string" && value.trim() !== "") {
			return value;
		}
	}
	return null;
}

function countText(value: number | null): string {
	return value === null ? UNKNOWN : formatViCount(value);
}

function instantParam(
	params: Readonly<Record<string, unknown>>,
	key: string,
): Date | null {
	const seconds = numberParam(params, key);
	if (seconds !== null) {
		return new Date(seconds * 1000);
	}
	const text = textParam(params, key);
	if (text === null) {
		return null;
	}
	const parsed = new Date(text);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clock(facts: AlertFacts, instant: Date): TemplateValues {
	return {
		time: formatClockTime(instant, facts.readerTimezone),
		date: formatViDate(localIsoDate(instant, facts.readerTimezone)),
	};
}

function ruleOf(facts: AlertFacts): string {
	if (facts.ruleKey !== null && facts.ruleKey !== "") {
		return facts.ruleKey;
	}
	const fromParams = textParam(facts.params, "rule_key");
	if (fromParams !== null) {
		return fromParams;
	}
	const fromRef = facts.templateRef?.match(/^alert\.([a-z0-9_]+)\./)?.[1];
	return fromRef ?? "unknown";
}

function store(facts: AlertFacts): string {
	return facts.storeName ?? STORE_FALLBACK;
}

function account(facts: AlertFacts): string {
	return facts.accountName ?? ACCOUNT_FALLBACK;
}

export function reasonText(code: string | null): string {
	if (code === null) {
		return UNKNOWN;
	}
	return REASON_KEYS.has(code) ? message(`reason.${code}` as MessageKey) : code;
}

function channelWord(kind: string | null): string {
	return kind !== null && kind in CHANNEL_WORDS
		? CHANNEL_WORDS[kind as keyof typeof CHANNEL_WORDS]
		: "nhận tin";
}

function syncFailedSubject(facts: AlertFacts): string {
	if (facts.storeName !== null) {
		return facts.storeName;
	}
	const kind = textParam(facts.params, "run_kind", "kind");
	const kindKey = kind === null ? undefined : RUN_KIND_KEYS[kind];
	return kindKey === undefined
		? account(facts)
		: message("alert.sync_failed.subject.kind", {
				account: account(facts),
				kind: message(kindKey),
			});
}

function syncFailedStage(facts: AlertFacts): string {
	const stage = textParam(facts.params, "stage");
	const key = stage === null ? undefined : STAGE_KEYS[stage];
	return message(key ?? "alert.sync_failed.stage.run");
}

function openingText(facts: AlertFacts): string {
	const rule = ruleOf(facts);
	const params = facts.params;
	switch (rule) {
		case "auth_failed": {
			const stores = numberParam(params, "store_count", "stores");
			return stores === null
				? message("alert.auth_failed.stores", { account: account(facts) })
				: message("alert.auth_failed", {
						account: account(facts),
						count: countText(stores),
					});
		}
		case "sync_stale": {
			const values = {
				store: store(facts),
				minutes: countText(
					numberParam(params, "minutes_without_sync", "minutes"),
				),
				threshold: countText(numberParam(params, "threshold_minutes")),
			};
			const previousDay =
				textParam(params, "scope") === "previous_day" ||
				(facts.templateRef ?? "").includes("previous_day");
			return previousDay
				? message("alert.sync_stale.previous_day", values)
				: message("alert.sync_stale", values);
		}
		case "sync_failed":
			return message("alert.sync_failed", {
				subject: syncFailedSubject(facts),
				stage: syncFailedStage(facts),
				count: countText(
					numberParam(params, "consecutive_failures", "occurrences") ?? 1,
				),
			});
		case "sync_dispatch_failed":
			return message("alert.sync_dispatch_failed", {
				store: store(facts),
				count: countText(
					numberParam(params, "sync_alert_occurrences", "occurrences"),
				),
			});
		case "zero_sales_open":
			return message("alert.zero_sales_open", {
				store: store(facts),
				minutes: countText(
					numberParam(params, "open_minutes", "minutes_open", "minutes"),
				),
			});
		case "nightly_missing":
			return message("alert.nightly_missing", {
				hours: countText(numberParam(params, "hours")),
			});
		case "job_failed": {
			const workflow = workflowKeyOf(textParam(params, "workflow") ?? "other");
			if (workflow === "workflows_active") {
				return message("alert.job_failed.workflows_active");
			}
			const occurred = instantParam(params, "opened_at") ?? facts.at;
			return message("alert.job_failed", {
				workflow: workflowLabel(workflow),
				time: formatClockTime(occurred, facts.readerTimezone),
				conclusion: textParam(params, "conclusion") ?? "failure",
			});
		}
		case "channel_failed":
			return message("alert.channel_failed", {
				label: channelWord(textParam(params, "channel_kind", "kind")),
				reason: reasonText(
					textParam(params, "error_code", "last_error_code", "code"),
				),
			});
		case "digest_failed": {
			const date = textParam(params, "business_date");
			return message("alert.digest_failed", {
				date: date === null ? UNKNOWN : formatViDate(date),
				attempts: countText(numberParam(params, "attempts") ?? 5),
			});
		}
		default:
			return message("alert.generic", { rule });
	}
}

function reminderText(facts: AlertFacts): string {
	if (ruleOf(facts) === "sync_stale") {
		const opened = instantParam(facts.params, "opened_at") ?? facts.at;
		return message("alert.sync_stale.reminder", {
			store: store(facts),
			...clock(facts, opened),
		});
	}
	return openingText(facts);
}

function resolvedText(facts: AlertFacts): string {
	const rule = ruleOf(facts);
	const resolvedAt = instantParam(facts.params, "resolved_at") ?? facts.at;
	switch (rule) {
		case "auth_failed":
			return message("alert.auth_failed.resolved", {
				account: account(facts),
			});
		case "sync_stale":
			return message("alert.sync_stale.resolved", {
				store: store(facts),
				time: formatClockTime(resolvedAt, facts.readerTimezone),
			});
		case "nightly_missing":
			return message("alert.nightly_missing.resolved", {
				time: formatClockTime(resolvedAt, facts.readerTimezone),
			});
		default:
			return message("alert.generic.resolved", { rule });
	}
}

const TITLE_KEYS: Readonly<Record<AlertMessageKind, MessageKey>> = {
	alert: "alert.subject",
	alert_reminder: "alert.reminder.subject",
	alert_resolved: "alert.resolved.subject",
};

export function renderAlert(facts: AlertFacts): RenderedAlert {
	const body =
		facts.kind === "alert_resolved"
			? resolvedText(facts)
			: facts.kind === "alert_reminder"
				? reminderText(facts)
				: openingText(facts);
	return {
		title: message(TITLE_KEYS[facts.kind]),
		text: `${body}\n${message("alert.footer")}`.normalize("NFC"),
	};
}
