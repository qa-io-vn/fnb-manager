import type { Page } from "@playwright/test";

/**
 * A Vietnamese phone number in full: national `0` + 9 digits, `+84` + 9 digits or `84` + 9 digits, not part of a longer
 * run of digits (an epoch in milliseconds or an amount is not a phone) and not part of an identifier (ten digits
 * inside a UUID, such as `...-8e5f-0123456790ab`, are not a phone: one in a few hundred ids did show as a leak).
 */
const FULL_PHONE = /(?<![\w-])(?:0\d{9}|\+?84\d{9})(?![\w-])/g;

/**
 * Every full phone in a text, each shortened to its last three digits so a failure never prints the number, except the
 * numbers in `allowed` (a session's own phone, in national or international form).
 */
export function findFullPhones(
	text: string,
	allowed: readonly string[] = [],
): string[] {
	let rest = text;
	for (const phone of allowed) {
		const national = phone.startsWith("+84") ? `0${phone.slice(3)}` : phone;
		const international = `+84${national.slice(1)}`;
		for (const form of [international, `84${national.slice(1)}`, national]) {
			rest = rest.split(form).join("");
		}
	}
	return (rest.match(FULL_PHONE) ?? []).map((found) => `…${found.slice(-3)}`);
}

export interface ResponseScan {
	/** the responses of the watched origin read so far, as `METHOD path (status)` */
	responses(): Promise<string[]>;
	/** `METHOD path: …123` for each full phone found in a response body, once every pending body is read */
	leaks(): Promise<string[]>;
}

/**
 * G-06 at browser level: reads the body of every data response (the `/rest/v1/`, `/functions/v1/`, `/auth/v1/` and
 * `/storage/v1/` paths the local loop proxies) that the app at `origin` receives and reports each full phone number in them. `allowed` lists the phones the session may see (a customer's own).
 */
export function watchResponsePhones(
	page: Page,
	origin: string,
	allowed: readonly string[] = [],
): ResponseScan {
	const data = /\/(?:rest|functions|auth|storage)\/v1\//;
	const reads: Promise<{ line: string; found: string[] }>[] = [];
	page.on("response", (response) => {
		const url = new URL(response.url());
		if (url.origin !== origin || !data.test(url.pathname)) return;
		const line = `${response.request().method()} ${url.pathname} (${response.status()})`;
		reads.push(
			response.text().then(
				(body) => ({ line, found: findFullPhones(body, allowed) }),
				() => ({ line, found: [] }),
			),
		);
	});
	return {
		async responses() {
			return (await Promise.all(reads)).map((read) => read.line);
		},
		async leaks() {
			return (await Promise.all(reads)).flatMap((read) =>
				read.found.map((found) => `${read.line}: ${found}`),
			);
		},
	};
}

export interface RpcCredentials {
	/** the address of one RPC call the page made; another function's address is derived from it */
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
}

/**
 * Remembers the session a page calls the data API with (the address, the `apikey` and the bearer of its latest RPC call)
 * so a spec can replay another function as that session. The values stay in memory; never print them.
 */
export function watchRpcCredentials(page: Page): () => RpcCredentials {
	let found: RpcCredentials | null = null;
	page.on("request", (request) => {
		if (!request.url().includes("/rest/v1/rpc/")) return;
		const headers = request.headers();
		const bearer = headers.authorization;
		const key = headers.apikey;
		if (bearer === undefined || key === undefined) return;
		found = {
			url: request.url(),
			headers: { authorization: bearer, apikey: key },
		};
	});
	return () => {
		if (found === null) throw new Error("the page made no RPC call yet");
		return found;
	};
}

export interface RpcReply {
	readonly status: number;
	/** the PostgREST error code (such as 42501) or null */
	readonly code: string | null;
	readonly body: unknown;
}

/** Calls `name` with `args` as the session of `credentials` (`anonymous` leaves the bearer out). */
export async function callRpc(
	credentials: RpcCredentials,
	name: string,
	args: Readonly<Record<string, unknown>>,
	options: { readonly anonymous?: boolean } = {},
): Promise<RpcReply> {
	const url = credentials.url.replace(/\/rpc\/[^/?]+/, `/rpc/${name}`);
	const headers: Record<string, string> = {
		"content-type": "application/json",
		apikey: credentials.headers.apikey ?? "",
	};
	if (options.anonymous !== true)
		headers.authorization = credentials.headers.authorization ?? "";
	const response = await fetch(url.split("?")[0] ?? url, {
		method: "POST",
		headers,
		body: JSON.stringify(args),
	});
	const text = await response.text();
	let body: unknown = text;
	try {
		body = JSON.parse(text);
	} catch {
		// not JSON: keep the text
	}
	const code =
		typeof body === "object" && body !== null && "code" in body
			? String((body as { code: unknown }).code)
			: null;
	return { status: response.status, code, body };
}
