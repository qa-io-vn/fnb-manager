import { describe, expect, it } from "vitest";
import {
	databaseSizeDetail,
	databaseSizeHealth,
	isLocalDatabase,
	migrationDrift,
	pauseRiskHealth,
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
