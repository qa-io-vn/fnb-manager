import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	PROMOTION_RULE_COUNTRIES,
	type PromotionRule,
	promotionDiscountCap,
	promotionRules,
	shiftIsoDate,
} from "../../src/index.js";
import {
	buildDiscountCapFixture,
	type DiscountCapFixture,
	type DiscountCapFixtureRule,
	datedDiscountCapRules,
	UNRULED_COUNTRY,
} from "../fixtures/discount-cap.js";

const repositoryRoot = join(import.meta.dirname, "..", "..", "..", "..");
const migrationsRoot = join(repositoryRoot, "supabase", "migrations");
const fixturePath = fileURLToPath(
	new URL("../fixtures/discount-cap.json", import.meta.url),
);
const sqlTestPath = join(
	repositoryRoot,
	"supabase",
	"tests",
	"92_discount_cap_mirror.sql",
);
const DEFINITION =
	/create (?:or replace )?function app\.promotion_discount_cap\(/g;
const VALUES_ROW =
	/\('([A-Z]{2})', date '(\d{4}-\d{2}-\d{2})', (?:date '(\d{4}-\d{2}-\d{2})'|null(?:::date)?), (\d+(?:\.\d+)?)(?:::numeric)?\)/g;

if (process.env.UPDATE_DISCOUNT_CAP_FIXTURE === "1") {
	writeFileSync(fixturePath, `${JSON.stringify(buildDiscountCapFixture())}\n`);
}

function latestCapDefinition(): { name: string; body: string } {
	const names = readdirSync(migrationsRoot)
		.filter((name) => name.endsWith(".sql"))
		.sort()
		.filter((name) =>
			readFileSync(join(migrationsRoot, name), "utf8").match(DEFINITION),
		);
	const name = names.at(-1);
	if (name === undefined) {
		throw new Error("no migration defines app.promotion_discount_cap");
	}
	const source = readFileSync(join(migrationsRoot, name), "utf8");
	const start = [...source.matchAll(DEFINITION)].at(-1)?.index ?? 0;
	const bodyStart = source.indexOf("$$", start);
	const bodyEnd = source.indexOf("$$", bodyStart + 2);
	return { name, body: source.slice(bodyStart + 2, bodyEnd) };
}

function sqlRules(body: string): DiscountCapFixtureRule[] {
	return [...body.matchAll(VALUES_ROW)].map((match) => ({
		countryCode: match[1] ?? "",
		validFrom: match[2] ?? "",
		validTo: match[3] ?? null,
		maxDiscountRate: Number(match[4]),
	}));
}

function capOnDay(country: string, day: string): number | null {
	const rule = promotionRules(country).find(
		(entry: PromotionRule) =>
			entry.id === "discount_cap" &&
			entry.validFrom <= day &&
			(entry.validTo === null || day <= entry.validTo),
	);
	return rule?.id === "discount_cap" ? rule.parameters.maxDiscountRate : null;
}

const fixture = JSON.parse(
	readFileSync(fixturePath, "utf8"),
) as DiscountCapFixture;

describe("promotionDiscountCap", () => {
	it("is the lowest rate of the discount_cap rules in force on any day of the range", () => {
		expect(promotionDiscountCap("VN", "2025-06-30", "2025-07-01")).toBe(0.5);
		expect(promotionDiscountCap("VN", "2026-11-19", "2026-12-31")).toBe(0.5);
		expect(promotionDiscountCap("VN", "2026-11-19", null)).toBe(0.5);
		expect(promotionDiscountCap("VN", null, null)).toBe(0.5);
		expect(promotionDiscountCap(" vn ", "2018-05-22", "2018-05-22")).toBe(0.5);
		expect(promotionDiscountCap("VN", "2018-05-20", "2018-05-21")).toBeNull();
		expect(promotionDiscountCap("VN", null, "2018-05-21")).toBeNull();
		expect(promotionDiscountCap("TH", null, null)).toBeNull();
	});

	it("gives the rate of the rule in force on each single day of the fixture", () => {
		const days = fixture.cases.filter(
			(entry) => entry.from !== null && entry.from === entry.to,
		);
		expect(days.length).toBeGreaterThan(0);
		for (const entry of days) {
			expect(entry.cap, JSON.stringify(entry)).toBe(
				capOnDay(entry.countryCode, entry.from ?? ""),
			);
		}
	});
});

describe("the SQL mirror app.promotion_discount_cap", () => {
	it("holds exactly the dated discount_cap rules of every country, in their order", () => {
		const { name, body } = latestCapDefinition();
		const rules = datedDiscountCapRules();
		expect(rules.length, name).toBeGreaterThan(0);
		expect(sqlRules(body), name).toEqual(
			rules.map((rule) => ({
				countryCode: rule.countryCode,
				validFrom: rule.validFrom,
				validTo: rule.validTo,
				maxDiscountRate: rule.parameters.maxDiscountRate,
			})),
		);
	});

	it("is checked against a fixture built from the current rules", () => {
		expect(fixture).toEqual(buildDiscountCapFixture());
		expect(fixture.rules).toHaveLength(datedDiscountCapRules().length);
	});

	it("covers every dated rule on its first and last day and on the days around them", () => {
		for (const rule of datedDiscountCapRules()) {
			const days = fixture.cases
				.filter(
					(entry) =>
						entry.countryCode === rule.countryCode && entry.from === entry.to,
				)
				.map((entry) => entry.from);
			expect(days).toContain(rule.validFrom);
			expect(days).toContain(shiftIsoDate(rule.validFrom, -1));
			if (rule.validTo !== null) {
				expect(days).toContain(rule.validTo);
				expect(days).toContain(shiftIsoDate(rule.validTo, 1));
			}
		}
		for (const country of PROMOTION_RULE_COUNTRIES) {
			expect(
				fixture.cases.some(
					(entry) =>
						entry.countryCode === country &&
						entry.from === null &&
						entry.to === null,
				),
			).toBe(true);
		}
		expect(
			fixture.cases.find((entry) => entry.countryCode === UNRULED_COUNTRY)?.cap,
		).toBeNull();
	});

	it("is embedded verbatim in the pgTAP comparison", () => {
		expect(existsSync(sqlTestPath)).toBe(true);
		const sql = readFileSync(sqlTestPath, "utf8");
		const match = /\$cap\$(.*)\$cap\$/.exec(sql);
		expect(match?.[1]).toBeDefined();
		expect(JSON.parse(match?.[1] ?? "null")).toEqual(fixture);
	});
});
