import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type HolidayEntry,
	isExcludedDay,
	isHolidayDate,
	isTetWindowDate,
	VIETNAM_HOLIDAYS,
} from "../../src/index.js";

const repositoryRoot = join(import.meta.dirname, "..", "..", "..", "..");
const migrationsRoot = join(repositoryRoot, "supabase", "migrations");
const holidayMigrationSuffix = "_vn_public_holidays.sql";
const valuesRow =
	/\('(\d{4}-\d{2}-\d{2})', '((?:[^']|'')*)', '(public|tet|custom)'\)/g;

function holidayMigration(): string {
	const names = readdirSync(migrationsRoot).filter((name) =>
		name.endsWith(holidayMigrationSuffix),
	);
	if (names.length !== 1) {
		throw new Error(
			`expected one migration ending in ${holidayMigrationSuffix}, found ${names.length}`,
		);
	}
	return readFileSync(join(migrationsRoot, names[0] ?? ""), "utf8");
}

function migrationRows(source: string): HolidayEntry[] {
	const valuesStart = source.indexOf("values");
	const valuesEnd = source.indexOf(") as v (", valuesStart);
	return [...source.slice(valuesStart, valuesEnd).matchAll(valuesRow)].map(
		(match) => ({
			holidayDate: match[1] ?? "",
			name: (match[2] ?? "").replaceAll("''", "'"),
			kind: (match[3] ?? "custom") as HolidayEntry["kind"],
		}),
	);
}

const gappedTet: readonly HolidayEntry[] = [
	{ holidayDate: "2025-06-10", name: "Store Tet first day", kind: "tet" },
	{ holidayDate: "2025-06-11", name: "Store Tet second day", kind: "tet" },
	{ holidayDate: "2025-06-14", name: "Store Tet last day", kind: "tet" },
	{ holidayDate: "2025-06-20", name: "Store anniversary", kind: "custom" },
];

describe("VIETNAM_HOLIDAYS and migration vn_public_holidays", () => {
	it("holds exactly the rows the migration inserts, in its order", () => {
		const rows = migrationRows(holidayMigration());
		expect(rows).toHaveLength(61);
		expect(VIETNAM_HOLIDAYS).toEqual(rows);
	});

	it("counts 30 public holidays and 31 Tet days over 2024 to 2028", () => {
		const kinds = VIETNAM_HOLIDAYS.map((holiday) => holiday.kind);
		expect(kinds.filter((kind) => kind === "public")).toHaveLength(30);
		expect(kinds.filter((kind) => kind === "tet")).toHaveLength(31);
		expect(
			new Set(
				VIETNAM_HOLIDAYS.map((holiday) => holiday.holidayDate.slice(0, 4)),
			),
		).toEqual(new Set(["2024", "2025", "2026", "2027", "2028"]));
	});
});

describe("holiday and Tet checks", () => {
	it("finds a public holiday and excludes it", () => {
		expect(isHolidayDate(VIETNAM_HOLIDAYS, "2026-09-02")).toBe(true);
		expect(isTetWindowDate(VIETNAM_HOLIDAYS, "2026-09-02")).toBe(false);
		expect(isExcludedDay(VIETNAM_HOLIDAYS, "2026-09-02")).toBe(true);
		expect(isExcludedDay(VIETNAM_HOLIDAYS, "2026-09-03")).toBe(false);
	});

	it("covers a gap inside a Tet run, as app.tet_window does", () => {
		expect(isHolidayDate(gappedTet, "2025-06-12")).toBe(false);
		expect(isTetWindowDate(gappedTet, "2025-06-12")).toBe(true);
		expect(isTetWindowDate(gappedTet, "2025-06-13")).toBe(true);
		expect(isExcludedDay(gappedTet, "2025-06-13")).toBe(true);
	});

	it("ends the window with the last Tet day", () => {
		expect(isTetWindowDate(VIETNAM_HOLIDAYS, "2026-02-15")).toBe(false);
		expect(isTetWindowDate(VIETNAM_HOLIDAYS, "2026-02-16")).toBe(true);
		expect(isTetWindowDate(VIETNAM_HOLIDAYS, "2026-02-21")).toBe(true);
		expect(isTetWindowDate(VIETNAM_HOLIDAYS, "2026-02-22")).toBe(false);
		expect(isExcludedDay(VIETNAM_HOLIDAYS, "2026-02-22")).toBe(false);
		expect(isTetWindowDate(gappedTet, "2025-06-15")).toBe(false);
	});

	it("does not join Tet days more than 14 days apart", () => {
		const farApart: readonly HolidayEntry[] = [
			{ holidayDate: "2025-03-01", name: "First", kind: "tet" },
			{ holidayDate: "2025-03-16", name: "Second", kind: "tet" },
		];
		expect(isTetWindowDate(farApart, "2025-03-08")).toBe(false);
		expect(isTetWindowDate(farApart, "2025-03-01")).toBe(true);
		const fourteenApart: readonly HolidayEntry[] = [
			{ holidayDate: "2025-03-01", name: "First", kind: "tet" },
			{ holidayDate: "2025-03-15", name: "Second", kind: "tet" },
		];
		expect(isTetWindowDate(fourteenApart, "2025-03-08")).toBe(true);
	});

	it("counts a custom holiday as excluded but never as Tet", () => {
		expect(isHolidayDate(gappedTet, "2025-06-20")).toBe(true);
		expect(isTetWindowDate(gappedTet, "2025-06-20")).toBe(false);
		expect(isExcludedDay(gappedTet, "2025-06-20")).toBe(true);
	});
});
