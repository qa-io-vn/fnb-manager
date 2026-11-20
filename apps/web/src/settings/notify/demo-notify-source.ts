import { SettingsWriteError } from "../source";
import {
	type AlertEpisode,
	type CatalogueRule,
	type ChannelKind,
	type Destination,
	type DestinationChange,
	type DigestRecord,
	type EffectivePolicy,
	type EffectiveRule,
	HISTORY_PAGE_SIZE,
	type LinkableKind,
	type LinkStart,
	type LogMessage,
	type MessageState,
	type NotifyOverview,
	type NotifySource,
	type PolicyChange,
	RATE_LIMITED,
	RESENDABLE_KINDS,
	type RuleChange,
	type Severity,
	ZALO_BOT_MONTHLY_QUOTA,
} from "./source";

export const DEMO_TEST_CHECKS = 2;
export const DEMO_LINK_CHECKS = 2;

interface DemoRuleOverride {
	readonly id: string;
	readonly ruleKey: string;
	readonly storeId: string | null;
	readonly enabled: boolean;
	readonly severity: Severity;
	readonly params: Readonly<Record<string, unknown>>;
	readonly cooldownHours: number;
}

interface DemoPolicyOverride {
	readonly id: string;
	readonly channelKind: ChannelKind;
	readonly windowStart: string | null;
	readonly windowEnd: string | null;
	readonly maxPerDay: number | null;
	readonly criticalBypass: boolean;
}

interface DemoState {
	destinations: Destination[];
	overrides: DemoRuleOverride[];
	policyOverrides: DemoPolicyOverride[];
	episodes: AlertEpisode[];
	messages: (LogMessage & { readonly sendAt?: number })[];
	digests: DigestRecord[];
	pendingLinks: Map<string, number>;
	tests: Map<string, number[]>;
	consent: boolean;
	next: number;
}

export const DEMO_CATALOGUE: readonly CatalogueRule[] = [
	{
		ruleKey: "daily_digest",
		category: "digest",
		delivery: "digest",
		defaultParams: {
			deadline_local: "06:30",
			settle_grace_minutes: 30,
			skip_closed_days: true,
			corrections: true,
		},
		paramsSchema: {
			deadline_local: { type: "time" },
			settle_grace_minutes: { type: "integer", min: 0, max: 240 },
			skip_closed_days: { type: "boolean" },
			corrections: { type: "boolean" },
		},
		storeScoped: false,
		sortOrder: 10,
	},
	{
		ruleKey: "revenue_below_baseline",
		category: "business",
		delivery: "digest",
		defaultParams: { ratio: 0.75, min_sample_days: 4 },
		paramsSchema: {
			ratio: { type: "number", min: 0.1, max: 0.99 },
			min_sample_days: { type: "integer", min: 1, max: 8 },
		},
		storeScoped: true,
		sortOrder: 20,
	},
	{
		ruleKey: "zero_sales_open",
		category: "business",
		delivery: "immediate",
		defaultParams: {
			min_open_minutes: 120,
			fresh_sync_minutes: 45,
			min_history_days: 28,
			skip_holidays: true,
		},
		paramsSchema: {
			min_open_minutes: { type: "integer", min: 30, max: 720 },
			fresh_sync_minutes: { type: "integer", min: 15, max: 120 },
			min_history_days: { type: "integer", min: 0, max: 365 },
			skip_holidays: { type: "boolean" },
		},
		storeScoped: true,
		sortOrder: 70,
	},
	{
		ruleKey: "sync_stale",
		category: "sync",
		delivery: "immediate",
		defaultParams: { threshold_minutes: 90 },
		paramsSchema: {
			threshold_minutes: { type: "integer", min: 90, max: 1440 },
		},
		storeScoped: true,
		sortOrder: 100,
	},
	{
		ruleKey: "nightly_missing",
		category: "operations",
		delivery: "immediate",
		defaultParams: { hours: 30 },
		paramsSchema: { hours: { type: "integer", min: 26, max: 96 } },
		storeScoped: false,
		sortOrder: 120,
	},
	{
		ruleKey: "channel_failed",
		category: "channel",
		delivery: "immediate",
		defaultParams: {},
		paramsSchema: {},
		storeScoped: false,
		sortOrder: 140,
	},
];

const DEFAULT_RULES: Readonly<
	Record<string, { severity: Severity; roles: string[]; cooldown: number }>
> = {
	daily_digest: { severity: "info", roles: ["owner", "manager"], cooldown: 0 },
	revenue_below_baseline: {
		severity: "warning",
		roles: ["owner", "manager"],
		cooldown: 0,
	},
	zero_sales_open: {
		severity: "warning",
		roles: ["owner", "manager"],
		cooldown: 24,
	},
	sync_stale: { severity: "critical", roles: ["owner"], cooldown: 2 },
	nightly_missing: { severity: "warning", roles: ["owner"], cooldown: 24 },
	channel_failed: { severity: "warning", roles: ["owner"], cooldown: 24 },
};

const GLOBAL_POLICIES: readonly EffectivePolicy[] = [
	{
		channelKind: "zalo_bot",
		messageClass: "operational",
		allowed: true,
		windowStart: "06:00",
		windowEnd: "22:00",
		maxPerDay: 30,
		maxPerMonth: null,
		criticalBypass: true,
		source: "global",
		policyId: "demo-policy-zalo-bot",
		note: "tin vận hành nội bộ, không phải quảng cáo",
	},
	{
		channelKind: "email",
		messageClass: "operational",
		allowed: true,
		windowStart: null,
		windowEnd: null,
		maxPerDay: 50,
		maxPerMonth: null,
		criticalBypass: true,
		source: "global",
		policyId: "demo-policy-email",
		note: "tin vận hành nội bộ, không phải quảng cáo",
	},
	{
		channelKind: "telegram",
		messageClass: "operational",
		allowed: true,
		windowStart: "06:00",
		windowEnd: "22:00",
		maxPerDay: 30,
		maxPerMonth: null,
		criticalBypass: true,
		source: "global",
		policyId: "demo-policy-telegram",
		note: "kênh tùy chọn",
	},
	{
		channelKind: "email",
		messageClass: "advertising",
		allowed: true,
		windowStart: "07:00",
		windowEnd: "22:00",
		maxPerDay: 3,
		maxPerMonth: null,
		criticalBypass: false,
		source: "global",
		policyId: "demo-policy-email-ad",
		note: "Nghị định 91/2020",
	},
	{
		channelKind: "zalo_zbs",
		messageClass: "transactional",
		allowed: true,
		windowStart: "06:00",
		windowEnd: "22:00",
		maxPerDay: null,
		maxPerMonth: null,
		criticalBypass: false,
		source: "global",
		policyId: "demo-policy-zbs",
		note: "tin giao dịch theo mẫu ZBS",
	},
];

function hoursAgo(now: number, hours: number): string {
	return new Date(now - hours * 3_600_000).toISOString();
}

function isoDateDaysAgo(now: number, days: number): string {
	return new Date(now - days * 86_400_000).toISOString().slice(0, 10);
}

function demoDestination(
	partial: Partial<Destination> & Pick<Destination, "id" | "kind" | "label">,
): Destination {
	return {
		provider: partial.kind,
		status: "active",
		enabled: true,
		disabledReason: null,
		addressHint: null,
		mine: true,
		hasMember: true,
		memberRole: "owner",
		memberEmail: null,
		storeIds: null,
		mutedRules: [],
		timezone: null,
		linkedAt: null,
		lastOkAt: null,
		lastErrorCode: null,
		lastErrorAt: null,
		consecutiveFailures: 0,
		secretReported: true,
		...partial,
	};
}

function demoMessage(
	partial: Partial<LogMessage> & Pick<LogMessage, "id" | "kind" | "status">,
	now: number,
): LogMessage {
	return {
		channel: "zalo_bot",
		channelId: "demo-dest-bot",
		decision: null,
		holdReason: null,
		notBefore: null,
		sentAt: null,
		createdAt: hoursAgo(now, 1),
		body: null,
		bodyVisible: true,
		resendOf: null,
		lastErrorCode: null,
		...partial,
	};
}

export function initialDemoState(
	now: number,
	storeIds: readonly string[],
): DemoState {
	const [first = "demo-store-1"] = storeIds;
	const destinations = [
		demoDestination({
			id: "demo-dest-bot",
			kind: "zalo_bot",
			label: "Zalo Bot",
			addressHint: "…3f7a",
			linkedAt: hoursAgo(now, 24 * 20),
			lastOkAt: hoursAgo(now, 2),
			memberEmail: "o…@example.com",
		}),
		demoDestination({
			id: "demo-dest-mail",
			kind: "email",
			provider: "brevo",
			label: "E-mail",
			status: "pending",
			mutedRules: ["daily_digest"],
		}),
		demoDestination({
			id: "demo-dest-failing",
			kind: "zalo_bot",
			label: "Zalo Bot quản lý",
			status: "failing",
			mine: false,
			memberRole: "manager",
			addressHint: "…9c21",
			linkedAt: hoursAgo(now, 24 * 9),
			lastOkAt: hoursAgo(now, 30),
			lastErrorCode: "token_invalid",
			lastErrorAt: hoursAgo(now, 3),
			consecutiveFailures: 3,
		}),
	];
	const episodes: AlertEpisode[] = [
		{
			id: "demo-episode-open",
			ruleKey: "sync_stale",
			storeId: first,
			severity: "critical",
			state: "open",
			openedAt: hoursAgo(now, 3),
			lastSeenAt: hoursAgo(now, 0.2),
			resolvedAt: null,
			resolution: null,
			occurrences: 4,
			foldedOccurrences: 0,
			facts: { minutes_without_sync: 180, threshold_minutes: 90 },
		},
		{
			id: "demo-episode-folded",
			ruleKey: "zero_sales_open",
			storeId: first,
			severity: "warning",
			state: "resolved",
			openedAt: hoursAgo(now, 30),
			lastSeenAt: hoursAgo(now, 28),
			resolvedAt: hoursAgo(now, 27),
			resolution: "day_ended",
			occurrences: 3,
			foldedOccurrences: 2,
			facts: { open_minutes: 130 },
		},
		{
			id: "demo-episode-resolved",
			ruleKey: "nightly_missing",
			storeId: null,
			severity: "warning",
			state: "resolved",
			openedAt: hoursAgo(now, 72),
			lastSeenAt: hoursAgo(now, 70),
			resolvedAt: hoursAgo(now, 60),
			resolution: "recovered",
			occurrences: 2,
			foldedOccurrences: 0,
			facts: { hours: 30 },
		},
	];
	const digests: DigestRecord[] = Array.from({ length: 14 }, (_, index) => {
		const day = isoDateDaysAgo(now, index + 1);
		const net = 4_200_000 + ((index * 731_000) % 2_300_000);
		const invoices = 61 + ((index * 7) % 23);
		const corrected = index === 2;
		const text = `Bản tin ngày ${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}\nDoanh thu thuần: ${net.toLocaleString("vi-VN")} ₫\nSố hóa đơn: ${invoices}`;
		return {
			id: `demo-digest-${index + 1}`,
			businessDate: day,
			storeIds: [first],
			allStores: true,
			dataState: index === 0 ? "unverified" : "verified",
			revision: corrected ? 1 : 0,
			builtAt: hoursAgo(now, 24 * index + 18),
			net,
			invoices,
			deliveries: [
				{
					messageId: `demo-digest-message-${index + 1}`,
					channelId: "demo-dest-bot",
					kind: "digest",
					status: "sent",
					sentAt: hoursAgo(now, 24 * index + 18),
					body: text,
				},
				...(corrected
					? [
							{
								messageId: `demo-digest-correction-${index + 1}`,
								channelId: "demo-dest-bot",
								kind: "digest_correction" as const,
								status: "sent" as const,
								sentAt: hoursAgo(now, 24 * index + 12),
								body: `Đính chính bản tin ngày ${day.slice(8, 10)}/${day.slice(5, 7)}: doanh thu thuần sau đối soát là ${(net + 85_000).toLocaleString("vi-VN")} ₫.`,
							},
						]
					: []),
			],
		};
	});
	const messages: LogMessage[] = [
		demoMessage(
			{
				id: "demo-msg-sent",
				kind: "digest",
				status: "sent",
				sentAt: hoursAgo(now, 18),
				createdAt: hoursAgo(now, 18.1),
				body: digests[0]?.deliveries[0]?.body ?? null,
			},
			now,
		),
		demoMessage(
			{
				id: "demo-msg-held",
				kind: "alert",
				status: "held",
				decision: "outside_window",
				holdReason: "outside_window",
				notBefore: new Date(now + 5 * 3_600_000).toISOString(),
				createdAt: hoursAgo(now, 1),
				body: "Cảnh báo: cửa hàng chưa đồng bộ thành công trong 180 phút mở cửa.",
			},
			now,
		),
		demoMessage(
			{
				id: "demo-msg-uncertain",
				kind: "alert",
				status: "uncertain",
				createdAt: hoursAgo(now, 5),
				body: "Cảnh báo: đồng bộ đêm chưa chạy thành công trong 30 giờ qua.",
			},
			now,
		),
		demoMessage(
			{
				id: "demo-msg-failed",
				kind: "alert",
				status: "failed",
				channelId: "demo-dest-failing",
				lastErrorCode: "token_invalid",
				createdAt: hoursAgo(now, 3),
				body: null,
				bodyVisible: false,
			},
			now,
		),
		demoMessage(
			{
				id: "demo-msg-cancelled",
				kind: "alert_reminder",
				status: "cancelled",
				decision: "resolved_before_send",
				createdAt: hoursAgo(now, 26),
				body: null,
			},
			now,
		),
	];
	return {
		destinations,
		overrides: [
			{
				id: "demo-override-seed",
				ruleKey: "revenue_below_baseline",
				storeId: null,
				enabled: true,
				severity: "warning",
				params: { ratio: 0.6, min_sample_days: 4 },
				cooldownHours: 0,
			},
		],
		policyOverrides: [],
		episodes,
		messages,
		digests,
		pendingLinks: new Map(),
		tests: new Map(),
		consent: true,
		next: 1,
	};
}

export function paramsProblem(
	rule: CatalogueRule,
	params: Readonly<Record<string, unknown>>,
): string | null {
	for (const [key, value] of Object.entries(params)) {
		const schema = rule.paramsSchema[key];
		if (schema === undefined) return key;
		switch (schema.type) {
			case "boolean":
				if (typeof value !== "boolean") return key;
				break;
			case "time":
				if (
					typeof value !== "string" ||
					!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)
				)
					return key;
				break;
			case "enum":
				if (typeof value !== "string" || !schema.values?.includes(value))
					return key;
				break;
			default: {
				if (typeof value !== "number" || !Number.isFinite(value)) return key;
				if (schema.type === "integer" && !Number.isInteger(value)) return key;
				if (schema.min !== undefined && value < schema.min) return key;
				if (schema.max !== undefined && value > schema.max) return key;
			}
		}
	}
	return null;
}

export function windowProblem(change: PolicyChange): string | null {
	const pattern = /^([01][0-9]|2[0-4]):[0-5][0-9]$/;
	if ((change.windowStart === null) !== (change.windowEnd === null)) {
		return "window";
	}
	if (
		change.windowStart !== null &&
		(!pattern.test(change.windowStart) || !pattern.test(change.windowEnd ?? ""))
	) {
		return "window";
	}
	if (
		change.maxPerDay !== null &&
		(!Number.isInteger(change.maxPerDay) ||
			change.maxPerDay < 1 ||
			change.maxPerDay > 1000)
	) {
		return "max_per_day";
	}
	return null;
}

export function createDemoNotifySource(
	options: {
		readonly now?: () => number;
		readonly storeIds?: readonly string[];
	} = {},
): NotifySource {
	const now = options.now ?? (() => Date.now());
	const state = initialDemoState(now(), options.storeIds ?? []);
	const nextId = (prefix: string) => `${prefix}-${state.next++}`;
	const destination = (channelId: string) => {
		const found = state.destinations.find((row) => row.id === channelId);
		if (found === undefined) throw new SettingsWriteError("forbidden");
		return found;
	};
	const replaceDestination = (row: Destination) => {
		state.destinations = state.destinations.map((entry) =>
			entry.id === row.id ? row : entry,
		);
	};
	const settle = () => {
		const at = now();
		for (const [channelId, left] of state.pendingLinks) {
			if (left > 1) {
				state.pendingLinks.set(channelId, left - 1);
				continue;
			}
			state.pendingLinks.delete(channelId);
			const row = state.destinations.find((entry) => entry.id === channelId);
			if (row !== undefined && row.status === "pending") {
				replaceDestination({
					...row,
					status: "active",
					addressHint: "…5d10",
					linkedAt: new Date(at).toISOString(),
				});
			}
		}
		state.messages = state.messages.map((message) => {
			if (message.sendAt === undefined) return message;
			if (message.sendAt > 1) return { ...message, sendAt: message.sendAt - 1 };
			const target = state.destinations.find(
				(row) => row.id === message.channelId,
			);
			const failing = target?.status === "failing";
			const { sendAt: _sendAt, ...rest } = message;
			return failing
				? {
						...rest,
						status: "failed",
						lastErrorCode: target?.lastErrorCode ?? "unavailable",
					}
				: {
						...rest,
						status: "sent",
						decision: "send",
						sentAt: new Date(at).toISOString(),
					};
		});
	};
	const effective = (storeId: string | null): EffectiveRule[] =>
		DEMO_CATALOGUE.map((rule) => {
			const base = DEFAULT_RULES[rule.ruleKey] ?? {
				severity: "warning" as Severity,
				roles: ["owner"],
				cooldown: 24,
			};
			const tenant = state.overrides.find(
				(row) => row.ruleKey === rule.ruleKey && row.storeId === null,
			);
			const store =
				storeId === null
					? undefined
					: state.overrides.find(
							(row) => row.ruleKey === rule.ruleKey && row.storeId === storeId,
						);
			const chosen = store ?? tenant;
			return {
				ruleKey: rule.ruleKey,
				category: rule.category,
				delivery: rule.delivery,
				enabled: chosen?.enabled ?? true,
				severity: chosen?.severity ?? base.severity,
				roles: base.roles,
				params: {
					...rule.defaultParams,
					...(tenant?.params ?? {}),
					...(store?.params ?? {}),
				},
				cooldownHours: chosen?.cooldownHours ?? base.cooldown,
				source: store ? "store" : tenant ? "tenant" : "catalogue",
				overrideId: chosen?.id ?? null,
				storeScoped: rule.storeScoped,
			};
		});
	return {
		kind: "demo",
		async overview(): Promise<NotifyOverview> {
			settle();
			return {
				role: "owner",
				storeLimited: false,
				scheduleEnabled: true,
				lastTickAt: new Date(now() - 3 * 60_000).toISOString(),
				lastDispatchAt: new Date(now() - 3 * 60_000).toISOString(),
				dispatcherSecrets: ["NOTIFY_ZALO_BOT_TOKEN", "NOTIFY_EMAIL_API_KEY"],
				destinations: state.destinations,
				held24h: state.messages.filter((row) => row.status === "held").length,
				uncertain24h: state.messages.filter((row) => row.status === "uncertain")
					.length,
				failed24h: state.messages.filter((row) => row.status === "failed")
					.length,
				pendingLinks: state.destinations.filter(
					(row) => row.status === "pending",
				).length,
				zaloBotMonth: 412,
				zaloBotQuota: ZALO_BOT_MONTHLY_QUOTA,
			};
		},
		async catalogue() {
			return [...DEMO_CATALOGUE];
		},
		async rules(_tenantId, storeId) {
			return effective(storeId);
		},
		async saveRule(_tenantId, change: RuleChange) {
			const rule = DEMO_CATALOGUE.find((row) => row.ruleKey === change.ruleKey);
			if (rule === undefined) throw new SettingsWriteError("invalid");
			const problem = paramsProblem(rule, change.params);
			if (problem !== null) throw new SettingsWriteError("invalid", problem);
			if (change.storeId !== null && !rule.storeScoped) {
				throw new SettingsWriteError("invalid");
			}
			if (change.cooldownHours < 0 || change.cooldownHours > 168) {
				throw new SettingsWriteError("invalid", "cooldown");
			}
			const kept = state.overrides.filter(
				(row) =>
					!(row.ruleKey === change.ruleKey && row.storeId === change.storeId),
			);
			state.overrides = [
				...kept,
				{
					id: change.overrideId ?? nextId("demo-override"),
					ruleKey: change.ruleKey,
					storeId: change.storeId,
					enabled: change.enabled,
					severity: change.severity,
					params: change.params,
					cooldownHours: change.cooldownHours,
				},
			];
		},
		async resetRule(_tenantId, overrideId) {
			state.overrides = state.overrides.filter((row) => row.id !== overrideId);
		},
		async policies() {
			return GLOBAL_POLICIES.map((policy) => {
				const override =
					policy.messageClass === "operational"
						? state.policyOverrides.find(
								(row) => row.channelKind === policy.channelKind,
							)
						: undefined;
				return override === undefined
					? policy
					: {
							...policy,
							windowStart: override.windowStart,
							windowEnd: override.windowEnd,
							maxPerDay: override.maxPerDay,
							criticalBypass: override.criticalBypass,
							source: "tenant" as const,
							policyId: override.id,
						};
			});
		},
		async savePolicy(_tenantId, change: PolicyChange) {
			const problem = windowProblem(change);
			if (problem !== null) throw new SettingsWriteError("invalid", problem);
			state.policyOverrides = [
				...state.policyOverrides.filter(
					(row) => row.channelKind !== change.channelKind,
				),
				{
					id: change.overrideId ?? nextId("demo-policy"),
					channelKind: change.channelKind,
					windowStart: change.windowStart,
					windowEnd: change.windowEnd,
					maxPerDay: change.maxPerDay,
					criticalBypass: change.criticalBypass,
				},
			];
		},
		async resetPolicy(_tenantId, overrideId) {
			state.policyOverrides = state.policyOverrides.filter(
				(row) => row.id !== overrideId,
			);
		},
		async alertHistory(_tenantId, page) {
			return state.episodes.slice(
				page * HISTORY_PAGE_SIZE,
				(page + 1) * HISTORY_PAGE_SIZE,
			);
		},
		async messageLog(_tenantId, page) {
			settle();
			const ordered = [...state.messages].sort(
				(left, right) =>
					right.createdAt.localeCompare(left.createdAt) ||
					left.id.localeCompare(right.id),
			);
			return ordered
				.slice(page * HISTORY_PAGE_SIZE, (page + 1) * HISTORY_PAGE_SIZE)
				.map(({ sendAt: _sendAt, ...row }) => row);
		},
		async digests() {
			return state.digests;
		},
		async startLink(_tenantId, kind: LinkableKind, label): Promise<LinkStart> {
			if (
				kind !== "email" &&
				state.destinations.some(
					(row) =>
						row.mine &&
						row.kind === kind &&
						(row.status === "active" || row.status === "failing"),
				)
			) {
				throw new SettingsWriteError("duplicate");
			}
			const existing = state.destinations.find(
				(row) => row.mine && row.kind === kind,
			);
			const id = existing?.id ?? nextId("demo-dest");
			const at = now();
			state.consent = state.consent || kind === "email";
			const row = demoDestination({
				...(existing ?? {}),
				id,
				kind,
				provider: kind === "email" ? "brevo" : kind,
				label:
					label ??
					existing?.label ??
					(kind === "email"
						? "E-mail"
						: kind === "telegram"
							? "Telegram"
							: "Zalo Bot"),
				status: kind === "email" ? "active" : "pending",
				addressHint: kind === "email" ? "o…@example.com" : null,
				linkedAt: kind === "email" ? new Date(at).toISOString() : null,
			});
			state.destinations = existing
				? state.destinations.map((entry) => (entry.id === id ? row : entry))
				: [...state.destinations, row];
			if (kind === "email") {
				return {
					channelId: id,
					status: "active",
					linkCode: null,
					expiresAt: null,
					botName: null,
				};
			}
			state.pendingLinks.set(id, DEMO_LINK_CHECKS);
			return {
				channelId: id,
				status: "pending",
				linkCode: `FNB-DEMO${String(state.next).padStart(4, "0")}`,
				expiresAt: new Date(at + 15 * 60_000).toISOString(),
				botName: kind === "telegram" ? "fnb_demo_bot" : "FNB Demo Bot",
			};
		},
		async updateDestination(channelId, change: DestinationChange) {
			const row = destination(channelId);
			if (change.label !== undefined) {
				const label = change.label.trim();
				if (label.length < 1 || label.length > 60) {
					throw new SettingsWriteError("invalid", "label");
				}
			}
			if (change.timezone !== undefined) {
				try {
					new Intl.DateTimeFormat("en", { timeZone: change.timezone });
				} catch {
					throw new SettingsWriteError("invalid", "timezone");
				}
			}
			if (
				change.mutedRules?.some(
					(key) => !DEMO_CATALOGUE.some((rule) => rule.ruleKey === key),
				)
			) {
				throw new SettingsWriteError("invalid", "muted_rules");
			}
			replaceDestination({
				...row,
				enabled: change.enabled ?? row.enabled,
				label: change.label?.trim() ?? row.label,
				storeIds:
					change.storeIds === undefined ? row.storeIds : change.storeIds,
				mutedRules:
					change.mutedRules === undefined
						? row.mutedRules
						: [...new Set(change.mutedRules)].sort(),
				timezone: change.timezone ?? row.timezone,
			});
		},
		async removeDestination(channelId) {
			destination(channelId);
			const open = state.messages.filter(
				(row) =>
					row.channelId === channelId &&
					(row.status === "queued" || row.status === "held"),
			).length;
			state.destinations = state.destinations.filter(
				(row) => row.id !== channelId,
			);
			return open;
		},
		async sendTest(channelId) {
			const row = destination(channelId);
			if (
				!row.enabled ||
				(row.status !== "active" && row.status !== "failing")
			) {
				throw new SettingsWriteError("invalid", "status");
			}
			const at = now();
			const recent = (state.tests.get(channelId) ?? []).filter(
				(sent) => sent > at - 3_600_000,
			);
			if (recent.some((sent) => sent > at - 60_000) || recent.length >= 5) {
				throw new SettingsWriteError("invalid", RATE_LIMITED);
			}
			state.tests.set(channelId, [...recent, at]);
			const id = nextId("demo-test");
			state.messages = [
				...state.messages,
				{
					...demoMessage(
						{
							id,
							kind: "test",
							status: "queued",
							channel: row.kind,
							channelId,
							createdAt: new Date(at).toISOString(),
						},
						at,
					),
					sendAt: DEMO_TEST_CHECKS,
				},
			];
			return id;
		},
		async messageStatus(messageId): Promise<MessageState | null> {
			settle();
			const row = state.messages.find((message) => message.id === messageId);
			return row === undefined
				? null
				: {
						id: row.id,
						status: row.status,
						decision: row.decision,
						holdReason: row.holdReason,
						notBefore: row.notBefore,
						sentAt: row.sentAt,
						lastErrorCode: row.lastErrorCode,
					};
		},
		async resend(messageId) {
			const row = state.messages.find((message) => message.id === messageId);
			if (row === undefined) throw new SettingsWriteError("forbidden");
			if (
				!RESENDABLE_KINDS.has(row.kind) ||
				(row.status !== "uncertain" && row.status !== "failed")
			) {
				throw new SettingsWriteError("invalid");
			}
			const id = nextId("demo-resend");
			const at = now();
			state.messages = [
				...state.messages,
				{
					...row,
					id,
					status: "queued",
					decision: null,
					sentAt: null,
					lastErrorCode: null,
					resendOf: row.id,
					createdAt: new Date(at).toISOString(),
					sendAt: DEMO_TEST_CHECKS,
				},
			];
			return id;
		},
		async stopMine() {
			const mine = new Set(
				state.destinations.filter((row) => row.mine).map((row) => row.id),
			);
			let cancelled = 0;
			state.messages = state.messages.map((row) => {
				if (
					row.channelId !== null &&
					mine.has(row.channelId) &&
					(row.status === "queued" || row.status === "held")
				) {
					cancelled += 1;
					return { ...row, status: "cancelled", decision: "no_consent" };
				}
				return row;
			});
			state.destinations = state.destinations
				.filter((row) => !(row.mine && row.status === "pending"))
				.map((row) =>
					row.mine
						? {
								...row,
								status: "disabled",
								disabledReason: "consent_withdrawn",
							}
						: row,
				);
			state.consent = false;
			return cancelled;
		},
	};
}
