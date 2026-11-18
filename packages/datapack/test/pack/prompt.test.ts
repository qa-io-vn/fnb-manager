import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { BuiltPack } from "../../src/pack/build.js";
import { DataPackError } from "../../src/pack/errors.js";
import { sha256Hex } from "../../src/pack/hash.js";
import { PACK_LANGUAGES, type PackLanguage } from "../../src/pack/request.js";
import type { DataPack } from "../../src/pack/schema.js";
import { lintPlan } from "../../src/plan/lint.js";
import {
	INITIATIVE_FIELDS,
	INITIATIVE_HEADING,
	MAX_INITIATIVES,
	MIN_INITIATIVES,
	PLAN_FORMAT,
	PLAN_SECTIONS,
} from "../../src/plan/sections.js";
import {
	PROMPT_ID,
	PROMPT_SHA256,
	PROMPT_TEXTS,
	PROMPT_VERSION,
	strategyPrompt,
} from "../../src/prompt/prompt.js";
import { buildWith, demoRequest, demoSource } from "./support/demo.js";

const PACKAGE_ROOT = join(import.meta.dirname, "..", "..");
const REPOSITORY_ROOT = join(PACKAGE_ROOT, "..", "..");
const PRIVATE_LIST = join(
	REPOSITORY_ROOT,
	"docs",
	"private",
	"identifiers.txt",
);
const IN_CI = Boolean(process.env.CI);
const SCANNED_FILES = [
	"src/prompt/strategy-vi.ts",
	"src/prompt/strategy-en.ts",
	"test/fixtures/demo-pack.json",
];
const FILE_LIST = "packages/datapack file names";

const EXAMPLE_OPEN = "```markdown\n";
const EXAMPLE_CLOSE = "\n```";
const PACK_PLACEHOLDER = "<pack_id>";
const CITATION = /\[\[([^[\]\n]*)\]\]/g;

const EXAMPLE_CELLS: Readonly<Record<string, number>> = {
	"kpi:ALL/net_revenue:w28": 1234567890,
	"kpi:ALL/net_revenue:p28_change": 0.0462,
	"items:ALL/r01:net": 124800000,
	"kpi:S2/discount_rate:w28": 0.0425,
	"kpi:ALL/avg_ticket:w28": 52314.27,
	"kpi:ALL/size_l_share:w28": 0.3451,
};

interface ScannedSource {
	readonly name: string;
	readonly lines: readonly string[];
}

function exampleOf(text: string): string {
	const start = text.indexOf(EXAMPLE_OPEN);
	const end = text.lastIndexOf(EXAMPLE_CLOSE);
	if (start === -1 || end <= start)
		throw new Error("the prompt has no example");
	return `${text.slice(start + EXAMPLE_OPEN.length, end)}\n`;
}

function headingsOf(example: string): [number, string][] {
	return [...example.matchAll(/^## ([0-9]+)\. (.+)$/gm)].map((match) => [
		Number(match[1]),
		match[2] ?? "",
	]);
}

function fieldLabelsOf(example: string): string[] {
	return [...example.matchAll(/^- \*\*(.+?):\*\* /gm)].map(
		(match) => match[1] ?? "",
	);
}

function citedRefs(text: string): string[] {
	return [...text.matchAll(CITATION)].map((match) => match[1] ?? "");
}

function frontMatterKpis(
	example: string,
): Record<string, { readonly initiatives: readonly number[] }> {
	const [, inside = ""] = example.split("---\n");
	return JSON.parse(inside).kpis;
}

function examplePlan(language: PackLanguage, packId: string): string {
	const example = exampleOf(strategyPrompt(language).text).replace(
		PACK_PLACEHOLDER,
		packId,
	);
	const heading = `### ${INITIATIVE_HEADING[language]}`;
	const kpiLabel = `- **${INITIATIVE_FIELDS.find((field) => field.id === "kpi")?.label[language]}:** `;
	const lines = example.split("\n");
	const first = lines.findIndex((line) => line.startsWith(`${heading} 1:`));
	const elided = lines.findIndex((line) => line.startsWith(`${heading} 2:`));
	if (first === -1 || elided === -1 || lines[elided + 1] !== "") {
		throw new Error("the example does not elide initiative 2");
	}
	const kpis = frontMatterKpis(example);
	const block = lines.slice(first, elided);
	const copies = Array.from(
		{ length: MIN_INITIATIVES - 1 },
		(_, index) => index + 2,
	).flatMap((number) => {
		const linked = Object.keys(kpis).filter((id) =>
			kpis[id]?.initiatives.includes(number),
		);
		return block.map((line) => {
			if (line.startsWith(`${heading} 1:`)) {
				return line.replace(`${heading} 1:`, `${heading} ${number}:`);
			}
			if (line.startsWith(kpiLabel) && linked.length > 0) {
				return `${kpiLabel}${linked.join(", ")}`;
			}
			return line;
		});
	});
	return [
		...lines.slice(0, elided),
		...copies,
		...lines.slice(elided + 2),
	].join("\n");
}

function withCells(
	pack: DataPack,
	cells: Readonly<Record<string, number>>,
): DataPack {
	const tables = structuredClone(pack.tables);
	for (const [ref, value] of Object.entries(cells)) {
		const [tableId = "", row = "", column = ""] = ref.split(":");
		const table = tables[tableId];
		const index = table?.columns.findIndex((entry) => entry.name === column);
		const cellsOfRow = table?.rows[row];
		if (index === undefined || index === -1 || cellsOfRow === undefined) {
			throw new Error(`the pack has no cell ${ref}`);
		}
		cellsOfRow[index] = value;
	}
	return { ...pack, tables };
}

function escapedPattern(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function folded(text: string): string {
	return text.normalize("NFC").toLowerCase();
}

function privateTermFindings(
	sources: readonly ScannedSource[],
	terms: readonly string[],
): string[] {
	const patterns = terms.map(
		(term) =>
			new RegExp(
				`(?<![\\p{L}\\p{N}\\p{M}_])${escapedPattern(folded(term))}(?![\\p{L}\\p{N}\\p{M}_])`,
				"u",
			),
	);
	return sources.flatMap((source) =>
		source.lines.flatMap((line, index) =>
			patterns.some((pattern) => pattern.test(folded(line)))
				? [`${source.name}:${index + 1}`]
				: [],
		),
	);
}

function packageFileNames(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.name !== "node_modules")
		.flatMap((entry) =>
			entry.isDirectory()
				? packageFileNames(join(directory, entry.name))
				: [
						`packages/datapack/${relative(PACKAGE_ROOT, join(directory, entry.name)).split(sep).join("/")}`,
					],
		)
		.sort();
}

function scannedSources(): ScannedSource[] {
	return [
		...SCANNED_FILES.map((file) => ({
			name: `packages/datapack/${file}`,
			lines: readFileSync(join(PACKAGE_ROOT, file), "utf8").split(/\r?\n/),
		})),
		{ name: FILE_LIST, lines: packageFileNames(PACKAGE_ROOT) },
	];
}

describe("strategyPrompt", () => {
	it("returns fnb-strategy 1.0.0 in the asked language", () => {
		for (const language of PACK_LANGUAGES) {
			expect(strategyPrompt(language)).toEqual({
				id: PROMPT_ID,
				version: PROMPT_VERSION,
				language,
				text: PROMPT_TEXTS[language],
			});
		}
		expect(PROMPT_ID).toBe("fnb-strategy");
		expect(PROMPT_VERSION).toBe("1.0.0");
		expect(PROMPT_TEXTS.vi).not.toBe(PROMPT_TEXTS.en);
		expect(() => strategyPrompt("fr" as PackLanguage)).toThrow(DataPackError);
		expect(() => strategyPrompt("fr" as PackLanguage)).toThrow(
			/^pack_invalid: /,
		);
	});

	it("hashes each language's text to the value pinned for its version", async () => {
		expect(Object.keys(PROMPT_SHA256)).toContain(PROMPT_VERSION);
		for (const version of Object.keys(PROMPT_SHA256)) {
			expect(version).toMatch(
				/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/,
			);
		}
		for (const language of PACK_LANGUAGES) {
			const pinned = PROMPT_SHA256[PROMPT_VERSION]?.[language];
			expect(pinned).toMatch(/^[0-9a-f]{64}$/);
			expect(await sha256Hex(strategyPrompt(language).text)).toBe(pinned);
		}
	});

	it("fails the pin when a text changes without a new version", async () => {
		const text = strategyPrompt("vi").text;
		const pinned = PROMPT_SHA256[PROMPT_VERSION]?.vi;
		expect(await sha256Hex(`${text} `)).not.toBe(pinned);
		expect(await sha256Hex(text.replace("5 đến 7", "4 đến 7"))).not.toBe(
			pinned,
		);
	});

	it("is one fixed text per language: NFC, LF only, no trailing space, a title and a version line", () => {
		for (const language of PACK_LANGUAGES) {
			const text = strategyPrompt(language).text;
			expect(text.normalize("NFC")).toBe(text);
			expect(text).not.toMatch(/\r|\t/);
			expect(text).not.toMatch(/[  ]$/m);
			expect(text).not.toMatch(/\n$/);
			expect(text).not.toContain("${");
			const [title = "", blank, version = ""] = text.split("\n");
			expect(title).toMatch(/^# .+fnb-strategy$/);
			expect(blank).toBe("");
			expect(version).toContain(PROMPT_VERSION);
			expect(version).toContain(PLAN_FORMAT);
		}
	});

	it("writes the ten sections of PLAN_SECTIONS in order and the seven fields of INITIATIVE_FIELDS", () => {
		for (const language of PACK_LANGUAGES) {
			const example = exampleOf(strategyPrompt(language).text);
			expect(headingsOf(example)).toEqual(
				PLAN_SECTIONS.map((section) => [
					section.number,
					section.title[language],
				]),
			);
			expect(fieldLabelsOf(example)).toEqual(
				INITIATIVE_FIELDS.map((field) => field.label[language]),
			);
			expect(example).toContain(`### ${INITIATIVE_HEADING[language]} 1: `);
			expect(strategyPrompt(language).text).toContain(
				`${MIN_INITIATIVES} ${language === "vi" ? "đến" : "to"} ${MAX_INITIATIVES}`,
			);
		}
	});

	it("names no tool: no slash command, link, markup tag or tool-call syntax", () => {
		for (const language of PACK_LANGUAGES) {
			const text = strategyPrompt(language).text;
			expect(text).not.toMatch(/(^|\s)\/[A-Za-z]/m);
			expect(text).not.toMatch(/https?:|www\./i);
			expect(text).not.toMatch(/<\//);
			expect(text).not.toMatch(/function_call|tool_use|tool_call/i);
		}
	});
});

describe("a plan written exactly as the prompt's example", () => {
	const built = new Map<PackLanguage, BuiltPack>();

	beforeAll(async () => {
		const source = demoSource();
		for (const language of PACK_LANGUAGES) {
			built.set(language, await buildWith(source, demoRequest({ language })));
		}
	});

	function packOf(language: PackLanguage): DataPack {
		const pack = built.get(language)?.pack;
		if (pack === undefined) throw new Error(`no ${language} pack`);
		return pack;
	}

	it("cites the cells the test fills, all of them existing in a built pack", () => {
		for (const language of PACK_LANGUAGES) {
			const example = exampleOf(strategyPrompt(language).text);
			expect(new Set(citedRefs(example))).toEqual(
				new Set(Object.keys(EXAMPLE_CELLS)),
			);
			expect(() => withCells(packOf(language), EXAMPLE_CELLS)).not.toThrow();
		}
	});

	it("lints with no issue at all against a pack that holds its numbers", () => {
		for (const language of PACK_LANGUAGES) {
			const pack = withCells(packOf(language), EXAMPLE_CELLS);
			const plan = examplePlan(language, pack.pack_id);
			const lint = lintPlan(plan, pack);
			expect(lint.issues).toEqual([]);
			expect(lint.ok).toBe(true);
			expect(lint.summary).toMatchObject({
				initiatives: MIN_INITIATIVES,
				citedInitiatives: MIN_INITIATIVES,
				kpis: 3,
				uncitedNumbers: 0,
			});
			expect(lint.plan?.frontMatter.language).toBe(language);
		}
	});

	it("is refused when the pack holds other numbers", () => {
		for (const language of PACK_LANGUAGES) {
			const pack = packOf(language);
			const codes = lintPlan(
				examplePlan(language, pack.pack_id),
				pack,
			).issues.map((issue) => issue.code);
			expect(codes).toContain("citation_mismatch:kpi:ALL/avg_ticket:w28");
			expect(codes).toContain("kpi_baseline_mismatch:avg_ticket");
		}
	});
});

describe("the private name list", () => {
	it("finds a term as a whole word, ignoring case after NFC, and names only the file and line", () => {
		const term = "Quán Mẫu Xyz";
		const sources: ScannedSource[] = [
			{
				name: "a.ts",
				lines: [
					"nothing here",
					"ghé quán mẫu xyz hôm nay",
					"QUÁN MẪU XYZ".normalize("NFD"),
					"quán mẫu xyzw",
					"aquán mẫu xyz",
				],
			},
			{ name: FILE_LIST, lines: ["packages/datapack/quán-mẫu-xyz.md"] },
		];
		const findings = privateTermFindings(sources, [term]);
		expect(findings).toEqual(["a.ts:2", "a.ts:3"]);
		expect(privateTermFindings(sources, ["mẫu-xyz"])).toEqual([
			`${FILE_LIST}:1`,
		]);
		for (const finding of findings) {
			expect(folded(finding)).not.toContain(folded(term));
		}
	});

	it.skipIf(IN_CI)(
		"occurs in neither prompt, the golden pack nor any file name under packages/datapack",
		() => {
			expect(
				existsSync(PRIVATE_LIST),
				"docs/private/identifiers.txt is missing",
			).toBe(true);
			const terms = readFileSync(PRIVATE_LIST, "utf8")
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter((line) => line !== "");
			expect(
				terms.length,
				"docs/private/identifiers.txt is empty",
			).toBeGreaterThan(0);
			expect(privateTermFindings(scannedSources(), terms)).toEqual([]);
		},
	);
});
