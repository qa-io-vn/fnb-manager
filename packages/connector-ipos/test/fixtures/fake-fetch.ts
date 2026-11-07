import type { FetchLike } from "../../src/http.js";

export interface RecordedRequest {
	url: URL;
	method: string;
	headers: Headers;
	body: unknown;
}

export interface FakeResponse {
	status?: number;
	json?: unknown;
	text?: string;
}

export type Responder = (
	request: RecordedRequest,
	callIndex: number,
) => FakeResponse | Error;

export interface FakeFetch {
	fetch: FetchLike;
	requests: RecordedRequest[];
	requestsTo(pathname: string): RecordedRequest[];
}

export function jsonResponse(json: unknown, status = 200): FakeResponse {
	return { status, json };
}

function toResponse(fake: FakeResponse): Response {
	const status = fake.status ?? 200;
	const body =
		fake.text ?? (fake.json === undefined ? "" : JSON.stringify(fake.json));
	return new Response(body, {
		status,
		headers: { "content-type": "application/json" },
	});
}

function parseBody(init: RequestInit | undefined): unknown {
	if (typeof init?.body !== "string") {
		return undefined;
	}
	try {
		return JSON.parse(init.body);
	} catch {
		return init.body;
	}
}

export function createFakeFetch(respond: Responder): FakeFetch {
	const requests: RecordedRequest[] = [];
	const fetch: FetchLike = async (input, init) => {
		const url =
			input instanceof URL
				? input
				: new URL(typeof input === "string" ? input : input.url);
		const request: RecordedRequest = {
			url,
			method: init?.method ?? "GET",
			headers: new Headers(init?.headers),
			body: parseBody(init),
		};
		requests.push(request);
		init?.signal?.throwIfAborted();
		const outcome = respond(request, requests.length - 1);
		if (outcome instanceof Error) {
			throw outcome;
		}
		return toResponse(outcome);
	};
	return {
		fetch,
		requests,
		requestsTo: (pathname) =>
			requests.filter((request) => request.url.pathname === pathname),
	};
}

export function routeByPath(
	routes: Record<string, Responder>,
	fallback?: Responder,
): Responder {
	return (request, callIndex) => {
		const route = routes[request.url.pathname];
		if (route) {
			return route(request, callIndex);
		}
		if (fallback) {
			return fallback(request, callIndex);
		}
		return {
			status: 404,
			json: {
				error: {
					code: 404,
					message: `no fake route for ${request.url.pathname}`,
				},
			},
		};
	};
}

export function sequence(...responses: FakeResponse[]): Responder {
	let next = 0;
	return () => {
		const response = responses[Math.min(next, responses.length - 1)];
		next += 1;
		if (!response) {
			throw new Error("sequence() needs at least one response");
		}
		return response;
	};
}
