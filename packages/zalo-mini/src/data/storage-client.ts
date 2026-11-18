import { REST_NETWORK_FAILURE, RestError } from "./rest-client";

export const STORAGE_PATH = "/storage/v1";
export const STORAGE_TIMEOUT_MS = 60_000;
export const DUPLICATE_OBJECT = 409;

const BUCKET = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/;
const HTTP_STATUS = /^[1-5][0-9]{2}$/;

export interface StorageRequest {
	readonly method: "GET" | "POST";
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly body?: Blob;
	readonly responseType: "json" | "blob";
	readonly timeoutMs: number;
	readonly onProgress?: (fraction: number) => void;
}

export interface StorageAnswer {
	readonly status: number;
	readonly body: unknown;
}

export type StorageTransport = (
	request: StorageRequest,
) => Promise<StorageAnswer>;

export interface StorageClientOptions {
	readonly url: string;
	readonly publishableKey: string;
	readonly accessToken: string;
	readonly transport?: StorageTransport;
	readonly timeoutMs?: number;
}

export interface UploadOptions {
	readonly contentType?: string;
	readonly onProgress?: (fraction: number) => void;
}

export interface StorageClient {
	upload(
		bucket: string,
		name: string,
		body: Blob,
		options?: UploadOptions,
	): Promise<void>;
	download(bucket: string, name: string): Promise<Blob>;
}

export function objectPath(bucket: string, name: string): string {
	if (!BUCKET.test(bucket)) throw new Error("not a bucket name");
	const segments = name.split("/");
	if (
		segments.length === 0 ||
		segments.some((segment) => !SEGMENT.test(segment) || segment === "..")
	) {
		throw new Error("not an object name");
	}
	return `${bucket}/${segments.map(encodeURIComponent).join("/")}`;
}

function statusOf(answer: StorageAnswer): number {
	const body = answer.body;
	if (typeof body === "object" && body !== null && !(body instanceof Blob)) {
		const code = (body as Readonly<Record<string, unknown>>).statusCode;
		const text = typeof code === "number" ? String(code) : code;
		if (typeof text === "string" && HTTP_STATUS.test(text)) return Number(text);
	}
	return answer.status;
}

export const xhrTransport: StorageTransport = (request) =>
	new Promise((resolve) => {
		const xhr = new XMLHttpRequest();
		xhr.open(request.method, request.url);
		xhr.responseType = request.responseType === "blob" ? "blob" : "text";
		xhr.timeout = request.timeoutMs;
		for (const [name, value] of Object.entries(request.headers)) {
			xhr.setRequestHeader(name, value);
		}
		const onProgress = request.onProgress;
		if (onProgress !== undefined) {
			xhr.upload.onprogress = (event) => {
				if (event.lengthComputable && event.total > 0)
					onProgress(Math.min(1, event.loaded / event.total));
			};
		}
		const lost = () => resolve({ status: REST_NETWORK_FAILURE, body: null });
		xhr.onerror = lost;
		xhr.ontimeout = lost;
		xhr.onabort = lost;
		xhr.onload = () => {
			if (request.responseType === "blob" && xhr.status < 300) {
				resolve({ status: xhr.status, body: xhr.response });
				return;
			}
			let body: unknown = null;
			try {
				body =
					xhr.response instanceof Blob
						? null
						: JSON.parse(String(xhr.response ?? ""));
			} catch {}
			resolve({ status: xhr.status, body });
		};
		xhr.send(request.body ?? null);
	});

export function createStorageClient(
	options: StorageClientOptions,
): StorageClient {
	const send = options.transport ?? xhrTransport;
	const base = `${options.url.replace(/\/+$/, "")}${STORAGE_PATH}`;
	const headers = {
		apikey: options.publishableKey,
		Authorization: `Bearer ${options.accessToken}`,
	};
	const timeoutMs = options.timeoutMs ?? STORAGE_TIMEOUT_MS;

	return {
		async upload(bucket, name, body, uploadOptions = {}) {
			const answer = await send({
				method: "POST",
				url: `${base}/object/${objectPath(bucket, name)}`,
				headers: {
					...headers,
					"Content-Type": uploadOptions.contentType ?? "image/jpeg",
					"x-upsert": "false",
				},
				body,
				responseType: "json",
				timeoutMs,
				...(uploadOptions.onProgress === undefined
					? {}
					: { onProgress: uploadOptions.onProgress }),
			});
			if (answer.status >= 200 && answer.status < 300) return;
			const status = statusOf(answer);
			if (status === DUPLICATE_OBJECT) return;
			throw new RestError(status);
		},
		async download(bucket, name) {
			const answer = await send({
				method: "GET",
				url: `${base}/object/authenticated/${objectPath(bucket, name)}`,
				headers,
				responseType: "blob",
				timeoutMs,
			});
			if (answer.status >= 200 && answer.status < 300) {
				if (answer.body instanceof Blob) return answer.body;
				throw new RestError(REST_NETWORK_FAILURE);
			}
			throw new RestError(statusOf(answer));
		},
	};
}
