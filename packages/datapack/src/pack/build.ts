import type { ReportSource } from "@fnb/reports";
import type { PackClock } from "./clock.js";
import { notImplemented } from "./errors.js";
import type { RecordedCall } from "./record.js";
import type { DataPackRequest } from "./request.js";
import type { DataPack } from "./schema.js";

export interface BuildDataPackOptions {
	readonly source: ReportSource;
	readonly clock: PackClock;
	readonly fence: (() => Promise<string>) | null;
	readonly onProgress?: (done: number, total: number) => void;
}

export interface BuiltPack {
	readonly pack: DataPack;
	readonly text: string;
	readonly packId: string;
	readonly estimatedTokens: number;
	readonly calls: readonly RecordedCall[];
}

export async function buildDataPack(
	_request: DataPackRequest,
	_options: BuildDataPackOptions,
): Promise<BuiltPack> {
	return notImplemented("buildDataPack");
}
