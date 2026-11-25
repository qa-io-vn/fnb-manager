// node --test scripts/zalo-sign-in-check.test.mjs: the real sign-in check (G-109), run against a fake network.
// Test design (ISTQB): equivalence partitions of the answers (the token refused by Zalo; accepted by Zalo but refused
// by the cloud, the wrong App secret; an unknown brand; a missing secret; signed in with a full home, with an empty
// one, with a failed home), the arguments (a token on the command line refused, a missing file, a bad brand, a wrong
// cloud address) and a security case: no token, session, Zalo user id or name ever reaches the output.
import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "./zalo-sign-in-check.mjs";

const TOKEN = "synthetic-zalo-user-token-0123456789";
const SESSION = "synthetic-session-access-token";
const REFRESH = "synthetic-session-refresh-token";
const ZALO_ID = "8800000000000000042";
const NAME = "Khách Thử Nghiệm";
const ENV = {
	SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
	SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
};
const FULL_HOME = {
	programme: { name: "Chương trình thử" },
	stores: [{ code: "s1", name: "Cửa hàng thử", address: "1 Đường Thử" }],
	legal: {
		entity_name: "Quán thử",
		policy_version: "privacy-1",
		documents: [{ kind: "privacy_notice" }, { kind: "mini_app_terms" }],
	},
	menu: [],
	oa_id: null,
};

function json(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function network({ zalo = 0, session, home }) {
	const calls = [];
	const fetch = async (input, init = {}) => {
		const url = String(input);
		calls.push({ url, init });
		if (url.startsWith("https://graph.zalo.me/"))
			return json(
				zalo === 0
					? { error: 0, message: "Success", id: ZALO_ID }
					: { error: zalo, message: "refused" },
			);
		if (url.endsWith("/functions/v1/zalo-session")) return session();
		if (url.endsWith("/rest/v1/rpc/customer_home")) return home();
		throw new Error(`unexpected call ${url}`);
	};
	return { fetch, calls };
}

const signedIn = () =>
	json({
		status: "customer",
		access_token: SESSION,
		refresh_token: REFRESH,
		expires_at: 2_000_000_000,
		customer: { tenant_id: "t", customer_id: null, display_name: NAME },
	});

async function run(argv, env, net, file = `${TOKEN}\n`) {
	const out = [];
	const err = [];
	const code = await main(argv, env, {
		fetch: net.fetch,
		readFile: () => file,
		log: (line) => out.push(line),
		error: (line) => err.push(line),
	});
	return { code, out, err, text: [...out, ...err].join("\n") };
}

function assertNothingPersonal(text) {
	for (const value of [TOKEN, SESSION, REFRESH, ZALO_ID, NAME])
		assert.ok(
			!text.includes(value),
			`the output carries ${value.slice(0, 12)}`,
		);
}

test("a token Zalo accepts and the cloud refuses names both causes, -501 (no relay) and 453 (wrong App secret), and exits 1", async () => {
	const net = network({
		session: () => json({ error: "zalo_token_refused", request_id: "r" }, 401),
	});
	const { code, out, text } = await run(
		["--token-file", "token.txt"],
		ENV,
		net,
	);
	assert.equal(code, 1);
	assert.equal(out[0], "zalo token: valid");
	assert.equal(out[1], "sign-in: 401 zalo_token_refused");
	assert.match(out[2], /-501 means Zalo refused the cloud server/);
	assert.match(out[2], /pnpm zalo:relay/);
	assert.match(out[2], /453 means the App secret stored for the brand/);
	// the home is never asked for without a session
	assert.equal(
		net.calls.some((call) => call.url.endsWith("customer_home")),
		false,
	);
	assertNothingPersonal(text);
});

test("a relay the cloud cannot reach (502 zalo_unavailable) says to check the relay, and exits 1", async () => {
	const net = network({
		session: () => json({ error: "zalo_unavailable", request_id: "r" }, 502),
	});
	const { code, out, text } = await run(["--token-file", "t"], ENV, net);
	assert.equal(code, 1);
	assert.equal(out[1], "sign-in: 502 zalo_unavailable");
	assert.match(out.at(-1), /pnpm zalo:relay is running/);
	assertNothingPersonal(text);
});

test("a token Zalo refuses asks for a fresh one and says nothing about the secret", async () => {
	const net = network({
		zalo: 452,
		session: () => json({ error: "zalo_token_refused", request_id: "r" }, 401),
	});
	const { code, out } = await run(["--token-file", "t"], ENV, net);
	assert.equal(code, 1);
	assert.equal(out[0], "zalo token: refused (error 452)");
	assert.match(out.at(-1), /get a fresh User Access Token/);
	assert.ok(!out.join("\n").includes("App secret"));
});

test("an unknown brand and a missing secret each get their own diagnosis", async () => {
	const unknown = await run(
		["--token-file", "t", "--brand", "brand-7"],
		ENV,
		network({
			session: () => json({ error: "unknown_brand", request_id: "r" }, 404),
		}),
	);
	assert.match(unknown.out.at(-1), /no Zalo App for this brand key/);
	const missing = await run(
		["--token-file", "t"],
		ENV,
		network({
			session: () => json({ error: "not_configured", request_id: "r" }, 500),
		}),
	);
	assert.match(
		missing.out.at(-1),
		/App secret named by the zalo_apps row is missing/,
	);
});

test("a sign-in and a full home exit 0 with counts only, and the session is sent as the bearer", async () => {
	const net = network({ session: signedIn, home: () => json(FULL_HOME) });
	const { code, out, text } = await run(["--token-file", "t"], ENV, net);
	assert.equal(code, 0);
	assert.deepEqual(out, [
		"zalo token: valid",
		"sign-in: 200 (visitor)",
		"home: 200 programme open, 1 stores, privacy notice published, 2 documents, 0 menu items",
		"Signed in and the home answered.",
	]);
	const homeCall = net.calls.find((call) => call.url.endsWith("customer_home"));
	assert.equal(homeCall.init.headers.authorization, `Bearer ${SESSION}`);
	// the token goes to Zalo and the cloud only, in headers or the body, never in an address
	for (const call of net.calls) assert.ok(!call.url.includes(TOKEN));
	assertNothingPersonal(text);
	for (const shopText of ["Cửa hàng thử", "1 Đường Thử", "Quán thử"])
		assert.ok(!text.includes(shopText));
});

test("an empty home names what is missing: the programme, the stores and the privacy notice", async () => {
	const { code, out } = await run(
		["--token-file", "t"],
		ENV,
		network({
			session: signedIn,
			home: () =>
				json({
					programme: null,
					stores: [],
					legal: { policy_version: null, documents: [] },
					menu: [],
				}),
		}),
	);
	assert.equal(code, 0);
	assert.match(out.join("\n"), /No loyalty programme is open/);
	assert.match(out.join("\n"), /No store is listed/);
	assert.match(out.join("\n"), /No privacy notice is published/);
});

test("a home that fails after the sign-in exits 1 with its status and code", async () => {
	const { code, out } = await run(
		["--token-file", "t"],
		ENV,
		network({
			session: signedIn,
			home: () => json({ code: "42501", message: "denied" }, 403),
		}),
	);
	assert.equal(code, 1);
	assert.equal(out.at(-1), "Signed in, but the home failed: 403 42501.");
});

test("the arguments: a token on the command line, no token file, a bad brand, a wrong cloud address or key, an empty file", async () => {
	const net = network({ session: signedIn, home: () => json(FULL_HOME) });
	const onLine = await run(["--token", TOKEN], ENV, net);
	assert.equal(onLine.code, 2);
	assert.match(onLine.err[0], /never on the command line/);
	assert.ok(!onLine.text.includes(TOKEN));
	assert.equal((await run([], ENV, net)).code, 2);
	assert.equal(
		(await run(["--token-file", "t", "--brand", "Brand 1"], ENV, net)).code,
		2,
	);
	assert.equal(
		(
			await run(
				["--token-file", "t"],
				{
					...ENV,
					SUPABASE_URL: "http://127.0.0.1:54321",
				},
				net,
			)
		).code,
		2,
	);
	assert.equal(
		(
			await run(
				["--token-file", "t"],
				{
					...ENV,
					SUPABASE_PUBLISHABLE_KEY: "sb_secret_x",
				},
				net,
			)
		).code,
		2,
	);
	assert.equal((await run(["--token-file", "t"], ENV, net, "  \n")).code, 2);
	assert.equal(net.calls.length, 0, "nothing was called for a usage error");
});
