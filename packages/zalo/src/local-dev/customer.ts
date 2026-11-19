import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ZaloEnvironment } from "../settings.js";
import {
	ensureCloudflared,
	startTunnel,
	tunnelPlatformProblem,
} from "./cloudflared.js";
import {
	customerDemoEnvironment,
	passthroughEnvironment,
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
import { type LocalLoopIo, viteBin } from "./loop.js";
import {
	LocalLoopError,
	type LocalLoopExposure,
	type LocalLoopOptions,
} from "./options.js";
import { type ManagedProcess, startProcess, waitForHttp } from "./processes.js";

const START_TIMEOUT_MS = 180_000;
const TUNNEL_REACH_TIMEOUT_MS = 120_000;
const VITE_ADDRESS_LINE = /(Local|Network)\S*:\s.*https?:\/\//;

export interface CustomerDemoPaths {
	readonly customerDir: string;
	readonly cacheDir: string;
}

export function customerDemoPaths(rootDir: string): CustomerDemoPaths {
	const customerDir = join(rootDir, "apps", "zalo-customer");
	return {
		customerDir,
		cacheDir: join(customerDir, "node_modules", ".cache", "zalo-local"),
	};
}

export interface CustomerDemoReady {
	readonly appUrl: string;
	readonly exposure: LocalLoopExposure;
	readonly phoneUrl: string | null;
	readonly phoneHint: string | null;
	readonly lan: LanHost | null;
	readonly port: number;
	readonly brand: string;
}

export interface CustomerDemo {
	readonly ready: CustomerDemoReady;
	readonly failed: Promise<string>;
	stop(): Promise<void>;
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

export async function startCustomerDemo(
	options: LocalLoopOptions,
	environment: ZaloEnvironment,
	io: LocalLoopIo,
	paths: CustomerDemoPaths,
): Promise<CustomerDemo> {
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
	try {
		const key = options.exposure === "loopback" ? null : newAccessKey();
		const parts: ManagedProcess[] = [];
		let tunnelHost: string | null = null;
		if (options.exposure === "tunnel") {
			const binary = await ensureCloudflared(environment, io);
			mkdirSync(paths.cacheDir, { recursive: true });
			const tunnel = await startTunnel(binary, options.port, {
				cwd: paths.cacheDir,
				env: passthroughEnvironment(environment),
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
			"customer app",
			process.execPath,
			[
				viteBin(paths.customerDir),
				"--host",
				bindHost,
				"--port",
				String(options.port),
				"--strictPort",
			],
			{
				cwd: paths.customerDir,
				env: customerDemoEnvironment(environment, {
					brand: options.brand,
					access: key === null ? null : { key, tunnelHost },
				}),
				onLine: (line) => {
					if (key === null || !VITE_ADDRESS_LINE.test(line)) {
						io.line(`[customer app] ${line}`);
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
				`the customer app did not start on ${bindHost}:${options.port}`,
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
					`the quick tunnel ${tunnelHost} did not reach the customer app within ${TUNNEL_REACH_TIMEOUT_MS / 1000} s`,
				);
			}
		}
		const checked = key !== null && guardedHere;
		const problem = checked ? await accessProblem(appUrl, key) : null;
		if (problem !== null) {
			throw failure(app, `the customer app's access guard ${problem}`);
		}
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
				phoneUrl: checked ? keyedUrl(appUrl, key) : null,
				phoneHint:
					key !== null && !checked
						? `http://<IPv4 address of this PC>:${options.port}/?${ACCESS_KEY_PARAMETER}=${key}`
						: null,
				lan,
				port: options.port,
				brand: options.brand,
			},
			failed,
			stop,
		};
	} catch (error) {
		await stop();
		throw error;
	}
}
