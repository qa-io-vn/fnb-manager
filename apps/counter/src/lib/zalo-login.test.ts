import { describe, expect, it, vi } from "vitest";
import type { CounterEnvironment } from "../env";
import {
	callbackOf,
	challengeOf,
	finishLogin,
	LOGIN_MAX_AGE_MS,
	LOGIN_STORAGE_KEY,
	LoginError,
	pairLogin,
	returnAddress,
	startLogin,
} from "./zalo-login";

// counter:unit/zalo-login (ADR-066): the browser half of the web login. Equivalence classes of a return address
// (code and state, an error, a state without a code, nothing), the PKCE pair, the stored state compared at the
// callback (CSRF: none, another, expired at 10 minutes and one millisecond, the same), and the shapes sent.

const ENV: CounterEnvironment = {
	supabaseUrl: "http://127.0.0.1:54321",
	publishableKey: "sb_publishable_synthetic",
	sessionUrl: "http://127.0.0.1:5767",
	checkoutUrl: "http://127.0.0.1:54321/functions/v1/checkout-order",
	brand: "brand-1",
};

function memoryStorage(): Storage {
	const map = new Map<string, string>();
	return {
		get length() {
			return map.size;
		},
		clear: () => map.clear(),
		getItem: (key) => map.get(key) ?? null,
		key: () => null,
		removeItem: (key) => void map.delete(key),
		setItem: (key, value) => void map.set(key, value),
	};
}

function answer(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("the return address", () => {
	it.each([
		["?code=abc&state=xyz", { code: "abc", state: "xyz" }],
		["?error=access_denied&state=xyz", { error: "access_denied" }],
		["?state=xyz", { error: "denied" }],
		["", null],
		["?lang=en", null],
	])("%s", (search, expected) => {
		expect(callbackOf(search)).toEqual(expected);
	});

	it("is the page without its query or hash", () => {
		expect(
			returnAddress({ origin: "https://counter.example.com", pathname: "/" }),
		).toBe("https://counter.example.com/");
	});
});

describe("starting and finishing", () => {
	it("sends the S256 challenge of a 43-character verifier and keeps the verifier with the state", async () => {
		const storage = memoryStorage();
		const fetch = vi.fn(
			async (_url: string | URL | Request, init?: RequestInit) => {
				const body = JSON.parse(String(init?.body));
				expect(body).toMatchObject({
					action: "start",
					brand: "brand-1",
					redirect_uri: "https://counter.example.com/",
				});
				expect(body.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
				return answer({
					status: "authorize",
					authorize_url: "https://zalo.example/authorize",
					state: "s".repeat(60),
				});
			},
		);
		const url = await startLogin(ENV, {
			location: { origin: "https://counter.example.com", pathname: "/" },
			storage,
			fetch: fetch as unknown as typeof globalThis.fetch,
			now: () => 1000,
		});
		expect(url).toBe("https://zalo.example/authorize");
		const pending = JSON.parse(storage.getItem(LOGIN_STORAGE_KEY) ?? "{}");
		expect(pending.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const sent = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
		expect(sent.code_challenge).toBe(await challengeOf(pending.verifier));
		expect(pending).toMatchObject({
			state: "s".repeat(60),
			redirect: "https://counter.example.com/",
			at: 1000,
		});
	});

	it("refuses a return it did not start, another state, or one older than ten minutes, before sending anything", async () => {
		const fetch = vi.fn();
		const cases: [string | null, number][] = [
			[null, 0],
			[
				JSON.stringify({
					verifier: "v".repeat(43),
					state: "other",
					redirect: "r",
					at: 0,
				}),
				0,
			],
			[
				JSON.stringify({
					verifier: "v".repeat(43),
					state: "mine",
					redirect: "r",
					at: 0,
				}),
				LOGIN_MAX_AGE_MS + 1,
			],
			["not json", 0],
		];
		for (const [stored, now] of cases) {
			const storage = memoryStorage();
			if (stored !== null) storage.setItem(LOGIN_STORAGE_KEY, stored);
			await expect(
				finishLogin(
					ENV,
					{ code: "c", state: "mine" },
					{ storage, fetch: fetch as never, now: () => now },
				),
			).rejects.toMatchObject({ code: "state_mismatch" });
			expect(storage.getItem(LOGIN_STORAGE_KEY)).toBeNull();
		}
		expect(fetch).not.toHaveBeenCalled();
	});

	it("sends the code, the state, the verifier and the same return address at ten minutes exactly", async () => {
		const storage = memoryStorage();
		storage.setItem(
			LOGIN_STORAGE_KEY,
			JSON.stringify({
				verifier: "v".repeat(43),
				state: "mine",
				redirect: "https://counter.example.com/",
				at: 0,
			}),
		);
		const fetch = vi.fn(async () =>
			answer({
				status: "unpaired",
				ticket: "t".repeat(60),
				notice: {
					version: "1",
					title: "T",
					body_markdown: "B",
					published_at: "x",
				},
			}),
		);
		const result = await finishLogin(
			ENV,
			{ code: "c", state: "mine" },
			{ storage, fetch: fetch as never, now: () => LOGIN_MAX_AGE_MS },
		);
		expect(result.status).toBe("unpaired");
		expect(
			JSON.parse(
				String(
					(fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body,
				),
			),
		).toEqual({
			action: "callback",
			redirect_uri: "https://counter.example.com/",
			code: "c",
			state: "mine",
			code_verifier: "v".repeat(43),
			brand: "brand-1",
		});
	});

	it("turns a refusal into a typed error and a broken network into 'network'", async () => {
		const storage = memoryStorage();
		storage.setItem(
			LOGIN_STORAGE_KEY,
			JSON.stringify({
				verifier: "v".repeat(43),
				state: "mine",
				redirect: "r",
				at: 0,
			}),
		);
		await expect(
			finishLogin(
				ENV,
				{ code: "c", state: "mine" },
				{
					storage,
					fetch: (async () => answer({ error: "state_refused" }, 401)) as never,
					now: () => 0,
				},
			),
		).rejects.toEqual(new LoginError("state_refused"));
		await expect(
			pairLogin(
				ENV,
				{ ticket: "t", pairingCode: "123456", notice: null },
				(async () => {
					throw new TypeError("Failed to fetch");
				}) as never,
			),
		).rejects.toMatchObject({ code: "network" });
	});

	it("pairs with the code and the notice acceptance, leaving out what is not given", async () => {
		const fetch = vi.fn(async () =>
			answer({ status: "notice_required", ticket: "t".repeat(60) }),
		);
		await pairLogin(
			ENV,
			{
				ticket: "t1",
				pairingCode: null,
				notice: { version: "2026-11-01", shownAt: "2026-11-28T00:00:00.000Z" },
			},
			fetch as never,
		);
		expect(
			JSON.parse(
				String(
					(fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body,
				),
			),
		).toEqual({
			action: "pair",
			ticket: "t1",
			notice: { version: "2026-11-01", shown_at: "2026-11-28T00:00:00.000Z" },
			brand: "brand-1",
		});
	});
});
