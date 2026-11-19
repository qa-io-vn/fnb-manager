import { parseArgs } from "node:util";
import { DISPLAY_NAME_MAX_LENGTH } from "../graph.js";
import { BRAND_KEY_PATTERN } from "../session.js";

export const MOCK_ID_PREFIX = "mock-";
export const MOCK_USER_PATTERN = /^mock-[A-Za-z0-9_-]{1,59}$/;
export const MOCK_PHONE_PATTERN = /^0900000[0-9]{3}$/;
export const TENANT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const MEMBER_EMAIL_VARIABLE = "FNB_MEMBER_EMAIL";
export const LOCAL_LOOP_DEFAULTS = {
	tenant: "live-local",
	brand: "brand-1",
	mockUser: "mock-user-1",
	mockName: "Người dùng Zalo thử",
	port: 5741,
	tunnelHours: 4,
} as const;
export const MAX_TUNNEL_HOURS = 12;
export const LOCAL_LOOP_APPS = ["staff", "customer"] as const;
export type LocalLoopApp = (typeof LOCAL_LOOP_APPS)[number];
export const CUSTOMER_LOOP_PORT = 5751;
export const CUSTOMER_LIVE_TENANT = "loyalty-sim";

export const LOCAL_LOOP_USAGE = [
	"Usage:",
	"  pnpm zalo:dev [--tenant <slug>] [--brand <key>] [--member <login e-mail>] [--mock-user mock-<id>] [--mock-name <name>] [--mock-phone 0900000xxx] [--port <port>] [--lan [--host <ipv4>] | --tunnel [--tunnel-hours <n>]]",
	"  pnpm zalo:dev --app customer [--live [--tenant <slug>] [--brand <key>] [--mock-user mock-<id>] [--mock-name <name>] [--mock-phone 0900000xxx]] [--port <port>] [--lan [--host <ipv4>] | --tunnel [--tunnel-hours <n>]]",
	"  pnpm zalo:dev forget [--tenant <slug>] [--brand <key>]",
	"",
	`Runs the staff Mini App in the browser against the real zalo-session on this PC: a mock Zalo graph, zalo-session and zalo-phone under Deno with ZALO_LOCAL_DEV=1 on the local stack, and the app's dev server. Defaults: --tenant ${LOCAL_LOOP_DEFAULTS.tenant}, --brand ${LOCAL_LOOP_DEFAULTS.brand}, --mock-user ${LOCAL_LOOP_DEFAULTS.mockUser}, --port ${LOCAL_LOOP_DEFAULTS.port}; the member is the login in ${MEMBER_EMAIL_VARIABLE}.`,
	"The brand needs its Zalo rows first (fnb zalo config set) with a mock Zalo App id (mock-…). On the first run the mock user is bound to the member with a one-time binding code. The staff app's loyalty tools call the staff loyalty functions of the local stack when it has them, and show the demo data otherwise (?loyalty=demo or ?loyalty=live in the address switches).",
	"--mock-phone sets the synthetic number the mock Zalo graph answers for the phone permission (default 0900000789); it must be one of 0900000000 to 0900000999.",
	`--lan serves the staff app on this PC's home network address (or --host <ipv4>) for a phone on the same Wi-Fi. --tunnel serves it on a public https link through a Cloudflare quick tunnel that stops after --tunnel-hours (default ${LOCAL_LOOP_DEFAULTS.tunnelHours}, at most ${MAX_TUNNEL_HOURS}). Both print a link with a one-time key and its QR code; without the key every request gets 403.`,
	`--app customer runs the customer Mini App instead, on port ${CUSTOMER_LOOP_PORT} by default: with its demo data and the stand-in session (no database or .env needed), or with --live against the real zalo-session, zalo-phone and the customer functions of the local stack as the mock user, who is a customer and needs no binding code. --live targets ${CUSTOMER_LIVE_TENANT} by default and seeds a synthetic brand with mock Zalo ids into a synthetic tenant (${CUSTOMER_LIVE_TENANT} or zalo-it-…) that has none.`,
	"forget removes the brand's Zalo rows and mock identities when every Zalo id is a mock id, so fnb zalo config set can store the real ids.",
].join("\n");

export type LocalLoopCommand = "start" | "forget";
export type LocalLoopExposure = "loopback" | "lan" | "tunnel";

export interface LocalLoopOptions {
	readonly command: LocalLoopCommand;
	readonly tenant: string;
	readonly brand: string;
	readonly member: string | null;
	readonly mockUser: string;
	readonly mockName: string;
	readonly port: number;
	readonly exposure: LocalLoopExposure;
	readonly host: string | null;
	readonly tunnelHours: number;
	readonly app?: "customer";
	readonly live?: boolean;
	readonly mockPhone?: string;
}

export class LocalLoopError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LocalLoopError";
	}
}

export function isMockId(value: string): boolean {
	return (
		value.startsWith(MOCK_ID_PREFIX) && value.length > MOCK_ID_PREFIX.length
	);
}

function portOf(value: string | undefined): number {
	if (value === undefined) {
		return LOCAL_LOOP_DEFAULTS.port;
	}
	const port = Number(value);
	if (!/^[0-9]{4,5}$/.test(value) || port < 1024 || port > 65535) {
		throw new LocalLoopError("--port must be a port from 1024 to 65535");
	}
	return port;
}

const IPV4_PATTERN =
	/^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$/;

export function isIpv4(value: string): boolean {
	return IPV4_PATTERN.test(value);
}

function hostOf(value: string | undefined, lan: boolean): string | null {
	if (value === undefined) {
		return null;
	}
	if (!lan) {
		throw new LocalLoopError("--host picks the address of --lan; add --lan");
	}
	const host = value.trim();
	if (!isIpv4(host)) {
		throw new LocalLoopError(
			"--host must be an IPv4 address of this PC such as 192.168.1.20",
		);
	}
	if (
		host.startsWith("127.") ||
		host.startsWith("0.") ||
		host === "255.255.255.255"
	) {
		throw new LocalLoopError(
			"--host must be this PC's address on the home network, not a loopback or unspecified address",
		);
	}
	return host;
}

function tunnelHoursOf(value: string | undefined, tunnel: boolean): number {
	if (value === undefined) {
		return LOCAL_LOOP_DEFAULTS.tunnelHours;
	}
	if (!tunnel) {
		throw new LocalLoopError("--tunnel-hours is used with --tunnel");
	}
	const hours = Number(value);
	if (
		!/^[0-9]{1,2}(\.[0-9]{1,2})?$/.test(value) ||
		hours <= 0 ||
		hours > MAX_TUNNEL_HOURS
	) {
		throw new LocalLoopError(
			`--tunnel-hours must be more than 0 and at most ${MAX_TUNNEL_HOURS}`,
		);
	}
	return hours;
}

export function parseLocalLoopArgs(
	argv: readonly string[],
): LocalLoopOptions | "help" {
	let parsed: ReturnType<typeof parse>;
	try {
		parsed = parse(argv[0] === "--" ? argv.slice(1) : argv);
	} catch (error) {
		throw new LocalLoopError(
			error instanceof Error ? error.message : String(error),
		);
	}
	const { values, positionals: words } = parsed;
	if (values.help) {
		return "help";
	}
	if (words.length > 1 || (words[0] !== undefined && words[0] !== "forget")) {
		throw new LocalLoopError(
			`unknown command "${words.join(" ")}"; run pnpm zalo:dev --help`,
		);
	}
	const tenant =
		values.tenant ??
		(values.app === "customer" && values.live === true
			? CUSTOMER_LIVE_TENANT
			: LOCAL_LOOP_DEFAULTS.tenant);
	if (!TENANT_SLUG_PATTERN.test(tenant)) {
		throw new LocalLoopError(
			"--tenant must be a tenant slug such as live-local",
		);
	}
	const brand = values.brand ?? LOCAL_LOOP_DEFAULTS.brand;
	if (!BRAND_KEY_PATTERN.test(brand)) {
		throw new LocalLoopError("--brand must be a neutral key such as brand-1");
	}
	const mockUser = values["mock-user"] ?? LOCAL_LOOP_DEFAULTS.mockUser;
	if (!MOCK_USER_PATTERN.test(mockUser)) {
		throw new LocalLoopError(
			"--mock-user must be a mock Zalo user id that starts with mock-",
		);
	}
	const mockName = (values["mock-name"] ?? LOCAL_LOOP_DEFAULTS.mockName).trim();
	if (
		mockName === "" ||
		[...mockName].length > DISPLAY_NAME_MAX_LENGTH ||
		/\p{Cc}/u.test(mockName)
	) {
		throw new LocalLoopError(
			`--mock-name must be 1 to ${DISPLAY_NAME_MAX_LENGTH} characters without control characters`,
		);
	}
	const mockPhone = values["mock-phone"]?.trim();
	if (mockPhone !== undefined && !MOCK_PHONE_PATTERN.test(mockPhone)) {
		throw new LocalLoopError(
			"--mock-phone must be a synthetic number from 0900000000 to 0900000999",
		);
	}
	const member = values.member?.trim() ?? "";
	const lan = values.lan === true;
	const tunnel = values.tunnel === true;
	if (lan && tunnel) {
		throw new LocalLoopError("choose --lan or --tunnel, not both");
	}
	const app = LOCAL_LOOP_APPS.find((name) => name === (values.app ?? "staff"));
	if (app === undefined) {
		throw new LocalLoopError("--app must be staff or customer");
	}
	const live = values.live === true;
	if (live && app !== "customer") {
		throw new LocalLoopError(
			"--live runs the customer app against the local stack; add --app customer",
		);
	}
	if (app === "customer" && member !== "") {
		throw new LocalLoopError(
			"--member is for the staff app; the customer app's mock user is a customer",
		);
	}
	return {
		command: words[0] === "forget" ? "forget" : "start",
		tenant,
		brand,
		member: member === "" ? null : member,
		mockUser,
		mockName,
		port:
			app === "customer" && values.port === undefined
				? CUSTOMER_LOOP_PORT
				: portOf(values.port),
		exposure: tunnel ? "tunnel" : lan ? "lan" : "loopback",
		host: hostOf(values.host, lan),
		tunnelHours: tunnelHoursOf(values["tunnel-hours"], tunnel),
		...(app === "customer" ? { app, live } : {}),
		...(mockPhone === undefined ? {} : { mockPhone }),
	};
}

function parse(argv: readonly string[]) {
	return parseArgs({
		args: [...argv],
		allowPositionals: true,
		options: {
			help: { type: "boolean", short: "h" },
			tenant: { type: "string" },
			brand: { type: "string" },
			member: { type: "string" },
			"mock-user": { type: "string" },
			"mock-name": { type: "string" },
			"mock-phone": { type: "string" },
			port: { type: "string" },
			lan: { type: "boolean" },
			host: { type: "string" },
			tunnel: { type: "boolean" },
			"tunnel-hours": { type: "string" },
			app: { type: "string" },
			live: { type: "boolean" },
		},
	});
}
