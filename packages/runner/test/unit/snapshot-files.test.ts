import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyManifest } from "@fnb/connector-ipos/snapshot";
import { afterEach, describe, expect, it } from "vitest";
import {
	createFileSnapshotStorage,
	createFileSnapshots,
	replaceAccountSnapshot,
	snapshotDirectory,
} from "../../src/snapshot-files.js";

const created: string[] = [];

async function temporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "fnb-snapshot-"));
	created.push(root);
	return root;
}

afterEach(async () => {
	for (const root of created.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe("iPOS snapshot files", () => {
	it("default to .ipos-snapshot at the repository root, or IPOS_SNAPSHOT_DIR", () => {
		const root = join(tmpdir(), "repo");
		expect(snapshotDirectory({}, root)).toBe(join(root, ".ipos-snapshot"));
		expect(snapshotDirectory({ IPOS_SNAPSHOT_DIR: "data/snap" }, root)).toBe(
			join(root, "data", "snap"),
		);
	});

	it("keep the manifest, the answers and the monthly rows across instances", async () => {
		const root = await temporaryRoot();
		const storage = createFileSnapshotStorage(join(root, "shop"));
		const manifest = emptyManifest(
			"database",
			new Date("2026-11-18T00:00:00Z"),
		);
		await storage.writeManifest(manifest);
		await storage.writeResponse("GET /api/mdata/v1/units?brand_uid=b", {
			status: 200,
			body: { data: [{ id: "u" }] },
		});
		await storage.writeRows("GET /api/v3/reports/shifts", "2026-11", [
			{ shift_id: "s", start_date: 1 },
		]);
		const again = createFileSnapshotStorage(join(root, "shop"));
		expect(await again.readManifest()).toEqual(manifest);
		expect(
			await again.readResponse("GET /api/mdata/v1/units?brand_uid=b"),
		).toEqual({ status: 200, body: { data: [{ id: "u" }] } });
		expect(await again.readResponse("GET /api/mdata/v1/items")).toBeNull();
		expect(
			await again.readRows("GET /api/v3/reports/shifts", "2026-11"),
		).toEqual([{ shift_id: "s", start_date: 1 }]);
		expect(
			await again.readRows("GET /api/v3/reports/shifts", "2026-10"),
		).toEqual([]);
	});

	it("record only into a snapshot folder that already exists", async () => {
		const root = await temporaryRoot();
		const missing = join(root, "missing");
		expect(
			createFileSnapshots(missing, () => undefined).recordTo("a"),
		).toBeNull();
		expect(
			createFileSnapshots(root, () => undefined).recordTo("a"),
		).not.toBeNull();
	});

	it("replace an account's snapshot as a whole and leave no partial folder", async () => {
		const root = await temporaryRoot();
		const first = await replaceAccountSnapshot(root, "shop", (storage) =>
			storage.writeManifest(emptyManifest("database", new Date())),
		);
		const second = await replaceAccountSnapshot(root, "shop", (storage) =>
			storage.writeManifest(emptyManifest("api", new Date())),
		);
		expect([first, second]).toEqual([false, true]);
		expect(await readdir(root)).toEqual(["shop"]);
		expect(
			(await createFileSnapshotStorage(join(root, "shop")).readManifest())
				?.origin,
		).toBe("api");
		await expect(
			replaceAccountSnapshot(root, "broken", async () => {
				throw new Error("stop");
			}),
		).rejects.toThrow("stop");
		expect(existsSync(join(root, "broken"))).toBe(false);
		expect(await readdir(root)).toEqual(["shop"]);
	});
});
