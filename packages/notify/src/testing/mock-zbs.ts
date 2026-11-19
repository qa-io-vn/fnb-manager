import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import type { FetchLike } from "../channels/types.js";
import {
	OA_ERRORS,
	ZALO_OA_CONSULTATION_PATH,
	ZBS_ERRORS,
	ZBS_TEMPLATE_PATH,
} from "../channels/zalo-zbs.js";
import {
	ZALO_OA_BASE_URL_VARIABLE,
	ZBS_BASE_URL_VARIABLE,
} from "../customer/dispatch.js";

export type MockZbsFault =
	| { readonly kind: "error"; readonly error: number }
	| { readonly kind: "status"; readonly status: number }
	| { readonly kind: "hang" }
	| { readonly kind: "accept_then_hang" };

export interface MockZbsMessage {
	readonly templateId: string;
	readonly phone: string | null;
	readonly userId: string | null;
	readonly data: Readonly<Record<string, string>>;
	readonly trackingId: string;
	readonly msgId: string;
	readonly at: Date;
}

export interface MockConsultationMessage {
	readonly userId: string;
	readonly text: string;
	readonly messageId: string;
	readonly at: Date;
}

export interface MockZbs {
	readonly fetch: FetchLike;
	handle(request: Request): Promise<Response>;
	registerToken(token: string): void;
	registerTemplate(templateId: string, parameters: readonly string[]): void;
	openWindow(userId: string): void;
	failNext(path: string, fault: MockZbsFault, times?: number): void;
	templates(): readonly MockZbsMessage[];
	consultations(): readonly MockConsultationMessage[];
	requestHeaders(): readonly Readonly<Record<string, string>>[];
	reset(): void;
}

export interface MockZbsServer extends MockZbs {
	readonly baseUrl: string;
	environment(): Record<string, string>;
	close(): Promise<void>;
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function waitForAbort(signal: AbortSignal | null | undefined): Promise<never> {
	return new Promise((_resolve, reject) => {
		if (signal === null || signal === undefined) {
			return;
		}
		const abort = () =>
			reject(
				signal.reason instanceof Error
					? signal.reason
					: new DOMException("aborted", "AbortError"),
			);
		if (signal.aborted) {
			abort();
			return;
		}
		signal.addEventListener("abort", abort, { once: true });
	});
}

export function createMockZbs(): MockZbs {
	const tokens = new Set<string>();
	const templateParameters = new Map<string, readonly string[]>();
	const windows = new Set<string>();
	const faults = new Map<
		string,
		{ fault: MockZbsFault; remaining: number }[]
	>();
	const templateMessages: MockZbsMessage[] = [];
	const consultationMessages: MockConsultationMessage[] = [];
	const headerLog: Record<string, string>[] = [];
	let counter = 0;

	const takeFault = (path: string): MockZbsFault | null => {
		const queue = faults.get(path);
		const head = queue?.[0];
		if (queue === undefined || head === undefined) {
			return null;
		}
		head.remaining -= 1;
		if (head.remaining <= 0) {
			queue.shift();
		}
		return head.fault;
	};

	const handleTemplate = (
		payload: Record<string, unknown>,
		fault: MockZbsFault | null,
		signal: AbortSignal | null,
	): Promise<Response> | Response => {
		const templateId = payload.template_id;
		const phone = payload.phone;
		const userId = payload.user_id;
		const data = record(payload.template_data);
		const trackingId = payload.tracking_id;
		if (
			typeof templateId !== "string" ||
			typeof trackingId !== "string" ||
			data === null ||
			(typeof phone !== "string" && typeof userId !== "string")
		) {
			return json(200, {
				error: -121,
				message: "Body data empty or malformed",
			});
		}
		if (typeof phone === "string" && !/^84\d{9,10}$/.test(phone)) {
			return json(200, {
				error: ZBS_ERRORS.phoneInvalid,
				message: "Phone number is invalid",
			});
		}
		const expected = templateParameters.get(templateId);
		if (expected === undefined) {
			return json(200, {
				error: ZBS_ERRORS.templateInvalid,
				message: "Template ID is invalid",
			});
		}
		const given = Object.keys(data).sort();
		if (
			given.length !== expected.length ||
			[...expected].sort().some((name, index) => name !== given[index]) ||
			Object.values(data).some(
				(value) => typeof value !== "string" || value === "",
			)
		) {
			return json(200, {
				error: ZBS_ERRORS.templateDataInvalid,
				message: "Template data is invalid",
			});
		}
		counter += 1;
		const msgId = `mock-zbs-${counter}`;
		templateMessages.push({
			templateId,
			phone: typeof phone === "string" ? phone : null,
			userId: typeof userId === "string" ? userId : null,
			data: Object.fromEntries(
				Object.entries(data).map(([key, value]) => [key, String(value)]),
			),
			trackingId,
			msgId,
			at: new Date(),
		});
		if (fault?.kind === "accept_then_hang") {
			return waitForAbort(signal);
		}
		return json(200, {
			error: 0,
			message: "Success",
			data: {
				msg_id: msgId,
				sent_time: String(Date.now()),
				quota: { dailyQuota: "1000", remainingQuota: String(1000 - counter) },
			},
		});
	};

	const handleConsultation = (
		payload: Record<string, unknown>,
		fault: MockZbsFault | null,
		signal: AbortSignal | null,
	): Promise<Response> | Response => {
		const recipient = record(payload.recipient);
		const message = record(payload.message);
		const userId = recipient?.user_id;
		const text = message?.text;
		if (
			typeof userId !== "string" ||
			typeof text !== "string" ||
			text.trim() === ""
		) {
			return json(200, {
				error: OA_ERRORS.parameterInvalid,
				message: "Parameters are invalid",
			});
		}
		if (!windows.has(userId)) {
			return json(200, {
				error: OA_ERRORS.outsideWindow,
				message: "User has not interacted with the OA in the last 7 days",
			});
		}
		counter += 1;
		const messageId = `mock-cs-${counter}`;
		consultationMessages.push({ userId, text, messageId, at: new Date() });
		if (fault?.kind === "accept_then_hang") {
			return waitForAbort(signal);
		}
		return json(200, {
			error: 0,
			message: "Success",
			data: { message_id: messageId, user_id: userId },
		});
	};

	const handle = async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		const headers = Object.fromEntries(request.headers.entries());
		headerLog.push(headers);
		const fault = takeFault(url.pathname);
		if (fault?.kind === "hang") {
			return waitForAbort(request.signal);
		}
		if (fault?.kind === "status") {
			return json(fault.status, { error: -1, message: "synthetic fault" });
		}
		if (fault?.kind === "error") {
			return json(200, { error: fault.error, message: "synthetic fault" });
		}
		if (request.method !== "POST") {
			return json(405, { error: -106, message: "Method unsupported" });
		}
		const token = request.headers.get("access_token");
		if (token === null || !tokens.has(token)) {
			return json(200, {
				error:
					url.pathname === ZBS_TEMPLATE_PATH
						? ZBS_ERRORS.accessTokenInvalid
						: OA_ERRORS.accessTokenInvalid,
				message: "Access token is invalid",
			});
		}
		let payload: Record<string, unknown> | null;
		try {
			payload = record(JSON.parse(await request.text()) as unknown);
		} catch {
			payload = null;
		}
		if (payload === null) {
			return json(200, { error: -122, message: "Body format is invalid" });
		}
		if (url.pathname === ZBS_TEMPLATE_PATH) {
			return handleTemplate(payload, fault, request.signal);
		}
		if (url.pathname === ZALO_OA_CONSULTATION_PATH) {
			return handleConsultation(payload, fault, request.signal);
		}
		return json(404, { error: -404, message: "Not found" });
	};

	const fetchLike: FetchLike = (input, init) =>
		handle(new Request(input, init));

	return {
		fetch: fetchLike,
		handle,
		registerToken: (token) => {
			tokens.add(token);
		},
		registerTemplate: (templateId, parameters) => {
			templateParameters.set(templateId, [...parameters]);
		},
		openWindow: (userId) => {
			windows.add(userId);
		},
		failNext: (path, fault, times = 1) => {
			const queue = faults.get(path) ?? [];
			queue.push({ fault, remaining: times });
			faults.set(path, queue);
		},
		templates: () => [...templateMessages],
		consultations: () => [...consultationMessages],
		requestHeaders: () => [...headerLog],
		reset: () => {
			faults.clear();
			templateMessages.length = 0;
			consultationMessages.length = 0;
			headerLog.length = 0;
		},
	};
}

function readBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		request.on("error", reject);
	});
}

export async function startMockZbs(): Promise<MockZbsServer> {
	const mock = createMockZbs();
	const sockets = new Set<Socket>();
	const server: Server = createServer(
		(incoming: IncomingMessage, outgoing: ServerResponse) => {
			const controller = new AbortController();
			outgoing.on("close", () => controller.abort());
			void readBody(incoming).then(async (body) => {
				const headers = new Headers();
				for (const [name, value] of Object.entries(incoming.headers)) {
					if (typeof value === "string") {
						headers.set(name, value);
					}
				}
				try {
					const response = await mock.handle(
						new Request(`http://127.0.0.1${incoming.url ?? "/"}`, {
							method: incoming.method ?? "GET",
							headers,
							...(incoming.method === "POST" ? { body } : {}),
							signal: controller.signal,
						}),
					);
					outgoing.writeHead(response.status, {
						"content-type": "application/json; charset=utf-8",
					});
					outgoing.end(await response.text());
				} catch {
					outgoing.destroy();
				}
			});
		},
	);
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port =
		typeof address === "object" && address !== null ? address.port : 0;
	const baseUrl = `http://127.0.0.1:${port}`;
	return {
		...mock,
		baseUrl,
		environment: () => ({
			[ZBS_BASE_URL_VARIABLE]: baseUrl,
			[ZALO_OA_BASE_URL_VARIABLE]: baseUrl,
		}),
		close: async () => {
			for (const socket of sockets) {
				socket.destroy();
			}
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
