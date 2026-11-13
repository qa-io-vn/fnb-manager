import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
	classifyFetchRejection,
	failureOutcome,
	timedFetch,
} from "../../../src/channels/timed-fetch.js";

const TOKEN = "synthetic-bot-token";

const servers: Server[] = [];

afterEach(async () => {
	while (servers.length > 0) {
		const server = servers.pop();
		await new Promise<void>((resolve) => server?.close(() => resolve()));
	}
});

async function listen(handler: RequestListener): Promise<string> {
	const server = createServer(handler);
	servers.push(server);
	await new Promise<void>((resolve) =>
		server.listen(0, "127.0.0.1", () => resolve()),
	);
	const { port } = server.address() as AddressInfo;
	return `http://127.0.0.1:${port}/bot${TOKEN}/sendMessage`;
}

function post(url: string) {
	return timedFetch(
		(input, init) => fetch(input, init),
		url,
		{ method: "POST", body: "{}" },
		2000,
	);
}

function denoError(phase: "Connect" | "SendRequest", detail: string): Error {
	return new TypeError(
		`error sending request for url (https://bot-api.zaloplatforms.com/bot${TOKEN}/sendMessage): client error (${phase}): ${detail}`,
	);
}

describe("timedFetch rejection classes", () => {
	it("calls a connection dropped after the request was written lost, because the provider may have accepted it", async () => {
		let received = 0;
		const url = await listen((request, response) => {
			request.resume();
			request.on("end", () => {
				received += 1;
				response.socket?.destroy();
			});
		});
		expect(await post(url)).toEqual({
			kind: "failure",
			code: "connection_lost",
		});
		expect(received).toBe(1);
	});

	it("calls a refused connection a network failure, because nothing reached the provider", async () => {
		const server = createServer();
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", () => resolve()),
		);
		const { port } = server.address() as AddressInfo;
		await new Promise<void>((resolve) => server.close(() => resolve()));
		expect(await post(`http://127.0.0.1:${port}/bot${TOKEN}/getMe`)).toEqual({
			kind: "failure",
			code: "network",
		});
	});

	it.each([
		[
			"a Node refusal",
			new TypeError("fetch failed", {
				cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }),
			}),
			"network",
		],
		[
			"a Node refusal on every address",
			new TypeError("fetch failed", {
				cause: Object.assign(
					new AggregateError(
						[
							Object.assign(new Error("v6"), { code: "ECONNREFUSED" }),
							Object.assign(new Error("v4"), { code: "ECONNREFUSED" }),
						],
						"connect",
					),
					{ code: "ECONNREFUSED" },
				),
			}),
			"network",
		],
		[
			"a Node DNS failure",
			new TypeError("fetch failed", {
				cause: Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" }),
			}),
			"network",
		],
		[
			"a Node connect timeout",
			new TypeError("fetch failed", {
				cause: Object.assign(new Error("connect"), {
					code: "UND_ERR_CONNECT_TIMEOUT",
				}),
			}),
			"network",
		],
		[
			"a Node certificate failure",
			new TypeError("fetch failed", {
				cause: Object.assign(new Error("cert"), {
					code: "ERR_TLS_CERT_ALTNAME_INVALID",
				}),
			}),
			"network",
		],
		[
			"a Node socket closed after the write",
			new TypeError("fetch failed", {
				cause: Object.assign(new Error("other side closed"), {
					code: "UND_ERR_SOCKET",
				}),
			}),
			"connection_lost",
		],
		[
			"a Node connection reset",
			new TypeError("fetch failed", {
				cause: Object.assign(new Error("read"), { code: "ECONNRESET" }),
			}),
			"connection_lost",
		],
		[
			"a Deno connect failure",
			denoError(
				"Connect",
				"tcp connect error: Connection refused (os error 61)",
			),
			"network",
		],
		[
			"a Deno DNS failure",
			denoError(
				"Connect",
				"dns error: failed to lookup address information: nodename nor servname provided, or not known",
			),
			"network",
		],
		[
			"a Deno connection closed after the write",
			denoError("SendRequest", "connection closed before message completed"),
			"connection_lost",
		],
		[
			"an error without a cause",
			new TypeError("fetch failed"),
			"connection_lost",
		],
		["a thrown string", "boom", "connection_lost"],
		["a timeout abort", new DOMException("aborted", "TimeoutError"), "timeout"],
	] as const)("classifies %s", (_label, error, expected) => {
		expect(classifyFetchRejection(error, false)).toBe(expected);
	});

	it("calls any rejection after its own timeout fired a timeout", () => {
		expect(
			classifyFetchRejection(
				new TypeError("fetch failed", {
					cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }),
				}),
				true,
			),
		).toBe("timeout");
	});
});

describe("failureOutcome", () => {
	it.each([
		[
			"network",
			false,
			{ kind: "retry", code: "network", retryAfterSeconds: null },
		],
		[
			"network",
			true,
			{ kind: "retry", code: "network", retryAfterSeconds: null },
		],
		["connection_lost", false, { kind: "uncertain", code: "connection_lost" }],
		[
			"connection_lost",
			true,
			{ kind: "retry", code: "connection_lost", retryAfterSeconds: null },
		],
		["timeout", false, { kind: "uncertain", code: "timeout" }],
		[
			"timeout",
			true,
			{ kind: "retry", code: "timeout", retryAfterSeconds: null },
		],
	] as const)(
		"maps %s on an idempotent=%s provider",
		(code, idempotent, expected) => {
			expect(failureOutcome(code, idempotent)).toEqual(expected);
		},
	);
});
