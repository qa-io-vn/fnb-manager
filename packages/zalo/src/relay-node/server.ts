import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
	openRelayRequest,
	RELAY_MAX_ANSWER_BYTES,
	RELAY_MAX_ENVELOPE_BYTES,
	RELAY_PATH,
	RelayError,
	ReplayGuard,
	sealRelayAnswer,
	ZALO_GRAPH_ORIGIN,
} from "../relay.js";

/** How the relay calls the Zalo Graph; tests pass a stand-in, the relay itself the global fetch. */
export type GraphSender = (
	url: string,
	init: {
		readonly method: "GET";
		readonly headers: Readonly<Record<string, string>>;
		readonly signal: AbortSignal;
	},
) => Promise<Response>;

export interface RelayServerOptions {
	readonly key: CryptoKey;
	readonly graph?: GraphSender;
	readonly now?: () => number;
	readonly log?: (line: string) => void;
	readonly timeoutMs?: number;
}

export const RELAY_GRAPH_TIMEOUT_MS = 10_000;

class BodyOverLimit extends Error {}

function readBody(request: IncomingMessage, limit: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		let overLimit = false;
		request.on("data", (chunk: Buffer) => {
			if (overLimit) {
				return;
			}
			size += chunk.length;
			if (size > limit) {
				overLimit = true;
				chunks.length = 0;
				reject(new BodyOverLimit());
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => {
			if (!overLimit) {
				resolve(Buffer.concat(chunks).toString("utf8"));
			}
		});
		request.on("error", reject);
	});
}

function answer(response: ServerResponse, status: number, body: string): void {
	response.writeHead(status, {
		"content-type": "application/json",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
	});
	response.end(body);
}

function graphErrorOf(text: string): string {
	try {
		const parsed: unknown = JSON.parse(text);
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			typeof (parsed as { error?: unknown }).error === "number"
		) {
			return String((parsed as { error: number }).error);
		}
	} catch {
		// not JSON
	}
	return "none";
}

/**
 * The relay's request handler: POST /relay with a sealed request, answered with the sealed Graph answer. It logs
 * the path, the HTTP status, Zalo's error number and the time taken, never a header or a body.
 */
export function relayHandler(
	options: RelayServerOptions,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
	const guard = new ReplayGuard();
	const now = options.now ?? (() => Date.now());
	const log = options.log ?? (() => undefined);
	const graph: GraphSender = options.graph ?? ((url, init) => fetch(url, init));
	return async (request, response) => {
		const path = (request.url ?? "").split("?")[0];
		if (path !== RELAY_PATH) {
			answer(response, 404, JSON.stringify({ error: "not_found" }));
			return;
		}
		if (request.method !== "POST") {
			response.setHeader("allow", "POST");
			answer(response, 405, JSON.stringify({ error: "method_not_allowed" }));
			return;
		}
		let envelope: string;
		try {
			envelope = await readBody(request, RELAY_MAX_ENVELOPE_BYTES);
		} catch (error) {
			const overLimit = error instanceof BodyOverLimit;
			if (!response.headersSent) {
				answer(
					response,
					overLimit ? 413 : 400,
					JSON.stringify({ error: overLimit ? "too_large" : "unreadable" }),
				);
			}
			return;
		}
		let relayed: Awaited<ReturnType<typeof openRelayRequest>>;
		try {
			relayed = await openRelayRequest(options.key, envelope, now(), guard);
		} catch (error) {
			const code = error instanceof RelayError ? error.code : "invalid";
			log(`refused a request (${code})`);
			answer(response, 401, JSON.stringify({ error: code }));
			return;
		}
		const started = now();
		const target = `${ZALO_GRAPH_ORIGIN}${relayed.path}${relayed.query === "" ? "" : `?${relayed.query}`}`;
		let status: number;
		let text: string;
		try {
			const graphAnswer = await graph(target, {
				method: "GET",
				headers: relayed.headers,
				signal: AbortSignal.timeout(
					options.timeoutMs ?? RELAY_GRAPH_TIMEOUT_MS,
				),
			});
			status = graphAnswer.status;
			text = await graphAnswer.text();
		} catch {
			log(`${relayed.path}: the Zalo Graph could not be reached`);
			answer(response, 502, JSON.stringify({ error: "graph_unreachable" }));
			return;
		}
		if (text.length > RELAY_MAX_ANSWER_BYTES) {
			log(`${relayed.path}: the Zalo Graph answer was too large`);
			answer(response, 502, JSON.stringify({ error: "answer_too_large" }));
			return;
		}
		log(
			`${relayed.path}: HTTP ${status}, Zalo error ${graphErrorOf(text)}, ${now() - started} ms`,
		);
		answer(
			response,
			200,
			await sealRelayAnswer(options.key, relayed.id, { status, body: text }),
		);
	};
}

export interface RunningRelay {
	readonly server: Server;
	readonly port: number;
	close(): Promise<void>;
}

/** Serves the relay on 127.0.0.1 only; the tunnel is what makes it reachable. */
export function startRelayServer(
	options: RelayServerOptions & { readonly port: number },
): Promise<RunningRelay> {
	const handle = relayHandler(options);
	const server = createServer((request, response) => {
		handle(request, response).catch(() => {
			if (!response.headersSent) {
				answer(response, 500, JSON.stringify({ error: "relay_failed" }));
			}
		});
	});
	server.requestTimeout = 30_000;
	server.headersTimeout = 15_000;
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port, "127.0.0.1", () => {
			const port = (server.address() as AddressInfo).port;
			resolve({
				server,
				port,
				close: () =>
					new Promise<void>((done) => {
						server.close(() => done());
						server.closeAllConnections();
					}),
			});
		});
	});
}
