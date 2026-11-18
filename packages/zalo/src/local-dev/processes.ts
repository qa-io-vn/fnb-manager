import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { LocalLoopError } from "./options.js";

export const DENO_VERSION = "2.7.3";
const RECENT_LINES = 20;
const STOP_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 250;

export interface ManagedProcess {
	readonly name: string;
	readonly exited: Promise<number | null>;
	running(): boolean;
	recentLines(): readonly string[];
	stop(): Promise<void>;
}

export interface StartProcessOptions {
	readonly cwd: string;
	readonly env: Readonly<Record<string, string>>;
	readonly onLine: (line: string) => void;
}

function wait(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function killTree(child: ChildProcess): void {
	if (child.pid === undefined) {
		return;
	}
	if (process.platform === "win32") {
		spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
			stdio: "ignore",
			windowsHide: true,
		});
		return;
	}
	child.kill("SIGTERM");
}

export function startProcess(
	name: string,
	command: string,
	args: readonly string[],
	options: StartProcessOptions,
): ManagedProcess {
	const child = spawn(command, [...args], {
		cwd: options.cwd,
		env: { ...options.env },
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	const recent: string[] = [];
	let alive = true;
	const exited = new Promise<number | null>((resolve) => {
		child.on("error", () => {
			alive = false;
			resolve(null);
		});
		child.on("exit", (code) => {
			alive = false;
			resolve(code);
		});
	});
	const reader = () => {
		let pending = "";
		return (chunk: Buffer) => {
			pending += chunk.toString("utf8");
			const lines = pending.split(/\r?\n/);
			pending = lines.pop() ?? "";
			for (const line of lines) {
				if (line.trim() === "") {
					continue;
				}
				recent.push(line);
				if (recent.length > RECENT_LINES) {
					recent.shift();
				}
				options.onLine(line);
			}
		};
	};
	child.stdout?.on("data", reader());
	child.stderr?.on("data", reader());
	return {
		name,
		exited,
		running: () => alive,
		recentLines: () => [...recent],
		async stop() {
			if (!alive) {
				return;
			}
			killTree(child);
			const stopped = await Promise.race([
				exited.then(() => true),
				wait(STOP_TIMEOUT_MS).then(() => false),
			]);
			if (!stopped) {
				child.kill("SIGKILL");
				await exited;
			}
		},
	};
}

export function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port =
				address !== null && typeof address === "object" ? address.port : 0;
			server.close(() =>
				port > 0
					? resolve(port)
					: reject(new LocalLoopError("no free port was found")),
			);
		});
	});
}

export interface WaitForHttpOptions {
	readonly timeoutMs: number;
	readonly method?: "GET" | "OPTIONS";
	readonly accept: (status: number) => boolean;
	readonly alive: () => boolean;
}

export async function waitForHttp(
	url: string,
	options: WaitForHttpOptions,
): Promise<boolean> {
	const deadline = Date.now() + options.timeoutMs;
	while (Date.now() < deadline && options.alive()) {
		const status = await statusOf(url, options.method ?? "GET");
		if (status !== null && options.accept(status)) {
			return true;
		}
		await wait(POLL_INTERVAL_MS);
	}
	return false;
}

async function statusOf(
	url: string,
	method: "GET" | "OPTIONS",
): Promise<number | null> {
	try {
		const response = await fetch(url, {
			method,
			signal: AbortSignal.timeout(2000),
		});
		await response.body?.cancel();
		return response.status;
	} catch {
		return null;
	}
}

function denoVersionOf(path: string): string {
	const result = spawnSync(path, ["--version"], {
		encoding: "utf8",
		windowsHide: true,
		timeout: 30_000,
	});
	return result.status === 0 ? result.stdout : "";
}

export function resolveDeno(
	cacheDir: string,
	env: Readonly<Record<string, string>>,
): string {
	const cache = join(cacheDir, "deno-path.txt");
	if (existsSync(cache)) {
		const cached = readFileSync(cache, "utf8").trim();
		if (
			cached !== "" &&
			existsSync(cached) &&
			denoVersionOf(cached).startsWith(`deno ${DENO_VERSION} `)
		) {
			return cached;
		}
	}
	const result = spawnSync(
		`npx -y deno@${DENO_VERSION} eval "console.log(Deno.execPath())"`,
		{
			shell: true,
			encoding: "utf8",
			env: { ...env },
			windowsHide: true,
			timeout: 300_000,
		},
	);
	const path =
		result.status === 0
			? (result.stdout
					.split(/\r?\n/)
					.map((line) => line.trim())
					.filter((line) => line !== "")
					.pop() ?? "")
			: "";
	if (path === "" || !existsSync(path)) {
		throw new LocalLoopError(
			`Deno ${DENO_VERSION} could not be started through npx -y deno@${DENO_VERSION}`,
		);
	}
	mkdirSync(cacheDir, { recursive: true });
	writeFileSync(cache, `${path}\n`);
	return path;
}
