import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ensureCloudflared, startTunnel } from "../local-dev/cloudflared.js";
import {
	importRelayKey,
	newRelayKey,
	RELAY_HEARTBEAT_MS,
	relayUrlProblem,
	sealAnnouncement,
} from "../relay.js";
import { startRelayServer } from "./server.js";

/**
 * pnpm zalo:relay (ADR-057): runs the Zalo Graph relay on this PC in Vietnam, opens a Cloudflare quick tunnel to
 * it, and announces the tunnel's address to the cloud zalo-session function every five minutes, sealed with the
 * relay key. It prints statuses and counts, never the key, a token or the tunnel address.
 */

export const RELAY_DEFAULT_PORT = 8790;
export const RELAY_KEY_FOLDER = "fnb-zalo-relay";
export const RELAY_KEY_FILE = "relay.key";

const USAGE = [
	"Usage:",
	"  pnpm zalo:relay [--port <port>] [--key-file <path>] [--no-tunnel]",
	"  pnpm zalo:relay --create-key [--key-file <path>]",
	"",
	"Runs the Zalo Graph relay for the cloud functions (ADR-057) on 127.0.0.1, opens a Cloudflare quick tunnel to it",
	"and announces the tunnel address to zalo-session every 5 minutes. Needs SUPABASE_URL (https://<ref>.supabase.co)",
	"and SUPABASE_PUBLISHABLE_KEY (sb_publishable_...) in the environment, and the relay key: ZALO_RELAY_KEY or the",
	`key file (default %LOCALAPPDATA%\\${RELAY_KEY_FOLDER}\\${RELAY_KEY_FILE}), the same value as the function secret`,
	"ZALO_RELAY_KEY. --create-key writes a new key file (never over an existing one) and prints nothing of it.",
	"--no-tunnel serves on 127.0.0.1 only and announces nothing (a local check).",
].join("\n");

export interface RelayArguments {
	readonly port: number;
	readonly keyFile: string | null;
	readonly tunnel: boolean;
	readonly createKey: boolean;
}

export class RelayUsageError extends Error {}

export function parseRelayArguments(argv: readonly string[]): RelayArguments {
	let port = RELAY_DEFAULT_PORT;
	let keyFile: string | null = null;
	let tunnel = true;
	let createKey = false;
	for (let index = 0; index < argv.length; index += 1) {
		const name = argv[index];
		const value = argv[index + 1];
		switch (name) {
			case "--port": {
				const parsed = Number(value);
				if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
					throw new RelayUsageError("--port takes a number from 1024 to 65535");
				}
				port = parsed;
				index += 1;
				break;
			}
			case "--key-file":
				if (value === undefined || value.startsWith("--")) {
					throw new RelayUsageError("--key-file takes a path");
				}
				keyFile = value;
				index += 1;
				break;
			case "--no-tunnel":
				tunnel = false;
				break;
			case "--create-key":
				createKey = true;
				break;
			default:
				throw new RelayUsageError(`unknown argument ${name ?? ""}`);
		}
	}
	return { port, keyFile, tunnel, createKey };
}

export type RelayEnvironment = Readonly<Record<string, string | undefined>>;

export function keyFilePath(
	argumentsGiven: RelayArguments,
	environment: RelayEnvironment,
): string {
	if (argumentsGiven.keyFile !== null) {
		return argumentsGiven.keyFile;
	}
	const base = environment.LOCALAPPDATA?.trim() ?? "";
	if (base === "") {
		throw new RelayUsageError(
			"LOCALAPPDATA is not set; pass --key-file <path>",
		);
	}
	return join(base, RELAY_KEY_FOLDER, RELAY_KEY_FILE);
}

export interface CloudTarget {
	readonly url: string;
	readonly publishableKey: string;
}

/** The cloud project to announce to: an https://<ref>.supabase.co address and its publishable key. */
export function cloudTarget(environment: RelayEnvironment): CloudTarget {
	const url = (
		environment.SUPABASE_URL ??
		environment.VITE_SUPABASE_URL ??
		""
	).trim();
	const publishableKey = (
		environment.SUPABASE_PUBLISHABLE_KEY ??
		environment.VITE_SUPABASE_PUBLISHABLE_KEY ??
		""
	).trim();
	if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url)) {
		throw new RelayUsageError(
			"SUPABASE_URL must be the cloud project address https://<ref>.supabase.co",
		);
	}
	if (!/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(publishableKey)) {
		throw new RelayUsageError(
			"SUPABASE_PUBLISHABLE_KEY must be the project's sb_publishable_ key",
		);
	}
	return { url, publishableKey };
}

export type AnnounceFetch = (
	url: string,
	init: {
		readonly method: "POST";
		readonly headers: Readonly<Record<string, string>>;
		readonly body: string;
		readonly signal: AbortSignal;
	},
) => Promise<Response>;

/** Sends one sealed announcement; answers a short status line without the address. */
export async function announce(
	key: CryptoKey,
	target: CloudTarget,
	relayUrl: string,
	options: { readonly fetch?: AnnounceFetch; readonly now?: () => number } = {},
): Promise<{ readonly ok: boolean; readonly line: string }> {
	const problem = relayUrlProblem(relayUrl);
	if (problem !== null) {
		return { ok: false, line: `not announced: ${problem}` };
	}
	const send: AnnounceFetch =
		options.fetch ?? ((url, init) => fetch(url, init));
	const relay = await sealAnnouncement(key, {
		url: relayUrl,
		at: (options.now ?? (() => Date.now()))(),
	});
	let response: Response;
	try {
		response = await send(`${target.url}/functions/v1/zalo-session`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				apikey: target.publishableKey,
			},
			body: JSON.stringify({ relay }),
			signal: AbortSignal.timeout(15_000),
		});
	} catch {
		return { ok: false, line: "not announced: the cloud could not be reached" };
	}
	let body: unknown = null;
	try {
		body = await response.json();
	} catch {
		// not JSON
	}
	const status =
		typeof body === "object" && body !== null
			? ((body as Record<string, unknown>).status ??
				(body as Record<string, unknown>).error)
			: undefined;
	const ok = response.ok && status === "relay_announced";
	return {
		ok,
		line: ok
			? "announced to the cloud"
			: `not announced: HTTP ${response.status} ${typeof status === "string" ? status : ""}`.trim(),
	};
}

export interface RelayCliIo {
	line(text: string): void;
}

function readKeyText(path: string, environment: RelayEnvironment): string {
	const fromEnvironment = environment.ZALO_RELAY_KEY?.trim() ?? "";
	if (fromEnvironment !== "") {
		return fromEnvironment;
	}
	if (!existsSync(path)) {
		throw new RelayUsageError(
			`no relay key: set ZALO_RELAY_KEY or create the key file with --create-key (${path})`,
		);
	}
	return readFileSync(path, "utf8").trim();
}

function createKeyFile(path: string, io: RelayCliIo): number {
	if (existsSync(path)) {
		io.line(`zalo:relay: ${path} exists already; it was left as it is`);
		return 1;
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${newRelayKey()}\n`, { encoding: "utf8", flag: "wx" });
	io.line(
		`zalo:relay: wrote a new relay key to ${path}; store the same value as the function secret ZALO_RELAY_KEY`,
	);
	return 0;
}

function wait(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runRelayCli(
	argv: readonly string[],
	environment: RelayEnvironment,
	io: RelayCliIo = { line: (text) => console.log(text) },
): Promise<number> {
	let parsed: RelayArguments;
	let keyPath: string;
	try {
		parsed = parseRelayArguments(argv);
		keyPath = keyFilePath(parsed, environment);
	} catch (error) {
		io.line(error instanceof Error ? error.message : String(error));
		io.line(USAGE);
		return 2;
	}
	if (parsed.createKey) {
		return createKeyFile(keyPath, io);
	}
	let key: CryptoKey;
	let target: CloudTarget | null = null;
	try {
		key = await importRelayKey(readKeyText(keyPath, environment));
		if (parsed.tunnel) {
			target = cloudTarget(environment);
		}
	} catch (error) {
		io.line(
			`zalo:relay: ${error instanceof Error ? error.message : String(error)}`,
		);
		return 2;
	}
	const relay = await startRelayServer({
		key,
		port: parsed.port,
		log: (line) => io.line(`zalo:relay: ${line}`),
	});
	io.line(`zalo:relay: serving on http://127.0.0.1:${relay.port}`);
	let stopping = false;
	let timer: NodeJS.Timeout | undefined;
	let stopTunnel: () => Promise<void> = async () => undefined;
	const finished = new Promise<void>((resolve) => {
		const stop = () => {
			if (stopping) {
				return;
			}
			stopping = true;
			clearInterval(timer);
			io.line("zalo:relay: stopping");
			void stopTunnel()
				.then(() => relay.close())
				.then(resolve);
		};
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
	});
	if (target !== null) {
		const cloud = target;
		const env = Object.fromEntries(
			Object.entries(environment).filter(
				(entry): entry is [string, string] =>
					typeof entry[1] === "string" &&
					!/^(ZALO_RELAY_KEY|SUPABASE_PUBLISHABLE_KEY|VITE_SUPABASE_PUBLISHABLE_KEY)$/.test(
						entry[0],
					),
			),
		);
		const binary = await ensureCloudflared(environment, {
			line: (text) => io.line(text.replace(/^zalo:dev/, "zalo:relay")),
		});
		const cacheDir = join(dirname(keyPath), "tunnel");
		mkdirSync(cacheDir, { recursive: true });
		let relayUrl = "";
		const openTunnel = async (): Promise<void> => {
			const tunnel = await startTunnel(binary, relay.port, {
				cwd: cacheDir,
				env,
				onLine: (line) => {
					if (/ ERR /.test(line)) {
						io.line(
							`zalo:relay: [tunnel] ${line.replace(/https:\/\/\S+/g, "<address>")}`,
						);
					}
				},
			});
			relayUrl = `https://${tunnel.host}`;
			stopTunnel = () => tunnel.process.stop();
			io.line("zalo:relay: the quick tunnel is open");
			const result = await announce(key, cloud, relayUrl);
			io.line(`zalo:relay: ${result.line}`);
			void tunnel.process.exited.then(async () => {
				if (stopping) {
					return;
				}
				io.line("zalo:relay: the tunnel stopped; opening a new one in 5 s");
				await wait(5_000);
				if (!stopping) {
					await openTunnel().catch((error: unknown) =>
						io.line(
							`zalo:relay: ${error instanceof Error ? error.message : String(error)}`,
						),
					);
				}
			});
		};
		await openTunnel();
		timer = setInterval(() => {
			void announce(key, cloud, relayUrl).then((result) => {
				if (!result.ok) {
					io.line(`zalo:relay: ${result.line}`);
				}
			});
		}, RELAY_HEARTBEAT_MS);
	}
	await finished;
	return 0;
}
