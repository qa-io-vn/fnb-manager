import { createInterface } from "node:readline";
import type { ZaloEnvironment } from "../settings.js";
import {
	type CustomerDemoReady,
	customerDemoPaths,
	startCustomerDemo,
} from "./customer.js";
import { findRepositoryRoot, withRepositoryEnv } from "./environment.js";
import { type LanHost, qrCodeLines } from "./lan.js";
import {
	forgetLocalBrand,
	type LocalLoopReady,
	localLoopPaths,
	startLocalLoop,
} from "./loop.js";
import {
	LOCAL_LOOP_USAGE,
	LocalLoopError,
	type LocalLoopExposure,
	type LocalLoopOptions,
	MEMBER_EMAIL_VARIABLE,
	parseLocalLoopArgs,
} from "./options.js";

const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGBREAK"] as const;
const SIGNAL_GRACE_MS = 1000;
const HOUR_MS = 3_600_000;

export interface LocalLoopReadyMessage {
	readonly type: "ready";
	readonly appUrl: string;
	readonly phoneUrl: string | null;
	readonly role: string;
	readonly stores: number;
	readonly mockName: string;
	readonly boundNow: boolean;
}

function two(value: number): string {
	return String(value).padStart(2, "0");
}

export function clockTime(at: Date, now: Date = new Date()): string {
	const time = `${two(at.getHours())}:${two(at.getMinutes())}`;
	return at.toDateString() === now.toDateString()
		? time
		: `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${time}`;
}

function firewallHint(port: number): string {
	return `  if the phone can't connect, allow TCP port ${port} on private networks in this PC's firewall`;
}

interface ExposureView {
	readonly appUrl: string;
	readonly exposure: LocalLoopExposure;
	readonly phoneUrl: string | null;
	readonly phoneHint: string | null;
	readonly lan: LanHost | null;
	readonly port: number;
	readonly role: string;
	readonly appName: string;
	readonly behind: string;
}

const LOCAL_SERVICES =
	"zalo-session, zalo-phone, the mock Zalo graph and the local Supabase API stay on 127.0.0.1 behind its proxy";
const DEMO_SERVICES =
	"the demo data and the stand-in session run inside the page, with no database";

function exposureLines(
	ready: ExposureView,
	stopsAt: Date | null,
	terminal: boolean,
): string[] {
	const qr = (url: string) =>
		terminal
			? ["  or scan this QR code with the iPhone camera:", ...qrCodeLines(url)]
			: [];
	if (ready.exposure === "tunnel" && ready.phoneUrl !== null) {
		return [
			`zalo:dev: ready on a public https link; on the phone open ${ready.phoneUrl}`,
			...qr(ready.phoneUrl),
			`  public link: anyone with it can open the app as ${ready.role}; it stops ${stopsAt === null ? "" : `at ${clockTime(stopsAt)} `}or on Ctrl+C`,
			"  the key in the link is new on every start; the dev server sets it as a cookie and drops it from the address, and any request without it gets 403",
			`  the ${ready.appName} listens on 127.0.0.1:${ready.port} behind a Cloudflare quick tunnel; ${ready.behind}`,
		];
	}
	if (ready.exposure === "lan" && ready.phoneUrl !== null) {
		const others = ready.lan?.others ?? [];
		return [
			`zalo:dev: ready on the home network; on the phone (same Wi-Fi) open ${ready.phoneUrl}`,
			...qr(ready.phoneUrl),
			`  the link carries a one-time key, new on every start: whoever opens it is signed in as the ${ready.role === "customer" ? "mock customer" : "member below"} (${ready.role}), so keep it to yourself; without it every request gets 403`,
			`  the ${ready.appName} listens on ${ready.lan?.host ?? ""}:${ready.port} only; ${ready.behind}`,
			...(others.length === 0
				? []
				: [
						`  other addresses of this PC: ${others.map((entry) => `${entry.address} (${entry.name})`).join(", ")}; pass --host <ipv4> to use one`,
					]),
			firewallHint(ready.port),
		];
	}
	if (ready.exposure === "lan") {
		return [
			`zalo:dev: ready; no Wi-Fi or LAN IPv4 address was found, so the ${ready.appName} listens on every interface (${ready.lan?.host ?? ""})`,
			`  on the phone open ${ready.phoneHint ?? ""}, or restart with --host <ipv4>`,
			`  on this PC open ${ready.appUrl}`,
			firewallHint(ready.port),
		];
	}
	return [`zalo:dev: ready, open ${ready.appUrl}`];
}

function readyLines(
	options: LocalLoopOptions,
	ready: LocalLoopReady,
	stopsAt: Date | null,
	terminal: boolean,
): string[] {
	const member =
		ready.app === "customer"
			? "a customer, joining with the mock phone token"
			: options.member === null
				? `the member in ${MEMBER_EMAIL_VARIABLE}`
				: "the member given with --member";
	return [
		...exposureLines(
			{ ...ready, appName: `${ready.app} app`, behind: LOCAL_SERVICES },
			stopsAt,
			terminal,
		),
		`  ${ready.brand} of ${ready.tenant}: the mock Zalo user ${ready.mockUser} signs in as ${member} (${ready.role}, ${ready.stores} ${ready.stores === 1 ? "store" : "stores"})`,
		...(ready.boundNow
			? [
					"  first run: the mock user was bound to the member with a one-time binding code",
				]
			: []),
		`  zalo-session and zalo-phone run under Deno with ZALO_LOCAL_DEV=1 on ${ready.functionUrl} and ${ready.phoneFunctionUrl}; the mock Zalo graph answers on ${ready.graphUrl}, phone linking included`,
		"  stop with Ctrl+C, or type q and Enter",
	];
}

function demoLines(
	ready: CustomerDemoReady,
	stopsAt: Date | null,
	terminal: boolean,
): string[] {
	return [
		...exposureLines(
			{
				...ready,
				role: "customer",
				appName: "customer app",
				behind: DEMO_SERVICES,
			},
			stopsAt,
			terminal,
		),
		`  ${ready.brand}: the customer app with its demo data (a visitor first; add ?member=1 to start as a member, ?phone=refused to refuse the phone, ?store=mau-1&src=qr for a store link)`,
		"  stop with Ctrl+C, or type q and Enter",
	];
}

function untilStopped(
	loop: { readonly failed: Promise<string> },
	stopsAt: Date | null,
): Promise<string | null> {
	return new Promise((resolve) => {
		const lineReader = process.stdin.isTTY
			? createInterface({ input: process.stdin })
			: null;
		const deadline =
			stopsAt === null
				? null
				: setTimeout(
						() => {
							console.log(
								"zalo:dev: the public link reached its time limit and stops now",
							);
							finish(null);
						},
						Math.max(0, stopsAt.getTime() - Date.now()),
					);
		const finish = (reason: string | null) => {
			if (deadline !== null) {
				clearTimeout(deadline);
			}
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
		if (options.app === "customer" && options.live !== true) {
			console.log(
				`zalo:dev: starting the customer app with its demo data for ${options.brand}`,
			);
			const demo = await startCustomerDemo(
				options,
				env,
				io,
				customerDemoPaths(rootDir),
			);
			const demoStopsAt =
				options.exposure === "tunnel"
					? new Date(Date.now() + options.tunnelHours * HOUR_MS)
					: null;
			for (const line of demoLines(
				demo.ready,
				demoStopsAt,
				process.stdout.isTTY === true,
			)) {
				console.log(line);
			}
			const ready: LocalLoopReadyMessage = {
				type: "ready",
				appUrl: demo.ready.appUrl,
				phoneUrl: demo.ready.phoneUrl,
				role: "customer",
				stores: 0,
				mockName: "",
				boundNow: false,
			};
			process.send?.(ready);
			const stopped = await untilStopped(demo, demoStopsAt);
			console.log("zalo:dev: stopping");
			await demo.stop();
			if (stopped !== null) {
				console.error(`zalo:dev: ${stopped}`);
				return 1;
			}
			console.log("zalo:dev: stopped");
			return 0;
		}
		console.log(
			`zalo:dev: starting the mock Zalo graph, zalo-session, zalo-phone and the ${options.app ?? "staff"} app for ${options.brand} of ${options.tenant}`,
		);
		const loop = await startLocalLoop(
			options,
			env,
			io,
			localLoopPaths(rootDir),
		);
		const stopsAt =
			options.exposure === "tunnel"
				? new Date(Date.now() + options.tunnelHours * HOUR_MS)
				: null;
		for (const line of readyLines(
			options,
			loop.ready,
			stopsAt,
			process.stdout.isTTY === true,
		)) {
			console.log(line);
		}
		const message: LocalLoopReadyMessage = {
			type: "ready",
			appUrl: loop.ready.appUrl,
			phoneUrl: loop.ready.phoneUrl,
			role: loop.ready.role,
			stores: loop.ready.stores,
			mockName: loop.ready.mockName,
			boundNow: loop.ready.boundNow,
		};
		process.send?.(message);
		const failure = await untilStopped(loop, stopsAt);
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
