import { type ChildProcess, fork, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = fileURLToPath(
	new URL("../../../scripts/zalo-dev.mjs", import.meta.url),
);
const LOOPBACK_API = /^http:\/\/(127\.0\.0\.1|localhost):[0-9]{1,5}$/;
const LOOPBACK_DATABASE =
	/^postgres(ql)?:\/\/[^@/]+@(127\.0\.0\.1|localhost)(:\d+)?\//;
const KEY_IN_TEXT = /([?&]key=)[A-Za-z0-9_-]+/g;
const STOP_GRACE_MS = 30_000;

export interface Ready {
	readonly type: "ready";
	readonly appUrl: string;
	readonly phoneUrl: string | null;
	readonly role: string;
	readonly stores: number;
	readonly mockName: string;
	readonly boundNow: boolean;
}

export function portOf(base: number): string {
	return String(base + Number(process.env.E2E_PORT_OFFSET ?? "0"));
}

export function withoutKey(text: string): string {
	return text.replace(KEY_IN_TEXT, "$1<key>");
}

function repositoryEnv(): Readonly<Record<string, string | undefined>> {
	const file = `${ROOT}.env`;
	return existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
}

export function localApiUrl(): string {
	const url = (
		process.env.SUPABASE_URL ||
		repositoryEnv().SUPABASE_URL ||
		""
	).trim();
	return LOOPBACK_API.test(url) ? url : "";
}

export function localDatabaseUrl(): string {
	const url = (
		process.env.DATABASE_URL ||
		repositoryEnv().DATABASE_URL ||
		""
	).trim();
	return LOOPBACK_DATABASE.test(url) ? url : "";
}

export async function localStackRuns(): Promise<boolean> {
	const url = localApiUrl();
	if (process.env.ZALO_LOCAL_DEV !== "1" || url === "") return false;
	if (localDatabaseUrl() === "") return false;
	try {
		const response = await fetch(`${url}/auth/v1/health`, {
			signal: AbortSignal.timeout(3000),
		});
		await response.body?.cancel();
		return true;
	} catch {
		return false;
	}
}

export class LocalLoop {
	private child: ChildProcess | null = null;
	private readonly output: string[] = [];

	start(args: readonly string[]): Promise<Ready> {
		const child = fork(SCRIPT, [...args], {
			cwd: ROOT,
			stdio: ["ignore", "pipe", "pipe", "ipc"],
		});
		this.child = child;
		for (const stream of [child.stdout, child.stderr]) {
			stream?.on("data", (chunk: Buffer) =>
				this.output.push(chunk.toString("utf8")),
			);
		}
		return new Promise((resolve, reject) => {
			child.on("message", (message: Ready) => {
				if (message.type === "ready") resolve(message);
			});
			child.on("exit", (code) =>
				reject(
					new Error(
						withoutKey(
							`pnpm zalo:dev exited with ${code}:\n${this.output.join("")}`,
						),
					),
				),
			);
		});
	}

	lines(): string {
		return withoutKey(this.output.join(""));
	}

	stop(): Promise<number | null> {
		const child = this.child;
		if (child === null) return Promise.resolve(null);
		return new Promise((resolve) => {
			child.on("exit", (code) => resolve(code));
			child.send({ type: "stop" });
		});
	}

	async dispose(): Promise<void> {
		const child = this.child;
		this.child = null;
		if (child === null || child.exitCode !== null) return;
		const exited = new Promise((resolve) => child.once("exit", resolve));
		if (child.connected) child.send({ type: "stop" });
		await Promise.race([
			exited,
			new Promise((resolve) => setTimeout(resolve, STOP_GRACE_MS)),
		]);
		if (child.exitCode !== null || child.pid === undefined) return;
		if (process.platform === "win32") {
			spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
				stdio: "ignore",
				windowsHide: true,
			});
			return;
		}
		child.kill();
	}
}
