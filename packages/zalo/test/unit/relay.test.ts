import { describe, expect, it } from "vitest";
import {
	fromBase64,
	graphCallOf,
	importRelayKey,
	newRelayKey,
	openAnnouncement,
	openRelayAnswer,
	openRelayEnvelope,
	openRelayRequest,
	RELAY_ANNOUNCE_MAX_SKEW_MS,
	RELAY_MAX_SKEW_MS,
	RelayError,
	type RelayRequest,
	ReplayGuard,
	relayFetch,
	relayUrlProblem,
	sealAnnouncement,
	sealRelayAnswer,
	sealRelayEnvelope,
	sealRelayRequest,
	toBase64,
	UpstreamError,
	validateRelayRequest,
	type ZaloRequestInit,
} from "../../src/index.js";

const NOW = Date.parse("2026-11-25T04:00:00Z");
const ID = "aaaaaaaa-1111-4111-8111-111111111111";
const TOKEN = "synthetic-access-token-0001";
const PROOF = "a".repeat(64);

async function keyPair(): Promise<{ key: CryptoKey; other: CryptoKey }> {
	return {
		key: await importRelayKey(newRelayKey()),
		other: await importRelayKey(newRelayKey()),
	};
}

function meRequest(overrides: Partial<RelayRequest> = {}): RelayRequest {
	return {
		id: ID,
		at: NOW,
		path: "/v2.0/me",
		query: "fields=id,name",
		headers: { access_token: TOKEN, appsecret_proof: PROOF },
		...overrides,
	};
}

async function refusal(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		return error instanceof RelayError ? error.code : "other";
	}
	return "none";
}

describe("relay key", () => {
	it("imports 32 bytes in base64 or base64url and refuses every other length or alphabet", async () => {
		const bytes = crypto.getRandomValues(new Uint8Array(32));
		const plain = toBase64(bytes);
		const url = plain
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
		await expect(importRelayKey(plain)).resolves.toBeDefined();
		await expect(importRelayKey(url)).resolves.toBeDefined();
		await expect(importRelayKey(` ${plain}\n`)).resolves.toBeDefined();
		expect(await refusal(importRelayKey(toBase64(new Uint8Array(31))))).toBe(
			"bad_key",
		);
		expect(await refusal(importRelayKey(toBase64(new Uint8Array(33))))).toBe(
			"bad_key",
		);
		expect(await refusal(importRelayKey(""))).toBe("bad_key");
		expect(await refusal(importRelayKey("not base64 at all!"))).toBe("bad_key");
	});

	it("makes a different 32-byte key every time", () => {
		const first = newRelayKey();
		const second = newRelayKey();
		expect(first).not.toBe(second);
		expect(fromBase64(first)?.length).toBe(32);
	});
});

describe("sealed envelopes", () => {
	it("open only with the same key, purpose and context", async () => {
		const { key, other } = await keyPair();
		const sealed = await sealRelayEnvelope(key, "answer", { a: 1 }, ID);
		expect(await openRelayEnvelope(key, "answer", sealed, ID)).toEqual({
			a: 1,
		});
		expect(await refusal(openRelayEnvelope(other, "answer", sealed, ID))).toBe(
			"sealed",
		);
		expect(await refusal(openRelayEnvelope(key, "request", sealed, ID))).toBe(
			"sealed",
		);
		expect(
			await refusal(openRelayEnvelope(key, "answer", sealed, "another-id")),
		).toBe("sealed");
	});

	it("refuses a tampered cipher text, a short iv, a wrong version and junk", async () => {
		const { key } = await keyPair();
		const sealed = JSON.parse(
			await sealRelayEnvelope(key, "request", { a: 1 }),
		);
		const data = fromBase64(sealed.data) as Uint8Array;
		data[0] = (data[0] ?? 0) ^ 1;
		const tampered = JSON.stringify({ ...sealed, data: toBase64(data) });
		expect(await refusal(openRelayEnvelope(key, "request", tampered))).toBe(
			"sealed",
		);
		const shortIv = JSON.stringify({
			...sealed,
			iv: toBase64(new Uint8Array(8)),
		});
		expect(await refusal(openRelayEnvelope(key, "request", shortIv))).toBe(
			"sealed",
		);
		const version = JSON.stringify({ ...sealed, v: 2 });
		expect(await refusal(openRelayEnvelope(key, "request", version))).toBe(
			"sealed",
		);
		expect(await refusal(openRelayEnvelope(key, "request", "{"))).toBe(
			"sealed",
		);
		expect(await refusal(openRelayEnvelope(key, "request", "[]"))).toBe(
			"sealed",
		);
	});

	it("never carry the token or the proof in clear text (security)", async () => {
		const { key } = await keyPair();
		const sealed = await sealRelayRequest(key, meRequest());
		expect(sealed).not.toContain(TOKEN);
		expect(sealed).not.toContain(PROOF);
		expect(sealed).not.toContain("access_token");
	});
});

describe("which calls the relay carries", () => {
	const get = (headers: Record<string, string>): ZaloRequestInit => ({
		method: "GET",
		headers,
	});

	it("carries the two Graph paths with their own headers", () => {
		expect(
			graphCallOf(
				"https://graph.zalo.me/v2.0/me?fields=id,name",
				get({ access_token: TOKEN, appsecret_proof: PROOF }),
			),
		).toEqual({
			path: "/v2.0/me",
			query: "fields=id,name",
			headers: { access_token: TOKEN, appsecret_proof: PROOF },
		});
		expect(
			graphCallOf(
				"https://graph.zalo.me/v2.0/me/info",
				get({ access_token: TOKEN, code: "phone", secret_key: "s" }),
			),
		).toEqual({
			path: "/v2.0/me/info",
			query: "",
			headers: { access_token: TOKEN, code: "phone", secret_key: "s" },
		});
	});

	it("leaves everything else to the network: other hosts, http, other paths, other methods, bodies", () => {
		const headers = { access_token: TOKEN };
		expect(graphCallOf("https://example.com/v2.0/me", get(headers))).toBeNull();
		expect(
			graphCallOf("http://graph.zalo.me/v2.0/me", get(headers)),
		).toBeNull();
		expect(
			graphCallOf("https://graph.zalo.me.evil.example/v2.0/me", get(headers)),
		).toBeNull();
		expect(
			graphCallOf("https://graph.zalo.me/v2.0/oa/message", get(headers)),
		).toBeNull();
		expect(
			graphCallOf("https://graph.zalo.me/v2.0/me/../oa/message", get(headers)),
		).toBeNull();
		expect(
			graphCallOf(`https://user:pw${"@"}graph.zalo.me/v2.0/me`, get(headers)),
		).toBeNull();
		expect(
			graphCallOf("https://graph.zalo.me/v2.0/me", { method: "POST", headers }),
		).toBeNull();
		expect(
			graphCallOf("https://graph.zalo.me/v2.0/me", {
				method: "GET",
				headers,
				body: "x",
			}),
		).toBeNull();
		expect(graphCallOf("not a url", get(headers))).toBeNull();
	});

	it("refuses unknown headers, unsafe values and odd queries", () => {
		expect(
			graphCallOf(
				"https://graph.zalo.me/v2.0/me",
				get({ access_token: TOKEN, authorization: "x" }),
			),
		).toBeNull();
		expect(
			graphCallOf(
				"https://graph.zalo.me/v2.0/me",
				get({ access_token: TOKEN, secret_key: "s" }),
			),
		).toBeNull();
		expect(
			graphCallOf(
				"https://graph.zalo.me/v2.0/me",
				get({ access_token: "a\r\nX-Evil: 1" }),
			),
		).toBeNull();
		expect(
			graphCallOf(
				"https://graph.zalo.me/v2.0/me",
				get({ appsecret_proof: PROOF }),
			),
		).toBeNull();
		expect(
			graphCallOf(
				"https://graph.zalo.me/v2.0/me?fields=id&x=1",
				get({ access_token: TOKEN }),
			),
		).toBeNull();
		expect(
			graphCallOf(
				"https://graph.zalo.me/v2.0/me?fields=%69d",
				get({ access_token: TOKEN }),
			),
		).toBeNull();
	});
});

describe("relay requests", () => {
	it("accept a fresh, allowed request and refuse each broken part", () => {
		expect(validateRelayRequest(meRequest(), NOW).path).toBe("/v2.0/me");
		const code = (value: unknown): string => {
			try {
				validateRelayRequest(value, NOW);
				return "none";
			} catch (error) {
				return error instanceof RelayError ? error.code : "other";
			}
		};
		expect(code(null)).toBe("invalid");
		expect(code({ ...meRequest(), id: "ID" })).toBe("invalid");
		expect(code({ ...meRequest(), at: "now" })).toBe("invalid");
		expect(code({ ...meRequest(), path: "/v2.0/oa/message" })).toBe(
			"not_allowed",
		);
		expect(code({ ...meRequest(), query: "fields=id&x=1" })).toBe(
			"not_allowed",
		);
		expect(
			code({ ...meRequest(), headers: { access_token: TOKEN, cookie: "x" } }),
		).toBe("not_allowed");
		expect(code({ ...meRequest(), headers: { access_token: "" } })).toBe(
			"invalid",
		);
		expect(code({ ...meRequest(), headers: { appsecret_proof: PROOF } })).toBe(
			"invalid",
		);
		expect(
			code({ ...meRequest(), headers: { access_token: "x".repeat(4097) } }),
		).toBe("invalid");
	});

	it("are fresh up to one minute either way and stale beyond (boundaries)", () => {
		expect(() =>
			validateRelayRequest(meRequest({ at: NOW - RELAY_MAX_SKEW_MS }), NOW),
		).not.toThrow();
		expect(() =>
			validateRelayRequest(meRequest({ at: NOW + RELAY_MAX_SKEW_MS }), NOW),
		).not.toThrow();
		expect(() =>
			validateRelayRequest(meRequest({ at: NOW - RELAY_MAX_SKEW_MS - 1 }), NOW),
		).toThrow(/older or newer/);
		expect(() =>
			validateRelayRequest(meRequest({ at: NOW + RELAY_MAX_SKEW_MS + 1 }), NOW),
		).toThrow(/older or newer/);
	});

	it("are relayed once: the same id again is a replay, until the guard forgets it", async () => {
		const { key } = await keyPair();
		const guard = new ReplayGuard();
		const sealed = await sealRelayRequest(key, meRequest());
		await expect(
			openRelayRequest(key, sealed, NOW, guard),
		).resolves.toMatchObject({ id: ID });
		expect(
			await refusal(openRelayRequest(key, sealed, NOW + 1000, guard)),
		).toBe("replayed");
		expect(guard.admit("another", NOW + RELAY_MAX_SKEW_MS * 2 + 1)).toBe(true);
		expect(guard.size).toBe(1);
	});

	it("answers are bound to their request", async () => {
		const { key } = await keyPair();
		const sealed = await sealRelayAnswer(key, ID, {
			status: 200,
			body: '{"error":0}',
		});
		await expect(openRelayAnswer(key, ID, sealed)).resolves.toEqual({
			status: 200,
			body: '{"error":0}',
		});
		expect(
			await refusal(
				openRelayAnswer(key, "bbbbbbbb-1111-4111-8111-111111111111", sealed),
			),
		).toBe("sealed");
		const odd = await sealRelayAnswer(key, ID, { status: 99, body: "" });
		expect(await refusal(openRelayAnswer(key, ID, odd))).toBe("invalid");
	});
});

describe("relay addresses", () => {
	it("accept an https origin on a DNS name and nothing else", () => {
		expect(
			relayUrlProblem("https://quiet-river-1234.trycloudflare.com"),
		).toBeNull();
		expect(relayUrlProblem("https://relay.example.vn")).toBeNull();
		for (const bad of [
			"http://relay.example.com",
			"https://127.0.0.1",
			"https://localhost",
			"https://relay.example.com:8443",
			"https://relay.example.com/relay",
			"https://relay.example.com?x=1",
			"https://user@example.com",
			"https://Relay.Example.com",
			"https://relay.example.com.",
			"https://-relay.example.com",
			"https://relay.example.123",
			`https://${"a".repeat(190)}.example.com`,
		]) {
			expect(relayUrlProblem(bad), bad).not.toBeNull();
		}
	});

	it("announcements open only fresh, with an acceptable address (boundaries at two minutes)", async () => {
		const { key, other } = await keyPair();
		const url = "https://quiet-river-1234.trycloudflare.com";
		const fresh = await sealAnnouncement(key, {
			url,
			at: NOW - RELAY_ANNOUNCE_MAX_SKEW_MS,
		});
		await expect(openAnnouncement(key, fresh, NOW)).resolves.toEqual({
			url,
			at: NOW - RELAY_ANNOUNCE_MAX_SKEW_MS,
		});
		const stale = await sealAnnouncement(key, {
			url,
			at: NOW - RELAY_ANNOUNCE_MAX_SKEW_MS - 1,
		});
		expect(await refusal(openAnnouncement(key, stale, NOW))).toBe("stale");
		const bad = await sealAnnouncement(key, {
			url: "https://127.0.0.1",
			at: NOW,
		});
		expect(await refusal(openAnnouncement(key, bad, NOW))).toBe("invalid");
		expect(await refusal(openAnnouncement(other, fresh, NOW))).toBe("sealed");
		const request = await sealRelayRequest(key, meRequest());
		expect(await refusal(openAnnouncement(key, request, NOW))).toBe("sealed");
	});
});

describe("relayFetch", () => {
	interface Sent {
		readonly url: string;
		readonly init: ZaloRequestInit;
	}

	async function setup(relayAddress: string | null) {
		const { key } = await keyPair();
		const sent: Sent[] = [];
		let answerFor: (request: RelayRequest) => Promise<Response> = async () =>
			new Response("{}");
		const send = async (
			url: string,
			init: ZaloRequestInit,
		): Promise<Response> => {
			sent.push({ url, init });
			if (url.endsWith("/relay")) {
				const request = await openRelayRequest(
					key,
					init.body ?? "",
					NOW,
					new ReplayGuard(),
				);
				return answerFor(request);
			}
			return new Response('{"direct":true}', { status: 200 });
		};
		const fetcher = relayFetch({
			key,
			fetch: send,
			relayUrl: async () => relayAddress,
			now: () => NOW,
			newId: () => ID,
		});
		return {
			key,
			sent,
			fetcher,
			answer: (make: (request: RelayRequest) => Promise<Response>) => {
				answerFor = make;
			},
		};
	}

	const meInit: ZaloRequestInit = {
		method: "GET",
		headers: { access_token: TOKEN, appsecret_proof: PROOF },
	};

	it("sends a Graph call through the relay, sealed, and gives back the Graph answer", async () => {
		const { key, sent, fetcher, answer } = await setup(
			"https://quiet-river-1234.trycloudflare.com",
		);
		answer(async (request) => {
			expect(request).toMatchObject({
				path: "/v2.0/me",
				query: "fields=id",
				headers: { access_token: TOKEN },
			});
			return new Response(
				await sealRelayAnswer(key, request.id, {
					status: 200,
					body: '{"error":0,"id":"z1"}',
				}),
			);
		});
		const response = await fetcher(
			"https://graph.zalo.me/v2.0/me?fields=id",
			meInit,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ error: 0, id: "z1" });
		expect(sent).toHaveLength(1);
		expect(sent[0]?.url).toBe(
			"https://quiet-river-1234.trycloudflare.com/relay",
		);
		expect(sent[0]?.init.method).toBe("POST");
		expect(sent[0]?.init.body).not.toContain(TOKEN);
		expect(JSON.stringify(sent[0]?.init.headers)).not.toContain(TOKEN);
	});

	it("calls the Graph directly while no relay is announced, and passes other calls through untouched", async () => {
		const { sent, fetcher } = await setup(null);
		await fetcher("https://graph.zalo.me/v2.0/me?fields=id", meInit);
		expect(sent[0]?.url).toBe("https://graph.zalo.me/v2.0/me?fields=id");
		const relayed = await setup("https://quiet-river-1234.trycloudflare.com");
		await relayed.fetcher("https://example.supabase.co/rest/v1/rpc/x", {
			method: "POST",
			headers: {},
			body: "{}",
		});
		expect(relayed.sent[0]?.url).toBe(
			"https://example.supabase.co/rest/v1/rpc/x",
		);
	});

	it("turns a refusing relay, a forged answer or an answer to another request into an upstream failure", async () => {
		const { key, fetcher, answer } = await setup(
			"https://quiet-river-1234.trycloudflare.com",
		);
		answer(async () => new Response('{"error":"sealed"}', { status: 401 }));
		await expect(
			fetcher("https://graph.zalo.me/v2.0/me", meInit),
		).rejects.toBeInstanceOf(UpstreamError);
		answer(
			async () => new Response('{"status":200,"body":"{}"}', { status: 200 }),
		);
		await expect(
			fetcher("https://graph.zalo.me/v2.0/me", meInit),
		).rejects.toMatchObject({ failure: "invalid_answer" });
		answer(
			async () =>
				new Response(
					await sealRelayAnswer(key, "bbbbbbbb-1111-4111-8111-111111111111", {
						status: 200,
						body: '{"error":0}',
					}),
				),
		);
		await expect(
			fetcher("https://graph.zalo.me/v2.0/me", meInit),
		).rejects.toMatchObject({ failure: "invalid_answer" });
	});
});
