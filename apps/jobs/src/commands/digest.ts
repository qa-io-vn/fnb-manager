import { randomUUID } from "node:crypto";
import {
	compareDigestWithNgay,
	type DueDigest,
	parseDigestModel,
	renderDigest,
	TEMPLATE_REFS,
} from "@fnb/notify";
import {
	activeStoreIds,
	appBaseUrl,
	asMember,
	buildDueDigestsNow,
	buildScopeDigest,
	type DigestOutcome,
	digestChannels,
	enqueueMessage,
	existingDigest,
	manualStoreFacts,
	perCallMemberClient,
	renderForChannels,
	scopeKeyOf,
	tenantDigestScopes,
	unlimitedOwner,
} from "@fnb/notify/postgres";
import { createRpcAnalyticsSource, dayReport, runReport } from "@fnb/reports";
import type { Sql } from "postgres";
import { requireTenant, type TenantRecord } from "../admin/tenants.js";
import { isCi } from "../config/config.js";
import {
	type CommandContext,
	flag,
	type OptionValues,
	stringOption,
	UsageError,
} from "../context.js";
import { isoDateOption } from "./dates.js";
import {
	instantOption,
	requireFixtureTenantForTestSends,
	scanNeedsTenant,
} from "./notify.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";

const DEFAULT_GRACE_MINUTES = 30;
const DIGEST_LIFETIME_MS = 36 * 3_600_000;
const POS_TOLERANCE_ABSOLUTE = 1_000;
const POS_TOLERANCE_RELATIVE = 0.0005;
const METRIC_TOLERANCE = 0.005;

function storeCountText(count: number): string {
	return `${count} store${count === 1 ? "" : "s"}`;
}

export function outcomeLine(outcome: DigestOutcome, index: number): string {
	const scope = `scope ${index + 1} (${storeCountText(outcome.due.storeIds.length)})`;
	const date = outcome.due.businessDate;
	if (outcome.status === "failed") {
		const failed = `digest: ${scope} ${date} failed (${outcome.errorCode ?? "build_failed"})`;
		return outcome.failureRecorded
			? `${failed}; recorded, retried on the back-off`
			: failed;
	}
	const model = outcome.model;
	const findings = model?.findings.length ?? 0;
	const state = model?.dataState ?? "unknown";
	if (outcome.status === "dry_run") {
		return `digest: ${scope} ${date}: ${state}, ${findings} finding(s), ${outcome.units ?? 0} units`;
	}
	if (outcome.status === "already_built") {
		return `digest: ${scope} ${date} already built, nothing queued`;
	}
	return `digest: ${scope} ${date} built, ${state}, ${findings} finding(s), ${outcome.messages} message(s) queued`;
}

export function digestExitCode(
	outcomes: readonly DigestOutcome[],
	scheduled: boolean,
): number {
	const failed = outcomes.filter((outcome) => outcome.status === "failed");
	const unrecorded = scheduled
		? failed.filter((outcome) => !outcome.failureRecorded)
		: failed;
	return unrecorded.length > 0 ? 1 : 0;
}

function printOutcomes(
	context: CommandContext,
	outcomes: readonly DigestOutcome[],
	showText: boolean,
	scheduled: boolean,
): number {
	if (outcomes.length === 0) {
		context.output.line("digest: nothing due");
		return 0;
	}
	for (const [index, outcome] of outcomes.entries()) {
		const line = outcomeLine(outcome, index);
		context.output.line(line);
		context.output.summary(`- ${line}`);
		if (showText) {
			for (const rendered of outcome.rendered.filter(
				(entry) => entry.channel !== "email",
			)) {
				context.output.line("");
				context.output.line(rendered.text);
			}
			if (outcome.rendered.length === 0 && outcome.model !== null) {
				context.output.line("");
				context.output.line(
					renderDigest(outcome.model, {
						channel: "zalo_bot",
						appBaseUrl: null,
						timeZone: "Asia/Ho_Chi_Minh",
						currencyCode: "VND",
					}).text,
				);
			}
		}
	}
	return digestExitCode(outcomes, scheduled);
}

async function manualDue(
	sql: Sql,
	tenant: TenantRecord,
	scope: {
		readonly storeIds: readonly string[];
		readonly allStores: boolean;
		readonly runAs: string;
		readonly channelIds: readonly string[];
	},
	businessDate: string,
	at: Date,
): Promise<DueDigest> {
	return {
		tenantId: tenant.id,
		businessDate,
		scopeKey: await scopeKeyOf(sql, scope.storeIds),
		storeIds: [...scope.storeIds].sort(),
		allStores: scope.allStores,
		trigger: "manual",
		runAs: scope.runAs,
		channelIds: [...scope.channelIds],
		storeFacts: await manualStoreFacts(
			sql,
			scope.storeIds,
			businessDate,
			at,
			DEFAULT_GRACE_MINUTES,
		),
	};
}

async function resendDigest(
	context: CommandContext,
	sql: Sql,
	due: DueDigest,
	at: Date,
): Promise<number> {
	const stored = await existingDigest(
		sql,
		due.tenantId,
		due.businessDate,
		due.scopeKey,
	);
	const model = stored === null ? null : parseDigestModel(stored.model);
	if (stored === null || stored.state !== "built" || model === null) {
		return 0;
	}
	const rendered = renderForChannels(
		model,
		await digestChannels(sql, due.channelIds),
		await appBaseUrl(sql),
	);
	for (const entry of rendered) {
		await enqueueMessage(sql, {
			tenantId: due.tenantId,
			channelId: entry.channelId,
			kind: "digest",
			templateRef: TEMPLATE_REFS.digest,
			dedupeKey: `digest:${stored.id}:${entry.channelId}:r${stored.revision}:resend:${randomUUID()}`,
			title: entry.title,
			body: entry.text,
			severity: "info",
			businessDate: due.businessDate,
			digestId: stored.id,
			expiresAt: new Date(at.getTime() + DIGEST_LIFETIME_MS),
			at,
		});
	}
	context.output.line(
		`digest: ${due.businessDate} resent, ${rendered.length} message(s) queued`,
	);
	return rendered.length;
}

async function buildForDate(
	context: CommandContext,
	sql: Sql,
	tenant: TenantRecord,
	businessDate: string,
	options: { at: Date; dryRun: boolean; resend: boolean; showText: boolean },
): Promise<number> {
	let scopes = await tenantDigestScopes(sql, tenant.id);
	if (scopes.length === 0) {
		if (!options.dryRun) {
			context.output.line(
				"digest: no linked destination takes digests for the tenant; link one with fnb notify link",
			);
			return 0;
		}
		const owner = await unlimitedOwner(sql, tenant.id);
		if (owner === null) {
			context.output.error("digest: the tenant has no owner with every store");
			return 1;
		}
		scopes = [
			{
				storeIds: await activeStoreIds(sql, tenant.id),
				allStores: true,
				runAs: owner.userId,
				channelIds: [],
			},
		];
	}
	const outcomes: DigestOutcome[] = [];
	for (const scope of scopes) {
		const due = await manualDue(sql, tenant, scope, businessDate, options.at);
		const outcome = await buildScopeDigest(sql, due, {
			at: options.at,
			dryRun: options.dryRun,
		});
		outcomes.push(outcome);
		if (outcome.status === "already_built" && options.resend) {
			await resendDigest(context, sql, due, options.at);
		}
	}
	return printOutcomes(context, outcomes, options.showText, false);
}

interface CheckFacts {
	readonly fields: number;
	readonly equal: boolean;
	readonly posInvoices: boolean;
	readonly posNet: boolean;
	readonly metricValue: boolean;
	readonly fitsZalo: boolean;
}

async function posTotals(
	sql: Sql,
	storeIds: readonly string[],
	businessDate: string,
): Promise<{ invoices: number; net: number }> {
	const [row] = await sql<{ invoices: string | null; net: string | null }[]>`
		select sum(source_invoice_count)::text as invoices, sum(source_net_amount)::text as net
		from public.sync_checks
		where store_id in (select jsonb_array_elements_text(${JSON.stringify([...storeIds])}::text::jsonb)::uuid)
			and business_date = ${businessDate}::date
	`;
	return {
		invoices: Number(row?.invoices ?? 0),
		net: Number(row?.net ?? 0),
	};
}

async function metricNet(
	sql: Sql,
	userId: string,
	storeIds: readonly string[],
	businessDate: string,
): Promise<number | null> {
	const [row] = await asMember(sql, userId, (transaction) =>
		transaction.unsafe(
			"select public.metric_value($1::uuid[], $2, $3::date, $4::date)::text as value",
			[`{${storeIds.join(",")}}`, "net_revenue", businessDate, businessDate],
		),
	);
	const value = row?.value;
	return value === null || value === undefined ? null : Number(value);
}

async function checkScope(
	sql: Sql,
	due: DueDigest,
	at: Date,
): Promise<CheckFacts> {
	const outcome = await buildScopeDigest(sql, due, {
		at,
		dryRun: true,
		keepBuild: true,
	});
	const build = outcome.build;
	if (outcome.status === "failed" || build === null || outcome.model === null) {
		return {
			fields: 0,
			equal: false,
			posInvoices: false,
			posNet: false,
			metricValue: false,
			fitsZalo: false,
		};
	}
	const ngay = await runReport(
		dayReport,
		build.context,
		createRpcAnalyticsSource(perCallMemberClient(sql, due.runAs), "postgres"),
	);
	const compared = compareDigestWithNgay(outcome.model, ngay);
	const pos = await posTotals(sql, due.storeIds, due.businessDate);
	const net = outcome.model.totals.net;
	const metric = await metricNet(
		sql,
		due.runAs,
		due.storeIds,
		due.businessDate,
	);
	return {
		fields: compared.fields,
		equal: compared.equal,
		posInvoices: outcome.model.totals.invoices === pos.invoices,
		posNet:
			net !== null &&
			Math.abs(net - pos.net) <=
				Math.max(
					POS_TOLERANCE_ABSOLUTE,
					Math.abs(pos.net) * POS_TOLERANCE_RELATIVE,
				),
		metricValue:
			net !== null &&
			metric !== null &&
			Math.abs(net - metric) <= METRIC_TOLERANCE,
		fitsZalo: (outcome.units ?? Number.POSITIVE_INFINITY) <= 1900,
	};
}

async function checkNgay(
	context: CommandContext,
	sql: Sql,
	tenant: TenantRecord,
	businessDate: string,
	at: Date,
): Promise<number> {
	const owner = await unlimitedOwner(sql, tenant.id);
	if (owner === null) {
		context.output.error("check: the tenant has no owner with every store");
		return 1;
	}
	const stores = await activeStoreIds(sql, tenant.id);
	if (stores.length === 0) {
		context.output.error("check: the tenant has no active store");
		return 1;
	}
	const scopes: { label: string; storeIds: string[]; allStores: boolean }[] = [
		{ label: "all", storeIds: stores, allStores: true },
		...(stores.length > 1
			? stores.map((id, index) => ({
					label: `store ${index + 1}`,
					storeIds: [id],
					allStores: false,
				}))
			: []),
	];
	let failures = 0;
	for (const scope of scopes) {
		const due = await manualDue(
			sql,
			tenant,
			{
				storeIds: scope.storeIds,
				allStores: scope.allStores,
				runAs: owner.userId,
				channelIds: [],
			},
			businessDate,
			at,
		);
		const started = performance.now();
		const facts = await checkScope(sql, due, at);
		const passed =
			facts.equal && facts.posInvoices && facts.posNet && facts.metricValue;
		if (!passed) {
			failures += 1;
		}
		context.output.line(
			JSON.stringify({
				check: "digest_equals_ngay",
				day: 1,
				scope: scope.label,
				fields: facts.fields,
				equal: facts.equal,
				pos_invoices: facts.posInvoices,
				pos_net: facts.posNet,
				metric_value: facts.metricValue,
				fits_zalo: facts.fitsZalo,
				ms: Math.round(performance.now() - started),
			}),
		);
	}
	return failures === 0 ? 0 : 1;
}

async function digest(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const slug = stringOption(values, "tenant");
	const dateText = stringOption(values, "date");
	const businessDate =
		dateText === undefined ? undefined : isoDateOption("date", dateText);
	const due = flag(values, "due");
	const checkNgayFlag = flag(values, "check-ngay");
	const dryRun = flag(values, "dry-run") || checkNgayFlag;
	const showText = flag(values, "show-text");
	const resend = flag(values, "resend");
	const at = instantOption(values, "at");
	if (due && businessDate !== undefined) {
		throw new UsageError("use either --due or --date, not both");
	}
	if (flag(values, "revise")) {
		throw new UsageError(
			"--revise (corrections after the nightly reconciliation) arrives with the next build step",
		);
	}
	if (showText && isCi(context.env)) {
		throw new UsageError(
			"--show-text is refused in CI: the rendered digest names stores and amounts",
		);
	}
	if (checkNgayFlag && (businessDate === undefined || slug === undefined)) {
		throw new UsageError("--check-ngay needs --tenant and --date");
	}
	if (resend && (businessDate === undefined || dryRun)) {
		throw new UsageError("--resend needs --date and cannot be a dry run");
	}
	if (slug === undefined && scanNeedsTenant(context, at !== undefined)) {
		throw new UsageError(
			"--tenant is required with --at, a provider base-URL override or NOTIFY_INTEGRATION=1",
		);
	}
	if (businessDate !== undefined && slug === undefined) {
		throw new UsageError("--date needs --tenant");
	}
	if (!dryRun) {
		requireFixtureTenantForTestSends(context, slug, at !== undefined);
	}
	const { sql } = context.services.db();
	const tenant =
		slug === undefined
			? null
			: await requireTenant(sql, slug, context.output.ci);
	const now = at ?? context.now();
	if (checkNgayFlag && tenant !== null && businessDate !== undefined) {
		return checkNgay(context, sql, tenant, businessDate, now);
	}
	if (businessDate !== undefined && tenant !== null) {
		return buildForDate(context, sql, tenant, businessDate, {
			at: now,
			dryRun,
			resend,
			showText,
		});
	}
	const outcomes = await buildDueDigestsNow(sql, {
		at: now,
		tenantId: tenant?.id ?? null,
		dryRun,
		repositoryOptions: {
			environment: context.env,
			simulatedClock: at !== undefined,
		},
	});
	return printOutcomes(context, outcomes, showText, !dryRun);
}

export const digestCommand: CommandSpec = {
	path: ["digest"],
	summary:
		"Build the daily digests that are due (or one date) and queue their messages",
	usage:
		"fnb digest [--tenant <slug>] [--due | --date YYYY-MM-DD] [--dry-run] [--check-ngay] [--show-text] [--resend] [--at <ISO instant>]",
	options: {
		...HELP_OPTION,
		tenant: { type: "string" },
		due: { type: "boolean" },
		date: { type: "string" },
		revise: { type: "boolean" },
		"dry-run": { type: "boolean" },
		"check-ngay": { type: "boolean" },
		"show-text": { type: "boolean" },
		resend: { type: "boolean" },
		at: { type: "string" },
	},
	details: [
		"--due (the default without --date) builds every digest app.due_digests returns: each scope's stores have settled the business day (no open shift, a successful sync at least 30 minutes after the close and the last shift close), or the 06:30 deadline passed. It queues one message per destination and sends nothing; fnb notify tick sends.",
		"A failed build under --due is recorded for a retry on the back-off (digest_failed alerts the owner at the fifth failure) and exits 0; it exits 1 only when a failure could not be recorded. --date exits 1 on any failed build.",
		"The digest is the Ngày report built as the recipient member in one read-only snapshot, so its numbers equal Ngày; the attention lines read the same rows.",
		"--date builds that business date for every digest scope of the tenant unless it is already built; --resend then queues a second copy.",
		"--dry-run builds and renders in memory and writes nothing: 'scope 1 (2 stores): verified, 3 findings, 812 units'.",
		"--check-ngay (needs --tenant and --date) builds, for all stores and for each store as the tenant's owner, the digest in a dry run and a separate Ngày, and prints one JSON line of booleans per scope: equal, pos_invoices, pos_net, metric_value.",
		"--show-text prints the rendered Zalo text (refused in CI). --at simulates the clock and then needs --tenant; it writes only for a fixture tenant (notify-it-…).",
		"Output names no shop, member or amount: scopes are numbered and the counts are findings, messages and text units.",
	],
	run: digest,
};
