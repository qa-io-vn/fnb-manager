import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";

export type MockFault =
	| {
			readonly kind: "status";
			readonly status: number;
			readonly errorCode?: number;
			readonly code?: string;
			readonly retryAfter?: number;
			readonly description?: string;
	  }
	| { readonly kind: "hang"; readonly milliseconds?: number }
	| { readonly kind: "accept_then_drop" };

export interface MockZaloMessage {
	readonly token: string;
	readonly chatId: string;
	readonly text: string;
	readonly messageId: string;
	readonly accepted: boolean;
	readonly at: Date;
}

export interface MockEmail {
	readonly provider: "brevo" | "resend";
	readonly idempotencyKey: string | null;
	readonly apiKey: string;
	readonly to: string;
	readonly from: string;
	readonly subject: string;
	readonly text: string;
	readonly html: string;
	readonly messageId: string;
	readonly at: Date;
}

export interface MockZaloUpdate {
	readonly chatId: string;
	readonly text: string;
	readonly chatType?: "PRIVATE" | "GROUP";
}

export interface MockTelegramMessage {
	readonly token: string;
	readonly chatId: string;
	readonly text: string;
	readonly messageId: number;
	readonly previewsDisabled: boolean;
	readonly at: Date;
}

export interface MockTelegramUpdate {
	readonly chatId: string;
	readonly text: string;
	readonly chatType?: "private" | "group";
}

export interface MockWebhookDelivery {
	readonly path: string;
	readonly event: string;
	readonly messageId: string;
	readonly idempotencyKey: string;
	readonly timestamp: number;
	readonly body: Record<string, unknown>;
	readonly verified: boolean;
	readonly at: Date;
}

export interface MockProvidersOptions {
	readonly port?: number;
	readonly acceptAnyToken?: boolean;
	readonly now?: () => Date;
}

export interface MockProviders {
	readonly baseUrl: string;
	readonly port: number;
	environment(): Record<string, string>;
	registerZaloBot(token: string, botName?: string): void;
	registerTelegramBot(token: string, username?: string): void;
	registerEmailKey(apiKey: string): void;
	registerWebhookSecret(secret: string): void;
	emails(apiKey?: string): readonly MockEmail[];
	queueZaloUpdate(token: string, update: MockZaloUpdate): void;
	queueTelegramUpdate(token: string, update: MockTelegramUpdate): number;
	telegramMessages(token?: string): readonly MockTelegramMessage[];
	telegramOffsets(token: string): readonly (number | null)[];
	webhookDeliveries(): readonly MockWebhookDelivery[];
	webhookRejections(): number;
	webhookDuplicates(): number;
	setClock(now: () => Date): void;
	failNext(method: string, fault: MockFault, times?: number): void;
	zaloMessages(token?: string): readonly MockZaloMessage[];
	requestCount(method?: string): number;
	maxConcurrentPolls(): number;
	reset(): void;
	close(): Promise<void>;
}

const BOT_PATH = /^\/bot([^/]+)\/([A-Za-z]+)$/;
const BREVO_PATH = "/v3/smtp/email";
const RESEND_PATH = "/emails";
export const BREVO_FAULT_METHOD = "brevo";
export const RESEND_FAULT_METHOD = "resend";
export const WEBHOOK_FAULT_METHOD = "webhook";
export const TELEGRAM_METHOD_PREFIX = "telegram:";
const WEBHOOK_MAX_AGE_SECONDS = 300;
const TELEGRAM_MAX_TEXT_CHARACTERS = 4096;
const DEFAULT_HANG_MS = 60_000;
const MAX_TEXT_CHARACTERS = 2000;

interface PendingFault {
	fault: MockFault;
	remaining: number;
}

function readBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		request.on("error", reject);
	});
}

function parseObject(text: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(text);
		return parsed !== null &&
			typeof parsed === "object" &&
			!Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function respond(
	response: ServerResponse,
	status: number,
	body: unknown,
	headers: Record<string, string> = {},
): void {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		...headers,
	});
	response.end(JSON.stringify(body));
}

function zaloError(
	status: number,
	errorCode = status,
): Record<string, unknown> {
	return { ok: false, error_code: errorCode, description: "synthetic fault" };
}

export async function startMockProviders(
	options: MockProvidersOptions = {},
): Promise<MockProviders> {
	const bots = new Map<string, string>();
	const telegramBots = new Map<string, string>();
	const telegramUpdates = new Map<
		string,
		{ updateId: number; update: MockTelegramUpdate }[]
	>();
	const telegramSent: MockTelegramMessage[] = [];
	const telegramOffsetLog = new Map<string, (number | null)[]>();
	const webhookSecrets = new Set<string>();
	const webhookReceived: MockWebhookDelivery[] = [];
	const webhookKeys = new Set<string>();
	let webhookRejected = 0;
	let webhookDuplicated = 0;
	const resendKeys = new Map<
		string,
		{ fingerprint: string; id: string | null }
	>();
	let clock = options.now ?? (() => new Date());
	let updateCounter = Date.now();
	const emailKeys = new Set<string>();
	const emails: MockEmail[] = [];
	const updates = new Map<string, MockZaloUpdate[]>();
	const faults = new Map<string, PendingFault[]>();
	const messages: MockZaloMessage[] = [];
	const requests = new Map<string, number>();
	const sockets = new Set<Socket>();
	const inFlightPolls = new Map<string, number>();
	let concurrentPollPeak = 0;
	let counter = 0;

	const takeFault = (method: string): MockFault | null => {
		const queue = faults.get(method);
		const head = queue?.[0];
		if (!queue || !head) {
			return null;
		}
		head.remaining -= 1;
		if (head.remaining <= 0) {
			queue.shift();
		}
		return head.fault;
	};

	const knownToken = (token: string) =>
		options.acceptAnyToken === true || bots.has(token);

	const isTelegramToken = (token: string) =>
		telegramBots.has(token) ||
		(options.acceptAnyToken === true && token.includes("telegram"));

	const count = (method: string) => {
		requests.set(method, (requests.get(method) ?? 0) + 1);
	};

	const telegramError = (
		response: ServerResponse,
		status: number,
		description: string,
		extra: Record<string, unknown> = {},
	) => {
		respond(response, status, {
			ok: false,
			error_code: status,
			description,
			...extra,
		});
	};

	const handleTelegram = (
		token: string,
		method: string,
		payload: Record<string, unknown>,
		response: ServerResponse,
	) => {
		const key = `${TELEGRAM_METHOD_PREFIX}${method}`;
		count(key);
		const fault = takeFault(key);
		if (fault?.kind === "status") {
			telegramError(
				response,
				fault.status,
				fault.description ?? "synthetic fault",
				fault.retryAfter === undefined
					? {}
					: { parameters: { retry_after: fault.retryAfter } },
			);
			return;
		}
		if (fault?.kind === "hang") {
			setTimeout(
				() => response.socket?.destroy(),
				fault.milliseconds ?? DEFAULT_HANG_MS,
			);
			return;
		}
		if (method === "getMe") {
			respond(response, 200, {
				ok: true,
				result: {
					id: 1000001,
					is_bot: true,
					first_name: "Synthetic",
					username: telegramBots.get(token) ?? "synthetic_fnb_bot",
				},
			});
			return;
		}
		if (method === "getUpdates") {
			const offset = typeof payload.offset === "number" ? payload.offset : null;
			telegramOffsetLog.set(token, [
				...(telegramOffsetLog.get(token) ?? []),
				offset,
			]);
			const queued = (telegramUpdates.get(token) ?? []).filter(
				(entry) => offset === null || entry.updateId >= offset,
			);
			telegramUpdates.set(token, queued);
			respond(response, 200, {
				ok: true,
				result: queued.map((entry) => ({
					update_id: entry.updateId,
					message: {
						message_id: entry.updateId,
						date: Math.floor(Date.now() / 1000),
						from: { id: 1, is_bot: false, first_name: "Synthetic" },
						chat: {
							id: entry.update.chatId,
							type: entry.update.chatType ?? "private",
						},
						text: entry.update.text,
					},
				})),
			});
			return;
		}
		if (method === "sendMessage") {
			const chatId = payload.chat_id;
			const text = payload.text;
			if (
				(typeof chatId !== "string" && typeof chatId !== "number") ||
				typeof text !== "string" ||
				text.length < 1 ||
				text.length > TELEGRAM_MAX_TEXT_CHARACTERS ||
				payload.parse_mode !== undefined
			) {
				telegramError(response, 400, "Bad Request: synthetic");
				return;
			}
			counter += 1;
			const preview = payload.link_preview_options;
			telegramSent.push({
				token,
				chatId: String(chatId),
				text,
				messageId: counter,
				previewsDisabled:
					typeof preview === "object" &&
					preview !== null &&
					(preview as Record<string, unknown>).is_disabled === true,
				at: new Date(),
			});
			if (fault?.kind === "accept_then_drop") {
				response.socket?.destroy();
				return;
			}
			respond(response, 200, {
				ok: true,
				result: { message_id: counter, date: Math.floor(Date.now() / 1000) },
			});
			return;
		}
		telegramError(response, 404, "Not Found");
	};

	const handleResend = (
		request: IncomingMessage,
		body: string,
		response: ServerResponse,
	) => {
		count(RESEND_FAULT_METHOD);
		const fault = takeFault(RESEND_FAULT_METHOD);
		if (fault?.kind === "status") {
			respond(
				response,
				fault.status,
				{
					statusCode: fault.status,
					name: fault.code ?? "synthetic_fault",
					message: "synthetic fault",
				},
				fault.retryAfter === undefined
					? {}
					: { "retry-after": String(fault.retryAfter) },
			);
			return;
		}
		const keyHeader = request.headers["idempotency-key"];
		const idempotencyKey = typeof keyHeader === "string" ? keyHeader : null;
		const fingerprint = createHash("sha256").update(body).digest("hex");
		if (fault?.kind === "hang") {
			if (idempotencyKey !== null && !resendKeys.has(idempotencyKey)) {
				resendKeys.set(idempotencyKey, { fingerprint, id: null });
			}
			setTimeout(() => {
				if (
					idempotencyKey !== null &&
					resendKeys.get(idempotencyKey)?.id === null
				) {
					resendKeys.delete(idempotencyKey);
				}
				response.socket?.destroy();
			}, fault.milliseconds ?? DEFAULT_HANG_MS);
			return;
		}
		if (request.headers["user-agent"] === undefined) {
			respond(response, 403, { statusCode: 403, name: "missing_user_agent" });
			return;
		}
		const authorization = String(request.headers.authorization ?? "");
		const apiKey = authorization.startsWith("Bearer ")
			? authorization.slice("Bearer ".length)
			: "";
		if (!(options.acceptAnyToken === true || emailKeys.has(apiKey))) {
			respond(response, 401, { statusCode: 401, name: "validation_error" });
			return;
		}
		if (idempotencyKey !== null) {
			const known = resendKeys.get(idempotencyKey);
			if (known !== undefined) {
				if (known.fingerprint !== fingerprint) {
					respond(response, 409, {
						statusCode: 409,
						name: "invalid_idempotent_request",
					});
					return;
				}
				if (known.id === null) {
					respond(response, 409, {
						statusCode: 409,
						name: "concurrent_idempotent_requests",
					});
					return;
				}
				respond(response, 200, { id: known.id });
				return;
			}
		}
		const payload = parseObject(body);
		const to = Array.isArray(payload.to) ? payload.to[0] : undefined;
		const fromText = typeof payload.from === "string" ? payload.from : "";
		const from = /<([^<>]+)>\s*$/.exec(fromText)?.[1] ?? fromText;
		const subject = typeof payload.subject === "string" ? payload.subject : "";
		const text = typeof payload.text === "string" ? payload.text : "";
		const html = typeof payload.html === "string" ? payload.html : "";
		if (typeof to !== "string" || from === "" || subject === "") {
			respond(response, 422, { statusCode: 422, name: "validation_error" });
			return;
		}
		counter += 1;
		const messageId = `mock-resend-${counter}`;
		if (idempotencyKey !== null) {
			resendKeys.set(idempotencyKey, { fingerprint, id: messageId });
		}
		emails.push({
			provider: "resend",
			idempotencyKey,
			apiKey,
			to,
			from,
			subject,
			text,
			html,
			messageId,
			at: new Date(),
		});
		if (fault?.kind === "accept_then_drop") {
			response.socket?.destroy();
			return;
		}
		respond(response, 200, { id: messageId });
	};

	const signatureMatches = (
		secret: string,
		timestamp: string,
		body: string,
		signature: string,
	) => {
		const expected = `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
		const left = Buffer.from(expected);
		const right = Buffer.from(signature);
		return left.length === right.length && timingSafeEqual(left, right);
	};

	const handleWebhook = (
		request: IncomingMessage,
		path: string,
		body: string,
		response: ServerResponse,
	) => {
		count(WEBHOOK_FAULT_METHOD);
		const fault = takeFault(WEBHOOK_FAULT_METHOD);
		if (fault?.kind === "status") {
			respond(
				response,
				fault.status,
				{ error: "synthetic fault" },
				fault.retryAfter === undefined
					? {}
					: { "retry-after": String(fault.retryAfter) },
			);
			return;
		}
		if (fault?.kind === "hang") {
			setTimeout(
				() => response.socket?.destroy(),
				fault.milliseconds ?? DEFAULT_HANG_MS,
			);
			return;
		}
		const header = (name: string) => {
			const value = request.headers[name];
			return typeof value === "string" ? value : "";
		};
		const timestamp = header("x-fnb-timestamp");
		const signature = header("x-fnb-signature");
		const idempotencyKey = header("idempotency-key");
		const verified = [...webhookSecrets].some((secret) =>
			signatureMatches(secret, timestamp, body, signature),
		);
		const fresh =
			/^\d{1,12}$/.test(timestamp) &&
			Math.abs(clock().getTime() / 1000 - Number(timestamp)) <=
				WEBHOOK_MAX_AGE_SECONDS;
		const trusted =
			verified ||
			(options.acceptAnyToken === true && webhookSecrets.size === 0);
		if (
			idempotencyKey === "" ||
			header("user-agent") === "" ||
			!fresh ||
			!trusted
		) {
			webhookRejected += 1;
			respond(response, trusted ? 400 : 401, { error: "rejected" });
			return;
		}
		if (webhookKeys.has(idempotencyKey)) {
			webhookDuplicated += 1;
			respond(response, 200, { duplicate: true });
			return;
		}
		webhookKeys.add(idempotencyKey);
		webhookReceived.push({
			path,
			event: header("x-fnb-event"),
			messageId: header("x-fnb-message-id"),
			idempotencyKey,
			timestamp: Number(timestamp),
			body: parseObject(body),
			verified,
			at: new Date(),
		});
		if (fault?.kind === "accept_then_drop") {
			response.socket?.destroy();
			return;
		}
		respond(response, 200, { received: true });
	};

	const handleSend = (
		token: string,
		payload: Record<string, unknown>,
		response: ServerResponse,
		fault: MockFault | null,
	) => {
		const chatId = payload.chat_id;
		const text = payload.text;
		if (
			typeof chatId !== "string" ||
			chatId === "" ||
			typeof text !== "string" ||
			text.length < 1 ||
			text.length > MAX_TEXT_CHARACTERS
		) {
			respond(response, 400, zaloError(400));
			return;
		}
		counter += 1;
		const messageId = `mock-message-${counter}`;
		if (fault?.kind === "accept_then_drop") {
			messages.push({
				token,
				chatId,
				text,
				messageId,
				accepted: true,
				at: new Date(),
			});
			response.socket?.destroy();
			return;
		}
		messages.push({
			token,
			chatId,
			text,
			messageId,
			accepted: true,
			at: new Date(),
		});
		respond(response, 200, {
			ok: true,
			result: { message_id: messageId, date: Date.now() },
		});
	};

	const handleUpdates = (token: string, response: ServerResponse) => {
		const active = (inFlightPolls.get(token) ?? 0) + 1;
		inFlightPolls.set(token, active);
		concurrentPollPeak = Math.max(concurrentPollPeak, active);
		const queued = updates.get(token) ?? [];
		updates.set(token, []);
		counter += 1;
		const events = queued.map((update, index) => ({
			event_name: "message.text.received",
			message: {
				message_id: `mock-inbound-${counter}-${index}`,
				date: Date.now(),
				message_type: "CHAT_MESSAGE",
				from: {
					id: update.chatId,
					display_name: "Synthetic sender",
					is_bot: false,
				},
				chat: { id: update.chatId, chat_type: update.chatType ?? "PRIVATE" },
				text: update.text,
			},
		}));
		const result = events.length === 1 ? events[0] : events;
		setTimeout(() => {
			inFlightPolls.set(token, (inFlightPolls.get(token) ?? 1) - 1);
			respond(response, 200, { ok: true, result });
		}, 20);
	};

	const handleBrevo = (
		request: IncomingMessage,
		body: string,
		response: ServerResponse,
	) => {
		requests.set(
			BREVO_FAULT_METHOD,
			(requests.get(BREVO_FAULT_METHOD) ?? 0) + 1,
		);
		const fault = takeFault(BREVO_FAULT_METHOD);
		if (fault?.kind === "status") {
			respond(
				response,
				fault.status,
				{ code: fault.code ?? "synthetic_fault", message: "synthetic fault" },
				fault.retryAfter === undefined
					? {}
					: { "retry-after": String(fault.retryAfter) },
			);
			return;
		}
		if (fault?.kind === "hang") {
			setTimeout(
				() => response.socket?.destroy(),
				fault.milliseconds ?? DEFAULT_HANG_MS,
			);
			return;
		}
		const apiKey = String(request.headers["api-key"] ?? "");
		if (
			request.headers["user-agent"] === undefined ||
			!(options.acceptAnyToken === true || emailKeys.has(apiKey))
		) {
			respond(response, 401, { code: "unauthorized", message: "synthetic" });
			return;
		}
		const payload = parseObject(body);
		const sender = parseObject(JSON.stringify(payload.sender ?? {}));
		const recipients = Array.isArray(payload.to) ? payload.to : [];
		const first = parseObject(JSON.stringify(recipients[0] ?? {}));
		const to = typeof first.email === "string" ? first.email : "";
		const subject = typeof payload.subject === "string" ? payload.subject : "";
		const text =
			typeof payload.textContent === "string" ? payload.textContent : "";
		const html =
			typeof payload.htmlContent === "string" ? payload.htmlContent : "";
		const from = typeof sender.email === "string" ? sender.email : "";
		if (to === "" || from === "" || subject === "" || html === "") {
			respond(response, 400, {
				code: "missing_parameter",
				message: "synthetic",
			});
			return;
		}
		counter += 1;
		const messageId = `<mock-email-${counter}@example.com>`;
		emails.push({
			provider: "brevo",
			idempotencyKey: null,
			apiKey,
			to,
			from,
			subject,
			text,
			html,
			messageId,
			at: new Date(),
		});
		if (fault?.kind === "accept_then_drop") {
			response.socket?.destroy();
			return;
		}
		respond(response, 201, { messageId });
	};

	const handle = async (request: IncomingMessage, response: ServerResponse) => {
		const body = await readBody(request);
		if (request.method === "POST" && request.url === BREVO_PATH) {
			handleBrevo(request, body, response);
			return;
		}
		if (request.method === "POST" && request.url === RESEND_PATH) {
			handleResend(request, body, response);
			return;
		}
		const match = BOT_PATH.exec(request.url ?? "");
		if (
			request.method === "POST" &&
			!match &&
			(webhookSecrets.size > 0 || options.acceptAnyToken === true)
		) {
			handleWebhook(request, request.url ?? "/", body, response);
			return;
		}
		if (request.method !== "POST" || !match) {
			respond(response, 404, zaloError(404));
			return;
		}
		const token = decodeURIComponent(match[1] ?? "");
		const method = match[2] ?? "";
		if (isTelegramToken(token)) {
			handleTelegram(token, method, parseObject(body), response);
			return;
		}
		requests.set(method, (requests.get(method) ?? 0) + 1);
		const fault = takeFault(method);
		if (fault?.kind === "status") {
			respond(
				response,
				fault.status,
				zaloError(fault.status, fault.errorCode),
				fault.retryAfter === undefined
					? {}
					: { "retry-after": String(fault.retryAfter) },
			);
			return;
		}
		if (fault?.kind === "hang") {
			setTimeout(
				() => response.socket?.destroy(),
				fault.milliseconds ?? DEFAULT_HANG_MS,
			);
			return;
		}
		if (!knownToken(token)) {
			respond(response, 401, zaloError(401));
			return;
		}
		const payload = parseObject(body);
		if (method === "sendMessage") {
			handleSend(token, payload, response, fault);
			return;
		}
		if (method === "getMe") {
			respond(response, 200, {
				ok: true,
				result: {
					id: "synthetic-bot-id",
					account_name: bots.get(token) ?? "Bot synthetic",
					account_type: "BASIC",
					can_join_groups: false,
				},
			});
			return;
		}
		if (method === "getUpdates") {
			handleUpdates(token, response);
			return;
		}
		respond(response, 404, zaloError(404));
	};

	const server: Server = createServer((request, response) => {
		handle(request, response).catch(() => {
			if (!response.headersSent) {
				respond(response, 500, zaloError(500));
			}
		});
	});
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	const port =
		typeof address === "object" && address !== null ? address.port : 0;
	const baseUrl = `http://127.0.0.1:${port}`;

	return {
		baseUrl,
		port,
		environment: () => ({
			NOTIFY_ZALO_BOT_BASE_URL: baseUrl,
			NOTIFY_TELEGRAM_BASE_URL: baseUrl,
			NOTIFY_BREVO_BASE_URL: baseUrl,
			NOTIFY_RESEND_BASE_URL: baseUrl,
			NOTIFY_WEBHOOK_BASE_URL: baseUrl,
		}),
		registerZaloBot(token, botName = "Bot synthetic") {
			bots.set(token, botName);
		},
		registerTelegramBot(token, username = "synthetic_fnb_bot") {
			telegramBots.set(token, username);
		},
		registerEmailKey(apiKey) {
			emailKeys.add(apiKey);
		},
		registerWebhookSecret(secret) {
			webhookSecrets.add(secret);
		},
		queueTelegramUpdate(token, update) {
			updateCounter += 1;
			const updateId = updateCounter;
			telegramUpdates.set(token, [
				...(telegramUpdates.get(token) ?? []),
				{ updateId, update },
			]);
			return updateId;
		},
		telegramMessages(token) {
			return telegramSent.filter(
				(entry) => token === undefined || entry.token === token,
			);
		},
		telegramOffsets(token) {
			return telegramOffsetLog.get(token) ?? [];
		},
		webhookDeliveries: () => [...webhookReceived],
		webhookRejections: () => webhookRejected,
		webhookDuplicates: () => webhookDuplicated,
		setClock(now) {
			clock = now;
		},
		emails(apiKey) {
			return emails.filter(
				(entry) => apiKey === undefined || entry.apiKey === apiKey,
			);
		},
		queueZaloUpdate(token, update) {
			updates.set(token, [...(updates.get(token) ?? []), update]);
		},
		failNext(method, fault, times = 1) {
			faults.set(method, [
				...(faults.get(method) ?? []),
				{ fault, remaining: times },
			]);
		},
		zaloMessages(token) {
			return messages.filter(
				(entry) => token === undefined || entry.token === token,
			);
		},
		requestCount(method) {
			if (method !== undefined) {
				return requests.get(method) ?? 0;
			}
			return [...requests.values()].reduce((sum, count) => sum + count, 0);
		},
		maxConcurrentPolls: () => concurrentPollPeak,
		reset() {
			updates.clear();
			faults.clear();
			messages.length = 0;
			emails.length = 0;
			requests.clear();
			concurrentPollPeak = 0;
			telegramUpdates.clear();
			telegramSent.length = 0;
			telegramOffsetLog.clear();
			webhookReceived.length = 0;
			webhookKeys.clear();
			webhookRejected = 0;
			webhookDuplicated = 0;
			resendKeys.clear();
		},
		async close() {
			for (const socket of sockets) {
				socket.destroy();
			}
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
