import type { FetchLike } from "../http.js";
import { vietnamDateISO } from "../time.js";
import { isRecord } from "./json.js";
import {
	describeSnapshotRequest,
	numberParam,
	type RangedRoute,
	type SnapshotRequest,
} from "./routes.js";
import { isFirstPage, rowsOfBody } from "./serve.js";
import {
	emptyManifest,
	monthsBetween,
	rowInRange,
	rowMonth,
	type SnapshotManifest,
	type SnapshotRow,
	type SnapshotStorage,
	widenCoverage,
} from "./storage.js";

export interface SnapshotRecorderOptions {
	onWarning?: (message: string) => void;
	now?: () => Date;
}

function withoutTrackId(body: unknown): unknown {
	if (!isRecord(body)) {
		return body;
	}
	const rest = { ...body };
	delete rest.track_id;
	return rest;
}

function withoutToken(body: unknown): unknown {
	const kept = withoutTrackId(body);
	if (!isRecord(kept) || !isRecord(kept.data)) {
		return kept;
	}
	const data = { ...kept.data };
	delete data.token;
	return { ...kept, data };
}

function replacedRange(
	route: RangedRoute,
	params: URLSearchParams,
	body: unknown,
): { start: number; end: number } | null {
	const start = numberParam(params, "start_date");
	const end = numberParam(params, "end_date");
	if (route.serve === "cursor") {
		const from = numberParam(params, "last_tran_date") ?? start;
		const next = isRecord(body) ? body.next_cursor : null;
		const to = typeof next === "number" ? next : end;
		return from === null || to === null ? null : { start: from, end: to };
	}
	if (start === null || end === null || !isFirstPage(route, params)) {
		return null;
	}
	return { start, end };
}

async function mergeRows(
	storage: SnapshotStorage,
	request: SnapshotRequest,
	route: RangedRoute,
	body: unknown,
): Promise<void> {
	const pending = new Map<string, SnapshotRow[]>();
	const load = async (month: string) => {
		const known = pending.get(month);
		if (known) {
			return known;
		}
		const stored = await storage.readRows(request.key, month);
		pending.set(month, stored);
		return stored;
	};
	const replaced = replacedRange(route, request.params, body);
	if (replaced !== null) {
		for (const month of monthsBetween(replaced.start, replaced.end)) {
			const stored = await load(month);
			pending.set(
				month,
				stored.filter(
					(row) => !rowInRange(row, route.field, replaced.start, replaced.end),
				),
			);
		}
	}
	for (const row of rowsOfBody(route, body)) {
		const at = Number(row[route.field]);
		if (Number.isFinite(at)) {
			(await load(rowMonth(at))).push(row);
		}
	}
	for (const [month, list] of pending) {
		list.sort(
			(left, right) => Number(left[route.field]) - Number(right[route.field]),
		);
		await storage.writeRows(request.key, month, list);
	}
}

export function createRecordingFetch(
	transport: FetchLike,
	storage: SnapshotStorage,
	options: SnapshotRecorderOptions = {},
): FetchLike {
	const now = options.now ?? (() => new Date());
	let manifest: SnapshotManifest | null = null;
	let queue: Promise<void> = Promise.resolve();

	const currentManifest = async (): Promise<SnapshotManifest> => {
		manifest ??= (await storage.readManifest()) ?? emptyManifest("api", now());
		return manifest;
	};

	const record = async (request: SnapshotRequest, body: unknown) => {
		let next = await currentManifest();
		switch (request.route.kind) {
			case "login":
				await storage.writeResponse(request.key, {
					status: 200,
					body: withoutToken(body),
				});
				break;
			case "ranged": {
				const route = request.route;
				await mergeRows(storage, request, route, body);
				const start = numberParam(request.params, "start_date");
				const end = numberParam(request.params, "end_date");
				if (route.covers && start !== null && end !== null) {
					next = widenCoverage(
						next,
						vietnamDateISO(start),
						vietnamDateISO(end),
						now(),
					);
				}
				break;
			}
			default:
				await storage.writeResponse(request.key, {
					status: 200,
					body: withoutTrackId(body),
				});
		}
		manifest = { ...next, updatedAt: now().toISOString() };
		await storage.writeManifest(manifest);
	};

	return async (input, init) => {
		const response = await transport(input, init);
		if (!response.ok) {
			return response;
		}
		let body: unknown;
		try {
			body = await response.clone().json();
		} catch {
			return response;
		}
		if (isRecord(body) && body.error !== undefined && body.error !== null) {
			return response;
		}
		const request = describeSnapshotRequest(input, init);
		const recording = queue.then(() => record(request, body));
		queue = recording.catch(() => undefined);
		try {
			await recording;
		} catch (error) {
			options.onWarning?.(
				`could not record ${request.method} ${request.path} into the iPOS snapshot: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		return response;
	};
}
