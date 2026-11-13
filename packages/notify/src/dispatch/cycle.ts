import {
	type AdapterRegistry,
	claimableSecretNames,
	pollingAdapterFor,
} from "../channels/registry.js";
import {
	baseUrlOverrideWarnings,
	type NotifyEnvironment,
	presentSecretNames,
	providerBaseUrl,
	resolveSecret,
} from "../channels/secrets.js";
import {
	type ChannelAdapter,
	type Destination,
	type FetchLike,
	REQUEST_TIMEOUT_MS,
	type RenderedMessage,
	type SendOutcome,
	USER_AGENT,
} from "../channels/types.js";
import { emailHtml } from "../render/html.js";
import { renderQueuedMessage } from "../render/queued.js";
import { fitSubject, fitToUnits } from "../render/truncate.js";
import type { CycleBudget } from "./budget.js";
import { pollBot } from "./links.js";
import { type CycleReport, emptyCycleReport } from "./report.js";
import type {
	ClaimedMessage,
	DigestBuilder,
	FinishRequest,
	NotifyRepository,
} from "./repository.js";
import { ChatSpacing, realSleep, type Sleep } from "./spacing.js";

export const CLAIM_LEASE_SECONDS = 120;
export const MAX_POLL_WAIT_SECONDS = 5;
const FINISH_RETRY_DELAYS_MS = [200, 1000, 3000] as const;

export interface NotifyCycleInput {
	readonly repository: NotifyRepository;
	readonly adapters: AdapterRegistry;
	readonly environment: NotifyEnvironment;
	readonly runtime: "edge" | "cli";
	readonly worker: string;
	readonly tenantId: string | null;
	readonly clock: () => Date;
	readonly fetch: FetchLike;
	readonly log: (line: string) => void;
	readonly budget: CycleBudget;
	readonly runSqlTick: boolean;
	readonly dryRun: boolean;
	readonly sleep?: Sleep;
	readonly requestTimeoutMs?: number;
	readonly digests?: DigestBuilder;
}

export async function runNotifyCycle(
	input: NotifyCycleInput,
): Promise<CycleReport> {
	const report = emptyCycleReport();
	if (input.dryRun) {
		return report;
	}
	for (const warning of baseUrlOverrideWarnings(input.environment)) {
		input.log(warning);
	}
	if (input.runSqlTick) {
		report.tick = await input.repository.tick(
			input.clock(),
			false,
			input.tenantId,
		);
	}
	await buildDueDigests(input, report);
	await pollPendingLinks(input, report);
	await dispatchDue(input, report);
	report.stoppedBy = input.budget.exhausted();
	await input.repository.recordDispatch(
		input.clock(),
		input.runtime,
		presentSecretNames(input.environment),
		report.counts(),
	);
	return report;
}

export async function buildDueDigests(
	input: NotifyCycleInput,
	report: CycleReport,
): Promise<void> {
	if (input.digests === undefined || !input.budget.allows("digest")) {
		return;
	}
	try {
		const counts = await input.digests.buildDue(
			input.clock(),
			input.tenantId,
			input.budget,
		);
		report.add("digests_built", counts.built);
		report.add("digests_failed", counts.failed);
		report.add("digest_messages", counts.messages);
	} catch (error) {
		report.add("digests_failed");
		input.log(
			`digests: the due-digest scan failed (${error instanceof Error ? error.name : "error"}); messages are still dispatched`,
		);
	}
}

export async function pollPendingLinks(
	input: NotifyCycleInput,
	report: CycleReport,
): Promise<void> {
	if (!input.budget.allows("poll")) {
		return;
	}
	const bots = await input.repository.pendingLinkBots(
		input.clock(),
		input.tenantId,
	);
	for (const bot of bots) {
		if (!input.budget.allows("poll")) {
			report.add("poll_skipped");
			continue;
		}
		const adapter = pollingAdapterFor(bot.kind, input.adapters);
		const secret = resolveSecret(bot.kind, bot.secretName, input.environment);
		if (adapter === null || secret === null) {
			report.add("poll_skipped");
			continue;
		}
		const started = performance.now();
		const round = await pollBot({
			repository: input.repository,
			adapter,
			kind: bot.kind,
			secretName: bot.secretName,
			secret,
			baseUrl: providerBaseUrl(adapter.provider, input.environment),
			worker: input.worker,
			clock: input.clock,
			fetch: input.fetch,
			waitSeconds: Math.min(
				MAX_POLL_WAIT_SECONDS,
				Math.floor(input.budget.remainingPollSeconds()),
			),
			release: true,
		});
		input.budget.spend("poll", performance.now() - started);
		if (round.outcome === "lease_held") {
			report.add("poll_skipped");
		} else if (round.outcome === "error") {
			report.add("poll_errors");
			input.log(`link polling: bot round ended with ${round.code ?? "error"}`);
		} else {
			report.add("poll_rounds");
		}
		report.add("links_matched", round.matched);
		report.add("links_accepted", round.accepted);
		report.add("updates_discarded", round.discarded);
	}
}

function stringConfig(
	config: Readonly<Record<string, unknown>>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(config).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

export const EMAIL_SENDER_VARIABLES = {
	from_email: "NOTIFY_EMAIL_FROM",
	from_name: "NOTIFY_EMAIL_FROM_NAME",
} as const;

export function destinationConfig(
	claim: Pick<ClaimedMessage, "channelKind" | "config">,
	environment: NotifyEnvironment,
): Record<string, string> {
	const config = stringConfig(claim.config);
	if (claim.channelKind !== "email") {
		return config;
	}
	const defaults: Record<string, string> = {};
	for (const [key, variable] of Object.entries(EMAIL_SENDER_VARIABLES)) {
		const value = environment[variable]?.trim();
		if (value) {
			defaults[key] = value;
		}
	}
	return { ...defaults, ...config };
}

export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function renderedText(
	claim: ClaimedMessage,
	adapter: ChannelAdapter,
): { title: string | null; body: string } {
	if (claim.body !== null) {
		return {
			title:
				claim.title === null
					? null
					: fitSubject(claim.title, adapter.limits.maxSubjectChars),
			body: fitToUnits(claim.body, adapter.limits.maxTextUnits),
		};
	}
	const rendered = renderQueuedMessage({
		kind: claim.kind,
		channelKind: claim.channelKind,
		provider: claim.provider,
		channelLabel: claim.channelLabel,
		readerTimezone: claim.readerTimezone,
		tenantName: claim.tenantName,
		at: new Date(claim.claimedAt),
		ruleKey: claim.ruleKey,
		templateRef: claim.templateRef,
		params: claim.params,
		storeName: claim.storeName,
		accountName: claim.accountName,
	});
	return {
		title:
			rendered.title === null
				? null
				: fitSubject(rendered.title, adapter.limits.maxSubjectChars),
		body: fitToUnits(rendered.text, adapter.limits.maxTextUnits),
	};
}

function finishRequest(
	claim: ClaimedMessage,
	outcome: SendOutcome,
	idempotent: boolean,
	at: Date,
): FinishRequest {
	const base = {
		messageId: claim.messageId,
		claimedAt: claim.claimedAt,
		idempotent,
		at,
	};
	switch (outcome.kind) {
		case "sent":
			return {
				...base,
				outcome: "sent",
				scope: null,
				code: null,
				providerMessageId: outcome.providerMessageId,
				retryAfterSeconds: null,
			};
		case "retry":
			return {
				...base,
				outcome: "retry",
				scope: null,
				code: outcome.code,
				providerMessageId: null,
				retryAfterSeconds: outcome.retryAfterSeconds,
			};
		case "failed":
			return {
				...base,
				outcome: "failed",
				scope: outcome.scope,
				code: outcome.code,
				providerMessageId: null,
				retryAfterSeconds: null,
			};
		case "uncertain":
			return {
				...base,
				outcome: "uncertain",
				scope: null,
				code: outcome.code,
				providerMessageId: null,
				retryAfterSeconds: null,
			};
	}
}

async function finishWithRetries(
	input: NotifyCycleInput,
	request: FinishRequest,
	report: CycleReport,
): Promise<boolean> {
	const sleep = input.sleep ?? realSleep;
	for (
		let attempt = 0;
		attempt <= FINISH_RETRY_DELAYS_MS.length;
		attempt += 1
	) {
		try {
			await input.repository.finishSend(request);
			return true;
		} catch {
			const delay = FINISH_RETRY_DELAYS_MS[attempt];
			if (delay === undefined) {
				break;
			}
			await sleep(delay);
		}
	}
	report.add("finish_errors");
	input.log(
		"dispatch: recording a send outcome failed four times; the lease recovery takes over",
	);
	return false;
}

function countOutcome(report: CycleReport, outcome: SendOutcome): void {
	if (outcome.kind === "sent") {
		report.add("sent");
	} else if (outcome.kind === "retry") {
		report.add("retried");
	} else if (outcome.kind === "failed") {
		report.add("failed");
	} else {
		report.add("uncertain");
	}
}

async function sendClaimed(
	input: NotifyCycleInput,
	claim: ClaimedMessage,
	spacing: ChatSpacing,
	report: CycleReport,
): Promise<void> {
	const adapter = input.adapters[claim.provider];
	const idempotent = adapter.available && adapter.limits.idempotent;
	const finish = (outcome: SendOutcome) =>
		finishWithRetries(
			input,
			finishRequest(claim, outcome, idempotent, input.clock()),
			report,
		).then(() => countOutcome(report, outcome));
	const secret = resolveSecret(
		claim.channelKind,
		claim.secretName,
		input.environment,
	);
	if (!adapter.available || secret === null || claim.address === null) {
		await finish({
			kind: "failed",
			code: !adapter.available
				? "provider_unavailable"
				: secret === null
					? "secret_missing"
					: "address_missing",
			scope: adapter.available && secret === null ? "channel" : "message",
		});
		return;
	}
	let text: { title: string | null; body: string };
	try {
		text = renderedText(claim, adapter);
	} catch {
		report.add("render_failed");
		await finish({ kind: "failed", code: "render_failed", scope: "message" });
		return;
	}
	const begun = await input.repository.beginSend(
		claim.messageId,
		claim.claimedAt,
		text.title,
		text.body,
		await sha256Hex(text.body),
		input.clock(),
	);
	if (!begun.ok || begun.body === null) {
		report.add("lost_lease");
		return;
	}
	const message: RenderedMessage = {
		messageId: claim.messageId,
		kind: claim.kind,
		subject:
			begun.title === null
				? null
				: fitSubject(begun.title, adapter.limits.maxSubjectChars),
		text: fitToUnits(begun.body, adapter.limits.maxTextUnits),
		html: adapter.limits.supportsHtml
			? emailHtml(
					claim.kind,
					fitToUnits(begun.body, adapter.limits.maxTextUnits),
				)
			: null,
		webhookBody: null,
	};
	const destination: Destination = {
		channelId: claim.channelId,
		kind: claim.channelKind,
		provider: claim.provider,
		address: claim.address,
		config: destinationConfig(claim, input.environment),
	};
	await spacing.waitFor(claim.channelId, adapter.limits.minSpacingMs);
	let outcome: SendOutcome;
	try {
		outcome = await adapter.send(message, destination, {
			secret,
			fetch: input.fetch,
			baseUrl: providerBaseUrl(claim.provider, input.environment),
			timeoutMs: input.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
			userAgent: USER_AGENT,
			now: input.clock,
		});
	} catch {
		outcome = idempotent
			? { kind: "retry", code: "adapter_error", retryAfterSeconds: null }
			: { kind: "uncertain", code: "adapter_error" };
	}
	spacing.record(claim.channelId);
	await finish(outcome);
}

export async function dispatchDue(
	input: NotifyCycleInput,
	report: CycleReport,
): Promise<void> {
	const secretNames = claimableSecretNames(
		presentSecretNames(input.environment),
		input.adapters,
	);
	if (secretNames.length === 0) {
		return;
	}
	const spacing = new ChatSpacing(input.sleep ?? realSleep);
	while (input.budget.allows("send")) {
		const claim = await input.repository.claimNext({
			worker: input.worker,
			secretNames,
			leaseSeconds: CLAIM_LEASE_SECONDS,
			at: input.clock(),
			tenantId: input.tenantId,
		});
		if (claim === null) {
			return;
		}
		input.budget.spend("send");
		report.add("claimed");
		await sendClaimed(input, claim, spacing, report);
	}
}
