import { parseArgs } from "node:util";
import { DISPLAY_NAME_MAX_LENGTH } from "../graph.js";
import { BRAND_KEY_PATTERN } from "../session.js";

export const MOCK_ID_PREFIX = "mock-";
export const MOCK_USER_PATTERN = /^mock-[A-Za-z0-9_-]{1,59}$/;
export const TENANT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const MEMBER_EMAIL_VARIABLE = "FNB_MEMBER_EMAIL";
export const LOCAL_LOOP_DEFAULTS = {
	tenant: "live-local",
	brand: "brand-1",
	mockUser: "mock-user-1",
	mockName: "Người dùng Zalo thử",
	port: 5741,
} as const;

export const LOCAL_LOOP_USAGE = [
	"Usage:",
	"  pnpm zalo:dev [--tenant <slug>] [--brand <key>] [--member <login e-mail>] [--mock-user mock-<id>] [--mock-name <name>] [--port <port>]",
	"  pnpm zalo:dev forget [--tenant <slug>] [--brand <key>]",
	"",
	`Runs the staff Mini App in the browser against the real zalo-session on this PC: a mock Zalo graph, zalo-session under Deno with ZALO_LOCAL_DEV=1 on the local stack, and the app's dev server. Defaults: --tenant ${LOCAL_LOOP_DEFAULTS.tenant}, --brand ${LOCAL_LOOP_DEFAULTS.brand}, --mock-user ${LOCAL_LOOP_DEFAULTS.mockUser}, --port ${LOCAL_LOOP_DEFAULTS.port}; the member is the login in ${MEMBER_EMAIL_VARIABLE}.`,
	"The brand needs its Zalo rows first (fnb zalo config set) with a mock Zalo App id (mock-…). On the first run the mock user is bound to the member with a one-time binding code.",
	"forget removes the brand's Zalo rows and mock identities when every Zalo id is a mock id, so fnb zalo config set can store the real ids.",
].join("\n");

export type LocalLoopCommand = "start" | "forget";

export interface LocalLoopOptions {
	readonly command: LocalLoopCommand;
	readonly tenant: string;
	readonly brand: string;
	readonly member: string | null;
	readonly mockUser: string;
	readonly mockName: string;
	readonly port: number;
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
	const tenant = values.tenant ?? LOCAL_LOOP_DEFAULTS.tenant;
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
	const member = values.member?.trim() ?? "";
	return {
		command: words[0] === "forget" ? "forget" : "start",
		tenant,
		brand,
		member: member === "" ? null : member,
		mockUser,
		mockName,
		port: portOf(values.port),
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
			port: { type: "string" },
		},
	});
}
