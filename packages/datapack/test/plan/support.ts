import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type CanonicalValue,
	canonicalJson,
	type DataPack,
	lintPlan,
	MAX_PLAN_CONTENT_BYTES,
	sha256Hex,
} from "../../src/index.js";

export const PLAN_FIXTURES = join(
	import.meta.dirname,
	"..",
	"fixtures",
	"plans",
);
export const LINT_FIXTURES = join(PLAN_FIXTURES, "lint");

export const LINT_PACK_ID =
	"a797a5c812e8280337968934e6f6a6df8cb195ee90cccc10ad6c12132f35004c";
export const STORE_S1 = "22222222-2222-4222-8222-000000000001";
export const STORE_S2 = "22222222-2222-4222-8222-000000000002";

export function lintPackJson(): unknown {
	return JSON.parse(
		readFileSync(join(PLAN_FIXTURES, "lint-pack.json"), "utf8"),
	);
}

export function lintPack(): DataPack {
	return lintPackJson() as DataPack;
}

export function oneStorePack(): DataPack {
	const pack = lintPack();
	const tables = Object.fromEntries(
		Object.entries(pack.tables).map(([id, table]) => [
			id,
			{
				...table,
				rows: Object.fromEntries(
					Object.entries(table.rows).filter(
						([key]) =>
							!key.startsWith("S1/") && !key.startsWith("S2/") && key !== "S2",
					),
				),
			},
		]),
	);
	return {
		...pack,
		request: {
			...pack.request,
			stores: pack.request.stores.filter((store) => store.label === "S1"),
		},
		tables,
	};
}

export function lintFixture(name: string): string {
	return readFileSync(join(LINT_FIXTURES, name), "utf8");
}

export function lintFixtureNames(): string[] {
	return readdirSync(LINT_FIXTURES)
		.filter((name) => name.endsWith(".md"))
		.sort();
}

export function expectedLintCodes(): Readonly<
	Record<string, readonly string[]>
> {
	return JSON.parse(readFileSync(join(LINT_FIXTURES, "expected.json"), "utf8"));
}

export function cleanPlan(language: "vi" | "en" = "vi"): string {
	return lintFixture(`clean.${language}.md`).replace(/\r\n/g, "\n");
}

export function withLine(text: string, anchor: string, line: string): string {
	const at = text.indexOf(anchor);
	if (at === -1) throw new Error(`anchor not found: ${anchor}`);
	return `${text.slice(0, at)}${line}\n\n${text.slice(at)}`;
}

export function replacing(text: string, from: string, to: string): string {
	if (!text.includes(from)) throw new Error(`text not found: ${from}`);
	return text.replace(from, to);
}

const LAST_LINE = "Lượng khách giữ ổn định trong mùa lễ.";
const FILLER = "Giả định thêm: lượng khách ổn định trong mùa lễ.";

export function oversizedPlan(): string {
	const plan = cleanPlan();
	const lines: string[] = [];
	let bytes = new TextEncoder().encode(plan).length;
	while (bytes <= MAX_PLAN_CONTENT_BYTES) {
		lines.push(FILLER);
		bytes += new TextEncoder().encode(`${FILLER}\n\n`).length;
	}
	return replacing(plan, LAST_LINE, [LAST_LINE, ...lines].join("\n\n"));
}

export const GENERATED_LINT_FIXTURES: Readonly<Record<string, () => string>> = {
	"content_too_large.md": oversizedPlan,
};

export function lintFixtureText(name: string): string {
	const generated = GENERATED_LINT_FIXTURES[name];
	return generated === undefined ? lintFixture(name) : generated();
}

export async function lintResultsText(): Promise<string> {
	const pack = lintPack();
	const results: Record<string, unknown> = {};
	for (const name of Object.keys(expectedLintCodes()).sort()) {
		const result = lintPlan(lintFixtureText(name), pack);
		results[name] = {
			ok: result.ok,
			issues: result.issues,
			summary: result.summary,
			sha256: await sha256Hex(
				canonicalJson(result as unknown as CanonicalValue),
			),
		};
	}
	return `${JSON.stringify(results, null, "\t")}\n`;
}
