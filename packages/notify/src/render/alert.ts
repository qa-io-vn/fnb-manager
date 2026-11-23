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
	"zalo_tokens",
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
	"Zalo tokens": "zalo_tokens",
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

const CASH_REASON_KEYS: readonly (readonly [string, MessageKey])[] = [
	["over_abs", "alert.cash_count_variance.reason.absolute"],
	["over_rel", "alert.cash_count_variance.reason.relative"],
	["over_z", "alert.cash_count_variance.reason.z_score"],
];

const TOKEN_KINDS: ReadonlySet<string> = new Set(["oa", "developer"]);

const OA_TIERS: ReadonlySet<string> = new Set([
	"co_ban",
	"tieu_chuan",
	"tang_truong",
	"toan_dien",
]);

const WEBHOOK_MODE_KEYS: Readonly<Record<string, MessageKey>> = {
	observe: "alert.zalo_webhook_unverified.observe",
	enforce: "alert.zalo_webhook_unverified.enforce",
};

const REDEMPTION_MISMATCH_KINDS = [
	"verified_without_invoice",
	"discount_without_redemption",
	"amount_mismatch",
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
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

function booleanParam(
	params: Readonly<Record<string, unknown>>,
	key: string,
): boolean | null {
	const value = params[key];
	if (typeof value === "boolean") {
		return value;
	}
	return value === "true" ? true : value === "false" ? false : null;
}

function countText(value: number | null): string {
	return value === null ? UNKNOWN : formatViCount(value);
}

function dateText(
	params: Readonly<Record<string, unknown>>,
	key: string,
): string {
	const date = textParam(params, key);
	return date !== null && ISO_DATE.test(date) ? formatViDate(date) : UNKNOWN;
}

function listText(items: readonly string[]): string {
	const last = items.at(-1);
	if (last === undefined || items.length === 1) {
		return last ?? "";
	}
	return `${items.slice(0, -1).join(", ")} ${message("list.and")} ${last}`;
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

function cashCountText(facts: AlertFacts): string {
	const params = facts.params;
	const shiftNumber = numberParam(params, "shift_number");
	const shortfall = booleanParam(params, "shortfall");
	const reasons = CASH_REASON_KEYS.filter(
		([key]) => booleanParam(params, key) === true,
	).map(([, reasonKey]) => message(reasonKey));
	const values = {
		store: store(facts),
		shift:
			shiftNumber !== null && Number.isInteger(shiftNumber) && shiftNumber > 0
				? message("alert.cash_count_variance.shift", {
						number: formatViCount(shiftNumber),
					})
				: message("alert.cash_count_variance.shift.unknown"),
		date: dateText(params, "business_date"),
		direction: message(
			shortfall === null
				? "alert.cash_count_variance.differs"
				: shortfall
					? "alert.cash_count_variance.shortfall"
					: "alert.cash_count_variance.surplus",
		),
		reasons:
			reasons.length === 0
				? message("alert.cash_count_variance.reason.unknown")
				: listText(reasons),
	};
	const recounts = numberParam(params, "recounts");
	return recounts !== null && recounts > 0
		? message("alert.cash_count_variance.recount", {
				...values,
				count: countText(recounts),
			})
		: message("alert.cash_count_variance", values);
}

function tokenKind(facts: AlertFacts): string | null {
	const kind = textParam(facts.params, "kind");
	return kind !== null && TOKEN_KINDS.has(kind) ? kind : null;
}

function zaloTokenValues(facts: AlertFacts): TemplateValues {
	const kind = tokenKind(facts);
	return {
		token: message(
			kind === null
				? "alert.zalo_token_failed.token.unknown"
				: (`alert.zalo_token_failed.token.${kind}` as MessageKey),
		),
		brand: textParam(facts.params, "brand") ?? UNKNOWN,
	};
}

function zaloTokenText(facts: AlertFacts): string {
	const values = zaloTokenValues(facts);
	const kind = tokenKind(facts);
	const code = numberParam(facts.params, "error_code");
	switch (textParam(facts.params, "reason")) {
		case "refused":
			return kind === null || code === null
				? message("alert.zalo_token_failed", values)
				: message("alert.zalo_token_failed.refused", {
						...values,
						code: String(code),
						command: message(
							`alert.zalo_token_failed.command.${kind}` as MessageKey,
						),
					});
		case "not_configured":
			return message("alert.zalo_token_failed.not_configured", values);
		case "unanswered":
			return message("alert.zalo_token_failed.unanswered", values);
		default:
			return message("alert.zalo_token_failed", values);
	}
}

function oaPackageText(facts: AlertFacts): string {
	const tier = textParam(facts.params, "tier");
	const values = {
		tier:
			tier !== null && OA_TIERS.has(tier)
				? message(`alert.oa_package_expiring.tier.${tier}` as MessageKey)
				: (tier ?? UNKNOWN),
		date: dateText(facts.params, "expires_on"),
	};
	const days = numberParam(facts.params, "days_left");
	return days === 0
		? message("alert.oa_package_expiring.last_day", values)
		: message("alert.oa_package_expiring", {
				...values,
				days: countText(days),
			});
}

function webhookUnverifiedText(facts: AlertFacts): string {
	const mode = textParam(facts.params, "mode");
	return message(
		(mode === null ? undefined : WEBHOOK_MODE_KEYS[mode]) ??
			"alert.zalo_webhook_unverified",
		{
			date: dateText(facts.params, "business_date"),
			count: countText(numberParam(facts.params, "unverified")),
			threshold: countText(numberParam(facts.params, "max_per_day")),
		},
	);
}

function redemptionMismatchText(facts: AlertFacts): string {
	const counted = REDEMPTION_MISMATCH_KINDS.flatMap((kind) => {
		const count = numberParam(facts.params, kind);
		return count !== null && Number.isInteger(count) && count > 0
			? [{ kind, count }]
			: [];
	});
	const total =
		numberParam(facts.params, "open_items") ??
		(counted.length === 0
			? null
			: counted.reduce((sum, entry) => sum + entry.count, 0));
	const values = { store: store(facts), count: countText(total) };
	return counted.length === 0
		? message("alert.redemption_mismatch.unsorted", values)
		: message("alert.redemption_mismatch", {
				...values,
				kinds: listText(
					counted.map(({ kind, count }) =>
						message(`alert.redemption_mismatch.${kind}` as MessageKey, {
							count: formatViCount(count),
						}),
					),
				),
			});
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
		case "dsr_due_soon":
			return message("alert.dsr_due_soon", {
				overdue: countText(numberParam(params, "overdue") ?? 0),
				due_soon: countText(numberParam(params, "due_soon") ?? 0),
				days: countText(numberParam(params, "days") ?? 3),
			});
		case "cash_count_variance":
			return cashCountText(facts);
		case "zalo_token_failed":
			return zaloTokenText(facts);
		case "oa_package_expiring":
			return oaPackageText(facts);
		case "zalo_webhook_unverified":
			return webhookUnverifiedText(facts);
		case "redemption_mismatch":
			return redemptionMismatchText(facts);
		default:
			return message("alert.generic", { rule });
	}
}

/** The first overdue notice of a request (no whole day late yet) is an escalation, not a reminder: say so. */
function isJustOverdue(facts: AlertFacts): boolean {
	return (
		facts.kind === "alert_reminder" &&
		ruleOf(facts) === "dsr_due_soon" &&
		(numberParam(facts.params, "days_late") ?? 0) === 0
	);
}

function reminderText(facts: AlertFacts): string {
	const rule = ruleOf(facts);
	if (rule === "sync_stale" || rule === "zalo_token_failed") {
		const opened = instantParam(facts.params, "opened_at") ?? facts.at;
		return rule === "sync_stale"
			? message("alert.sync_stale.reminder", {
					store: store(facts),
					...clock(facts, opened),
				})
			: message("alert.zalo_token_failed.reminder", {
					...zaloTokenValues(facts),
					...clock(facts, opened),
				});
	}
	if (rule === "dsr_due_soon") {
		// ADR-045: the repeat of this rule is the overdue notice, sent when a request turns overdue and every 24 hours after
		const overdue = countText(numberParam(facts.params, "overdue") ?? 0);
		if (isJustOverdue(facts)) {
			return message("alert.dsr_due_soon.overdue_now", { overdue });
		}
		return message("alert.dsr_due_soon.reminder", {
			overdue,
			days_late: countText(numberParam(facts.params, "days_late") ?? 0),
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
		case "zalo_token_failed":
			return message("alert.zalo_token_failed.resolved", {
				...zaloTokenValues(facts),
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
		title: message(
			isJustOverdue(facts) ? "alert.subject" : TITLE_KEYS[facts.kind],
		),
		text: `${body}\n${message("alert.footer")}`.normalize("NFC"),
	};
}
