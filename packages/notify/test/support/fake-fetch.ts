import type { FetchLike } from "../../src/index.js";

export interface RecordedRequest {
	readonly url: string;
	readonly method: string;
	readonly headers: Record<string, string>;
	readonly body: unknown;
}

export type FakeAnswer =
	| {
			readonly status: number;
			readonly body?: unknown;
			readonly headers?: Record<string, string>;
			readonly raw?: string;
	  }
	| {
			readonly reject:
				| "network"
				| "timeout"
				| "connection_lost"
				| "unclassified";
	  }
	| { readonly waitForAbort: true };

export interface FakeFetch {
	readonly fetch: FetchLike;
	readonly requests: RecordedRequest[];
	answer(...answers: FakeAnswer[]): void;
}

function headerRecord(init: RequestInit): Record<string, string> {
	const headers = new Headers(init.headers);
	const result: Record<string, string> = {};
	headers.forEach((value, key) => {
		result[key] = value;
	});
	return result;
}

function socketError(
	reject: "network" | "connection_lost",
	input: string,
): Error {
	return reject === "network"
		? Object.assign(new Error(`connect ECONNREFUSED ${input}`), {
				code: "ECONNREFUSED",
			})
		: Object.assign(new Error(`other side closed ${input}`), {
				code: "UND_ERR_SOCKET",
			});
}

export function fakeFetch(): FakeFetch {
	const queue: FakeAnswer[] = [];
	const requests: RecordedRequest[] = [];
	const fetchLike: FetchLike = async (input, init) => {
		requests.push({
			url: input,
			method: init.method ?? "GET",
			headers: headerRecord(init),
			body: typeof init.body === "string" ? JSON.parse(init.body) : null,
		});
		const answer = queue.shift() ?? {
			status: 200,
			body: { ok: true, result: { message_id: "m-1" } },
		};
		if ("reject" in answer) {
			if (answer.reject === "timeout") {
				throw new DOMException(
					"The operation was aborted due to timeout",
					"TimeoutError",
				);
			}
			if (answer.reject === "unclassified") {
				throw new TypeError(`fetch failed for ${input}`);
			}
			throw new TypeError(`fetch failed for ${input}`, {
				cause: socketError(answer.reject, input),
			});
		}
		if ("waitForAbort" in answer) {
			return new Promise<Response>((_resolve, reject) => {
				init.signal?.addEventListener("abort", () =>
					reject(init.signal?.reason),
				);
			});
		}
		return new Response(answer.raw ?? JSON.stringify(answer.body ?? {}), {
			status: answer.status,
			headers: {
				"content-type": "application/json",
				...(answer.headers ?? {}),
			},
		});
	};
	return {
		fetch: fetchLike,
		requests,
		answer: (...answers) => {
			queue.push(...answers);
		},
	};
}
