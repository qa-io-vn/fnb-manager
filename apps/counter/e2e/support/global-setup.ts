import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { join } from "node:path";
import { createMockZalo, type MockZalo } from "@fnb/zalo/testing";
import {
	BANK_SECRET_NAME,
	dropPaymentRows,
} from "../../test/support/payment-exceptions";
import {
	connect,
	dropCounterTenant,
	type LocalStack,
	localStackFromEnv,
	seedCounterTenant,
} from "../../test/support/seed";
import {
	E2E_CHECKOUT_PORT,
	E2E_FUNCTION_PORT,
	E2E_MOCK_ZALO_PORT,
	SEEDED_FILE,
} from "./ports";

/**
 * The counter's end-to-end stack (ADR-066): a synthetic tenant on the local Supabase stack, the mock Zalo on a fixed
 * loopback port (its web login picks the person from a cookie the test sets), the real counter-session function run by
 * Deno against both, and the real checkout-order function (ADR-067) with the mock bank allowed (PAYMENTS_MOCK=on) and
 * the synthetic key a test's VietQR provider row names (BANK_SECRET_NAME): a test seeds the row, the counter opens its
 * VietQR through the function, and the bank's news is settled by app.checkout_settle as bank-webhook settles it.
 * Nothing here reaches the real Zalo, a bank, a payment provider or the cloud. Without the local stack's addresses
 * (scripts/with-local-stack.mjs gives them) the suite is skipped.
 */

function readBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		request.on("error", reject);
	});
}

function serveMock(mock: MockZalo, port: number): Promise<Server> {
	const server = createServer((incoming, outgoing) => {
		void (async () => {
			const headers = new Headers();
			for (const [name, value] of Object.entries(incoming.headers)) {
				if (typeof value === "string") headers.set(name, value);
			}
			const body = await readBody(incoming);
			const method = incoming.method ?? "GET";
			const response = await mock.handle(
				new Request(`http://127.0.0.1:${port}${incoming.url ?? "/"}`, {
					method,
					headers,
					...(method === "GET" || method === "HEAD" ? {} : { body }),
				}),
			);
			const location = response.headers.get("location");
			outgoing.writeHead(response.status, {
				"content-type":
					response.headers.get("content-type") ?? "application/json",
				...(location === null ? {} : { location }),
			});
			outgoing.end(await response.text());
		})().catch(() => {
			outgoing.writeHead(500);
			outgoing.end();
		});
	});
	return new Promise((resolve, reject) => {
		server.on("error", reject);
		server.listen(port, "127.0.0.1", () => resolve(server));
	});
}

function denoPath(): string {
	if (process.env.DENO !== undefined && process.env.DENO !== "")
		return process.env.DENO;
	const local = join(
		process.env.LOCALAPPDATA ?? "",
		"fnb-deno",
		"2.7.3",
		"deno.exe",
	);
	return existsSync(local) ? local : "deno";
}

interface RunningFunction {
	readonly name: string;
	readonly child: ChildProcess;
	readonly output: string[];
}

/** An Edge Function of supabase/functions run by Deno on a loopback port, with only the environment given. */
function runFunction(
	name: string,
	port: number,
	environment: Readonly<Record<string, string>>,
): RunningFunction {
	const functionDir = join(
		import.meta.dirname,
		"..",
		"..",
		"..",
		"..",
		"supabase",
		"functions",
		name,
	);
	const output: string[] = [];
	const child = spawn(
		denoPath(),
		[
			"run",
			"--allow-net=127.0.0.1,localhost",
			"--allow-env",
			"--no-prompt",
			"--config",
			join(functionDir, "deno.json"),
			join(functionDir, "index.ts"),
		],
		{
			env: {
				PATH: process.env.PATH ?? "",
				SystemRoot: process.env.SystemRoot ?? "",
				USERPROFILE: process.env.USERPROFILE ?? "",
				LOCALAPPDATA: process.env.LOCALAPPDATA ?? "",
				DENO_DIR:
					process.env.DENO_DIR ??
					join(process.env.LOCALAPPDATA ?? "", "fnb-deno", "2.7.3"),
				NO_COLOR: "1",
				DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${port}`,
				...environment,
			},
			windowsHide: true,
		},
	);
	child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
	child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
	return { name, child, output };
}

/** Waits until the function answers an empty POST as it answers a malformed one (its own status, never a crash). */
async function waitFor(
	url: string,
	running: RunningFunction,
	readyStatus: number,
): Promise<void> {
	for (let attempt = 0; attempt < 240; attempt += 1) {
		if (running.child.exitCode !== null) {
			throw new Error(
				`${running.name} exited: ${running.output.slice(-5).join(" | ")}`,
			);
		}
		try {
			const response = await fetch(url, {
				method: "POST",
				body: "{}",
				headers: { "content-type": "application/json" },
			});
			if (response.status === readyStatus) return;
		} catch {
			// not up yet
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(
		`${running.name} did not start: ${running.output.slice(-5).join(" | ")}`,
	);
}

function backendEnvironment(stack: LocalStack): Record<string, string> {
	return {
		SUPABASE_URL: stack.supabaseUrl,
		SUPABASE_DB_URL: stack.databaseUrl,
		SUPABASE_SECRET_KEYS: JSON.stringify({ default: stack.secretKey }),
		// loopback origins (the built app on 127.0.0.1) and the local Zalo addresses
		ZALO_LOCAL_DEV: "1",
	};
}

export default async function globalSetup(): Promise<() => Promise<void>> {
	const stack = localStackFromEnv();
	const cacheDir = join(import.meta.dirname, "..", ".cache");
	mkdirSync(cacheDir, { recursive: true });
	if (stack === null) {
		writeFileSync(join(cacheDir, SEEDED_FILE), JSON.stringify({ skip: true }));
		return async () => undefined;
	}
	const sql = connect(stack);
	const seeded = await seedCounterTenant(stack, sql, "ct-e2e");
	const mock = createMockZalo({ startAt: Date.now() });
	mock.registerApp({
		appId: seeded.externalAppId,
		appSecret: seeded.appSecret,
	});
	const mockServer = await serveMock(mock, E2E_MOCK_ZALO_PORT);
	const mockUrl = `http://127.0.0.1:${E2E_MOCK_ZALO_PORT}`;
	const running: RunningFunction[] = [];
	const stopAll = () => {
		for (const each of running) each.child.kill();
	};
	try {
		const session = runFunction("counter-session", E2E_FUNCTION_PORT, {
			...backendEnvironment(stack),
			ZALO_TENANT_ID: seeded.tenantId,
			ZALO_GRAPH_BASE_URL: mockUrl,
			ZALO_OAUTH_BASE_URL: mockUrl,
			[seeded.secretName]: seeded.appSecret,
		});
		running.push(session);
		// checkout-order with the mock bank allowed and a synthetic key for the provider rows the tests seed
		const checkout = runFunction("checkout-order", E2E_CHECKOUT_PORT, {
			...backendEnvironment(stack),
			PAYMENTS_MOCK: "on",
			[BANK_SECRET_NAME]: `synthetic-bank-key-${randomBytes(16).toString("hex")}`,
		});
		running.push(checkout);
		// counter-session answers an empty body 400; checkout-order asks for a session first (401)
		await waitFor(`http://127.0.0.1:${E2E_FUNCTION_PORT}`, session, 400);
		await waitFor(`http://127.0.0.1:${E2E_CHECKOUT_PORT}`, checkout, 401);
	} catch (error) {
		stopAll();
		await new Promise<void>((resolve) => mockServer.close(() => resolve()));
		await dropPaymentRows(sql, seeded.tenantId);
		await dropCounterTenant(stack, sql, seeded);
		await sql.end({ timeout: 5 });
		throw error;
	}
	writeFileSync(
		join(cacheDir, SEEDED_FILE),
		JSON.stringify({
			skip: false,
			seeded,
			mockUrl,
			stack: { databaseUrl: stack.databaseUrl },
		}),
	);
	return async () => {
		stopAll();
		await new Promise<void>((resolve) => mockServer.close(() => resolve()));
		await dropPaymentRows(sql, seeded.tenantId);
		await dropCounterTenant(stack, sql, seeded);
		await sql.end({ timeout: 5 });
	};
}
