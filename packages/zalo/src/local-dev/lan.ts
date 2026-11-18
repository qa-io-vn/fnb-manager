import { randomBytes } from "node:crypto";
import { type NetworkInterfaceInfo, networkInterfaces } from "node:os";
import { encode } from "uqr";
import { isIpv4, LocalLoopError } from "./options.js";

export const ACCESS_KEY_BYTES = 32;
export const ACCESS_KEY_PARAMETER = "key";
export const ALL_INTERFACES = "0.0.0.0";

const VIRTUAL_ADAPTER =
	/vethernet|virtual|vmware|vbox|hyper-v|wsl|docker|podman|tailscale|zerotier|wireguard|vpn|loopback|bluetooth|bridge|^(tun|tap|utun|veth|br-|virbr)|^lo[0-9]*$/i;
const WIRELESS_ADAPTER = /wi-?fi|wlan|wireless|^wl/i;
const CHECK_TIMEOUT_MS = 10_000;

export type NetworkInterfaces = Readonly<
	Record<string, readonly NetworkInterfaceInfo[] | undefined>
>;

export interface LanAddress {
	readonly name: string;
	readonly address: string;
}

export interface LanHost {
	readonly host: string;
	readonly found: boolean;
	readonly others: readonly LanAddress[];
}

function isPrivateIpv4(address: string): boolean {
	const [first = 0, second = 0] = address.split(".").map(Number);
	return (
		first === 10 ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 168)
	);
}

function ownIpv4(interfaces: NetworkInterfaces): LanAddress[] {
	return Object.entries(interfaces).flatMap(([name, infos]) =>
		(infos ?? [])
			.filter(
				(info) =>
					info.family === "IPv4" && !info.internal && isIpv4(info.address),
			)
			.map((info) => ({ name, address: info.address })),
	);
}

export function lanAddresses(
	interfaces: NetworkInterfaces = networkInterfaces(),
): LanAddress[] {
	const rank = (entry: LanAddress) =>
		WIRELESS_ADAPTER.test(entry.name) ? 0 : 1;
	return ownIpv4(interfaces)
		.filter(
			(entry) =>
				isPrivateIpv4(entry.address) && !VIRTUAL_ADAPTER.test(entry.name),
		)
		.sort((left, right) => rank(left) - rank(right));
}

export function chooseLanHost(
	requested: string | null,
	interfaces: NetworkInterfaces = networkInterfaces(),
): LanHost {
	if (requested !== null) {
		const own = ownIpv4(interfaces);
		if (!own.some((entry) => entry.address === requested)) {
			throw new LocalLoopError(
				`--host ${requested} is not an IPv4 address of this PC${
					own.length === 0
						? ""
						: `; its addresses are ${own.map((entry) => `${entry.address} (${entry.name})`).join(", ")}`
				}`,
			);
		}
		return { host: requested, found: true, others: [] };
	}
	const [first, ...others] = lanAddresses(interfaces);
	return first === undefined
		? { host: ALL_INTERFACES, found: false, others: [] }
		: { host: first.address, found: true, others };
}

export function newAccessKey(): string {
	return randomBytes(ACCESS_KEY_BYTES).toString("base64url");
}

export function keyedUrl(baseUrl: string, key: string): string {
	const url = new URL(baseUrl);
	url.searchParams.set(ACCESS_KEY_PARAMETER, key);
	return url.toString();
}

const DARK_ON_LIGHT = {
	dark: "30",
	light: "97",
	darkBack: "40",
	lightBack: "107",
};

export function qrCodeLines(text: string): string[] {
	const { data } = encode(text, { ecc: "M", border: 4 });
	const lines: string[] = [];
	for (let row = 0; row < data.length; row += 2) {
		const top = data[row] ?? [];
		const bottom = data[row + 1];
		const cells = top.map((dark, column) => {
			const below = bottom?.[column] ?? false;
			const foreground = dark ? DARK_ON_LIGHT.dark : DARK_ON_LIGHT.light;
			const background = below
				? DARK_ON_LIGHT.darkBack
				: DARK_ON_LIGHT.lightBack;
			return `\u001b[${foreground};${background}m▀`;
		});
		lines.push(`${cells.join("")}\u001b[0m`);
	}
	return lines;
}

async function answer(
	url: string,
	cookie: string | null,
): Promise<{ readonly status: number; readonly cookie: string | null }> {
	const response = await fetch(url, {
		redirect: "manual",
		headers: cookie === null ? {} : { cookie },
		signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
	});
	await response.body?.cancel();
	const setCookie = response.headers.get("set-cookie");
	return {
		status: response.status,
		cookie: setCookie === null ? null : (setCookie.split(";")[0] ?? null),
	};
}

export async function accessProblem(
	appUrl: string,
	key: string,
): Promise<string | null> {
	try {
		const stranger = await answer(appUrl, null);
		if (stranger.status !== 403) {
			return `answered ${stranger.status} instead of 403 without the key`;
		}
		const wrong = await answer(keyedUrl(appUrl, newAccessKey()), null);
		if (wrong.status !== 403 || wrong.cookie !== null) {
			return `answered ${wrong.status} instead of 403 to a wrong key`;
		}
		const admitted = await answer(keyedUrl(appUrl, key), null);
		if (admitted.status !== 200 || admitted.cookie === null) {
			return `did not admit the printed link (${admitted.status})`;
		}
		const page = await answer(appUrl, admitted.cookie);
		return page.status === 200
			? null
			: `answered ${page.status} to the key cookie`;
	} catch {
		return "did not answer";
	}
}
