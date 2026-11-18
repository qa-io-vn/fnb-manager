import { createHash } from "node:crypto";
import {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	readdirSync,
	renameSync,
	rmSync,
} from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ZaloEnvironment } from "../settings.js";
import { LocalLoopError } from "./options.js";
import { type ManagedProcess, startProcess } from "./processes.js";

export interface CloudflaredRelease {
	readonly version: string;
	readonly url: string;
	readonly sha256: string;
}

export const CLOUDFLARED_ASSET = "cloudflared-windows-amd64.exe";
export const CLOUDFLARED_RELEASE: CloudflaredRelease = {
	version: "2026.10.7",
	url: `https://github.com/cloudflare/cloudflared/releases/download/2026.10.7/${CLOUDFLARED_ASSET}`,
	sha256: "2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343",
};
export const CLOUDFLARED_FOLDER = "fnb-cloudflared";

const DOWNLOAD_SUFFIX = ".download";
const DOWNLOAD_TIMEOUT_MS = 600_000;
const TUNNEL_TIMEOUT_MS = 90_000;
const TUNNEL_URL =
	/https:\/\/((?!api\.)[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com)(?![a-z0-9.-])/;

export function tunnelPlatformProblem(
	platform: string = process.platform,
	arch: string = process.arch,
): string | null {
	return platform === "win32" && arch === "x64"
		? null
		: `--tunnel runs the pinned cloudflared for Windows x64; this is ${platform} ${arch}`;
}

export function cloudflaredDir(
	environment: ZaloEnvironment,
	release: CloudflaredRelease = CLOUDFLARED_RELEASE,
): string {
	const base = environment.LOCALAPPDATA?.trim() ?? "";
	if (base === "") {
		throw new LocalLoopError(
			"--tunnel keeps cloudflared under LOCALAPPDATA, which is not set",
		);
	}
	return join(base, CLOUDFLARED_FOLDER, release.version);
}

export async function sha256Of(path: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) {
		hash.update(chunk);
	}
	return hash.digest("hex");
}

async function download(url: string, target: string): Promise<void> {
	let response: Response;
	try {
		response = await fetch(url, {
			redirect: "follow",
			signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
		});
	} catch {
		throw new LocalLoopError(
			"cloudflared could not be downloaded from github.com",
		);
	}
	if (!response.ok || response.body === null) {
		throw new LocalLoopError(
			`cloudflared could not be downloaded from github.com (${response.status})`,
		);
	}
	await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
}

export interface CloudflaredIo {
	line(text: string): void;
}

export async function ensureCloudflared(
	environment: ZaloEnvironment,
	io: CloudflaredIo,
	release: CloudflaredRelease = CLOUDFLARED_RELEASE,
): Promise<string> {
	const dir = cloudflaredDir(environment, release);
	const binary = join(dir, CLOUDFLARED_ASSET);
	if (existsSync(binary)) {
		if ((await sha256Of(binary)) === release.sha256) {
			return binary;
		}
		rmSync(binary, { force: true });
		io.line(
			`zalo:dev: the cached cloudflared ${release.version} did not match its SHA-256 and was removed`,
		);
	}
	mkdirSync(dir, { recursive: true });
	const partial = `${binary}${DOWNLOAD_SUFFIX}`;
	rmSync(partial, { force: true });
	if (readdirSync(dir).length > 0) {
		throw new LocalLoopError(
			`${dir} holds other files; cloudflared is downloaded only into an empty folder, so empty it first`,
		);
	}
	io.line(
		`zalo:dev: downloading cloudflared ${release.version} (${CLOUDFLARED_ASSET}) from its GitHub release into ${dir}`,
	);
	try {
		await download(release.url, partial);
		const digest = await sha256Of(partial);
		if (digest !== release.sha256) {
			throw new LocalLoopError(
				`the downloaded cloudflared ${release.version} does not match the SHA-256 its release publishes, so it was removed`,
			);
		}
		renameSync(partial, binary);
	} finally {
		rmSync(partial, { force: true });
	}
	io.line(
		`zalo:dev: cloudflared ${release.version} matches the SHA-256 of its release`,
	);
	return binary;
}

export function tunnelHostFrom(line: string): string | null {
	return TUNNEL_URL.exec(line)?.[1] ?? null;
}

export interface TunnelOptions {
	readonly cwd: string;
	readonly env: Readonly<Record<string, string>>;
	readonly onLine: (line: string) => void;
	readonly timeoutMs?: number;
}

export interface Tunnel {
	readonly process: ManagedProcess;
	readonly host: string;
}

export function tunnelArguments(port: number): string[] {
	return ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`];
}

export async function startTunnel(
	binary: string,
	port: number,
	options: TunnelOptions,
): Promise<Tunnel> {
	let announce: (host: string) => void = () => undefined;
	const announced = new Promise<string>((resolve) => {
		announce = resolve;
	});
	const part = startProcess("cloudflared", binary, tunnelArguments(port), {
		cwd: options.cwd,
		env: options.env,
		onLine: (line) => {
			const host = tunnelHostFrom(line);
			if (host !== null) {
				announce(host);
			}
			options.onLine(line);
		},
	});
	let timer: NodeJS.Timeout | undefined;
	const host = await Promise.race([
		announced,
		part.exited.then(() => null),
		new Promise<null>((resolve) => {
			timer = setTimeout(
				() => resolve(null),
				options.timeoutMs ?? TUNNEL_TIMEOUT_MS,
			);
		}),
	]);
	clearTimeout(timer);
	if (host === null) {
		const recent = part
			.recentLines()
			.filter((line) => / (ERR|WRN) /.test(line))
			.slice(-3);
		await part.stop();
		throw new LocalLoopError(
			`cloudflared did not open a quick tunnel${recent.length === 0 ? "" : `; last output: ${recent.join(" | ")}`}`,
		);
	}
	return { process: part, host };
}
