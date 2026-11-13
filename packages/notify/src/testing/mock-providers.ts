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

export interface MockProvidersOptions {
	readonly port?: number;
	readonly acceptAnyToken?: boolean;
}

export interface MockProviders {
	readonly baseUrl: string;
	readonly port: number;
	environment(): Record<string, string>;
	registerZaloBot(token: string, botName?: string): void;
	registerEmailKey(apiKey: string): void;
	emails(apiKey?: string): readonly MockEmail[];
	queueZaloUpdate(token: string, update: MockZaloUpdate): void;
	failNext(method: string, fault: MockFault, times?: number): void;
	zaloMessages(token?: string): readonly MockZaloMessage[];
	requestCount(method?: string): number;
	maxConcurrentPolls(): number;
	reset(): void;
	close(): Promise<void>;
}

const BOT_PATH = /^\/bot([^/]+)\/([A-Za-z]+)$/;
const BREVO_PATH = "/v3/smtp/email";
export const BREVO_FAULT_METHOD = "brevo";
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
		const match = BOT_PATH.exec(request.url ?? "");
		if (request.method !== "POST" || !match) {
			respond(response, 404, zaloError(404));
			return;
		}
		const token = decodeURIComponent(match[1] ?? "");
		const method = match[2] ?? "";
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
			NOTIFY_BREVO_BASE_URL: baseUrl,
		}),
		registerZaloBot(token, botName = "Bot synthetic") {
			bots.set(token, botName);
		},
		registerEmailKey(apiKey) {
			emailKeys.add(apiKey);
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
		},
		async close() {
			for (const socket of sockets) {
				socket.destroy();
			}
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
