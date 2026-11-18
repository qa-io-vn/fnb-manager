import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { NetworkInterfaceInfo } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encode } from "uqr";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clockTime } from "../../src/local-dev/cli.js";
import {
	CLOUDFLARED_ASSET,
	CLOUDFLARED_RELEASE,
	type CloudflaredRelease,
	cloudflaredDir,
	ensureCloudflared,
	tunnelArguments,
	tunnelHostFrom,
	tunnelPlatformProblem,
} from "../../src/local-dev/cloudflared.js";
import { staffAppEnvironment } from "../../src/local-dev/environment.js";
import {
	ALL_INTERFACES,
	chooseLanHost,
	keyedUrl,
	lanAddresses,
	type NetworkInterfaces,
	newAccessKey,
	qrCodeLines,
} from "../../src/local-dev/lan.js";
import {
	LocalLoopError,
	parseLocalLoopArgs,
} from "../../src/local-dev/options.js";

function refusal(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(LocalLoopError);
		return (error as Error).message;
	}
	throw new Error("nothing was refused");
}

async function rejection(run: () => Promise<unknown>): Promise<string> {
	try {
		await run();
	} catch (error) {
		expect(error).toBeInstanceOf(LocalLoopError);
		return (error as Error).message;
	}
	throw new Error("nothing was refused");
}

function ipv4(address: string, internal = false): NetworkInterfaceInfo {
	return {
		address,
		netmask: "255.255.255.0",
		family: "IPv4",
		mac: "00:00:00:00:00:00",
		internal,
		cidr: `${address}/24`,
	};
}

function ipv6(address: string): NetworkInterfaceInfo {
	return {
		address,
		netmask: "ffff:ffff:ffff:ffff::",
		family: "IPv6",
		mac: "00:00:00:00:00:00",
		internal: false,
		cidr: `${address}/64`,
		scopeid: 0,
	};
}

const HOME_PC: NetworkInterfaces = {
	"vEthernet (WSL (Hyper-V firewall))": [ipv4("172.26.144.1")],
	Ethernet: [ipv4("10.0.0.5")],
	"Wi-Fi 3": [ipv6("fe80::1"), ipv4("192.168.1.20")],
	"Loopback Pseudo-Interface 1": [ipv4("127.0.0.1", true)],
	Tailscale: [ipv4("100.64.0.3")],
	"Local Area Connection* 2": [ipv4("169.254.10.10")],
};
const QR_CELL = new RegExp(
	`${String.fromCharCode(27)}\\[(30|97);(40|107)m▀`,
	"g",
);

describe("pnpm zalo:dev --lan and --tunnel options", () => {
	it("take --lan with an optional --host, and --tunnel with its hours", () => {
		expect(parseLocalLoopArgs(["--lan"])).toMatchObject({
			exposure: "lan",
			host: null,
			tunnelHours: 4,
		});
		expect(
			parseLocalLoopArgs(["--lan", "--host", "192.168.1.20", "--port", "5766"]),
		).toMatchObject({ exposure: "lan", host: "192.168.1.20", port: 5766 });
		expect(parseLocalLoopArgs(["--tunnel"])).toMatchObject({
			exposure: "tunnel",
			host: null,
			tunnelHours: 4,
		});
		expect(
			parseLocalLoopArgs(["--tunnel", "--tunnel-hours", "0.5"]),
		).toMatchObject({ exposure: "tunnel", tunnelHours: 0.5 });
		expect(
			parseLocalLoopArgs(["--tunnel", "--tunnel-hours", "12"]),
		).toMatchObject({ tunnelHours: 12 });
	});

	it("refuse a host without --lan, a loopback or malformed host, both modes and hours past 12", () => {
		expect(
			refusal(() => parseLocalLoopArgs(["--host", "192.168.1.20"])),
		).toContain("add --lan");
		for (const host of ["127.0.0.1", "0.0.0.0", "255.255.255.255"]) {
			expect(
				refusal(() => parseLocalLoopArgs(["--lan", "--host", host])),
			).toContain("not a loopback or unspecified address");
		}
		for (const host of ["300.1.2.3", "192.168.1", "fe80::1", "pc.local"]) {
			expect(
				refusal(() => parseLocalLoopArgs(["--lan", "--host", host])),
			).toContain("must be an IPv4 address");
		}
		expect(refusal(() => parseLocalLoopArgs(["--lan", "--tunnel"]))).toBe(
			"choose --lan or --tunnel, not both",
		);
		for (const hours of ["0", "13", "12.5", "four", "1e1"]) {
			expect(
				refusal(() =>
					parseLocalLoopArgs(["--tunnel", "--tunnel-hours", hours]),
				),
			).toContain("at most 12");
		}
		expect(
			refusal(() => parseLocalLoopArgs(["--tunnel-hours", "2"])),
		).toContain("used with --tunnel");
	});
});

describe("the LAN address of the PC", () => {
	it("prefers the Wi-Fi address and skips loopback, link-local, virtual and VPN adapters", () => {
		expect(lanAddresses(HOME_PC)).toEqual([
			{ name: "Wi-Fi 3", address: "192.168.1.20" },
			{ name: "Ethernet", address: "10.0.0.5" },
		]);
		expect(chooseLanHost(null, HOME_PC)).toEqual({
			host: "192.168.1.20",
			found: true,
			others: [{ name: "Ethernet", address: "10.0.0.5" }],
		});
	});

	it("takes --host only when it is an address of this PC", () => {
		expect(chooseLanHost("10.0.0.5", HOME_PC)).toEqual({
			host: "10.0.0.5",
			found: true,
			others: [],
		});
		expect(chooseLanHost("172.26.144.1", HOME_PC).host).toBe("172.26.144.1");
		expect(refusal(() => chooseLanHost("192.168.1.99", HOME_PC))).toContain(
			"is not an IPv4 address of this PC; its addresses are 172.26.144.1",
		);
	});

	it("falls back to every interface when no LAN address exists", () => {
		expect(
			chooseLanHost(null, {
				"Loopback Pseudo-Interface 1": [ipv4("127.0.0.1", true)],
				"vEthernet (Default Switch)": [ipv4("172.20.0.1")],
			}),
		).toEqual({ host: ALL_INTERFACES, found: false, others: [] });
	});
});

describe("the one-time key and its link", () => {
	it("is 256 random bits in base64url, new on every start", () => {
		const keys = new Set(Array.from({ length: 50 }, () => newAccessKey()));
		expect(keys.size).toBe(50);
		for (const key of keys) {
			expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
			expect(Buffer.from(key, "base64url")).toHaveLength(32);
		}
	});

	it("rides in the link and its QR code", () => {
		const key = "k".repeat(43);
		expect(keyedUrl("http://192.168.1.20:5766/", key)).toBe(
			`http://192.168.1.20:5766/?key=${key}`,
		);
		expect(keyedUrl("https://sample-words-here.trycloudflare.com/", key)).toBe(
			`https://sample-words-here.trycloudflare.com/?key=${key}`,
		);
		const link = `https://sample-words-here-now.trycloudflare.com/?key=${key}`;
		const lines = qrCodeLines(link);
		expect(lines.every((line) => line.endsWith("\u001b[0m"))).toBe(true);
		const drawn = lines.flatMap((line) => {
			const cells = [...line.matchAll(QR_CELL)];
			return [
				cells.map((cell) => cell[1] === "30"),
				cells.map((cell) => cell[2] === "40"),
			];
		});
		const { data } = encode(link, { ecc: "M", border: 4 });
		expect(data[0]?.every((dark) => !dark)).toBe(true);
		expect(data.every((row) => !row[0])).toBe(true);
		expect(drawn.slice(0, data.length)).toEqual(data);
		expect(
			drawn
				.slice(data.length)
				.flat()
				.every((dark) => !dark),
		).toBe(true);
	});

	it("reaches the staff app only through its variables, never as VITE_", () => {
		const app = staffAppEnvironment(
			{ PATH: "/usr/bin" },
			{
				brand: "brand-1",
				publishableKey: "sb_publishable_synthetic",
				functionUrl: "http://127.0.0.1:40124",
				phoneFunctionUrl: "http://127.0.0.1:40125",
				accessToken: "mock-zalo-access-synthetic",
				appConfigPath: null,
				access: {
					key: "k".repeat(43),
					tunnelHost: "sample-words-here.trycloudflare.com",
					supabaseUrl: "http://127.0.0.1:54321",
				},
			},
		);
		expect(app).toMatchObject({
			ZALO_LOCAL_ACCESS_KEY: "k".repeat(43),
			ZALO_LOCAL_TUNNEL_HOST: "sample-words-here.trycloudflare.com",
			ZALO_LOCAL_SUPABASE_URL: "http://127.0.0.1:54321",
		});
		expect(
			Object.entries(app)
				.filter(([name]) => name.startsWith("VITE_"))
				.map(([, value]) => value),
		).not.toContain("k".repeat(43));
	});

	it("names the stop time of a public link", () => {
		const now = new Date(2026, 10, 18, 9, 5);
		expect(clockTime(new Date(2026, 10, 18, 13, 5), now)).toBe("13:05");
		expect(clockTime(new Date(2026, 10, 19, 1, 5), now)).toBe(
			"2026-11-19 01:05",
		);
	});
});

describe("the pinned cloudflared", () => {
	const root = mkdtempSync(join(tmpdir(), "fnb-cloudflared-"));
	const body = Buffer.from("synthetic cloudflared bytes");
	const digest = createHash("sha256").update(body).digest("hex");
	let server: Server;
	let downloads = 0;
	let baseUrl = "";
	const io = { line: () => undefined };

	beforeAll(async () => {
		server = createServer((_request, response) => {
			downloads += 1;
			response.writeHead(200, { "content-type": "application/octet-stream" });
			response.end(body);
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	afterAll(async () => {
		await new Promise((resolve) => server.close(resolve));
		rmSync(root, { recursive: true, force: true });
	});

	function release(version: string, sha256 = digest): CloudflaredRelease {
		return { version, url: `${baseUrl}/${CLOUDFLARED_ASSET}`, sha256 };
	}

	it("is an exact Windows x64 release with the SHA-256 its release publishes", () => {
		expect(CLOUDFLARED_RELEASE.version).toMatch(/^[0-9]{4}\.[0-9]+\.[0-9]+$/);
		expect(CLOUDFLARED_RELEASE.url).toBe(
			`https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_RELEASE.version}/cloudflared-windows-amd64.exe`,
		);
		expect(CLOUDFLARED_RELEASE.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(cloudflaredDir({ LOCALAPPDATA: root })).toBe(
			join(root, "fnb-cloudflared", CLOUDFLARED_RELEASE.version),
		);
		expect(tunnelPlatformProblem("win32", "x64")).toBeNull();
		expect(tunnelPlatformProblem("linux", "x64")).toContain("Windows x64");
		expect(tunnelArguments(5767)).toEqual([
			"tunnel",
			"--no-autoupdate",
			"--url",
			"http://127.0.0.1:5767",
		]);
	});

	it("is downloaded once into its own empty folder and kept when its SHA-256 matches", async () => {
		const env = { LOCALAPPDATA: root };
		const binary = await ensureCloudflared(env, io, release("1.0.0"));
		expect(binary).toBe(
			join(root, "fnb-cloudflared", "1.0.0", CLOUDFLARED_ASSET),
		);
		expect(readFileSync(binary)).toEqual(body);
		expect(readdirSync(join(root, "fnb-cloudflared", "1.0.0"))).toEqual([
			CLOUDFLARED_ASSET,
		]);
		const before = downloads;
		expect(await ensureCloudflared(env, io, release("1.0.0"))).toBe(binary);
		expect(downloads).toBe(before);
		writeFileSync(binary, "changed");
		expect(await ensureCloudflared(env, io, release("1.0.0"))).toBe(binary);
		expect(downloads).toBe(before + 1);
		expect(readFileSync(binary)).toEqual(body);
	});

	it("is removed when the download does not match the published SHA-256", async () => {
		const env = { LOCALAPPDATA: root };
		expect(
			await rejection(() =>
				ensureCloudflared(env, io, release("2.0.0", "0".repeat(64))),
			),
		).toContain("does not match the SHA-256");
		expect(readdirSync(join(root, "fnb-cloudflared", "2.0.0"))).toEqual([]);
	});

	it("is not downloaded into a folder that holds anything else", async () => {
		const dir = join(root, "fnb-cloudflared", "3.0.0");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "other.dll"), "x");
		expect(
			await rejection(() =>
				ensureCloudflared({ LOCALAPPDATA: root }, io, release("3.0.0")),
			),
		).toContain("only into an empty folder");
		expect(existsSync(join(dir, CLOUDFLARED_ASSET))).toBe(false);
	});

	it("announces the quick tunnel host and ignores the API host", () => {
		expect(
			tunnelHostFrom(
				"2026-11-18T03:00:00Z INF |  https://sample-words-here-now.trycloudflare.com                    |",
			),
		).toBe("sample-words-here-now.trycloudflare.com");
		expect(
			tunnelHostFrom(
				'2026-11-18T03:00:00Z ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp',
			),
		).toBeNull();
		expect(
			tunnelHostFrom("https://sample.trycloudflare.com.example.org/"),
		).toBeNull();
	});
});
