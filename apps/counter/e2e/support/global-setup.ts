import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { join } from "node:path";
import { createMockZalo, type MockZalo } from "@fnb/zalo/testing";
import {
	connect,
	dropCounterTenant,
	localStackFromEnv,
	seedCounterTenant,
} from "../../test/support/seed";
import { E2E_FUNCTION_PORT, E2E_MOCK_ZALO_PORT, SEEDED_FILE } from "./ports";

/**
 * The counter's end-to-end stack (ADR-066): a synthetic tenant on the local Supabase stack, the mock Zalo on a fixed
 * loopback port (its web login picks the person from a cookie the test sets), and the real counter-session function
 * run by Deno against both. Nothing here reaches the real Zalo or the cloud. Without the local stack's addresses
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

async function waitFor(
	url: string,
	child: ChildProcess,
	output: string[],
): Promise<void> {
	for (let attempt = 0; attempt < 240; attempt += 1) {
		if (child.exitCode !== null) {
			throw new Error(
				`counter-session exited: ${output.slice(-5).join(" | ")}`,
			);
		}
		try {
			const response = await fetch(url, {
				method: "POST",
				body: "{}",
				headers: { "content-type": "application/json" },
			});
			if (response.status === 400) return;
		} catch {
			// not up yet
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(
		`counter-session did not start: ${output.slice(-5).join(" | ")}`,
	);
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
	const functionDir = join(
		import.meta.dirname,
		"..",
		"..",
		"..",
		"..",
		"supabase",
		"functions",
		"counter-session",
	);
	const output: string[] = [];
	const deno = spawn(
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
				DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${E2E_FUNCTION_PORT}`,
				SUPABASE_URL: stack.supabaseUrl,
				SUPABASE_DB_URL: stack.databaseUrl,
				SUPABASE_SECRET_KEYS: JSON.stringify({ default: stack.secretKey }),
				ZALO_LOCAL_DEV: "1",
				ZALO_TENANT_ID: seeded.tenantId,
				ZALO_GRAPH_BASE_URL: mockUrl,
				ZALO_OAUTH_BASE_URL: mockUrl,
				[seeded.secretName]: seeded.appSecret,
			},
			windowsHide: true,
		},
	);
	deno.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
	deno.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
	await waitFor(`http://127.0.0.1:${E2E_FUNCTION_PORT}`, deno, output);
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
		deno.kill();
		await new Promise<void>((resolve) => mockServer.close(() => resolve()));
		await dropCounterTenant(stack, sql, seeded);
		await sql.end({ timeout: 5 });
	};
}
