export const REST_PATH = "/rest/v1";
export const REST_TIMEOUT_MS = 15_000;
export const REST_NETWORK_FAILURE = 0;

const NAME = /^[a-z][a-z0-9_]{0,62}$/;

export class RestError extends Error {
	readonly status: number;

	constructor(status: number) {
		super(
			status === REST_NETWORK_FAILURE
				? "the data request did not complete"
				: `the data request was answered with ${status}`,
		);
		this.name = "RestError";
		this.status = status;
	}
}

export interface RestClientOptions {
	readonly url: string;
	readonly publishableKey: string;
	readonly accessToken: string;
	readonly fetch?: typeof fetch;
	readonly timeoutMs?: number;
}

export interface RestClient {
	select(
		table: string,
		query: Readonly<Record<string, string>>,
	): Promise<unknown[]>;
	rpc(fn: string, args?: Readonly<Record<string, unknown>>): Promise<unknown>;
}

function checkedName(name: string): string {
	if (!NAME.test(name))
		throw new Error(`not a table or function name: ${name}`);
	return name;
}

export function createRestClient(options: RestClientOptions): RestClient {
	const send = options.fetch ?? ((input, init) => fetch(input, init));
	const base = `${options.url.replace(/\/+$/, "")}${REST_PATH}`;
	const headers = {
		apikey: options.publishableKey,
		Authorization: `Bearer ${options.accessToken}`,
		Accept: "application/json",
	};

	async function request(path: string, init: RequestInit): Promise<unknown> {
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(),
			options.timeoutMs ?? REST_TIMEOUT_MS,
		);
		try {
			let response: Response;
			try {
				response = await send(`${base}/${path}`, {
					...init,
					signal: controller.signal,
				});
			} catch {
				throw new RestError(REST_NETWORK_FAILURE);
			}
			if (!response.ok) {
				try {
					await response.body?.cancel();
				} catch {}
				throw new RestError(response.status);
			}
			try {
				return await response.json();
			} catch {
				throw new RestError(REST_NETWORK_FAILURE);
			}
		} finally {
			clearTimeout(timer);
		}
	}

	return {
		async select(table, query) {
			const search = new URLSearchParams(query).toString();
			const rows = await request(
				`${checkedName(table)}${search === "" ? "" : `?${search}`}`,
				{ method: "GET", headers },
			);
			if (!Array.isArray(rows)) throw new RestError(REST_NETWORK_FAILURE);
			return rows;
		},
		async rpc(fn, args = {}) {
			return request(`rpc/${checkedName(fn)}`, {
				method: "POST",
				headers: { ...headers, "Content-Type": "application/json" },
				body: JSON.stringify(args),
			});
		},
	};
}
