import {
	addressHint,
	classifyZaloSend,
	type FetchLike,
	failureOutcome,
	findLinkCode,
	type InboundText,
	isAcceptance,
	providerBaseUrl,
	REQUEST_TIMEOUT_MS,
	type SendOutcome,
	sha256Hex,
	timedFetch,
	USER_AGENT,
	zaloUpdatesFrom,
} from "@fnb/notify";
import {
	type FunctionEnvironment,
	type FunctionHandler,
	HttpError,
	json,
	MissingSecretError,
	type RequestContext,
	readJsonObject,
	requireMethod,
} from "../_shared/http.ts";

export const FUNCTION_NAME = "bot-webhook";
export const SECRET_TOKEN_HEADER = "x-bot-api-secret-token";
export const MAX_UPDATE_BYTES = 65_536;
export const MAX_UPDATES_PER_CALL = 20;
export const STOP_TEMPLATE = "stop_confirmation.v1";
export const STOP_CONFIRMATION =
	"Đã dừng: bạn sẽ không nhận bản tin và cảnh báo qua Zalo này nữa. Muốn nhận lại, hãy nhờ chủ cửa hàng tạo mã liên kết mới.";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,256}$/;
const EDGE_PUNCTUATION = /^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu;
const STOP_WORDS: ReadonlySet<string> = new Set(
	["DỪNG", "DUNG"].map((word) => word.normalize("NFC")),
);

export interface BotTarget {
	readonly secretName: string;
	readonly kind: "zalo_bot";
}

export interface BotReply {
	readonly template: string;
	readonly status: "sent" | "failed" | "uncertain";
	readonly errorCode: string | null;
	readonly providerMessageId: string | null;
}

export interface BotWebhookStore {
	target(secretTokenSha256: string): Promise<BotTarget | null>;
	completeLink(
		target: BotTarget,
		code: string,
		chatId: string,
		hint: string,
		at: Date,
	): Promise<string | null>;
	acceptLink(
		target: BotTarget,
		chatId: string,
		at: Date,
	): Promise<string | null>;
	stopChat(
		target: BotTarget,
		chatId: string,
		at: Date,
	): Promise<readonly string[]>;
	recordReply(
		channelIds: readonly string[],
		reply: BotReply,
		at: Date,
	): Promise<number>;
}

export interface BotWebhookDependencies {
	store(
		environment: FunctionEnvironment,
		context: RequestContext,
	): BotWebhookStore;
	clock(): Date;
	waitUntil(promise: Promise<unknown>): void;
	readonly fetch: FetchLike;
}

type UpdateOutcome = "linked" | "accepted" | "stopped" | "dropped";

export function isStop(text: string): boolean {
	const word = text
		.normalize("NFC")
		.replace(EDGE_PUNCTUATION, "")
		.replace(/\s+/g, " ")
		.toUpperCase();
	return STOP_WORDS.has(word);
}

export function inboundUpdates(
	body: Readonly<Record<string, unknown>>,
): InboundText[] {
	const result = body.result;
	return zaloUpdatesFrom(
		result !== null && typeof result === "object" ? result : body,
	);
}

function replyOf(outcome: SendOutcome): BotReply {
	switch (outcome.kind) {
		case "sent":
			return {
				template: STOP_TEMPLATE,
				status: "sent",
				errorCode: null,
				providerMessageId: outcome.providerMessageId,
			};
		case "uncertain":
			return {
				template: STOP_TEMPLATE,
				status: "uncertain",
				errorCode: outcome.code,
				providerMessageId: null,
			};
		default:
			return {
				template: STOP_TEMPLATE,
				status: "failed",
				errorCode: outcome.code,
				providerMessageId: null,
			};
	}
}

async function confirmStop(
	dependencies: BotWebhookDependencies,
	context: RequestContext,
	target: BotTarget,
	chatId: string,
): Promise<BotReply> {
	let token: string;
	try {
		token = context.secret(target.secretName);
	} catch (error) {
		if (error instanceof MissingSecretError) {
			context.log(
				`the function secret ${error.secretName} is not set; the stop is recorded without a confirmation`,
			);
			return {
				template: STOP_TEMPLATE,
				status: "failed",
				errorCode: "not_configured",
				providerMessageId: null,
			};
		}
		throw error;
	}
	const response = await timedFetch(
		dependencies.fetch,
		`${providerBaseUrl("zalo_bot", context.environment)}/bot${token}/sendMessage`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json; charset=utf-8",
				accept: "application/json",
				"user-agent": USER_AGENT,
			},
			body: JSON.stringify({ chat_id: chatId, text: STOP_CONFIRMATION }),
		},
		REQUEST_TIMEOUT_MS,
	);
	return replyOf(
		response.kind === "failure"
			? failureOutcome(response.code, false)
			: classifyZaloSend(response, dependencies.clock),
	);
}

async function handleUpdate(
	dependencies: BotWebhookDependencies,
	context: RequestContext,
	store: BotWebhookStore,
	target: BotTarget,
	update: InboundText,
): Promise<UpdateOutcome> {
	const at = dependencies.clock();
	const code = findLinkCode(update.text);
	if (code !== null) {
		const linked = await store.completeLink(
			target,
			code,
			update.chatId,
			addressHint(update.chatId),
			at,
		);
		return linked === null ? "dropped" : "linked";
	}
	if (isAcceptance(update.text)) {
		const accepted = await store.acceptLink(target, update.chatId, at);
		return accepted === null ? "dropped" : "accepted";
	}
	if (isStop(update.text)) {
		const channels = await store.stopChat(target, update.chatId, at);
		if (channels.length === 0) {
			return "dropped";
		}
		const reply = await confirmStop(
			dependencies,
			context,
			target,
			update.chatId,
		);
		await store.recordReply(channels, reply, dependencies.clock());
		context.log(
			`stop confirmation: ${reply.status}${reply.errorCode ? ` (${reply.errorCode})` : ""}`,
		);
		return "stopped";
	}
	return "dropped";
}

async function handleUpdates(
	dependencies: BotWebhookDependencies,
	context: RequestContext,
	store: BotWebhookStore,
	target: BotTarget,
	updates: readonly InboundText[],
): Promise<void> {
	const counts: Record<UpdateOutcome, number> = {
		linked: 0,
		accepted: 0,
		stopped: 0,
		dropped: 0,
	};
	for (const update of updates) {
		counts[await handleUpdate(dependencies, context, store, target, update)] +=
			1;
	}
	context.log(
		`updates ${updates.length}: linked ${counts.linked}, accepted ${counts.accepted}, stopped ${counts.stopped}, dropped ${counts.dropped}`,
	);
}

export function createBotWebhookHandler(
	dependencies: BotWebhookDependencies,
): FunctionHandler {
	return async (request, context) => {
		requireMethod(request, "POST");
		const token = request.headers.get(SECRET_TOKEN_HEADER)?.trim() ?? "";
		if (!TOKEN_PATTERN.test(token)) {
			context.log("refused a call without a well-formed secret token");
			throw new HttpError(401, "invalid_secret_token");
		}
		context.protect(token);
		const store = dependencies.store(context.environment, context);
		const target = await store.target(await sha256Hex(token));
		if (target === null) {
			context.log(
				"refused a call whose secret token matches no bot in webhook mode",
			);
			throw new HttpError(401, "invalid_secret_token");
		}
		const { body } = await readJsonObject(request, MAX_UPDATE_BYTES);
		const updates = inboundUpdates(body).slice(0, MAX_UPDATES_PER_CALL);
		if (updates.length === 0) {
			context.log("updates 0: nothing to do");
			return json({ ok: true }, 200);
		}
		dependencies.waitUntil(
			handleUpdates(dependencies, context, store, target, updates).catch(
				(error: unknown) => {
					context.log(`updates failed: ${context.errorMessage(error)}`);
				},
			),
		);
		return json({ ok: true }, 200);
	};
}
