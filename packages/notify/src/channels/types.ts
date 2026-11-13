export const CHANNEL_KINDS = [
	"zalo_bot",
	"email",
	"telegram",
	"webhook",
	"zalo_oa",
	"zalo_gmf",
	"zalo_zbs",
	"mini_app",
	"sms",
] as const;

export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export const PROVIDER_IDS = [
	"zalo_bot",
	"telegram",
	"brevo",
	"resend",
	"hmac_webhook",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const MESSAGE_KINDS = [
	"digest",
	"digest_correction",
	"alert",
	"alert_reminder",
	"alert_resolved",
	"test",
	"link_code",
	"link_notice",
	"link_confirmation",
] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface RenderedMessage {
	readonly messageId: string;
	readonly kind: MessageKind;
	readonly subject: string | null;
	readonly text: string;
	readonly html: string | null;
	readonly webhookBody: string | null;
}

export interface Destination {
	readonly channelId: string;
	readonly kind: ChannelKind;
	readonly provider: ProviderId;
	readonly address: string;
	readonly config: Readonly<Record<string, string>>;
}

export type FailureScope = "message" | "destination" | "channel";

export type SendOutcome =
	| { readonly kind: "sent"; readonly providerMessageId: string | null }
	| {
			readonly kind: "retry";
			readonly code: string;
			readonly retryAfterSeconds: number | null;
	  }
	| {
			readonly kind: "failed";
			readonly code: string;
			readonly scope: FailureScope;
	  }
	| { readonly kind: "uncertain"; readonly code: string };

export interface ProviderLimits {
	readonly maxTextUnits: number;
	readonly maxSubjectChars: number | null;
	readonly supportsHtml: boolean;
	readonly idempotent: boolean;
	readonly minSpacingMs: number;
}

export interface SendContext {
	readonly secret: string;
	readonly fetch: FetchLike;
	readonly baseUrl: string;
	readonly timeoutMs: number;
	readonly userAgent: string;
	readonly now: () => Date;
}

export interface InboundText {
	readonly updateId: number | null;
	readonly chatId: string;
	readonly chatType: "private" | "group";
	readonly text: string;
}

export interface CredentialCheck {
	readonly ok: boolean;
	readonly code: string | null;
	readonly botName: string | null;
}

export interface PollResult {
	readonly updates: readonly InboundText[];
	readonly cursor: number | null;
}

export interface ChannelAdapter {
	readonly provider: ProviderId;
	readonly kind: ChannelKind;
	readonly available: boolean;
	readonly limits: ProviderLimits;
	send(
		message: RenderedMessage,
		destination: Destination,
		context: SendContext,
	): Promise<SendOutcome>;
	checkCredentials?(context: SendContext): Promise<CredentialCheck>;
	pollUpdates?(
		context: SendContext,
		cursor: number | null,
		waitSeconds: number,
	): Promise<PollResult>;
}

export class PollError extends Error {
	readonly code: string;

	constructor(code: string) {
		super(`poll failed: ${code}`);
		this.name = "PollError";
		this.code = code;
	}
}

export const USER_AGENT = "fnb-manager-notify/1";

export const REQUEST_TIMEOUT_MS = 10_000;

export function isChannelKind(value: string): value is ChannelKind {
	return (CHANNEL_KINDS as readonly string[]).includes(value);
}

export function isProviderId(value: string): value is ProviderId {
	return (PROVIDER_IDS as readonly string[]).includes(value);
}

export function isMessageKind(value: string): value is MessageKind {
	return (MESSAGE_KINDS as readonly string[]).includes(value);
}
