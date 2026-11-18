import { createInterface } from "node:readline";
import type { ZaloEnvironment } from "../settings.js";
import { findRepositoryRoot, withRepositoryEnv } from "./environment.js";
import {
	forgetLocalBrand,
	type LocalLoop,
	type LocalLoopReady,
	localLoopPaths,
	startLocalLoop,
} from "./loop.js";
import {
	LOCAL_LOOP_USAGE,
	LocalLoopError,
	type LocalLoopOptions,
	MEMBER_EMAIL_VARIABLE,
	parseLocalLoopArgs,
} from "./options.js";

const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGBREAK"] as const;
const SIGNAL_GRACE_MS = 1000;

export interface LocalLoopReadyMessage {
	readonly type: "ready";
	readonly appUrl: string;
	readonly role: string;
	readonly stores: number;
	readonly mockName: string;
	readonly boundNow: boolean;
}

function readyLines(
	options: LocalLoopOptions,
	ready: LocalLoopReady,
): string[] {
	const member =
		options.member === null
			? `the member in ${MEMBER_EMAIL_VARIABLE}`
			: "the member given with --member";
	return [
		`zalo:dev: ready, open ${ready.appUrl}`,
		`  ${ready.brand} of ${ready.tenant}: the mock Zalo user ${ready.mockUser} signs in as ${member} (${ready.role}, ${ready.stores} ${ready.stores === 1 ? "store" : "stores"})`,
		...(ready.boundNow
			? [
					"  first run: the mock user was bound to the member with a one-time binding code",
				]
			: []),
		`  zalo-session runs under Deno with ZALO_LOCAL_DEV=1 on ${ready.functionUrl}; the mock Zalo graph answers on ${ready.graphUrl}`,
		"  stop with Ctrl+C, or type q and Enter",
	];
}

function untilStopped(loop: LocalLoop): Promise<string | null> {
	return new Promise((resolve) => {
		const lineReader = process.stdin.isTTY
			? createInterface({ input: process.stdin })
			: null;
		const finish = (reason: string | null) => {
			for (const signal of STOP_SIGNALS) {
				process.off(signal, onSignal);
			}
			process.off("message", onMessage);
			process.off("disconnect", onSignal);
			lineReader?.close();
			resolve(reason);
		};
		const onSignal = () => finish(null);
		const onMessage = (message: unknown) => {
			if (
				typeof message === "object" &&
				message !== null &&
				"type" in message &&
				message.type === "stop"
			) {
				finish(null);
			}
		};
		for (const signal of STOP_SIGNALS) {
			process.on(signal, onSignal);
		}
		process.on("message", onMessage);
		process.on("disconnect", onSignal);
		lineReader?.on("line", (line) => {
			if (line.trim().toLowerCase() === "q") {
				finish(null);
			}
		});
		loop.failed.then((reason) => {
			setTimeout(
				() => finish(reason === "stopped" ? null : reason),
				SIGNAL_GRACE_MS,
			).unref();
		});
	});
}

export async function runLocalLoopCli(
	argv: readonly string[],
	environment: ZaloEnvironment,
): Promise<number> {
	let options: LocalLoopOptions | "help";
	try {
		options = parseLocalLoopArgs(argv);
	} catch (error) {
		if (error instanceof LocalLoopError) {
			console.error(`zalo:dev: ${error.message}`);
			return 2;
		}
		throw error;
	}
	if (options === "help") {
		console.log(LOCAL_LOOP_USAGE);
		return 0;
	}
	const rootDir = findRepositoryRoot();
	const env = withRepositoryEnv(rootDir, environment);
	const io = { line: (text: string) => console.log(text) };
	try {
		if (options.command === "forget") {
			await forgetLocalBrand(options, env, io);
			return 0;
		}
		console.log(
			`zalo:dev: starting the mock Zalo graph, zalo-session and the staff app for ${options.brand} of ${options.tenant}`,
		);
		const loop = await startLocalLoop(
			options,
			env,
			io,
			localLoopPaths(rootDir),
		);
		for (const line of readyLines(options, loop.ready)) {
			console.log(line);
		}
		const message: LocalLoopReadyMessage = {
			type: "ready",
			appUrl: loop.ready.appUrl,
			role: loop.ready.role,
			stores: loop.ready.stores,
			mockName: loop.ready.mockName,
			boundNow: loop.ready.boundNow,
		};
		process.send?.(message);
		const failure = await untilStopped(loop);
		console.log("zalo:dev: stopping");
		await loop.stop();
		if (failure !== null) {
			console.error(`zalo:dev: ${failure}`);
			return 1;
		}
		console.log("zalo:dev: stopped");
		return 0;
	} catch (error) {
		if (error instanceof LocalLoopError) {
			console.error(`zalo:dev: ${error.message}`);
			return 1;
		}
		throw error;
	} finally {
		if (process.connected) {
			process.disconnect?.();
		}
	}
}
