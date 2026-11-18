import { describe, expect, it } from "vitest";
import { fetchZaloUser } from "../../src/graph.js";
import {
	readJson,
	timedFetch,
	UpstreamError,
	ZALO_HTTP_TIMEOUT_MS,
	type ZaloFetch,
	type ZaloRequestInit,
} from "../../src/http.js";

const SECRET = "synthetic-app-secret-value";
const TOKEN = "synthetic-access-token-value";

function recorder(answer: () => Promise<Response>) {
	const calls: { url: string; init: ZaloRequestInit }[] = [];
	const send: ZaloFetch = (url, init) => {
		calls.push({ url, init });
		return answer();
	};
	return { send, calls };
}

describe("timed HTTP client", () => {
	it("gives up after the timeout and aborts the request", async () => {
		const { send, calls } = recorder(
			() => new Promise<Response>(() => undefined),
		);
		const started = Date.now();
		const error = await timedFetch(
			"https://graph.example.test/v2.0/me",
			{ method: "GET", headers: {} },
			{ service: "zalo", fetch: send, timeoutMs: 25 },
		).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(UpstreamError);
		expect((error as UpstreamError).failure).toBe("timeout");
		expect(Date.now() - started).toBeLessThan(2000);
		expect(calls[0]?.init.signal?.aborted).toBe(true);
	});

	it("waits ten seconds by default", () => {
		expect(ZALO_HTTP_TIMEOUT_MS).toBe(10_000);
	});

	it("sends the request to an overridden base URL", async () => {
		const { send, calls } = recorder(async () =>
			Response.json({ id: "123456789", name: "Synthetic", error: 0 }),
		);
		const outcome = await fetchZaloUser(
			{ baseUrl: "http://127.0.0.1:8788/", fetch: send },
			TOKEN,
			SECRET,
		);
		expect(outcome).toEqual({
			ok: true,
			value: { id: "123456789", name: "Synthetic" },
		});
		expect(calls.map((call) => call.url)).toEqual([
			"http://127.0.0.1:8788/v2.0/me?fields=id,name",
		]);
		expect(Object.keys(calls[0]?.init.headers ?? {}).sort()).toEqual([
			"access_token",
			"appsecret_proof",
		]);
	});

	it("names no secret, token or address in its errors", async () => {
		const failures: ZaloFetch[] = [
			async () => {
				throw new Error(`connect failed for ${TOKEN} with ${SECRET}`);
			},
			async () => new Response(`<html>${TOKEN}</html>`, { status: 502 }),
			async () => new Response(`{"leak": "${SECRET}"`, { status: 200 }),
		];
		for (const send of failures) {
			const error = await fetchZaloUser(
				{ baseUrl: "http://127.0.0.1:8788", fetch: send },
				TOKEN,
				SECRET,
			).catch((caught: unknown) => caught);
			expect(error).toBeInstanceOf(UpstreamError);
			const text = `${String(error)} ${(error as Error).stack ?? ""}`;
			expect(text).not.toContain(TOKEN);
			expect(text).not.toContain(SECRET);
			expect(text).not.toContain("127.0.0.1");
		}
	});

	it("reads an empty body as null and refuses broken JSON", async () => {
		expect(await readJson(new Response(""), "supabase")).toBeNull();
		await expect(readJson(new Response("{"), "supabase")).rejects.toMatchObject(
			{
				failure: "invalid_answer",
			},
		);
	});
});
