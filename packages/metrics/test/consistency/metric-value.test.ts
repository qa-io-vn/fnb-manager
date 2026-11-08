import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { metricValueIds } from "../../src/index.js";
import { repositoryRoot } from "../support/metrics-document.js";

const migrationsRoot = join(repositoryRoot, "supabase", "migrations");
const definitionStart = "create or replace function public.metric_value(";

interface MetricValueDefinition {
	migration: string;
	body: string;
}

function latestMetricValueDefinition(): MetricValueDefinition {
	const definitions = readdirSync(migrationsRoot)
		.filter((name) => name.endsWith(".sql"))
		.sort()
		.map((migration) => ({
			migration,
			source: readFileSync(join(migrationsRoot, migration), "utf8"),
		}))
		.filter(({ source }) => source.includes(definitionStart));
	const latest = definitions.at(-1);
	if (latest === undefined) {
		throw new Error("no migration defines public.metric_value");
	}
	const start = latest.source.lastIndexOf(definitionStart);
	const bodyStart = latest.source.indexOf("$$", start);
	const bodyEnd = latest.source.indexOf("$$", bodyStart + 2);
	return {
		migration: latest.migration,
		body: latest.source.slice(bodyStart + 2, bodyEnd),
	};
}

function dispatchedIds(body: string): string[] {
	return [...body.matchAll(/\bwhen '([a-z0-9_]+)' then\b/g)].map(
		(match) => match[1] ?? "",
	);
}

describe("public.metric_value and the registry", () => {
	const definition = latestMetricValueDefinition();
	const dispatched = dispatchedIds(definition.body);

	it("dispatches each metric id once", () => {
		expect(
			dispatched.filter((id, index) => dispatched.indexOf(id) !== index),
		).toEqual([]);
	});

	it("computes exactly the metrics that are available now and have one value per store and period", () => {
		expect([...dispatched].sort()).toEqual([...metricValueIds()].sort());
	});

	it("rejects every other id with SQLSTATE 22023", () => {
		expect(definition.body).toMatch(
			/else\s+raise exception using\s+errcode = '22023'/,
		);
	});
});
