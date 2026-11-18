import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import postgres, { type Sql } from "postgres";
import { isRecord } from "../http.js";
import type { MemberRole } from "../session.js";
import type { ZaloEnvironment } from "../settings.js";
import { createMockZalo, startMockZalo } from "../testing/mock-zalo.js";
import { staffAppConfig } from "./app-config.js";
import {
	ensureCloudflared,
	startTunnel,
	tunnelPlatformProblem,
} from "./cloudflared.js";
import {
	brandRows,
	findMember,
	forgetBrand,
	forgetProblems,
	identityOwner,
	issueBindingCode,
	type LoopTarget,
	loadLoopTarget,
	startProblems,
} from "./database.js";
import {
	localStackFrom,
	passthroughEnvironment,
	sessionFunctionEnvironment,
	staffAppEnvironment,
} from "./environment.js";
import {
	ACCESS_KEY_PARAMETER,
	ALL_INTERFACES,
	accessProblem,
	chooseLanHost,
	keyedUrl,
	type LanHost,
	newAccessKey,
} from "./lan.js";
import {
	LocalLoopError,
	type LocalLoopExposure,
	type LocalLoopOptions,
	MEMBER_EMAIL_VARIABLE,
} from "./options.js";
import {
	freePort,
	type ManagedProcess,
	resolveDeno,
	startProcess,
	waitForHttp,
} from "./processes.js";

const START_TIMEOUT_MS = 180_000;
const TUNNEL_REACH_TIMEOUT_MS = 120_000;
const VITE_ADDRESS_LINE = /(Local|Network)\S*:\s.*https?:\/\//;

export interface LocalLoopPaths {
	readonly rootDir: string;
	readonly staffDir: string;
	readonly functionDir: string;
	readonly cacheDir: string;
}

export function localLoopPaths(rootDir: string): LocalLoopPaths {
	const staffDir = join(rootDir, "apps", "zalo-staff");
	return {
		rootDir,
		staffDir,
		functionDir: join(rootDir, "supabase", "functions", "zalo-session"),
		cacheDir: join(staffDir, "node_modules", ".cache", "zalo-local"),
	};
}

export interface LocalLoopIo {
	line(text: string): void;
}

export interface LocalLoopReady {
	readonly appUrl: string;
	readonly exposure: LocalLoopExposure;
	readonly phoneUrl: string | null;
	readonly phoneHint: string | null;
	readonly lan: LanHost | null;
	readonly port: number;
	readonly functionUrl: string;
	readonly graphUrl: string;
	readonly tenant: string;
	readonly brand: string;
	readonly mockUser: string;
	readonly mockName: string;
	readonly role: MemberRole;
	readonly stores: number;
	readonly boundNow: boolean;
}

export interface LocalLoop {
	readonly ready: LocalLoopReady;
	readonly failed: Promise<string>;
	stop(): Promise<void>;
}

interface Profile {
	readonly role: MemberRole;
	readonly stores: number;
}

function connect(databaseUrl: string): Sql {
	return postgres(databaseUrl, {
		max: 1,
		connect_timeout: 10,
		onnotice: () => undefined,
	});
}

async function memberProfile(
	sql: Sql,
	target: LoopTarget,
	userId: string,
	role: MemberRole,
): Promise<Profile> {
	const [row] = await sql<{ stores: number | null }[]>`
		select jsonb_array_length(app.zalo_member_profile(${target.zaloAppId}::uuid, ${userId}::uuid) -> 'stores') as stores
	`;
	return { role, stores: row?.stores ?? 0 };
}

async function bindWithCode(
	functionUrl: string,
	accessToken: string,
	brand: string,
	code: string,
): Promise<void> {
	let status: unknown = null;
	try {
		const response = await fetch(functionUrl, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				access_token: accessToken,
				brand,
				binding_code: code,
			}),
			signal: AbortSignal.timeout(30_000),
		});
		const body: unknown = await response.json();
		status = isRecord(body) ? (body.status ?? body.error) : null;
	} catch {
		status = null;
	}
	if (status !== "bound") {
		throw new LocalLoopError(
			`zalo-session did not bind the mock user with the binding code (${typeof status === "string" ? status : "no answer"})`,
		);
	}
}

function viteBin(staffDir: string): string {
	const require = createRequire(join(staffDir, "package.json"));
	const manifestPath = require.resolve("vite/package.json");
	const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
	const bin = isRecord(manifest) ? manifest.bin : undefined;
	const relative =
		typeof bin === "string" ? bin : isRecord(bin) ? bin.vite : undefined;
	if (typeof relative !== "string") {
		throw new LocalLoopError("the staff app's Vite has no command line entry");
	}
	return join(dirname(manifestPath), relative);
}

function failure(part: ManagedProcess, what: string): LocalLoopError {
	const recent = part
		.recentLines()
		.filter((line) => !/^\s*at /.test(line))
		.slice(-3);
	return new LocalLoopError(
		recent.length === 0 ? what : `${what}; last output: ${recent.join(" | ")}`,
	);
}

export async function startLocalLoop(
	options: LocalLoopOptions,
	environment: ZaloEnvironment,
	io: LocalLoopIo,
	paths: LocalLoopPaths,
): Promise<LocalLoop> {
	const stack = localStackFrom(environment);
	const email =
		options.member ?? environment[MEMBER_EMAIL_VARIABLE]?.trim() ?? "";
	if (email === "") {
		throw new LocalLoopError(
			`set ${MEMBER_EMAIL_VARIABLE} in .env or pass --member <login e-mail>`,
		);
	}
	const lan = options.exposure === "lan" ? chooseLanHost(options.host) : null;
	const platformProblem =
		options.exposure === "tunnel" ? tunnelPlatformProblem() : null;
	if (platformProblem !== null) {
		throw new LocalLoopError(platformProblem);
	}
	const cleanups: (() => Promise<void> | void)[] = [];
	let stopping = false;
	const stop = async () => {
		stopping = true;
		for (const cleanup of cleanups.splice(0).reverse()) {
			await cleanup();
		}
	};
	const sql = connect(stack.databaseUrl);
	try {
		const target = await loadLoopTarget(sql, options.tenant, options.brand);
		const problems = startProblems(target);
		if (problems.length > 0) {
			throw new LocalLoopError(problems.join("; "));
		}
		const member = await findMember(sql, target.tenantId, email);
		if (member === null) {
			throw new LocalLoopError(
				`the member login is not a member of ${options.tenant}`,
			);
		}
		if (member.role === "publisher") {
			throw new LocalLoopError(
				"a publisher login cannot be bound to a Zalo account",
			);
		}
		const owner = await identityOwner(sql, target.zaloAppId, options.mockUser);
		if (owner !== null && owner !== member.userId) {
			throw new LocalLoopError(
				`${options.mockUser} is bound to another login of ${options.tenant}; pass another --mock-user for this member`,
			);
		}

		const mock = createMockZalo();
		const graph = await startMockZalo(mock);
		cleanups.push(() => graph.close());
		const appSecret = `local-${randomBytes(24).toString("base64url")}`;
		const accessToken = mock.issueAccessToken(appSecret, {
			id: options.mockUser,
			name: options.mockName,
		});

		const base = passthroughEnvironment(environment);
		const deno = resolveDeno(paths.cacheDir, base);
		const functionPort = await freePort();
		const functionUrl = `http://127.0.0.1:${functionPort}`;
		const session = startProcess(
			"zalo-session",
			deno,
			[
				"run",
				"--allow-net=127.0.0.1,localhost",
				"--allow-env",
				"--no-prompt",
				"--config",
				join(paths.functionDir, "deno.json"),
				join(paths.functionDir, "index.ts"),
			],
			{
				cwd: paths.functionDir,
				env: sessionFunctionEnvironment(environment, {
					stack,
					tenantId: target.tenantId,
					graphBaseUrl: graph.baseUrl,
					secretName: target.secretName,
					appSecret,
					port: functionPort,
				}),
				onLine: (line) => io.line(`[zalo-session] ${line}`),
			},
		);
		cleanups.push(() => session.stop());
		const sessionUp = await waitForHttp(functionUrl, {
			method: "OPTIONS",
			accept: (status) => status === 204,
			timeoutMs: START_TIMEOUT_MS,
			alive: session.running,
		});
		if (!sessionUp) {
			throw failure(session, "zalo-session did not start");
		}

		const boundNow = owner === null;
		if (boundNow) {
			const code = await issueBindingCode(sql, target, member.userId);
			await bindWithCode(functionUrl, accessToken, options.brand, code);
		}
		const profile = await memberProfile(
			sql,
			target,
			member.userId,
			member.role,
		);
		await sql.end();

		let appConfigPath: string | null = null;
		if (target.staffMiniApp !== null) {
			mkdirSync(paths.cacheDir, { recursive: true });
			const path = join(
				paths.cacheDir,
				`${options.brand}-staff-app-config.json`,
			);
			writeFileSync(
				path,
				`${JSON.stringify(staffAppConfig(target.staffMiniApp), null, "\t")}\n`,
			);
			appConfigPath = path;
			cleanups.push(() => rmSync(path, { force: true }));
		}
		const key = options.exposure === "loopback" ? null : newAccessKey();
		const parts: ManagedProcess[] = [session];
		let tunnelHost: string | null = null;
		if (options.exposure === "tunnel") {
			const binary = await ensureCloudflared(environment, io);
			mkdirSync(paths.cacheDir, { recursive: true });
			const tunnel = await startTunnel(binary, options.port, {
				cwd: paths.cacheDir,
				env: base,
				onLine: (line) => {
					if (/ ERR /.test(line)) {
						io.line(`[tunnel] ${line}`);
					}
				},
			});
			cleanups.push(() => tunnel.process.stop());
			parts.push(tunnel.process);
			tunnelHost = tunnel.host;
		}
		const bindHost = lan?.host ?? "127.0.0.1";
		const app = startProcess(
			"staff app",
			process.execPath,
			[
				viteBin(paths.staffDir),
				"--host",
				bindHost,
				"--port",
				String(options.port),
				"--strictPort",
			],
			{
				cwd: paths.staffDir,
				env: staffAppEnvironment(environment, {
					brand: options.brand,
					publishableKey: stack.publishableKey,
					functionUrl,
					accessToken,
					appConfigPath,
					access:
						key === null
							? null
							: { key, tunnelHost, supabaseUrl: stack.supabaseUrl },
				}),
				onLine: (line) => {
					if (key === null || !VITE_ADDRESS_LINE.test(line)) {
						io.line(`[staff app] ${line}`);
					}
				},
			},
		);
		cleanups.push(() => app.stop());
		parts.push(app);
		const localUrl = `http://${bindHost === ALL_INTERFACES ? "127.0.0.1" : bindHost}:${options.port}/`;
		const guardedHere = options.exposure === "tunnel" || lan?.found === true;
		const appUp = await waitForHttp(localUrl, {
			accept: (status) => status === (guardedHere ? 403 : 200),
			timeoutMs: START_TIMEOUT_MS,
			alive: app.running,
		});
		if (!appUp) {
			throw failure(
				app,
				`the staff app did not start on ${bindHost}:${options.port}`,
			);
		}
		const appUrl = tunnelHost === null ? localUrl : `https://${tunnelHost}/`;
		if (tunnelHost !== null) {
			const reached = await waitForHttp(appUrl, {
				accept: (status) => status === 403,
				timeoutMs: TUNNEL_REACH_TIMEOUT_MS,
				alive: () => parts.every((part) => part.running()),
			});
			if (!reached) {
				throw new LocalLoopError(
					`the quick tunnel ${tunnelHost} did not reach the staff app within ${TUNNEL_REACH_TIMEOUT_MS / 1000} s`,
				);
			}
		}
		const checked = key !== null && guardedHere;
		const problem = checked ? await accessProblem(appUrl, key) : null;
		if (problem !== null) {
			throw failure(app, `the staff app's access guard ${problem}`);
		}
		const phoneUrl = checked ? keyedUrl(appUrl, key) : null;
		const phoneHint =
			key !== null && !checked
				? `http://<IPv4 address of this PC>:${options.port}/?${ACCESS_KEY_PARAMETER}=${key}`
				: null;

		const failed = Promise.race(
			parts.map((part) => part.exited.then((code) => ({ part, code }))),
		).then(({ part, code }) =>
			stopping
				? "stopped"
				: `${part.name} stopped on its own (exit code ${code ?? "none"})`,
		);
		return {
			ready: {
				appUrl,
				exposure: options.exposure,
				phoneUrl,
				phoneHint,
				lan,
				port: options.port,
				functionUrl,
				graphUrl: graph.baseUrl,
				tenant: options.tenant,
				brand: options.brand,
				mockUser: options.mockUser,
				mockName: options.mockName,
				role: profile.role,
				stores: profile.stores,
				boundNow,
			},
			failed,
			stop,
		};
	} catch (error) {
		await stop();
		throw error;
	} finally {
		await sql.end({ timeout: 5 });
	}
}

export async function forgetLocalBrand(
	options: LocalLoopOptions,
	environment: ZaloEnvironment,
	io: LocalLoopIo,
): Promise<void> {
	const stack = localStackFrom(environment);
	const sql = connect(stack.databaseUrl);
	try {
		const target = await loadLoopTarget(sql, options.tenant, options.brand);
		const rows = await brandRows(sql, target);
		const problems = forgetProblems(target, rows);
		if (problems.length > 0) {
			throw new LocalLoopError(`nothing was removed: ${problems.join("; ")}`);
		}
		await forgetBrand(sql, target);
		io.line(
			`${options.brand} of ${options.tenant}: the mock Zalo configuration and ${rows.identities.length} mock identities were removed; store the real ids with fnb zalo config set`,
		);
	} finally {
		await sql.end({ timeout: 5 });
	}
}
