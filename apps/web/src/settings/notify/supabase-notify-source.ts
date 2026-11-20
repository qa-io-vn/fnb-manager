import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { SettingsWriteError } from "../source";
import { type PostgrestFailure, writeErrorOf } from "../supabase-common";
import {
	type AlertEpisode,
	type CatalogueRule,
	CHANNEL_KINDS,
	DESTINATION_STATUSES,
	type DestinationChange,
	DIGEST_LIMIT,
	type DigestRecord,
	type EffectivePolicy,
	type EffectiveRule,
	HISTORY_PAGE_SIZE,
	type LinkableKind,
	type LinkStart,
	type LogMessage,
	MESSAGE_KINDS,
	MESSAGE_STATUSES,
	type MessageState,
	type NotifyOverview,
	type NotifySource,
	type ParamSchema,
	type PolicyChange,
	RATE_LIMITED,
	type RuleChange,
	SEVERITIES,
} from "./source";

const count = z
	.union([z.number(), z.string()])
	.transform((value) => Number(value));

const destinationRow = z.object({
	id: z.string(),
	kind: z.enum(CHANNEL_KINDS),
	provider: z.string(),
	label: z.string(),
	status: z.enum(DESTINATION_STATUSES),
	enabled: z.boolean(),
	disabled_reason: z.string().nullable(),
	address_hint: z.string().nullable(),
	mine: z.boolean(),
	has_member: z.boolean(),
	member_role: z.string().nullable(),
	member_email: z.string().nullable(),
	store_ids: z.array(z.string()).nullable(),
	muted_rules: z.array(z.string()),
	timezone: z.string().nullable(),
	linked_at: z.string().nullable(),
	last_ok_at: z.string().nullable(),
	last_error_code: z.string().nullable(),
	last_error_at: z.string().nullable(),
	consecutive_failures: count,
	secret_reported: z.boolean().nullable(),
});

const overviewRow = z.object({
	role: z.string(),
	store_limited: z.boolean(),
	schedule_enabled: z.boolean(),
	last_tick_at: z.string().nullable(),
	last_dispatch_at: z.string().nullable(),
	dispatcher_secrets: z.array(z.string()),
	destinations: z.array(destinationRow),
	held_24h: count,
	uncertain_24h: count,
	failed_24h: count,
	pending_links: count,
	zalo_bot_month: count,
	zalo_bot_quota: count,
});

const paramSchema = z.object({
	type: z.enum(["number", "integer", "boolean", "time", "enum"]),
	min: z.number().optional(),
	max: z.number().optional(),
	values: z.array(z.string()).optional(),
});

const catalogueRow = z.object({
	rule_key: z.string(),
	category: z.string(),
	delivery: z.enum(["digest", "immediate"]),
	default_params: z.record(z.string(), z.unknown()),
	params_schema: z.record(z.string(), paramSchema),
	store_scoped: z.boolean(),
	sort_order: count,
});

export const CATALOGUE_SELECT =
	"rule_key,category,delivery,default_params,params_schema,store_scoped,sort_order";

const effectiveRuleRow = z.object({
	rule_key: z.string(),
	category: z.string(),
	delivery: z.string(),
	enabled: z.boolean(),
	severity: z.enum(SEVERITIES),
	roles: z.array(z.string()),
	params: z.record(z.string(), z.unknown()),
	cooldown: z.string(),
	source: z.enum(["catalogue", "tenant", "store"]),
	override_id: z.string().nullable(),
	store_scoped: z.boolean(),
});

const policyRow = z.object({
	channel_kind: z.enum(CHANNEL_KINDS),
	message_class: z.enum(["operational", "transactional", "advertising"]),
	allowed: z.boolean(),
	window_start: z.string().nullable(),
	window_end: z.string().nullable(),
	max_per_day: count.nullable(),
	max_per_month: count.nullable(),
	critical_bypass: z.boolean(),
	source: z.enum(["global", "tenant"]),
	policy_id: z.string(),
	note: z.string(),
});

const globalPolicyRow = z.object({
	channel_kind: z.string(),
	message_class: z.string(),
	allowed: z.boolean(),
	cap_window: z.string(),
	max_per_month: count.nullable(),
	label: z.string().nullable(),
	label_position: z.string().nullable(),
	opt_out_text: z.string().nullable(),
	sender_info_required: z.boolean(),
	consent_purpose: z.string().nullable(),
	requires_consent: z.boolean(),
	interaction_window: z.string().nullable(),
	api_send_allowed: z.boolean(),
	source_note: z.string(),
});

export const GLOBAL_POLICY_SELECT =
	"channel_kind,message_class,allowed,cap_window,max_per_month,label,label_position,opt_out_text,sender_info_required,consent_purpose,requires_consent,interaction_window,api_send_allowed,source_note";

const episodeRow = z.object({
	id: z.string(),
	rule_key: z.string(),
	store_id: z.string().nullable(),
	severity: z.enum(SEVERITIES),
	state: z.enum(["open", "resolved"]),
	opened_at: z.string(),
	last_seen_at: z.string(),
	resolved_at: z.string().nullable(),
	resolution: z.string().nullable(),
	occurrences: count,
	folded_occurrences: count,
	facts: z.record(z.string(), z.unknown()).nullable(),
});

export const EPISODE_SELECT =
	"id,rule_key,store_id,severity,state,opened_at,last_seen_at,resolved_at,resolution,occurrences,folded_occurrences,facts";

const messageRow = z.object({
	id: z.string(),
	kind: z.enum(MESSAGE_KINDS),
	channel: z.string(),
	channel_id: z.string().nullable(),
	status: z.enum(MESSAGE_STATUSES),
	decision: z.string().nullable(),
	hold_reason: z.string().nullable(),
	not_before: z.string().nullable(),
	sent_at: z.string().nullable(),
	created_at: z.string(),
	body: z.string().nullable(),
	resend_of: z.string().nullable(),
	last_error_code: z.string().nullable(),
	digest_id: z.string().nullable().optional(),
});

export const MESSAGE_SELECT =
	"id,kind,channel,channel_id,status,decision,hold_reason,not_before,sent_at,created_at,body,resend_of,last_error_code";

const digestRow = z.object({
	id: z.string(),
	business_date: z.string(),
	store_ids: z.array(z.string()),
	all_stores: z.boolean(),
	data_state: z.string().nullable(),
	revision: count,
	built_at: z.string().nullable(),
	model: z.unknown(),
});

export const DIGEST_SELECT =
	"id,business_date,store_ids,all_stores,data_state,revision,built_at,model";

export const DELIVERY_SELECT = `${MESSAGE_SELECT},digest_id`;

const linkRow = z.object({
	channel_id: z.string(),
	status: z.enum(DESTINATION_STATUSES),
	link_code: z.string().nullable(),
	expires_at: z.string().nullable(),
	bot_name: z.string().nullable(),
});

const stateRow = z.object({
	id: z.string(),
	status: z.enum(MESSAGE_STATUSES),
	decision: z.string().nullable(),
	hold_reason: z.string().nullable(),
	not_before: z.string().nullable(),
	sent_at: z.string().nullable(),
	last_error_code: z.string().nullable(),
});

interface Reply {
	readonly data: unknown;
	readonly error: (PostgrestFailure & { hint?: string | null }) | null;
}

export function notifyErrorOf(
	error: PostgrestFailure & { hint?: string | null },
): SettingsWriteError {
	if (error.code === "22023" && error.hint === RATE_LIMITED) {
		return new SettingsWriteError("invalid", RATE_LIMITED);
	}
	return writeErrorOf(error);
}

async function answered(request: PromiseLike<Reply>): Promise<unknown> {
	let reply: Reply;
	try {
		reply = await request;
	} catch {
		throw new SettingsWriteError("network");
	}
	if (reply.error !== null) throw notifyErrorOf(reply.error);
	return reply.data;
}

async function rows<T>(
	schema: z.ZodType<T>,
	request: PromiseLike<Reply>,
): Promise<T[]> {
	const data = await answered(request);
	return z.array(schema).parse(data ?? []);
}

export function cooldownHoursOf(text: string): number {
	const days = /(\d+)\s+day/.exec(text);
	const clock = /(\d+):(\d+):(\d+)/.exec(text);
	const hours =
		(days ? Number(days[1]) * 24 : 0) +
		(clock ? Number(clock[1]) + Number(clock[2]) / 60 : 0);
	return Math.round(hours * 100) / 100;
}

function shortTime(value: string | null): string | null {
	return value === null ? null : value.slice(0, 5);
}

function modelNumber(model: unknown, key: "net" | "invoices"): number | null {
	if (model === null || typeof model !== "object") return null;
	const totals = (model as { totals?: Record<string, unknown> }).totals;
	const value = totals?.[key];
	return typeof value === "number" ? value : null;
}

function paramsSchemaOf(
	raw: Record<string, z.output<typeof paramSchema>>,
): Record<string, ParamSchema> {
	return Object.fromEntries(
		Object.entries(raw).map(([key, value]) => [key, { ...value }]),
	);
}

export function createSupabaseNotifySource(
	client: SupabaseClient,
): NotifySource {
	return {
		kind: "supabase",
		async overview(tenantId): Promise<NotifyOverview> {
			const data = await answered(
				client.rpc("notify_overview", { p_tenant_id: tenantId }),
			);
			const row = overviewRow.parse(data);
			return {
				role: row.role,
				storeLimited: row.store_limited,
				scheduleEnabled: row.schedule_enabled,
				lastTickAt: row.last_tick_at,
				lastDispatchAt: row.last_dispatch_at,
				dispatcherSecrets: row.dispatcher_secrets,
				destinations: row.destinations.map((d) => ({
					id: d.id,
					kind: d.kind,
					provider: d.provider,
					label: d.label,
					status: d.status,
					enabled: d.enabled,
					disabledReason: d.disabled_reason,
					addressHint: d.address_hint,
					mine: d.mine,
					hasMember: d.has_member,
					memberRole: d.member_role,
					memberEmail: d.member_email,
					storeIds: d.store_ids,
					mutedRules: d.muted_rules,
					timezone: d.timezone,
					linkedAt: d.linked_at,
					lastOkAt: d.last_ok_at,
					lastErrorCode: d.last_error_code,
					lastErrorAt: d.last_error_at,
					consecutiveFailures: d.consecutive_failures,
					secretReported: d.secret_reported === true,
				})),
				held24h: row.held_24h,
				uncertain24h: row.uncertain_24h,
				failed24h: row.failed_24h,
				pendingLinks: row.pending_links,
				zaloBotMonth: row.zalo_bot_month,
				zaloBotQuota: row.zalo_bot_quota,
			};
		},
		async catalogue(): Promise<CatalogueRule[]> {
			const found = await rows(
				catalogueRow,
				client
					.from("alert_rule_catalog")
					.select(CATALOGUE_SELECT)
					.order("sort_order", { ascending: true }),
			);
			return found.map((row) => ({
				ruleKey: row.rule_key,
				category: row.category,
				delivery: row.delivery,
				defaultParams: row.default_params,
				paramsSchema: paramsSchemaOf(row.params_schema),
				storeScoped: row.store_scoped,
				sortOrder: row.sort_order,
			}));
		},
		async rules(tenantId, storeId): Promise<EffectiveRule[]> {
			const found = await rows(
				effectiveRuleRow,
				client.rpc("effective_alert_rules", {
					p_tenant_id: tenantId,
					p_store_id: storeId,
				}),
			);
			return found.map((row) => ({
				ruleKey: row.rule_key,
				category: row.category,
				delivery: row.delivery,
				enabled: row.enabled,
				severity: row.severity,
				roles: row.roles,
				params: row.params,
				cooldownHours: cooldownHoursOf(row.cooldown),
				source: row.source,
				overrideId: row.override_id,
				storeScoped: row.store_scoped,
			}));
		},
		async saveRule(tenantId, change: RuleChange): Promise<void> {
			const values = {
				enabled: change.enabled,
				severity: change.severity,
				params: change.params,
				cooldown: `${change.cooldownHours} hours`,
			};
			if (change.overrideId !== null) {
				await answered(
					client
						.from("alert_rules")
						.update(values)
						.eq("id", change.overrideId)
						.eq("tenant_id", tenantId),
				);
				return;
			}
			await answered(
				client.from("alert_rules").insert({
					tenant_id: tenantId,
					store_id: change.storeId,
					rule_key: change.ruleKey,
					...values,
				}),
			);
		},
		async resetRule(tenantId, overrideId): Promise<void> {
			await answered(
				client
					.from("alert_rules")
					.delete()
					.eq("id", overrideId)
					.eq("tenant_id", tenantId),
			);
		},
		async policies(tenantId): Promise<EffectivePolicy[]> {
			const found = await rows(
				policyRow,
				client.rpc("effective_channel_policies", { p_tenant_id: tenantId }),
			);
			return found.map((row) => ({
				channelKind: row.channel_kind,
				messageClass: row.message_class,
				allowed: row.allowed,
				windowStart: shortTime(row.window_start),
				windowEnd: shortTime(row.window_end),
				maxPerDay: row.max_per_day,
				maxPerMonth: row.max_per_month,
				criticalBypass: row.critical_bypass,
				source: row.source,
				policyId: row.policy_id,
				note: row.note,
			}));
		},
		async savePolicy(tenantId, change: PolicyChange): Promise<void> {
			const values = {
				window_start: change.windowStart,
				window_end: change.windowEnd,
				max_per_day: change.maxPerDay,
				critical_bypass: change.criticalBypass,
			};
			if (change.overrideId !== null) {
				await answered(
					client
						.from("channel_policies")
						.update(values)
						.eq("id", change.overrideId)
						.eq("tenant_id", tenantId),
				);
				return;
			}
			const [global] = await rows(
				globalPolicyRow,
				client
					.from("channel_policies")
					.select(GLOBAL_POLICY_SELECT)
					.is("tenant_id", null)
					.eq("channel_kind", change.channelKind)
					.eq("message_class", "operational")
					.limit(1),
			);
			if (global === undefined) throw new SettingsWriteError("invalid");
			await answered(
				client.from("channel_policies").insert({
					...global,
					tenant_id: tenantId,
					...values,
				}),
			);
		},
		async resetPolicy(tenantId, overrideId): Promise<void> {
			await answered(
				client
					.from("channel_policies")
					.delete()
					.eq("id", overrideId)
					.eq("tenant_id", tenantId),
			);
		},
		async alertHistory(tenantId, page): Promise<AlertEpisode[]> {
			const from = page * HISTORY_PAGE_SIZE;
			const found = await rows(
				episodeRow,
				client
					.from("alert_events")
					.select(EPISODE_SELECT)
					.eq("tenant_id", tenantId)
					.order("opened_at", { ascending: false })
					.order("id", { ascending: true })
					.range(from, from + HISTORY_PAGE_SIZE - 1),
			);
			return found.map((row) => ({
				id: row.id,
				ruleKey: row.rule_key,
				storeId: row.store_id,
				severity: row.severity,
				state: row.state,
				openedAt: row.opened_at,
				lastSeenAt: row.last_seen_at,
				resolvedAt: row.resolved_at,
				resolution: row.resolution,
				occurrences: row.occurrences,
				foldedOccurrences: row.folded_occurrences,
				facts: row.facts ?? {},
			}));
		},
		async messageLog(tenantId, page): Promise<LogMessage[]> {
			const from = page * HISTORY_PAGE_SIZE;
			const found = await rows(
				messageRow,
				client
					.from("outbound_messages")
					.select(MESSAGE_SELECT)
					.eq("tenant_id", tenantId)
					.not("kind", "is", null)
					.order("created_at", { ascending: false })
					.order("id", { ascending: true })
					.range(from, from + HISTORY_PAGE_SIZE - 1),
			);
			return found.map(logMessageOf);
		},
		async digests(tenantId): Promise<DigestRecord[]> {
			const found = await rows(
				digestRow,
				client
					.from("digests")
					.select(DIGEST_SELECT)
					.eq("tenant_id", tenantId)
					.eq("state", "built")
					.order("business_date", { ascending: false })
					.order("id", { ascending: true })
					.limit(DIGEST_LIMIT),
			);
			if (found.length === 0) return [];
			const deliveries = await rows(
				messageRow,
				client
					.from("outbound_messages")
					.select(DELIVERY_SELECT)
					.in(
						"digest_id",
						found.map((row) => row.id),
					)
					.in("kind", ["digest", "digest_correction"])
					.order("created_at", { ascending: true })
					.order("id", { ascending: true }),
			);
			return found.map((row) => ({
				id: row.id,
				businessDate: row.business_date,
				storeIds: row.store_ids,
				allStores: row.all_stores,
				dataState: row.data_state,
				revision: row.revision,
				builtAt: row.built_at,
				net: modelNumber(row.model, "net"),
				invoices: modelNumber(row.model, "invoices"),
				deliveries: deliveries
					.filter((message) => message.digest_id === row.id)
					.map((message) => ({
						messageId: message.id,
						channelId: message.channel_id,
						kind: message.kind,
						status: message.status,
						sentAt: message.sent_at,
						body: message.body,
					})),
			}));
		},
		async startLink(tenantId, kind: LinkableKind, label): Promise<LinkStart> {
			const data = await answered(
				client.rpc("start_channel_link", {
					p_tenant_id: tenantId,
					p_kind: kind,
					p_label: label,
				}),
			);
			const row = linkRow.parse(data);
			return {
				channelId: row.channel_id,
				status: row.status,
				linkCode: row.link_code,
				expiresAt: row.expires_at,
				botName: row.bot_name,
			};
		},
		async updateDestination(channelId, change: DestinationChange) {
			await answered(
				client.rpc("update_destination", {
					p_channel_id: channelId,
					p_enabled: change.enabled ?? null,
					p_label: change.label ?? null,
					p_store_ids:
						change.storeIds === undefined || change.storeIds === null
							? null
							: change.storeIds,
					p_clear_store_ids: change.storeIds === null,
					p_muted_rules: change.mutedRules ?? null,
					p_timezone: change.timezone ?? null,
				}),
			);
		},
		async removeDestination(channelId): Promise<number> {
			return Number(
				await answered(
					client.rpc("remove_destination", { p_channel_id: channelId }),
				),
			);
		},
		async sendTest(channelId): Promise<string> {
			return z
				.string()
				.parse(
					await answered(
						client.rpc("send_test_message", { p_channel_id: channelId }),
					),
				);
		},
		async messageStatus(messageId): Promise<MessageState | null> {
			const data = await answered(
				client.rpc("notify_message_status", { p_message_id: messageId }),
			);
			if (data === null) return null;
			const row = stateRow.parse(data);
			return {
				id: row.id,
				status: row.status,
				decision: row.decision,
				holdReason: row.hold_reason,
				notBefore: row.not_before,
				sentAt: row.sent_at,
				lastErrorCode: row.last_error_code,
			};
		},
		async resend(messageId): Promise<string> {
			return z
				.string()
				.parse(
					await answered(
						client.rpc("resend_message", { p_message_id: messageId }),
					),
				);
		},
		async stopMine(tenantId): Promise<number> {
			return Number(
				await answered(
					client.rpc("stop_my_notifications", { p_tenant_id: tenantId }),
				),
			);
		},
	};
}

function logMessageOf(row: z.output<typeof messageRow>): LogMessage {
	return {
		id: row.id,
		kind: row.kind,
		channel: row.channel,
		channelId: row.channel_id,
		status: row.status,
		decision: row.decision,
		holdReason: row.hold_reason,
		notBefore: row.not_before,
		sentAt: row.sent_at,
		createdAt: row.created_at,
		body: row.body,
		bodyVisible: row.body !== null,
		resendOf: row.resend_of,
		lastErrorCode: row.last_error_code,
	};
}
