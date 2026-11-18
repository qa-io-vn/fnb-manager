import type { FetchLike } from "../http.js";
import { MILLISECONDS_PER_DAY, vietnamDateISO } from "../time.js";
import { isRecord, snapshotToken } from "./json.js";
import {
	describeSnapshotRequest,
	numberParam,
	type RangedRoute,
	type SnapshotRequest,
} from "./routes.js";
import {
	dataEnvelope,
	errorEnvelope,
	SNAPSHOT_TRACK_ID,
	serveRows,
} from "./serve.js";
import {
	dayEndMs,
	dayStartMs,
	monthsBetween,
	rowInRange,
	type SnapshotManifest,
	type SnapshotRow,
	type SnapshotStorage,
	type StoredResponse,
} from "./storage.js";

export interface SnapshotReplayOptions {
	onWarning?: (message: string) => void;
	now?: () => number;
}

const TOKEN_LIFETIME_MS = 30 * MILLISECONDS_PER_DAY;
const MONTH_MARGIN_MS = 40 * MILLISECONDS_PER_DAY;

function jsonResponse(answer: StoredResponse): Response {
	return new Response(JSON.stringify(answer.body), {
		status: answer.status,
		headers: { "content-type": "application/json" },
	});
}

function loginAnswer(stored: StoredResponse | null, now: number) {
	if (!stored || !isRecord(stored.body) || !isRecord(stored.body.data)) {
		return {
			status: 401,
			body: errorEnvelope(401, "the iPOS snapshot holds no login answer"),
		};
	}
	const data = stored.body.data;
	const user = isRecord(data.user) ? data.user : {};
	const company = isRecord(data.company) ? data.company : {};
	const token = snapshotToken({
		id: typeof user.id === "string" ? user.id : "ipos-snapshot-user",
		cp: typeof company.id === "string" ? company.id : "ipos-snapshot-company",
		email: typeof user.email === "string" ? user.email : null,
		iat: Math.floor(now / 1000),
		exp: Math.floor((now + TOKEN_LIFETIME_MS) / 1000),
	});
	return {
		status: 200,
		body: {
			...stored.body,
			data: { ...data, token },
			track_id: SNAPSHOT_TRACK_ID,
		},
	};
}

function readRange(
	manifest: SnapshotManifest | null,
	start: number | null,
	end: number | null,
): { from: number; to: number } | null {
	const coveredFrom =
		manifest?.coveredFrom === null || manifest?.coveredFrom === undefined
			? null
			: dayStartMs(manifest.coveredFrom) - MONTH_MARGIN_MS;
	const coveredTo =
		manifest?.coveredTo === null || manifest?.coveredTo === undefined
			? null
			: dayEndMs(manifest.coveredTo) + MONTH_MARGIN_MS;
	const from = Math.max(
		start ?? Number.NEGATIVE_INFINITY,
		coveredFrom ?? Number.NEGATIVE_INFINITY,
	);
	const to = Math.min(
		end ?? Number.POSITIVE_INFINITY,
		coveredTo ?? Number.POSITIVE_INFINITY,
	);
	if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
		return null;
	}
	return { from, to };
}

export function coverageWarnings(
	manifest: SnapshotManifest | null,
	start: number | null,
	end: number | null,
): string[] {
	if (!manifest?.coveredFrom || !manifest.coveredTo) {
		return ["the iPOS snapshot covers no dates yet"];
	}
	const warnings: string[] = [];
	if (start !== null && vietnamDateISO(start) < manifest.coveredFrom) {
		warnings.push(`iPOS snapshot has no data before ${manifest.coveredFrom}`);
	}
	if (end !== null && vietnamDateISO(end) > manifest.coveredTo) {
		warnings.push(`iPOS snapshot has no data after ${manifest.coveredTo}`);
	}
	return warnings;
}

export function createSnapshotReplay(
	storage: SnapshotStorage,
	options: SnapshotReplayOptions = {},
): FetchLike {
	const now = options.now ?? Date.now;
	const warned = new Set<string>();
	const warn = (message: string) => {
		if (!warned.has(message)) {
			warned.add(message);
			options.onWarning?.(message);
		}
	};
	let manifest: Promise<SnapshotManifest | null> | null = null;
	const manifestOnce = () => {
		manifest ??= storage.readManifest();
		return manifest;
	};
	const shards = new Map<string, Promise<SnapshotRow[]>>();
	const shard = (key: string, month: string) => {
		const id = `${key}\n${month}`;
		const known = shards.get(id);
		if (known) {
			return known;
		}
		const loading = storage.readRows(key, month);
		shards.set(id, loading);
		return loading;
	};

	const answerRanged = async (
		request: SnapshotRequest,
		route: RangedRoute,
	): Promise<StoredResponse> => {
		const loaded = await manifestOnce();
		const start = numberParam(request.params, "start_date");
		const end = numberParam(request.params, "end_date");
		if (route.covers) {
			for (const warning of coverageWarnings(loaded, start, end)) {
				warn(warning);
			}
		}
		const range = readRange(loaded, start, end);
		const months = range === null ? [] : monthsBetween(range.from, range.to);
		const rows = (
			await Promise.all(months.map((month) => shard(request.key, month)))
		).flat();
		return serveRows(
			route,
			rows.filter((row) => rowInRange(row, route.field, start, end)),
			request.params,
		);
	};

	const answer = async (request: SnapshotRequest): Promise<StoredResponse> => {
		switch (request.route.kind) {
			case "login":
				return loginAnswer(await storage.readResponse(request.key), now());
			case "ranged":
				return answerRanged(request, request.route);
			default: {
				const stored = await storage.readResponse(request.key);
				if (stored) {
					return {
						status: stored.status,
						body: isRecord(stored.body)
							? { ...stored.body, track_id: SNAPSHOT_TRACK_ID }
							: stored.body,
					};
				}
				warn(
					`iPOS snapshot has no answer for ${request.method} ${request.path}; an empty list was served`,
				);
				return { status: 200, body: dataEnvelope([]) };
			}
		}
	};

	return async (input, init) => {
		init?.signal?.throwIfAborted();
		const request = describeSnapshotRequest(input, init);
		return jsonResponse(await answer(request));
	};
}
