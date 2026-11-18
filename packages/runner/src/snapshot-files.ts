import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
	SnapshotManifest,
	SnapshotRow,
	SnapshotStorage,
	StoredResponse,
} from "@fnb/connector-ipos/snapshot";
import type { IposSnapshots } from "./ipos-mode.js";

export const IPOS_SNAPSHOT_DIR_VARIABLE = "IPOS_SNAPSHOT_DIR";
export const DEFAULT_SNAPSHOT_DIRECTORY = ".ipos-snapshot";
const MANIFEST_FILE = "manifest.json";

export function snapshotDirectory(
	environment: Readonly<Record<string, string | undefined>>,
	rootDir: string,
): string {
	const configured = environment[IPOS_SNAPSHOT_DIR_VARIABLE]?.trim();
	return configured
		? resolve(rootDir, configured)
		: join(rootDir, DEFAULT_SNAPSHOT_DIRECTORY);
}

function fileName(key: string): string {
	const readable = key
		.toLowerCase()
		.replace(/\?.*$/, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	const digest = createHash("sha256").update(key).digest("hex").slice(0, 12);
	return `${readable}-${digest}`;
}

function isMissingFile(error: unknown): boolean {
	return (
		error !== null &&
		typeof error === "object" &&
		"code" in error &&
		error.code === "ENOENT"
	);
}

async function readJson<T>(path: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as T;
	} catch (error) {
		if (isMissingFile(error)) {
			return null;
		}
		throw error;
	}
}

let temporaryCounter = 0;

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	temporaryCounter += 1;
	const temporary = `${path}.${process.pid}-${temporaryCounter}.tmp`;
	await writeFile(temporary, JSON.stringify(value));
	await rename(temporary, path);
}

interface ResponseFile extends StoredResponse {
	key: string;
}

interface RowsFile {
	key: string;
	month: string;
	rows: SnapshotRow[];
}

export function createFileSnapshotStorage(directory: string): SnapshotStorage {
	const responsePath = (key: string) =>
		join(directory, "responses", `${fileName(key)}.json`);
	const rowsPath = (key: string, month: string) =>
		join(directory, "rows", fileName(key), `${month}.json`);
	return {
		readManifest: () =>
			readJson<SnapshotManifest>(join(directory, MANIFEST_FILE)),
		writeManifest: (manifest) =>
			writeJson(join(directory, MANIFEST_FILE), manifest),
		async readResponse(key) {
			const stored = await readJson<ResponseFile>(responsePath(key));
			return stored === null
				? null
				: { status: stored.status, body: stored.body };
		},
		writeResponse: (key, response) =>
			writeJson(responsePath(key), {
				key,
				status: response.status,
				body: response.body,
			} satisfies ResponseFile),
		async readRows(key, month) {
			return (await readJson<RowsFile>(rowsPath(key, month)))?.rows ?? [];
		},
		writeRows: (key, month, rows) =>
			writeJson(rowsPath(key, month), {
				key,
				month,
				rows: [...rows],
			} satisfies RowsFile),
	};
}

export function accountSnapshotDirectory(
	root: string,
	accountKey: string,
): string {
	return join(root, accountKey);
}

export function createFileSnapshots(
	root: string,
	warn: (message: string) => void,
): IposSnapshots {
	return {
		open: (accountKey) =>
			createFileSnapshotStorage(accountSnapshotDirectory(root, accountKey)),
		recordTo: (accountKey) =>
			existsSync(root)
				? createFileSnapshotStorage(accountSnapshotDirectory(root, accountKey))
				: null,
		warn,
	};
}

export async function replaceAccountSnapshot(
	root: string,
	accountKey: string,
	write: (storage: SnapshotStorage) => Promise<void>,
): Promise<boolean> {
	const target = accountSnapshotDirectory(root, accountKey);
	const partial = join(root, `.${accountKey}.partial-${process.pid}`);
	await rm(partial, { recursive: true, force: true });
	try {
		await write(createFileSnapshotStorage(partial));
		const replaced = existsSync(target);
		await rm(target, { recursive: true, force: true });
		await rename(partial, target);
		return replaced;
	} finally {
		await rm(partial, { recursive: true, force: true });
	}
}
