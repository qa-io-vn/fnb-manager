import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createRestClient,
	REST_NETWORK_FAILURE,
	RestError,
} from "../../src/data/rest-client";

interface Sent {
	readonly url: string;
	readonly init: RequestInit;
}

function recorder(answer: () => Response | Promise<Response>) {
	const sent: Sent[] = [];
	const send: typeof fetch = async (input, init) => {
		sent.push({ url: String(input), init: init ?? {} });
		return answer();
	};
	return { sent, send };
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

afterEach(() => {
	vi.useRealTimers();
});

describe("the Mini App's Data API client", () => {
	it("reads a table with the publishable key and the member's session", async () => {
		const { sent, send } = recorder(() => json([{ id: "a" }]));
		const rest = createRestClient({
			url: "https://project.example.com/",
			publishableKey: "publishable-test",
			accessToken: "session-test",
			fetch: send,
		});
		expect(
			await rest.select("stores", {
				select: "id,name",
				store_id: "in.(a,b)",
				order: "name.asc,id.asc",
			}),
		).toEqual([{ id: "a" }]);
		const url = new URL(sent[0]?.url ?? "");
		expect(`${url.origin}${url.pathname}`).toBe(
			"https://project.example.com/rest/v1/stores",
		);
		expect(Object.fromEntries(url.searchParams)).toEqual({
			select: "id,name",
			store_id: "in.(a,b)",
			order: "name.asc,id.asc",
		});
		expect(sent[0]?.init.method).toBe("GET");
		expect(sent[0]?.init.headers).toEqual({
			apikey: "publishable-test",
			Authorization: "Bearer session-test",
			Accept: "application/json",
		});
	});

	it("calls a function with a JSON body, on the local dev server's /supabase path too", async () => {
		const { sent, send } = recorder(() => json([{ store_id: "a" }]));
		const rest = createRestClient({
			url: "/supabase",
			publishableKey: "publishable-test",
			accessToken: "session-test",
			fetch: send,
		});
		expect(await rest.rpc("today_store_totals")).toEqual([{ store_id: "a" }]);
		expect(sent[0]?.url).toBe("/supabase/rest/v1/rpc/today_store_totals");
		expect(sent[0]?.init.method).toBe("POST");
		expect(sent[0]?.init.body).toBe("{}");
		expect(sent[0]?.init.headers).toMatchObject({
			"Content-Type": "application/json",
			Authorization: "Bearer session-test",
		});
	});

	it("turns a refusal into its status without the answer's text, and a lost request into status 0", async () => {
		const refused = createRestClient({
			url: "/supabase",
			publishableKey: "k",
			accessToken: "t",
			fetch: recorder(() => json({ message: "JWT expired" }, 401)).send,
		});
		const error = await refused.select("tenants", {}).catch((e) => e);
		expect(error).toBeInstanceOf(RestError);
		expect(error.status).toBe(401);
		expect(error.message).not.toContain("JWT");
		const lost = createRestClient({
			url: "/supabase",
			publishableKey: "k",
			accessToken: "t",
			fetch: async () => {
				throw new TypeError("offline");
			},
		});
		await expect(lost.rpc("today_store_totals")).rejects.toMatchObject({
			status: REST_NETWORK_FAILURE,
		});
		const notRows = createRestClient({
			url: "/supabase",
			publishableKey: "k",
			accessToken: "t",
			fetch: recorder(() => json({ id: "a" })).send,
		});
		await expect(notRows.select("tenants", {})).rejects.toMatchObject({
			status: REST_NETWORK_FAILURE,
		});
	});

	it("gives up after the timeout and refuses names that are not plain identifiers", async () => {
		vi.useFakeTimers();
		const hanging = createRestClient({
			url: "/supabase",
			publishableKey: "k",
			accessToken: "t",
			timeoutMs: 1000,
			fetch: (_input, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new DOMException("aborted", "AbortError")),
					);
				}),
		});
		const pending = hanging.select("sync_runs", {}).catch((e) => e);
		await vi.advanceTimersByTimeAsync(1000);
		expect(await pending).toMatchObject({ status: REST_NETWORK_FAILURE });
		vi.useRealTimers();
		const { sent, send } = recorder(() => json([]));
		const rest = createRestClient({
			url: "/supabase",
			publishableKey: "k",
			accessToken: "t",
			fetch: send,
		});
		await expect(rest.select("../auth/v1/admin", {})).rejects.toThrow(
			"not a table or function name",
		);
		await expect(rest.rpc("today_store_totals?x=1")).rejects.toThrow(
			"not a table or function name",
		);
		expect(sent).toEqual([]);
	});
});
