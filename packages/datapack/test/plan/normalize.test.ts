import { describe, expect, it } from "vitest";
import { lintPlan, normalizePlanText } from "../../src/index.js";
import { normalizePlan } from "../../src/plan/normalize.js";
import {
	cleanPlan,
	expectedLintCodes,
	lintFixture,
	lintFixtureNames,
	lintFixtureText,
	lintPack,
} from "./support.js";

const FRONT_MATTER = [
	"{",
	'\t"format": "fnb-plan/1",',
	`\t"pack": "${"a".repeat(64)}",`,
	'\t"title": "Kế hoạch",',
	'\t"horizon": "90d",',
	'\t"language": "vi",',
	'\t"kpis": {}',
	"}",
].join("\n");

const BODY = "## 1. Tóm tắt tình hình\n\nDoanh thu ổn định.";
const NORMALIZED = `---\n${FRONT_MATTER}\n---\n\n${BODY}\n`;

describe("normalizePlanText", () => {
	it("leaves a normalised plan unchanged", () => {
		expect(normalizePlanText(NORMALIZED)).toBe(NORMALIZED);
		expect(normalizePlan(NORMALIZED)).toEqual({
			text: NORMALIZED,
			preamble: false,
		});
	});

	it("converts Windows and old Mac line ends to LF", () => {
		expect(normalizePlanText(NORMALIZED.replace(/\n/g, "\r\n"))).toBe(
			NORMALIZED,
		);
		expect(normalizePlanText(NORMALIZED.replace(/\n/g, "\r"))).toBe(NORMALIZED);
		expect(normalizePlanText("a\r\nb\rc\n")).toBe("a\nb\nc\n");
	});

	it("removes a leading byte order mark", () => {
		expect(normalizePlanText(`\uFEFF${NORMALIZED}`)).toBe(NORMALIZED);
	});

	it("composes decomposed Unicode", () => {
		const decomposed = NORMALIZED.normalize("NFD");
		expect(decomposed).not.toBe(NORMALIZED);
		expect(normalizePlanText(decomposed)).toBe(NORMALIZED);
		expect(normalizePlanText("Tie\u0302\u0301n")).toBe("Tiến\n");
	});

	it("strips trailing spaces and surrounding blank lines and keeps one final newline", () => {
		expect(normalizePlanText("\n\n  \nfirst  \t\n\n\nsecond \n\n\n")).toBe(
			"first\n\n\nsecond\n",
		);
		expect(normalizePlanText("only")).toBe("only\n");
		expect(normalizePlanText("")).toBe("\n");
		expect(normalizePlanText("   \n\t\n")).toBe("\n");
	});

	it("removes a single fence wrapped around the whole answer", () => {
		for (const opening of ["```", "```markdown", "```md", "~~~", "````"]) {
			const closing = opening.startsWith("~")
				? "~~~"
				: opening.replace(/[a-z]+$/, "");
			expect(normalizePlanText(`${opening}\n${NORMALIZED}${closing}\n`)).toBe(
				NORMALIZED,
			);
		}
		const twice = `\`\`\`\n\`\`\`\n${NORMALIZED}\`\`\`\n\`\`\`\n`;
		expect(normalizePlanText(twice)).not.toBe(NORMALIZED);
	});

	it("keeps a fence that does not wrap the whole answer", () => {
		const text = `${NORMALIZED}\n\`\`\`\nfnb datapack --check\n\`\`\`\n`;
		expect(normalizePlanText(text)).toBe(text);
		expect(normalizePlanText("```python\nprint(1)\n```\n")).toBe(
			"```python\nprint(1)\n```\n",
		);
	});

	it("discards the text before the front matter and reports it", () => {
		const text = `Đây là kế hoạch của bạn:\n\n${NORMALIZED}`;
		expect(normalizePlan(text)).toEqual({ text: NORMALIZED, preamble: true });
		expect(normalizePlan(`\n\n${NORMALIZED}`)).toEqual({
			text: NORMALIZED,
			preamble: false,
		});
	});

	it("removes a fence opened after the preamble and closed at the end", () => {
		const fenced = `Kế hoạch:\n\n\`\`\`markdown\n${NORMALIZED}\`\`\`\n`;
		expect(normalizePlan(fenced)).toEqual({ text: NORMALIZED, preamble: true });
	});

	it("removes the fence around the plan when a remark follows it and keeps the remark", () => {
		const fence = "```";
		const remark = "Chúc may mắn!";
		expect(
			normalizePlan(
				`Kế hoạch:\n\n${fence}markdown\n${NORMALIZED}${fence}\n\n${remark}\n`,
			),
		).toEqual({ text: `${NORMALIZED}\n${remark}\n`, preamble: true });
		expect(
			normalizePlan(`${fence}markdown\n${NORMALIZED}${fence}\n\n${remark}\n`),
		).toEqual({ text: `${NORMALIZED}\n${remark}\n`, preamble: false });
		const long = "````";
		const inner = `${NORMALIZED}\n${fence}\nfnb datapack\n${fence}\n`;
		expect(
			normalizePlan(`${long}markdown\n${inner}${long}\n${remark}\n`),
		).toEqual({ text: `${inner}${remark}\n`, preamble: false });
	});

	it("drops an opening fence that is never closed without calling it a preamble", () => {
		expect(normalizePlan(`\`\`\`markdown\n${NORMALIZED}`)).toEqual({
			text: NORMALIZED,
			preamble: false,
		});
	});

	it("turns front matter given as a json or fnb-plan code block into the dashed form", () => {
		for (const info of ["json", "fnb-plan", "JSON"]) {
			const text = `\`\`\`${info}\n${FRONT_MATTER}\n\`\`\`\n\n${BODY}\n`;
			expect(normalizePlan(text)).toEqual({
				text: NORMALIZED,
				preamble: false,
			});
		}
		const compact = `\`\`\`json\n{"format":"fnb-plan/1"}\n\`\`\`\n${BODY}\n`;
		expect(normalizePlanText(compact)).toBe(
			`---\n{"format":"fnb-plan/1"}\n---\n${BODY}\n`,
		);
	});

	it("handles a json front matter block inside a wrapping fence and after a preamble", () => {
		const inner = `\`\`\`json\n${FRONT_MATTER}\n\`\`\`\n\n${BODY}\n`;
		expect(normalizePlan(`\`\`\`\`markdown\n${inner}\`\`\`\`\n`)).toEqual({
			text: NORMALIZED,
			preamble: false,
		});
		expect(normalizePlan(`Kế hoạch như sau.\n${inner}`)).toEqual({
			text: NORMALIZED,
			preamble: true,
		});
	});

	it("leaves a json code block without the plan format alone", () => {
		const text = `${BODY}\n\n\`\`\`json\n{"a": 1}\n\`\`\`\n`;
		expect(normalizePlan(text)).toEqual({ text, preamble: false });
	});

	it("does not take a horizontal rule in the preamble for front matter", () => {
		const text = `Ghi chú\n---\nkhông phải front matter\n---\n\n${NORMALIZED}`;
		expect(normalizePlan(text)).toEqual({ text: NORMALIZED, preamble: true });
	});

	it("is idempotent on every lint fixture", () => {
		for (const name of lintFixtureNames()) {
			const once = normalizePlanText(lintFixture(name));
			expect(normalizePlanText(once)).toBe(once);
			expect(
				once.startsWith("---\n") || name === "front_matter_missing.md",
			).toBe(true);
		}
	});

	it("is the text the lint reports, hashes and stores", () => {
		const pack = lintPack();
		for (const name of Object.keys(expectedLintCodes())) {
			const text = lintFixtureText(name);
			expect(lintPlan(text, pack).normalized).toBe(normalizePlanText(text));
		}
		const windows = `\uFEFF${cleanPlan().replace(/\n/g, "\r\n").normalize("NFD")}`;
		const result = lintPlan(windows, pack);
		expect(result.normalized).toBe(normalizePlanText(cleanPlan()));
		expect(result.issues).toEqual([]);
	});
});
