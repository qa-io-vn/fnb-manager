import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { trackableMetricIds } from "../../src/pack/kpi-ids.js";
import { PLAN_SECTIONS } from "../../src/plan/sections.js";

const migrationsRoot = join(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"..",
	"supabase",
	"migrations",
);

function latestDefinition(signature: string): string {
	const files = readdirSync(migrationsRoot)
		.filter((name) => name.endsWith(".sql"))
		.sort()
		.reverse();
	for (const name of files) {
		const text = readFileSync(join(migrationsRoot, name), "utf8");
		const start = text.search(
			new RegExp(`create (?:or replace )?function ${signature}`),
		);
		if (start === -1) continue;
		const bodyStart = text.indexOf("$$", start);
		const bodyEnd = text.indexOf("$$", bodyStart + 2);
		return text.slice(bodyStart + 2, bodyEnd);
	}
	throw new Error(`no migration defines ${signature}`);
}

function quoted(text: string): string[] {
	return [...text.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? "");
}

describe("the SQL constants of the strategy plans migration", () => {
	it("app.trackable_metric_ids() equals trackableMetricIds()", () => {
		const body = latestDefinition("app\\.trackable_metric_ids\\(");
		expect(quoted(body)).toEqual([...trackableMetricIds()]);
	});

	it("names only ids the latest metric_value computes", () => {
		const body = latestDefinition("public\\.metric_value\\(");
		const computed = [...body.matchAll(/when '([a-z0-9_]+)' then/g)].map(
			(match) => match[1],
		);
		for (const id of trackableMetricIds()) {
			expect(computed).toContain(id);
		}
	});

	it("app.plan_section_titles equals PLAN_SECTIONS in both languages", () => {
		const body = latestDefinition("app\\.plan_section_titles\\(");
		const vi = body.slice(body.indexOf("when 'vi'"), body.indexOf("when 'en'"));
		const en = body.slice(body.indexOf("when 'en'"));
		expect(quoted(vi).slice(1)).toEqual(
			PLAN_SECTIONS.map((section) => section.title.vi),
		);
		expect(quoted(en).slice(1)).toEqual(
			PLAN_SECTIONS.map((section) => section.title.en),
		);
	});
});
