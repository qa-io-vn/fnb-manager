import { createHash, timingSafeEqual } from "node:crypto";
import type { EventEmitter } from "node:events";
import type {
	IncomingHttpHeaders,
	IncomingMessage,
	ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";

export const ACCESS_KEY_PARAMETER = "key";
export const ACCESS_COOKIE = "fnb_local_access";
export const SECURE_ACCESS_COOKIE = `__Host-${ACCESS_COOKIE}`;
export const ACCESS_KEY_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
export const TUNNEL_HOST_PATTERN = /^[a-z0-9-]+\.trycloudflare\.com$/;

const LOOPBACK_ADDRESS =
	/^(127(\.[0-9]{1,3}){3}|::1|::ffff:127(\.[0-9]{1,3}){3})$/i;
const URL_BASE = "http://dev-server.invalid";
const FORBIDDEN_UPGRADE =
	"HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";

export interface LocalAccess {
	readonly key: string | null;
	readonly tunnelHost: string | null;
}

export interface AccessRequest {
	readonly method?: string | undefined;
	readonly url?: string | undefined;
	readonly headers: IncomingHttpHeaders;
	readonly socket: { readonly remoteAddress?: string | undefined };
}

export type AccessDecision =
	| { readonly kind: "pass" }
	| {
			readonly kind: "admit";
			readonly location: string;
			readonly cookie: string;
	  }
	| { readonly kind: "deny" };

export function isLoopbackAddress(address: string | undefined): boolean {
	return address !== undefined && LOOPBACK_ADDRESS.test(address);
}

export function isForwarded(headers: IncomingHttpHeaders): boolean {
	return Object.keys(headers).some((name) => {
		const lower = name.toLowerCase();
		return (
			lower === "forwarded" ||
			lower === "x-real-ip" ||
			lower.startsWith("x-forwarded-") ||
			lower.startsWith("cf-")
		);
	});
}

export function accessCookieName(access: LocalAccess): string {
	return access.tunnelHost === null ? ACCESS_COOKIE : SECURE_ACCESS_COOKIE;
}

function digest(value: string): Buffer {
	return createHash("sha256").update(value).digest();
}

function sameKey(key: string, candidate: string): boolean {
	return timingSafeEqual(digest(key), digest(candidate));
}

function cookieValues(header: string | undefined, name: string): string[] {
	return (header ?? "").split(";").flatMap((part) => {
		const index = part.indexOf("=");
		return index > 0 && part.slice(0, index).trim() === name
			? [part.slice(index + 1).trim()]
			: [];
	});
}

function parseUrl(url: string | undefined): URL | null {
	try {
		return new URL(url ?? "/", URL_BASE);
	} catch {
		return null;
	}
}

export function accessDecision(
	access: LocalAccess,
	request: AccessRequest,
): AccessDecision {
	if (
		access.tunnelHost === null &&
		isLoopbackAddress(request.socket.remoteAddress) &&
		!isForwarded(request.headers)
	) {
		return { kind: "pass" };
	}
	const key = access.key;
	if (key === null) return { kind: "deny" };
	const name = accessCookieName(access);
	if (
		cookieValues(request.headers.cookie, name).some((value) =>
			sameKey(key, value),
		)
	) {
		return { kind: "pass" };
	}
	const method = request.method ?? "GET";
	const url = parseUrl(request.url);
	if (
		url === null ||
		(method !== "GET" && method !== "HEAD") ||
		!url.searchParams
			.getAll(ACCESS_KEY_PARAMETER)
			.some((value) => sameKey(key, value))
	) {
		return { kind: "deny" };
	}
	url.searchParams.delete(ACCESS_KEY_PARAMETER);
	return {
		kind: "admit",
		location: `${url.pathname.replace(/^\/+/, "/")}${url.search}`,
		cookie: [
			`${name}=${key}`,
			"Path=/",
			"HttpOnly",
			"SameSite=Strict",
			...(access.tunnelHost === null ? [] : ["Secure"]),
		].join("; "),
	};
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

export function admittedPage(location: string): string {
	const script = JSON.stringify(location).replaceAll("<", "\\u003c");
	const href = escapeHtml(location);
	return [
		"<!doctype html>",
		'<html lang="en">',
		'<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer">',
		`<noscript><meta http-equiv="refresh" content="0;url=${href}"></noscript>`,
		"<title>Opening the staff app</title></head>",
		`<body><script>location.replace(${script});</script><p><a href="${href}">Open the staff app</a></p></body>`,
		"</html>",
	].join("\n");
}

export const FORBIDDEN_PAGE = [
	"<!doctype html>",
	'<html lang="en">',
	'<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>403 Forbidden</title></head>',
	"<body><h1>403 Forbidden</h1><p>Open the link that pnpm zalo:dev printed on the PC, or scan its QR code. The link changes every time the loop starts.</p></body>",
	"</html>",
].join("\n");

const NO_STORE = {
	"cache-control": "no-store",
	"referrer-policy": "no-referrer",
	"x-content-type-options": "nosniff",
} as const;

export function localAccessGuard(
	access: LocalAccess,
): (
	request: IncomingMessage,
	response: ServerResponse,
	next: () => void,
) => void {
	return (request, response, next) => {
		const decision = accessDecision(access, request);
		if (decision.kind === "pass") {
			next();
			return;
		}
		const head = request.method === "HEAD";
		if (decision.kind === "admit") {
			response.writeHead(200, {
				...NO_STORE,
				"content-type": "text/html; charset=utf-8",
				"set-cookie": decision.cookie,
			});
			response.end(head ? undefined : admittedPage(decision.location));
			return;
		}
		response.writeHead(403, {
			...NO_STORE,
			"content-type": "text/html; charset=utf-8",
		});
		response.end(head ? undefined : FORBIDDEN_PAGE);
	};
}

export function guardUpgrades(server: EventEmitter, access: LocalAccess): void {
	const listeners = server.listeners("upgrade");
	server.removeAllListeners("upgrade");
	server.on(
		"upgrade",
		(request: IncomingMessage, socket: Duplex, head: Buffer) => {
			if (accessDecision(access, request).kind !== "pass") {
				socket.on("error", () => undefined);
				socket.end(FORBIDDEN_UPGRADE);
				return;
			}
			for (const listener of listeners) {
				Reflect.apply(listener, server, [request, socket, head]);
			}
		},
	);
}
