import { UpstreamError, ZaloConfigError, type ZaloFetch } from "@fnb/zalo";
import {
	type ConsultationMessage,
	type CustomerInput,
	type OaApiSettings,
	type OaMenuButton,
	oaApiSettings,
	parseMenuButtons,
	sendConsultation,
	textMessage,
	userInfoRequest,
	zaloButtons,
} from "@fnb/zalo/oa";
import type { RequestContext } from "../_shared/http.ts";

export const REPLY_KINDS = ["welcome", "form", "member", "joined"] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];

export type Reply =
	| {
			readonly kind: "welcome" | "member" | "joined";
			readonly text: string;
			readonly buttons: readonly OaMenuButton[];
			readonly miniAppId: string | null;
	  }
	| {
			readonly kind: "form";
			readonly title: string;
			readonly subtitle: string;
			readonly imageUrl: string;
			readonly buttons: readonly OaMenuButton[];
			readonly miniAppId: string | null;
	  };

export interface CustomerStep {
	readonly step: string;
	readonly oaUserRow: string | null;
	readonly recipient: string | null;
	readonly customerId: string | null;
	readonly reply: Reply | null;
}

export type ReplyStatus = "sent" | "failed" | "uncertain" | "cancelled";

export interface ReplyRecord {
	readonly oaUserRow: string;
	readonly customerId: string | null;
	readonly kind: ReplyKind;
	readonly status: ReplyStatus;
	readonly errorCode: string | null;
	readonly providerMessageId: string | null;
	readonly at: Date;
}

export interface CustomerStore {
	customerStep(
		eventRow: string,
		input: CustomerInput,
		at: Date,
	): Promise<CustomerStep>;
	accessToken(oaId: string, at: Date): Promise<string | null>;
	recordReply(record: ReplyRecord): Promise<void>;
}

export interface DeliveryTarget {
	readonly oaId: string;
	readonly tenantId: string;
}

const STEP_PATTERN = /^[a-z][a-z_]{0,39}$/;
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MINI_APP_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function recordOf(value: unknown): Readonly<Record<string, unknown>> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function text(value: unknown): string {
	if (typeof value !== "string" || value === "") {
		throw new Error("app.oa_customer_step answered a reply without its text");
	}
	return value;
}

function matching(value: unknown, pattern: RegExp): string | null {
	return typeof value === "string" && pattern.test(value) ? value : null;
}

export function parseReply(value: unknown): Reply | null {
	const reply = recordOf(value);
	if (reply === null) {
		return null;
	}
	const buttons = parseMenuButtons(reply.buttons);
	const miniAppId = matching(reply.mini_app_id, MINI_APP_ID_PATTERN);
	if (reply.kind === "form") {
		return {
			kind: "form",
			title: text(reply.title),
			subtitle: text(reply.subtitle),
			imageUrl: text(reply.image_url),
			buttons,
			miniAppId,
		};
	}
	if (
		reply.kind === "welcome" ||
		reply.kind === "member" ||
		reply.kind === "joined"
	) {
		return { kind: reply.kind, text: text(reply.text), buttons, miniAppId };
	}
	throw new Error("app.oa_customer_step answered an unknown reply");
}

export function parseCustomerStep(value: unknown): CustomerStep {
	const answer = recordOf(value);
	const step = answer?.step;
	if (answer === null || typeof step !== "string" || !STEP_PATTERN.test(step)) {
		throw new Error("app.oa_customer_step answered no outcome");
	}
	return {
		step,
		oaUserRow: matching(answer.oa_user_row, UUID_PATTERN),
		recipient: matching(answer.recipient, USER_ID_PATTERN),
		customerId: matching(answer.customer_id, UUID_PATTERN),
		reply: parseReply(answer.reply),
	};
}

export function replyMessage(
	recipient: string,
	reply: Reply,
): ConsultationMessage {
	const buttons = zaloButtons(reply.buttons, reply.miniAppId);
	if (reply.kind === "form") {
		return userInfoRequest(recipient, {
			title: reply.title,
			subtitle: reply.subtitle,
			imageUrl: reply.imageUrl,
		});
	}
	return textMessage(recipient, reply.text, buttons);
}

export function zaloErrorCode(error: number): string {
	return `zalo_${error < 0 ? "m" : ""}${Math.abs(error)}`;
}

function upstreamOutcome(error: UpstreamError): {
	readonly status: ReplyStatus;
	readonly errorCode: string;
} {
	switch (error.failure) {
		case "network":
		case "status":
			return { status: "failed", errorCode: `upstream_${error.failure}` };
		case "timeout":
		case "invalid_answer":
			return { status: "uncertain", errorCode: `upstream_${error.failure}` };
	}
}

export interface DeliveryDependencies {
	readonly store: CustomerStore;
	readonly clock: () => Date;
	readonly fetch?: ZaloFetch | undefined;
}

type Gate =
	| { readonly open: true; readonly settings: OaApiSettings }
	| { readonly open: false; readonly errorCode: string };

function gate(context: RequestContext, target: DeliveryTarget): Gate {
	let settings: OaApiSettings;
	try {
		settings = oaApiSettings(context.environment);
	} catch (error) {
		if (error instanceof ZaloConfigError) {
			context.log(`the OA API is not configured: ${error.message}`);
			return { open: false, errorCode: "not_configured" };
		}
		throw error;
	}
	if (!settings.messages) {
		return { open: false, errorCode: "messages_off" };
	}
	if (
		(settings.integration || settings.local) &&
		target.tenantId !== settings.tenantId
	) {
		return { open: false, errorCode: "outside_fixture" };
	}
	return { open: true, settings };
}

export async function deliverReply(
	dependencies: DeliveryDependencies,
	context: RequestContext,
	target: DeliveryTarget,
	step: CustomerStep,
): Promise<string> {
	const { reply, recipient, oaUserRow } = step;
	if (reply === null || recipient === null || oaUserRow === null) {
		return "none";
	}
	const record = async (
		status: ReplyStatus,
		errorCode: string | null,
		providerMessageId: string | null,
	): Promise<string> => {
		await dependencies.store.recordReply({
			oaUserRow,
			customerId: step.customerId,
			kind: reply.kind,
			status,
			errorCode,
			providerMessageId,
			at: dependencies.clock(),
		});
		return errorCode === null ? status : `${status} (${errorCode})`;
	};
	const opened = gate(context, target);
	if (!opened.open) {
		return record("cancelled", opened.errorCode, null);
	}
	const token = await dependencies.store.accessToken(
		target.oaId,
		dependencies.clock(),
	);
	if (token === null) {
		return record("cancelled", "no_token", null);
	}
	context.protect(token);
	const message = replyMessage(recipient, reply);
	try {
		const sent = await sendConsultation(
			{ baseUrl: opened.settings.baseUrl, fetch: dependencies.fetch },
			token,
			message,
		);
		return sent.ok
			? record("sent", null, sent.value.messageId)
			: record("failed", zaloErrorCode(sent.error), null);
	} catch (error) {
		if (error instanceof UpstreamError) {
			const outcome = upstreamOutcome(error);
			return record(outcome.status, outcome.errorCode, null);
		}
		throw error;
	}
}
