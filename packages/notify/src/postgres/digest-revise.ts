import type { Sql } from "postgres";
import type { DigestTrigger, DueDigest } from "../digest/build.js";
import {
	type CorrectionDelta,
	correctionDelta,
	isEmptyDelta,
} from "../digest/fingerprint.js";
import { type DigestModel, parseDigestModel } from "../digest/model.js";
import { renderCorrection } from "../render/correction.js";
import { renderDigest } from "../render/digest.js";
import {
	buildScopeDigest,
	digestChannelOf,
	digestErrorCode,
} from "./digest-builder.js";
import {
	appBaseUrl,
	type DigestChannel,
	digestChannels,
	digestLockKey,
	manualStoreFacts,
} from "./digests.js";
import { guardScan, type NotifyRepositoryOptions } from "./repository.js";
import { textArray } from "./statements.js";

export const SETTLE_GRACE_MINUTES = 30;

export interface RevisionCandidate {
	readonly id: string;
	readonly tenantId: string;
	readonly businessDate: string;
	readonly scopeKey: string;
	readonly storeIds: readonly string[];
	readonly allStores: boolean;
	readonly trigger: DigestTrigger;
	readonly builtAs: string;
	readonly model: unknown;
	readonly fingerprint: string | null;
	readonly revision: number;
	readonly channelIds: readonly string[];
}

export interface RevisionText {
	readonly title: string | null;
	readonly body: string;
}

export interface RevisionEntry {
	readonly channel_id: string;
	readonly digest: RevisionText;
	readonly correction: RevisionText | null;
}

export type RevisionStatus =
	| "unchanged"
	| "replaced"
	| "corrected"
	| "failed"
	| "dry_run";

export interface RevisionOutcome {
	readonly candidate: RevisionCandidate;
	readonly status: RevisionStatus;
	readonly changed: boolean;
	readonly delta: CorrectionDelta | null;
	readonly messages: number;
	readonly errorCode: string | null;
}

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function revisionDigestId(row: unknown): string | null {
	const fields = record(row);
	const value = fields.digest_id ?? fields.id;
	return typeof value === "string" && value !== "" ? value : null;
}

function triggerOf(value: string): DigestTrigger {
	return value === "settled" || value === "deadline" ? value : "manual";
}

export async function digestsToRevise(
	sql: Sql,
	at: Date,
	tenantId: string | null,
	options: NotifyRepositoryOptions,
): Promise<RevisionCandidate[]> {
	guardScan(options, "a digest revision scan", tenantId);
	const listed = await sql<{ row: unknown }[]>`
		select to_jsonb(r) as row
		from app.digests_to_revise(${at}::timestamptz, ${tenantId}::uuid) r
	`;
	const ids = [
		...new Set(
			listed.flatMap((entry) => {
				const id = revisionDigestId(entry.row);
				return id === null ? [] : [id];
			}),
		),
	];
	if (ids.length === 0) {
		return [];
	}
	const rows = await sql<
		{
			id: string;
			tenant_id: string;
			business_date: string;
			scope_key: string;
			store_ids: string[];
			all_stores: boolean;
			trigger: string;
			built_as: string | null;
			model: unknown;
			fingerprint: string | null;
			revision: number;
			channel_ids: string[] | null;
		}[]
	>`
		select
			d.id::text as id,
			d.tenant_id::text as tenant_id,
			d.business_date::text as business_date,
			d.scope_key,
			d.store_ids::text[] as store_ids,
			d.all_stores,
			d.trigger,
			d.built_as::text as built_as,
			d.model,
			d.fingerprint,
			d.revision::integer as revision,
			array(
				select distinct o.channel_id::text
				from public.outbound_messages o
				where o.digest_id = d.id and o.kind = 'digest' and o.channel_id is not null
				order by 1
			) as channel_ids
		from public.digests d
		where d.id in (select jsonb_array_elements_text(${textArray(ids)}::text::jsonb)::uuid)
			and (${tenantId}::uuid is null or d.tenant_id = ${tenantId}::uuid)
		order by d.tenant_id, d.business_date, d.scope_key
	`;
	return rows.flatMap((row) =>
		row.built_as === null
			? []
			: [
					{
						id: row.id,
						tenantId: row.tenant_id,
						businessDate: row.business_date,
						scopeKey: row.scope_key,
						storeIds: [...row.store_ids].sort(),
						allStores: row.all_stores,
						trigger: triggerOf(row.trigger),
						builtAs: row.built_as,
						model: row.model,
						fingerprint: row.fingerprint,
						revision: Number(row.revision),
						channelIds: [...(row.channel_ids ?? [])],
					},
				],
	);
}

export function revisionEntries(
	before: DigestModel,
	after: DigestModel,
	channels: readonly DigestChannel[],
	baseUrl: string | null,
): RevisionEntry[] {
	const delta = correctionDelta(before, after);
	return channels.flatMap((channel) => {
		const kind = digestChannelOf(channel.kind);
		if (kind === null) {
			return [];
		}
		const options = {
			channel: kind,
			appBaseUrl: baseUrl,
			timeZone: channel.readerTimezone,
			currencyCode: channel.currencyCode,
		};
		const digest = renderDigest(after, options);
		const correction = isEmptyDelta(delta)
			? null
			: renderCorrection(delta, after, options);
		return [
			{
				channel_id: channel.id,
				digest: { title: digest.title, body: digest.text },
				correction:
					correction === null
						? null
						: { title: correction.title, body: correction.text },
			},
		];
	});
}

function dueOf(
	candidate: RevisionCandidate,
	storeFacts: DueDigest["storeFacts"],
): DueDigest {
	return {
		tenantId: candidate.tenantId,
		businessDate: candidate.businessDate,
		scopeKey: candidate.scopeKey,
		storeIds: candidate.storeIds,
		allStores: candidate.allStores,
		trigger: candidate.trigger,
		runAs: candidate.builtAs,
		channelIds: candidate.channelIds,
		storeFacts,
	};
}

export interface ReviseOptions {
	readonly at: Date;
	readonly dryRun: boolean;
	readonly graceMinutes?: number;
}

export async function reviseDigest(
	sql: Sql,
	candidate: RevisionCandidate,
	options: ReviseOptions,
): Promise<RevisionOutcome> {
	const failed = (errorCode: string): RevisionOutcome => ({
		candidate,
		status: "failed",
		changed: false,
		delta: null,
		messages: 0,
		errorCode,
	});
	const before = parseDigestModel(candidate.model);
	if (before === null) {
		return failed("model_unreadable");
	}
	try {
		const due = dueOf(
			candidate,
			await manualStoreFacts(
				sql,
				candidate.storeIds,
				candidate.businessDate,
				options.at,
				options.graceMinutes ?? SETTLE_GRACE_MINUTES,
			),
		);
		const rebuilt = await buildScopeDigest(sql, due, {
			at: options.at,
			dryRun: true,
		});
		if (
			rebuilt.status === "failed" ||
			rebuilt.model === null ||
			rebuilt.fingerprint === null
		) {
			return failed(rebuilt.errorCode ?? "build_failed");
		}
		const after = rebuilt.model;
		const fingerprint = rebuilt.fingerprint;
		const changed = fingerprint !== candidate.fingerprint;
		const delta = correctionDelta(before, after);
		if (options.dryRun) {
			return {
				candidate,
				status: "dry_run",
				changed,
				delta,
				messages: 0,
				errorCode: null,
			};
		}
		const entries = revisionEntries(
			before,
			after,
			await digestChannels(sql, candidate.channelIds),
			await appBaseUrl(sql),
		);
		const queued = await sql.begin(async (transaction) => {
			await transaction`select pg_advisory_xact_lock(hashtextextended(${digestLockKey(due)}, 0))`;
			const [row] = await transaction<{ queued: number | null }[]>`
				select app.revise_digest(
					${candidate.id}::uuid,
					${JSON.stringify(after)}::text::jsonb,
					${fingerprint}::text,
					${JSON.stringify(entries)}::text::jsonb,
					${options.at}::timestamptz
				)::integer as queued
			`;
			return Number(row?.queued ?? 0);
		});
		return {
			candidate,
			status: !changed ? "unchanged" : queued > 0 ? "corrected" : "replaced",
			changed,
			delta,
			messages: queued,
			errorCode: null,
		};
	} catch (error) {
		return failed(digestErrorCode(error));
	}
}

export async function reviseDueDigests(
	sql: Sql,
	options: ReviseOptions & {
		readonly tenantId: string | null;
		readonly repositoryOptions: NotifyRepositoryOptions;
	},
): Promise<RevisionOutcome[]> {
	const candidates = await digestsToRevise(
		sql,
		options.at,
		options.tenantId,
		options.repositoryOptions,
	);
	const outcomes: RevisionOutcome[] = [];
	for (const candidate of candidates) {
		outcomes.push(await reviseDigest(sql, candidate, options));
	}
	return outcomes;
}
