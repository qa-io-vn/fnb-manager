import { afterEach, describe, expect, it } from "vitest";
import {
	importRelayKey,
	newRelayKey,
	openAnnouncement,
	openRelayAnswer,
	RELAY_MAX_ENVELOPE_BYTES,
	sealRelayRequest,
} from "../../src/index.js";
import {
	announce,
	cloudTarget,
	keyFilePath,
	parseRelayArguments,
	RELAY_DEFAULT_PORT,
	RelayUsageError,
} from "../../src/relay-node/cli.js";
import {
	type RunningRelay,
	startRelayServer,
} from "../../src/relay-node/server.js";

const NOW = Date.parse("2026-11-25T04:00:00Z");
const TOKEN = "synthetic-access-token-0002";
const PROOF = "b".repeat(64);
const SECRET = "synthetic-app-secret";

interface GraphCall {
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
}

const running: RunningRelay[] = [];

afterEach(async () => {
	await Promise.all(running.splice(0).map((relay) => relay.close()));
});

async function relayWith(graphAnswer: () => Promise<Response>) {
	const key = await importRelayKey(newRelayKey());
	const calls: GraphCall[] = [];
	const logs: string[] = [];
	const relay = await startRelayServer({
		key,
		port: 0,
		now: () => NOW,
		log: (line) => logs.push(line),
		graph: async (url, init) => {
			calls.push({ url, headers: init.headers });
			return graphAnswer();
		},
	});
	running.push(relay);
	const post = (body: string, path = "/relay", method = "POST") =>
		fetch(`http://127.0.0.1:${relay.port}${path}`, {
			method,
			headers: { "content-type": "application/json" },
			...(method === "POST" ? { body } : {}),
		});
	return { key, calls, logs, post };
}

function request(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		at: NOW,
		path: "/v2.0/me",
		query: "fields=id",
		headers: { access_token: TOKEN, appsecret_proof: PROOF },
		...overrides,
	} as Parameters<typeof sealRelayRequest>[1];
}

describe("the relay server", () => {
	it("forwards a sealed request to the Graph and answers it sealed, logging no secret (security)", async () => {
		const { key, calls, logs, post } = await relayWith(
			async () => new Response('{"error":0,"id":"z9"}', { status: 200 }),
		);
		const id = "11111111-2222-4333-8444-555555555555";
		const response = await post(await sealRelayRequest(key, request(id)));
		expect(response.status).toBe(200);
		const answered = await openRelayAnswer(key, id, await response.text());
		expect(answered).toEqual({ status: 200, body: '{"error":0,"id":"z9"}' });
		expect(calls).toEqual([
			{
				url: "https://graph.zalo.me/v2.0/me?fields=id",
				headers: { access_token: TOKEN, appsecret_proof: PROOF },
			},
		]);
		expect(logs).toEqual([
			expect.stringMatching(/^\/v2\.0\/me: HTTP 200, Zalo error 0, \d+ ms$/),
		]);
		expect(logs.join("\n")).not.toContain(TOKEN);
		expect(logs.join("\n")).not.toContain(PROOF);
	});

	it("passes the phone exchange's App secret only to the Graph, never to its logs (security)", async () => {
		const { key, calls, logs, post } = await relayWith(
			async () =>
				new Response('{"error":0,"data":{"number":"84900000001"}}', {
					status: 200,
				}),
		);
		const id = "11111111-2222-4333-8444-555555555556";
		const phone = request(id, {
			path: "/v2.0/me/info",
			query: "",
			headers: { access_token: TOKEN, code: "phone-token", secret_key: SECRET },
		});
		expect((await post(await sealRelayRequest(key, phone))).status).toBe(200);
		expect(calls[0]?.url).toBe("https://graph.zalo.me/v2.0/me/info");
		expect(logs.join("\n")).not.toContain(SECRET);
		expect(logs.join("\n")).not.toContain("84900000001");
	});

	it("refuses junk, a wrong key, a replay, a stale request and a disallowed path without calling the Graph", async () => {
		const { key, calls, post } = await relayWith(
			async () => new Response("{}"),
		);
		const otherKey = await importRelayKey(newRelayKey());
		const id = "11111111-2222-4333-8444-555555555557";
		expect(await (await post("not json")).json()).toEqual({ error: "sealed" });
		const foreign = await post(await sealRelayRequest(otherKey, request(id)));
		expect([foreign.status, await foreign.json()]).toEqual([
			401,
			{ error: "sealed" },
		]);
		const stale = await post(
			await sealRelayRequest(key, request(id, { at: NOW - 61_000 })),
		);
		expect(await stale.json()).toEqual({ error: "stale" });
		const sealed = await sealRelayRequest(key, request(id));
		expect((await post(sealed)).status).toBe(200);
		const replay = await post(sealed);
		expect([replay.status, await replay.json()]).toEqual([
			401,
			{ error: "replayed" },
		]);
		const oa = await post(
			await sealRelayRequest(
				key,
				request("11111111-2222-4333-8444-555555555558", {
					path: "/v2.0/oa/message",
				}),
			),
		);
		expect(await oa.json()).toEqual({ error: "not_allowed" });
		expect(calls).toHaveLength(1);
	});

	it("answers only POST /relay, and refuses a body over the limit (boundaries)", async () => {
		const { post, calls } = await relayWith(async () => new Response("{}"));
		expect((await post("", "/", "GET")).status).toBe(404);
		expect((await post("", "/relay", "GET")).status).toBe(405);
		expect((await post("{}", "/other")).status).toBe(404);
		const large = await post("x".repeat(RELAY_MAX_ENVELOPE_BYTES + 1));
		expect(large.status).toBe(413);
		expect(calls).toHaveLength(0);
	});

	it("reports an unreachable Graph as 502 without details", async () => {
		const { key, post } = await relayWith(async () => {
			throw new Error("connect ECONNREFUSED with secret details");
		});
		const response = await post(
			await sealRelayRequest(
				key,
				request("11111111-2222-4333-8444-555555555559"),
			),
		);
		expect([response.status, await response.json()]).toEqual([
			502,
			{ error: "graph_unreachable" },
		]);
	});
});

describe("the relay command line", () => {
	it("parses its arguments and refuses anything else", () => {
		expect(parseRelayArguments([])).toEqual({
			port: RELAY_DEFAULT_PORT,
			keyFile: null,
			tunnel: true,
			createKey: false,
		});
		expect(
			parseRelayArguments([
				"--port",
				"8800",
				"--no-tunnel",
				"--key-file",
				"k.key",
			]),
		).toEqual({
			port: 8800,
			keyFile: "k.key",
			tunnel: false,
			createKey: false,
		});
		expect(() => parseRelayArguments(["--port", "80"])).toThrow(
			RelayUsageError,
		);
		expect(() => parseRelayArguments(["--port", "65536"])).toThrow(
			RelayUsageError,
		);
		expect(() => parseRelayArguments(["--key-file"])).toThrow(RelayUsageError);
		expect(() => parseRelayArguments(["--key", "abc"])).toThrow(
			RelayUsageError,
		);
	});

	it("keeps the key file under LOCALAPPDATA unless told otherwise", () => {
		expect(
			keyFilePath(parseRelayArguments([]), {
				LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local",
			}),
		).toMatch(/fnb-zalo-relay[\\/]relay\.key$/);
		expect(() => keyFilePath(parseRelayArguments([]), {})).toThrow(
			RelayUsageError,
		);
	});

	it("announces only to a cloud project address with a publishable key", () => {
		const url = "https://abcdefghijklmnopqrst.supabase.co";
		const publishableKey = "sb_publishable_syntheticKey123";
		expect(
			cloudTarget({
				SUPABASE_URL: url,
				SUPABASE_PUBLISHABLE_KEY: publishableKey,
			}),
		).toEqual({ url, publishableKey });
		expect(() =>
			cloudTarget({
				SUPABASE_URL: "http://127.0.0.1:54321",
				SUPABASE_PUBLISHABLE_KEY: publishableKey,
			}),
		).toThrow(RelayUsageError);
		expect(() =>
			cloudTarget({
				SUPABASE_URL: url,
				SUPABASE_PUBLISHABLE_KEY: "sb_secret_x",
			}),
		).toThrow(RelayUsageError);
	});

	it("sends a sealed announcement the function can open, and reports refusals without the address", async () => {
		const key = await importRelayKey(newRelayKey());
		const target = {
			url: "https://abcdefghijklmnopqrst.supabase.co",
			publishableKey: "sb_publishable_syntheticKey123",
		};
		const relayUrl = "https://quiet-river-1234.trycloudflare.com";
		let sentBody = "";
		let sentUrl = "";
		const ok = await announce(key, target, relayUrl, {
			now: () => NOW,
			fetch: async (url, init) => {
				sentUrl = url;
				sentBody = init.body;
				return new Response('{"status":"relay_announced"}', { status: 200 });
			},
		});
		expect(ok).toEqual({ ok: true, line: "announced to the cloud" });
		expect(sentUrl).toBe(`${target.url}/functions/v1/zalo-session`);
		expect(sentBody).not.toContain(relayUrl);
		const relay = (JSON.parse(sentBody) as { relay: string }).relay;
		await expect(openAnnouncement(key, relay, NOW)).resolves.toEqual({
			url: relayUrl,
			at: NOW,
		});
		const refused = await announce(key, target, relayUrl, {
			fetch: async () =>
				new Response('{"error":"relay_refused"}', { status: 401 }),
		});
		expect(refused).toEqual({
			ok: false,
			line: "not announced: HTTP 401 relay_refused",
		});
		expect(refused.line).not.toContain(relayUrl);
		const badAddress = await announce(key, target, "https://127.0.0.1");
		expect(badAddress.ok).toBe(false);
	});
});
