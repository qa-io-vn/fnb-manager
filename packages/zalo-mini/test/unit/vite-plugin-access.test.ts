import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfigEnv, UserConfig, ViteDevServer } from "vite";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
	accessDecision,
	guardUpgrades,
	type LocalAccess,
	localAccessGuard,
	localServerOptions,
	miniApp,
	miniAppSettings,
} from "../../src/vite/index";

const KEY = "k".repeat(43);
const NEXT_KEY = "n".repeat(43);
const LAN: LocalAccess = { key: KEY, tunnelHost: null };
const TUNNEL_HOST = "sample-words-here.trycloudflare.com";
const TUNNEL: LocalAccess = { key: KEY, tunnelHost: TUNNEL_HOST };
const PHONE = "192.168.1.30";
const OUTSIDE = "203.0.113.9";
const LOOPBACKS = ["127.0.0.1", "::1", "::ffff:127.0.0.1"] as const;
const FORWARDING: readonly IncomingHttpHeaders[] = [
	{ "cf-connecting-ip": OUTSIDE },
	{ "x-forwarded-for": OUTSIDE },
	{ "x-forwarded-host": TUNNEL_HOST, "x-forwarded-proto": "https" },
	{ forwarded: `for=${OUTSIDE};proto=https` },
	{
		"cf-connecting-ip": OUTSIDE,
		"cf-ray": "0000000000000000-AMS",
		"x-forwarded-for": OUTSIDE,
		"x-forwarded-proto": "https",
	},
];

const appRoot = mkdtempSync(join(tmpdir(), "fnb-mini-access-"));
afterAll(() => rmSync(appRoot, { recursive: true, force: true }));
afterEach(() => {
	vi.unstubAllEnvs();
});

function request(
	remoteAddress: string,
	url: string,
	headers: IncomingHttpHeaders = {},
	method = "GET",
): IncomingMessage {
	return {
		method,
		url,
		headers,
		socket: { remoteAddress },
	} as unknown as IncomingMessage;
}

interface Answer {
	readonly passed: boolean;
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: string;
}

function serve(access: LocalAccess, incoming: IncomingMessage): Answer {
	let passed = false;
	let status = 0;
	let headers: Record<string, string> = {};
	let body = "";
	const response = {
		writeHead(code: number, values: Record<string, string>) {
			status = code;
			headers = values;
			return response;
		},
		end(chunk?: string) {
			body = chunk ?? "";
			return response;
		},
	};
	localAccessGuard(access)(incoming, response as never, () => {
		passed = true;
	});
	return { passed, status, headers, body };
}

function refused(answer: Answer): void {
	expect(answer.passed).toBe(false);
	expect(answer.status).toBe(403);
	expect(answer.headers["set-cookie"]).toBeUndefined();
	expect(answer.headers["cache-control"]).toBe("no-store");
}

function cookieOf(answer: Answer): string {
	return (answer.headers["set-cookie"] ?? "").split(";")[0] ?? "";
}

interface Upgrade {
	readonly reached: boolean;
	readonly written: string;
}

function upgrade(access: LocalAccess, incoming: IncomingMessage): Upgrade {
	const server = new EventEmitter();
	let reached = false;
	server.on("upgrade", () => {
		reached = true;
	});
	guardUpgrades(server, access);
	let written = "";
	const socket = {
		on: () => socket,
		end: (chunk: string) => {
			written = chunk;
		},
	};
	server.emit("upgrade", incoming, socket, Buffer.alloc(0));
	return { reached, written };
}

describe("the access guard of the local dev server", () => {
	it("refuses a wrong key from the network, in the address or in a cookie", () => {
		refused(serve(LAN, request(PHONE, `/?key=${NEXT_KEY}`)));
		refused(serve(LAN, request(PHONE, "/?key=")));
		refused(serve(LAN, request(PHONE, `/?key=${KEY.slice(1)}`)));
		refused(
			serve(
				LAN,
				request(PHONE, "/", { cookie: `fnb_local_access=${NEXT_KEY}` }),
			),
		);
		refused(serve(LAN, request(PHONE, "/", { cookie: `other_cookie=${KEY}` })));
		expect(upgrade(LAN, request(PHONE, "/?token=vite")).reached).toBe(false);
	});

	it("answers every request without a key from the network with a plain 403 page", () => {
		for (const [url, method] of [
			["/", "GET"],
			["/src/main.tsx", "GET"],
			["/@vite/client", "GET"],
			["/@fs/C:/Windows/win.ini", "GET"],
			["/functions/v1/zalo-session", "POST"],
			["/supabase/rest/v1/stores", "GET"],
			["/supabase/auth/v1/user", "GET"],
			["//", "GET"],
		] as const) {
			const answer = serve(LAN, request(PHONE, url, {}, method));
			refused(answer);
			expect(answer.headers["content-type"]).toBe("text/html; charset=utf-8");
			expect(answer.body).toContain("403 Forbidden");
			expect(answer.body).not.toContain(KEY);
		}
		const head = serve(LAN, request(PHONE, "/", {}, "HEAD"));
		refused(head);
		expect(head.body).toBe("");
		const socket = upgrade(LAN, request(PHONE, "/?token=vite"));
		expect(socket.reached).toBe(false);
		expect(socket.written).toMatch(/^HTTP\/1\.1 403 Forbidden\r\n/);
	});

	it("admits the printed key once with an HttpOnly, SameSite=Strict cookie and drops it from the address", () => {
		const admitted = serve(LAN, request(PHONE, `/?lang=en&key=${KEY}`));
		expect(admitted.passed).toBe(false);
		expect(admitted.status).toBe(200);
		expect(admitted.headers["set-cookie"]).toBe(
			`fnb_local_access=${KEY}; Path=/; HttpOnly; SameSite=Strict`,
		);
		expect(admitted.headers["cache-control"]).toBe("no-store");
		expect(admitted.headers["referrer-policy"]).toBe("no-referrer");
		expect(admitted.body).toContain('location.replace("/?lang=en")');
		expect(admitted.body).not.toContain(KEY);

		const cookie = cookieOf(admitted);
		for (const [url, method] of [
			["/", "GET"],
			["/src/main.tsx", "GET"],
			["/functions/v1/zalo-session", "POST"],
		] as const) {
			expect(
				serve(LAN, request(PHONE, url, { cookie: `a=1; ${cookie}` }, method))
					.passed,
			).toBe(true);
		}
		expect(upgrade(LAN, request(PHONE, "/", { cookie })).reached).toBe(true);
		refused(
			serve(
				LAN,
				request(PHONE, `/functions/v1/zalo-session?key=${KEY}`, {}, "POST"),
			),
		);
		const sneaky = serve(
			LAN,
			request(PHONE, `/.//elsewhere.example/?key=${KEY}`),
		);
		expect(sneaky.body).toContain('location.replace("/elsewhere.example/")');
	});

	it("lets loopback requests through as before, with or without a key", () => {
		for (const address of LOOPBACKS) {
			for (const access of [LAN, { key: null, tunnelHost: null }]) {
				const answer = serve(access, request(address, `/?key=${KEY}`));
				expect(answer.passed).toBe(true);
				expect(answer.status).toBe(0);
				expect(serve(access, request(address, "/src/main.tsx")).passed).toBe(
					true,
				);
				expect(upgrade(access, request(address, "/")).reached).toBe(true);
			}
		}
		refused(
			serve({ key: null, tunnelHost: null }, request(PHONE, `/?key=${KEY}`)),
		);
	});

	it("does not trust a loopback request that carries forwarding headers", () => {
		for (const headers of FORWARDING) {
			refused(serve(LAN, request("127.0.0.1", "/", headers)));
			expect(upgrade(LAN, request("127.0.0.1", "/", headers)).reached).toBe(
				false,
			);
			expect(
				serve(
					LAN,
					request("127.0.0.1", "/", {
						...headers,
						cookie: `fnb_local_access=${KEY}`,
					}),
				).passed,
			).toBe(true);
		}
		refused(
			serve(LAN, request(PHONE, "/", { "x-forwarded-for": "127.0.0.1" })),
		);
	});

	it("refuses the key and the cookie of an earlier start after a restart", () => {
		const first = serve(LAN, request(PHONE, `/?key=${KEY}`));
		const oldCookie = cookieOf(first);
		expect(serve(LAN, request(PHONE, "/", { cookie: oldCookie })).passed).toBe(
			true,
		);
		const restarted: LocalAccess = { key: NEXT_KEY, tunnelHost: null };
		refused(serve(restarted, request(PHONE, `/?key=${KEY}`)));
		refused(serve(restarted, request(PHONE, "/", { cookie: oldCookie })));
		expect(
			upgrade(restarted, request(PHONE, "/", { cookie: oldCookie })).reached,
		).toBe(false);
		const again = serve(restarted, request(PHONE, `/?key=${NEXT_KEY}`));
		expect(again.status).toBe(200);
		expect(cookieOf(again)).toBe(`fnb_local_access=${NEXT_KEY}`);
	});
});

describe("the access guard behind a quick tunnel", () => {
	it("trusts no request without the key, loopback included, with or without forwarding headers", () => {
		for (const address of [...LOOPBACKS, OUTSIDE]) {
			for (const headers of [{}, ...FORWARDING]) {
				refused(serve(TUNNEL, request(address, "/", headers)));
				refused(serve(TUNNEL, request(address, "/src/main.tsx", headers)));
				refused(
					serve(
						TUNNEL,
						request(address, "/functions/v1/zalo-session", headers, "POST"),
					),
				);
				expect(upgrade(TUNNEL, request(address, "/", headers)).reached).toBe(
					false,
				);
			}
		}
		refused(
			serve(
				TUNNEL,
				request("127.0.0.1", "/", { cookie: `fnb_local_access=${KEY}` }),
			),
		);
	});

	it("admits the key with a Secure __Host- cookie and then serves the cookie", () => {
		for (const headers of [{}, ...FORWARDING]) {
			const admitted = serve(
				TUNNEL,
				request("127.0.0.1", `/?key=${KEY}`, headers),
			);
			expect(admitted.status).toBe(200);
			expect(admitted.headers["set-cookie"]).toBe(
				`__Host-fnb_local_access=${KEY}; Path=/; HttpOnly; SameSite=Strict; Secure`,
			);
			expect(admitted.body).toContain('location.replace("/")');
			const cookie = cookieOf(admitted);
			expect(
				serve(TUNNEL, request("127.0.0.1", "/", { ...headers, cookie })).passed,
			).toBe(true);
			expect(
				upgrade(TUNNEL, request("127.0.0.1", "/", { ...headers, cookie }))
					.reached,
			).toBe(true);
		}
		const restarted: LocalAccess = { key: NEXT_KEY, tunnelHost: TUNNEL_HOST };
		refused(
			serve(
				restarted,
				request("127.0.0.1", "/", {
					cookie: `__Host-fnb_local_access=${KEY}`,
					"cf-connecting-ip": OUTSIDE,
				}),
			),
		);
		expect(
			accessDecision(TUNNEL, request("127.0.0.1", `/?key=${KEY}`, {}, "POST"))
				.kind,
		).toBe("deny");
	});
});

describe("the local session's access settings", () => {
	const local = {
		VITE_ZALO_SESSION: "local",
		ZALO_LOCAL_SESSION_URL: "http://127.0.0.1:5745",
		ZALO_LOCAL_ACCESS_TOKEN: "mock-zalo-access-local",
	};

	it("read the key, the tunnel host and the local Supabase API, and name no value in refusals", () => {
		expect(miniAppSettings(local, "serve", appRoot).local).toMatchObject({
			supabaseUrl: null,
			access: { key: null, tunnelHost: null },
		});
		const tunnel = miniAppSettings(
			{
				...local,
				ZALO_LOCAL_ACCESS_KEY: KEY,
				ZALO_LOCAL_TUNNEL_HOST: TUNNEL_HOST,
				ZALO_LOCAL_SUPABASE_URL: "http://127.0.0.1:54321",
			},
			"serve",
			appRoot,
		).local;
		expect(tunnel).toMatchObject({
			supabaseUrl: "http://127.0.0.1:54321",
			access: { key: KEY, tunnelHost: TUNNEL_HOST },
		});
		for (const [name, value, message] of [
			["ZALO_LOCAL_ACCESS_KEY", "short-key", "at least 128 bits"],
			["ZALO_LOCAL_TUNNEL_HOST", "app.example.com", "quick tunnel host"],
			["ZALO_LOCAL_SUPABASE_URL", "https://project.example.com", "loopback"],
		] as const) {
			const run = () =>
				miniAppSettings(
					{ ...local, ZALO_LOCAL_ACCESS_KEY: KEY, [name]: value },
					"serve",
					appRoot,
				);
			expect(run).toThrow(message);
			expect(run).not.toThrow(value);
		}
		expect(() =>
			miniAppSettings(
				{ ...local, ZALO_LOCAL_TUNNEL_HOST: TUNNEL_HOST },
				"serve",
				appRoot,
			),
		).toThrow("needs ZALO_LOCAL_ACCESS_KEY");
	});

	it("allow the tunnel host, turn HMR off behind a tunnel and proxy only REST and Auth of the local Supabase API", () => {
		const base = {
			functionUrl: "http://127.0.0.1:5745",
			accessToken: "mock-zalo-access-local",
			supabaseUrl: "http://127.0.0.1:54321",
		};
		const lan = localServerOptions({ ...base, access: LAN });
		expect(lan).not.toHaveProperty("allowedHosts");
		expect(lan).not.toHaveProperty("hmr");
		expect(Object.keys(lan.proxy).sort()).toEqual([
			"/functions/v1/zalo-session",
			"/supabase/auth/v1/",
			"/supabase/rest/v1/",
		]);
		const rest = lan.proxy["/supabase/rest/v1/"];
		expect(rest?.target).toBe("http://127.0.0.1:54321");
		expect(rest?.rewrite?.("/supabase/rest/v1/stores?select=id")).toBe(
			"/rest/v1/stores?select=id",
		);
		const tunnel = localServerOptions({ ...base, access: TUNNEL });
		expect(tunnel.allowedHosts).toEqual([TUNNEL_HOST]);
		expect(tunnel.hmr).toBe(false);
	});

	it("put the guard in front of every dev server middleware and upgrade in local mode", () => {
		for (const [name, value] of Object.entries({
			...local,
			ZALO_LOCAL_ACCESS_KEY: KEY,
		})) {
			vi.stubEnv(name, value);
		}
		const main = miniApp({ kind: "staff", appRoot }).find(
			(plugin) => plugin.name === "fnb-mini-app",
		);
		const config = main?.config as (
			config: UserConfig,
			env: ConfigEnv,
		) => UserConfig;
		const resolved = config({}, { command: "serve", mode: "development" });
		expect(resolved.server?.proxy).toHaveProperty("/functions/v1/zalo-session");
		const hook = main?.configureServer as {
			readonly order: string;
			readonly handler: (server: ViteDevServer) => (() => void) | undefined;
		};
		expect(hook.order).toBe("pre");
		const used: unknown[] = [];
		const httpServer = new EventEmitter();
		let viteUpgrades = 0;
		httpServer.on("upgrade", () => {
			viteUpgrades += 1;
		});
		const after = hook.handler({
			middlewares: { use: (handler: unknown) => used.push(handler) },
			httpServer,
		} as unknown as ViteDevServer);
		expect(used).toHaveLength(1);
		after?.();
		const socket = { on: () => socket, end: () => undefined };
		httpServer.emit("upgrade", request(PHONE, "/"), socket, Buffer.alloc(0));
		expect(viteUpgrades).toBe(0);
		httpServer.emit(
			"upgrade",
			request(PHONE, "/", { cookie: `fnb_local_access=${KEY}` }),
			socket,
			Buffer.alloc(0),
		);
		expect(viteUpgrades).toBe(1);
	});
});
