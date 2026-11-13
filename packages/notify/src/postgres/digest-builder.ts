import { AnalyticsCallError } from "@fnb/reports";
import type { Sql } from "postgres";
import type { NotifyEnvironment } from "../channels/secrets.js";
import {
	buildDigest,
	type DigestBuild,
	type DueDigest,
} from "../digest/build.js";
import { digestFingerprint } from "../digest/fingerprint.js";
import type { DigestModel } from "../digest/model.js";
import type { CycleBudget } from "../dispatch/budget.js";
import type {
	DigestBuildCounts,
	DigestBuilder,
} from "../dispatch/repository.js";
import { type DigestChannel, renderDigest } from "../render/digest.js";
import { TemplateError } from "../render/template.js";
import {
	appBaseUrl,
	type DigestChannel as ChannelRow,
	completeDigestAndEnqueue,
	type DigestMessageInput,
	digestChannels,
	dueDigests,
	failDigest,
	loadRuleSet,
	openDigestAlerts,
	scopeStores,
} from "./digests.js";
import { withMemberSnapshot } from "./member-snapshot.js";
import { guardScan, type NotifyRepositoryOptions } from "./repository.js";

export type DigestStatus = "built" | "already_built" | "failed" | "dry_run";

export interface RenderedDigestMessage {
	readonly channelId: string;
	readonly channel: DigestChannel;
	readonly title: string;
	readonly text: string;
	readonly units: number;
}

export interface DigestOutcome {
	readonly due: DueDigest;
	readonly status: DigestStatus;
	readonly model: DigestModel | null;
	readonly fingerprint: string | null;
	readonly messages: number;
	readonly rendered: readonly RenderedDigestMessage[];
	readonly units: number | null;
	readonly errorCode: string | null;
	readonly failureRecorded: boolean;
	readonly build: DigestBuild | null;
}

const ERROR_CODE = /^[a-z0-9_]{1,40}$/;

export function digestErrorCode(error: unknown): string {
	if (error instanceof AnalyticsCallError) {
		const code = `analytics_${(error.code ?? "error").toLowerCase()}`
			.replace(/[^a-z0-9_]/g, "_")
			.slice(0, 40);
		return ERROR_CODE.test(code) ? code : "analytics_error";
	}
	if (error instanceof TemplateError) {
		return "render_failed";
	}
	const code =
		typeof error === "object" && error !== null
			? (error as { readonly code?: unknown }).code
			: undefined;
	if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
		return `db_${code.toLowerCase()}`;
	}
	return "build_failed";
}

export function digestChannelOf(kind: string): DigestChannel | null {
	return kind === "zalo_bot" || kind === "telegram" || kind === "email"
		? kind
		: null;
}

export function renderForChannels(
	model: DigestModel,
	channels: readonly ChannelRow[],
	baseUrl: string | null,
): RenderedDigestMessage[] {
	return channels.flatMap((channel) => {
		const kind = digestChannelOf(channel.kind);
		if (kind === null) {
			return [];
		}
		const rendered = renderDigest(model, {
			channel: kind,
			appBaseUrl: baseUrl,
			timeZone: channel.readerTimezone,
			currencyCode: channel.currencyCode,
		});
		return [
			{
				channelId: channel.id,
				channel: kind,
				title: rendered.title,
				text: rendered.text,
				units: rendered.units,
			},
		];
	});
}

export interface ScopeDigestOptions {
	readonly at: Date;
	readonly dryRun: boolean;
	readonly keepBuild?: boolean;
}

export async function buildScopeDigest(
	sql: Sql,
	due: DueDigest,
	options: ScopeDigestOptions,
): Promise<DigestOutcome> {
	const empty = {
		due,
		model: null,
		fingerprint: null,
		messages: 0,
		rendered: [],
		units: null,
		failureRecorded: false,
		build: null,
	};
	try {
		const [stores, rules, openAlerts, baseUrl, channels] = await Promise.all([
			scopeStores(sql, due.storeIds),
			loadRuleSet(sql, due.tenantId, due.storeIds),
			openDigestAlerts(sql, due.tenantId, due.storeIds),
			appBaseUrl(sql),
			digestChannels(sql, due.channelIds),
		]);
		const build = await withMemberSnapshot(sql, due.runAs, (source) =>
			buildDigest(
				{
					due,
					stores,
					rules,
					openAlerts,
					appBaseUrl: baseUrl,
					now: options.at,
				},
				source,
			),
		);
		const fingerprint = await digestFingerprint(build.model);
		const rendered = renderForChannels(build.model, channels, baseUrl);
		const units =
			rendered.find((entry) => entry.channel === "zalo_bot")?.units ??
			renderDigest(build.model, {
				channel: "zalo_bot",
				appBaseUrl: baseUrl,
				timeZone: stores[0]?.timeZone ?? "Asia/Ho_Chi_Minh",
				currencyCode: channels[0]?.currencyCode ?? "VND",
			}).units;
		const kept = options.keepBuild === true ? build : null;
		if (options.dryRun) {
			return {
				...empty,
				status: "dry_run",
				model: build.model,
				fingerprint,
				rendered,
				units,
				errorCode: null,
				build: kept,
			};
		}
		const messages: DigestMessageInput[] = rendered.map((entry) => ({
			channelId: entry.channelId,
			title: entry.title,
			body: entry.text,
		}));
		const stored = await completeDigestAndEnqueue(sql, {
			due,
			model: build.model,
			fingerprint,
			at: options.at,
			messages,
		});
		return {
			...empty,
			status: stored.digestId === null ? "already_built" : "built",
			model: build.model,
			fingerprint,
			messages: stored.messageIds.length,
			rendered,
			units,
			errorCode: null,
			build: kept,
		};
	} catch (error) {
		const errorCode = digestErrorCode(error);
		if (options.dryRun) {
			return { ...empty, status: "failed", errorCode };
		}
		await failDigest(sql, due, errorCode, options.at);
		return { ...empty, status: "failed", errorCode, failureRecorded: true };
	}
}

export interface DueDigestRunOptions {
	readonly at: Date;
	readonly tenantId: string | null;
	readonly dryRun: boolean;
	readonly budget?: CycleBudget;
	readonly repositoryOptions: NotifyRepositoryOptions;
}

export async function buildDueDigestsNow(
	sql: Sql,
	options: DueDigestRunOptions,
): Promise<DigestOutcome[]> {
	guardScan(options.repositoryOptions, "a due-digest scan", options.tenantId);
	const due = await dueDigests(sql, options.at, options.tenantId);
	const outcomes: DigestOutcome[] = [];
	for (const entry of due) {
		if (options.budget && !options.budget.allows("digest")) {
			break;
		}
		options.budget?.spend("digest");
		outcomes.push(
			await buildScopeDigest(sql, entry, {
				at: options.at,
				dryRun: options.dryRun,
			}),
		);
	}
	return outcomes;
}

export function countDigestOutcomes(
	outcomes: readonly DigestOutcome[],
): DigestBuildCounts {
	return {
		built: outcomes.filter((outcome) => outcome.status === "built").length,
		failed: outcomes.filter((outcome) => outcome.status === "failed").length,
		messages: outcomes.reduce((sum, outcome) => sum + outcome.messages, 0),
	};
}

export function createPostgresDigestBuilder(
	sql: Sql,
	options: {
		readonly environment: NotifyEnvironment;
		readonly simulatedClock?: boolean;
	},
): DigestBuilder {
	return {
		async buildDue(at, tenantId, budget) {
			const outcomes = await buildDueDigestsNow(sql, {
				at,
				tenantId,
				dryRun: false,
				budget,
				repositoryOptions: options,
			});
			return countDigestOutcomes(outcomes);
		},
	};
}
