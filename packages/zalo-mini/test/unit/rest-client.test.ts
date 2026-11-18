import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createRestClient,
	REST_NETWORK_FAILURE,
	RestError,
	refusalCode,
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

	it("keeps the database's refusal code, and only the code, so a screen can tell refusals apart", async () => {
		const answers: [Response, number, string | null][] = [
			[
				json(
					{
						code: "23505",
						message:
							"another member has this checklist open at this store today",
						details: null,
						hint: null,
					},
					409,
				),
				409,
				"23505",
			],
			[
				json({ code: "55000", message: "the checklist is retired" }, 500),
				500,
				"55000",
			],
			[json({ code: "42501", message: "x" }, 403), 403, "42501"],
			[
				json({ code: "PGRST301", message: "JWT expired" }, 401),
				401,
				"PGRST301",
			],
			[json({ code: "drop table", message: "x" }, 400), 400, null],
			[new Response("not json", { status: 502 }), 502, null],
		];
		for (const [answer, status, code] of answers) {
			const rest = createRestClient({
				url: "/supabase",
				publishableKey: "k",
				accessToken: "t",
				fetch: recorder(() => answer).send,
			});
			const error: unknown = await rest.rpc("start_checklist_run").then(
				() => null,
				(refused: unknown) => refused,
			);
			expect(error).toBeInstanceOf(RestError);
			if (!(error instanceof RestError)) throw new Error("not refused");
			expect(error.status).toBe(status);
			expect(error.code).toBe(code);
			expect(refusalCode(error)).toBe(code);
			expect(error.message).not.toMatch(/member|retired|JWT|json/);
		}
		expect(refusalCode(new Error("x"))).toBeNull();
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
