import {
	isLoopbackBaseUrl,
	type NotifyEnvironment,
} from "../channels/secrets.js";
import {
	type FetchLike,
	REQUEST_TIMEOUT_MS,
	USER_AGENT,
} from "../channels/types.js";
import {
	type CustomerSendContext,
	type CustomerSendOutcome,
	sendConsultation,
	sendZbsTemplate,
	ZALO_OA_BASE_URL,
	ZBS_BASE_URL,
	type ZbsRecipient,
} from "../channels/zalo-zbs.js";
import type { CycleBudget } from "../dispatch/budget.js";
import type { CycleReport } from "../dispatch/report.js";
import { realSleep, type Sleep } from "../dispatch/spacing.js";
import {
	type CustomerMessageKind,
	consultationText,
	type ResolvedParameters,
	TemplateParameterError,
	templateData,
	type ZbsTemplatePurpose,
} from "./templates.js";

export const CUSTOMER_MESSAGES_VARIABLE = "NOTIFY_CUSTOMER_MESSAGES";
export const CUSTOMER_LIVE_VARIABLE = "NOTIFY_CUSTOMER_LIVE";
export const ZBS_BASE_URL_VARIABLE = "NOTIFY_ZBS_BASE_URL";
export const ZALO_OA_BASE_URL_VARIABLE = "NOTIFY_ZALO_OA_BASE_URL";
export const CUSTOMER_LEASE_SECONDS = 120;
export const TOKEN_MISSING_RETRY_SECONDS = 900;
const FINISH_RETRY_DELAYS_MS = [200, 1000, 3000] as const;

export type CustomerRoute = "consultation" | "template";

export interface CustomerClaim {
	readonly messageId: string;
	readonly claimedAt: string;
	readonly tenantId: string;
	readonly kind: CustomerMessageKind;
	readonly route: CustomerRoute;
	readonly attempts: number;
	readonly oaId: string;
	readonly window: "free" | "allowance" | null;
	readonly templateExternalId: string | null;
	readonly templatePurpose: ZbsTemplatePurpose | null;
	readonly recipient: ZbsRecipient;
	readonly parameters: ResolvedParameters;
	readonly readerTimezone: string;
}

export interface CustomerClaimRequest {
	readonly worker: string;
	readonly routes: readonly CustomerRoute[];
	readonly leaseSeconds: number;
	readonly at: Date;
	readonly tenantId: string | null;
}

export type CustomerFinishOutcome =
	| "sent"
	| "retry"
	| "reroute"
	| "failed"
	| "uncertain";

export interface CustomerFinishRequest {
	readonly messageId: string;
	readonly claimedAt: string;
	readonly outcome: CustomerFinishOutcome;
	readonly code: string | null;
	readonly providerMessageId: string | null;
	readonly retryAfterSeconds: number | null;
	readonly at: Date;
}

export interface CustomerRepository {
	enqueueReminders(
		at: Date,
		tenantId: string | null,
	): Promise<Readonly<Record<string, number>>>;
	claimNext(request: CustomerClaimRequest): Promise<CustomerClaim | null>;
	beginSend(messageId: string, claimedAt: string, at: Date): Promise<boolean>;
	finishSend(request: CustomerFinishRequest): Promise<string>;
	accessToken(oaId: string, at: Date): Promise<string | null>;
}

export interface CustomerBaseUrls {
	readonly consultation: string | null;
	readonly template: string | null;
}

export function customerMessagesEnabled(
	environment: NotifyEnvironment,
): boolean {
	return environment[CUSTOMER_MESSAGES_VARIABLE]?.trim() === "on";
}

function baseUrl(
	environment: NotifyEnvironment,
	variable: string,
	live: string,
): string | null {
	const override = environment[variable]?.trim();
	if (
		override !== undefined &&
		override !== "" &&
		isLoopbackBaseUrl(override)
	) {
		return override;
	}
	return environment[CUSTOMER_LIVE_VARIABLE]?.trim() === "1" ? live : null;
}

export function customerBaseUrls(
	environment: NotifyEnvironment,
): CustomerBaseUrls {
	return {
		consultation: baseUrl(
			environment,
			ZALO_OA_BASE_URL_VARIABLE,
			ZALO_OA_BASE_URL,
		),
		template: baseUrl(environment, ZBS_BASE_URL_VARIABLE, ZBS_BASE_URL),
	};
}

export function customerRoutes(
	environment: NotifyEnvironment,
): CustomerRoute[] {
	const urls = customerBaseUrls(environment);
	return [
		...(urls.consultation === null ? [] : (["consultation"] as const)),
		...(urls.template === null ? [] : (["template"] as const)),
	];
}

export function customerBaseUrlWarnings(
	environment: NotifyEnvironment,
): string[] {
	return [ZBS_BASE_URL_VARIABLE, ZALO_OA_BASE_URL_VARIABLE].flatMap(
		(variable) => {
			const value = environment[variable]?.trim();
			return value !== undefined && value !== "" && !isLoopbackBaseUrl(value)
				? [
						`${variable} ignored: only a loopback test server (http://127.0.0.1:<port>) may replace a Zalo host`,
					]
				: [];
		},
	);
}

export interface CustomerStepInput {
	readonly repository: CustomerRepository;
	readonly environment: NotifyEnvironment;
	readonly fetch: FetchLike;
	readonly clock: () => Date;
	readonly worker: string;
	readonly tenantId: string | null;
	readonly budget: CycleBudget;
	readonly log: (line: string) => void;
	readonly requestTimeoutMs?: number;
	readonly sleep?: Sleep;
}

export type RenderedCustomerMessage =
	| {
			readonly route: "consultation";
			readonly userId: string;
			readonly text: string;
	  }
	| {
			readonly route: "template";
			readonly templateId: string;
			readonly recipient: ZbsRecipient;
			readonly data: Record<string, string>;
	  };

export function renderCustomerMessage(
	claim: CustomerClaim,
): RenderedCustomerMessage {
	if (claim.route === "consultation") {
		if (claim.recipient.kind !== "uid") {
			throw new TemplateParameterError("oa_user_id");
		}
		return {
			route: "consultation",
			userId: claim.recipient.userId,
			text: consultationText(claim.kind, claim.parameters),
		};
	}
	if (claim.templateExternalId === null || claim.templatePurpose === null) {
		throw new TemplateParameterError("template_id");
	}
	return {
		route: "template",
		templateId: claim.templateExternalId,
		recipient: claim.recipient,
		data: templateData(claim.templatePurpose, claim.parameters),
	};
}

function finishRequest(
	claim: CustomerClaim,
	outcome: CustomerSendOutcome,
	at: Date,
): CustomerFinishRequest {
	const base = {
		messageId: claim.messageId,
		claimedAt: claim.claimedAt,
		at,
		providerMessageId: null,
		retryAfterSeconds: null,
	};
	switch (outcome.kind) {
		case "sent":
			return {
				...base,
				outcome: "sent",
				code: null,
				providerMessageId: outcome.providerMessageId,
			};
		case "retry":
			return {
				...base,
				outcome: "retry",
				code: outcome.code,
				retryAfterSeconds: outcome.retryAfterSeconds,
			};
		case "reroute":
			return { ...base, outcome: "reroute", code: outcome.code };
		case "failed":
			return { ...base, outcome: "failed", code: outcome.code };
		case "uncertain":
			return { ...base, outcome: "uncertain", code: outcome.code };
	}
}

const OUTCOME_COUNTS = {
	sent: "customer_sent",
	retry: "customer_retried",
	reroute: "customer_rerouted",
	failed: "customer_failed",
	uncertain: "customer_uncertain",
} as const;

async function finish(
	input: CustomerStepInput,
	claim: CustomerClaim,
	outcome: CustomerSendOutcome,
	report: CycleReport,
): Promise<void> {
	const sleep = input.sleep ?? realSleep;
	const request = finishRequest(claim, outcome, input.clock());
	for (
		let attempt = 0;
		attempt <= FINISH_RETRY_DELAYS_MS.length;
		attempt += 1
	) {
		try {
			await input.repository.finishSend(request);
			report.add(OUTCOME_COUNTS[outcome.kind]);
			return;
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
		"customer messages: recording a send outcome failed four times; the lease recovery takes over",
	);
}

async function sendClaimed(
	input: CustomerStepInput,
	claim: CustomerClaim,
	urls: CustomerBaseUrls,
	report: CycleReport,
): Promise<void> {
	const accessToken = await input.repository.accessToken(
		claim.oaId,
		input.clock(),
	);
	if (accessToken === null) {
		await finish(
			input,
			claim,
			{
				kind: "retry",
				code: "token_missing",
				retryAfterSeconds: TOKEN_MISSING_RETRY_SECONDS,
			},
			report,
		);
		return;
	}
	let rendered: RenderedCustomerMessage;
	try {
		rendered = renderCustomerMessage(claim);
	} catch (error) {
		report.add("render_failed");
		await finish(
			input,
			claim,
			{
				kind: "failed",
				code:
					error instanceof TemplateParameterError
						? "missing_parameter"
						: "render_failed",
				scope: "message",
			},
			report,
		);
		return;
	}
	const base =
		rendered.route === "consultation" ? urls.consultation : urls.template;
	if (base === null) {
		await finish(
			input,
			claim,
			{ kind: "retry", code: "route_unavailable", retryAfterSeconds: null },
			report,
		);
		return;
	}
	const begun = await input.repository.beginSend(
		claim.messageId,
		claim.claimedAt,
		input.clock(),
	);
	if (!begun) {
		report.add("lost_lease");
		return;
	}
	const context: CustomerSendContext = {
		accessToken,
		fetch: input.fetch,
		baseUrl: base,
		timeoutMs: input.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
		userAgent: USER_AGENT,
		now: input.clock,
	};
	let outcome: CustomerSendOutcome;
	try {
		outcome =
			rendered.route === "consultation"
				? await sendConsultation(
						{ userId: rendered.userId, text: rendered.text },
						context,
					)
				: await sendZbsTemplate(
						{
							trackingId: claim.messageId,
							templateId: rendered.templateId,
							recipient: rendered.recipient,
							data: rendered.data,
						},
						context,
					);
	} catch {
		outcome = { kind: "uncertain", code: "adapter_error" };
	}
	await finish(input, claim, outcome, report);
}

export async function runCustomerStep(
	input: CustomerStepInput,
	report: CycleReport,
): Promise<void> {
	for (const warning of customerBaseUrlWarnings(input.environment)) {
		input.log(warning);
	}
	try {
		const queued = await input.repository.enqueueReminders(
			input.clock(),
			input.tenantId,
		);
		report.add(
			"customer_reminders",
			Object.values(queued).reduce(
				(sum, value) => sum + (Number.isFinite(value) ? value : 0),
				0,
			),
		);
	} catch (error) {
		input.log(
			`customer messages: the reminder scan failed (${error instanceof Error ? error.name : "error"}); waiting messages are still dispatched`,
		);
	}
	const urls = customerBaseUrls(input.environment);
	const routes = customerRoutes(input.environment);
	while (input.budget.allows("send")) {
		const claim = await input.repository.claimNext({
			worker: input.worker,
			routes,
			leaseSeconds: CUSTOMER_LEASE_SECONDS,
			at: input.clock(),
			tenantId: input.tenantId,
		});
		if (claim === null) {
			return;
		}
		input.budget.spend("send");
		report.add("customer_claimed");
		await sendClaimed(input, claim, urls, report);
	}
}
