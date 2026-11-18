import { describe, expect, it } from "vitest";
import {
	databaseSizeDetail,
	databaseSizeHealth,
	isLocalDatabase,
	migrationDrift,
	pauseRiskHealth,
	photoStorageCheck,
	photoStorageHealth,
	syncAgeHealth,
} from "../../src/commands/doctor-checks.js";
import { ageText } from "../../src/commands/formatting.js";

const MIB = 1024 * 1024;

describe("doctor thresholds", () => {
	it("grades database size against the free plan", () => {
		expect(databaseSizeHealth(100 * MIB)).toBe("green");
		expect(databaseSizeHealth(400 * MIB - 1)).toBe("green");
		expect(databaseSizeHealth(400 * MIB)).toBe("yellow");
		expect(databaseSizeHealth(475 * MIB - 1)).toBe("yellow");
		expect(databaseSizeHealth(475 * MIB)).toBe("red");
	});

	it("labels database sizes in MiB, the unit the limits are kept in", () => {
		expect(databaseSizeDetail(291.25 * MIB)).toBe(
			"291.3 MiB of the 500 MiB free-plan quota (upgrade trigger 400 MiB, red from 475 MiB)",
		);
		expect(databaseSizeDetail(300_000_000)).toMatch(/^286\.1 MiB /);
	});

	it("grades operations photo storage against the free-plan storage quota", () => {
		expect(photoStorageHealth(0)).toBe("green");
		expect(photoStorageHealth(858_993_459)).toBe("green");
		expect(photoStorageHealth(858_993_460)).toBe("yellow");
		expect(photoStorageHealth(1_020_054_732)).toBe("yellow");
		expect(photoStorageHealth(1_020_054_733)).toBe("red");
		const now = new Date("2026-11-18T12:00:00Z");
		expect(
			photoStorageCheck(
				{
					buckets: 2,
					objects: 345,
					bytes: 12.34 * MIB,
					oldestAt: new Date("2026-11-08T12:00:00Z"),
					expired: 0,
				},
				now,
			),
		).toEqual({
			name: "operations photo storage",
			health: "green",
			detail:
				"12.3 MiB in 345 photo(s) across 2 ops- bucket(s) (oldest 10.0 d; none past retention) of the 1024 MiB free-plan storage quota (upgrade trigger 819.2 MiB, red from 972.8 MiB)",
		});
		const full = photoStorageCheck(
			{
				buckets: 1,
				objects: 9000,
				bytes: 980 * MIB,
				oldestAt: new Date("2026-08-01T00:00:00Z"),
				expired: 1000,
			},
			now,
		);
		expect(full.health).toBe("red");
		expect(full.detail).toContain(
			"at least 1000 past retention (fnb photos prune removes them)",
		);
		expect(
			photoStorageCheck(
				{ buckets: 0, objects: 0, bytes: 0, oldestAt: null, expired: 0 },
				now,
			).detail,
		).toMatch(
			/^0\.0 MiB in 0 photo\(s\) across 0 ops- bucket\(s\) \(no photo yet;/,
		);
		expect(photoStorageCheck(null, now)).toEqual({
			name: "operations photo storage",
			health: "unavailable",
			detail: "app.ops_photo_storage is missing; apply the migrations",
		});
	});

	it("grades sync age and pause risk", () => {
		expect(syncAgeHealth(null)).toBe("yellow");
		expect(syncAgeHealth(20)).toBe("green");
		expect(syncAgeHealth(30)).toBe("yellow");
		expect(syncAgeHealth(80)).toBe("red");
		expect(pauseRiskHealth(1)).toBe("green");
		expect(pauseRiskHealth(5)).toBe("yellow");
		expect(pauseRiskHealth(7)).toBe("red");
		expect(pauseRiskHealth(null)).toBe("red");
	});

	it("compares applied migrations with the files", () => {
		expect(migrationDrift(["1", "2", "3"], ["1", "2", "9"])).toEqual({
			missing: ["3"],
			unknown: ["9"],
		});
	});

	it("recognises a local database", () => {
		expect(
			isLocalDatabase(
				"postgresql://postgres:postgres@127.0.0.1:54322/postgres",
			),
		).toBe(true);
		expect(
			isLocalDatabase("postgresql://postgres.ref:x@example.com:5432/postgres"),
		).toBe(false);
	});

	it("formats ages", () => {
		const now = new Date("2026-11-08T12:00:00Z");
		expect(ageText(null, now)).toBe("never");
		expect(ageText(new Date("2026-11-08T11:30:00Z"), now)).toBe("30 min");
		expect(ageText(new Date("2026-11-08T00:00:00Z"), now)).toBe("12.0 h");
		expect(ageText(new Date("2026-11-01T12:00:00Z"), now)).toBe("7.0 d");
	});
});
