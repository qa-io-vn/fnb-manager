import { beforeAll, describe, expect, it } from "vitest";
import type { BuiltPack } from "../../src/pack/build.js";
import {
	BUNDLE_FENCE_CLOSE,
	BUNDLE_FENCE_OPEN,
	BUNDLE_PROMPT_POINTER,
	chatBundle,
} from "../../src/pack/bundle.js";
import { canonicalJson } from "../../src/pack/canonical.js";
import { packIdOf } from "../../src/pack/hash.js";
import { parsePack } from "../../src/pack/invariants.js";
import { PACK_LANGUAGES, type PackLanguage } from "../../src/pack/request.js";
import type { DataPack } from "../../src/pack/schema.js";
import { strategyPrompt } from "../../src/prompt/prompt.js";
import {
	buildWith,
	demoRequest,
	demoSource,
	GOLDEN_FOCUS,
} from "./support/demo.js";

interface BundleParts {
	readonly prompt: string;
	readonly json: string;
}

function partsOf(bundle: string): BundleParts {
	const open = `\n\n${BUNDLE_FENCE_OPEN}\n`;
	const at = bundle.lastIndexOf(open);
	const close = `${BUNDLE_FENCE_CLOSE}\n`;
	expect(at).toBeGreaterThan(0);
	expect(bundle.endsWith(close)).toBe(true);
	return {
		prompt: bundle.slice(0, at),
		json: bundle.slice(at + open.length, bundle.length - close.length),
	};
}

function occurrences(text: string, part: string): number {
	return text.split(part).length - 1;
}

describe("chatBundle", () => {
	const built = new Map<PackLanguage, BuiltPack>();

	beforeAll(async () => {
		const source = demoSource();
		for (const language of PACK_LANGUAGES) {
			built.set(
				language,
				await buildWith(source, demoRequest({ language, focus: GOLDEN_FOCUS })),
			);
		}
	});

	function packOf(language: PackLanguage): DataPack {
		const pack = built.get(language)?.pack;
		if (pack === undefined) throw new Error(`no ${language} pack`);
		return pack;
	}

	it("starts with the prompt, from its heading on", () => {
		for (const language of PACK_LANGUAGES) {
			const pack = packOf(language);
			const bundle = chatBundle(pack);
			expect(bundle.startsWith(`${strategyPrompt(language).text}\n\n`)).toBe(
				true,
			);
			expect(bundle.startsWith("# ")).toBe(true);
			expect(partsOf(bundle).prompt).toBe(pack.prompt.text);
		}
	});

	it("carries the canonical pack in one json fence, with a one-line pointer instead of a second copy of the prompt", () => {
		for (const language of PACK_LANGUAGES) {
			const pack = packOf(language);
			const bundle = chatBundle(pack);
			const { json } = partsOf(bundle);
			expect(occurrences(bundle, BUNDLE_FENCE_OPEN)).toBe(1);
			expect(json.endsWith("\n")).toBe(true);
			expect(json.slice(0, -1)).not.toContain("\n");
			const fenced = JSON.parse(json) as DataPack;
			expect(canonicalJson(fenced)).toBe(json);
			expect(fenced.prompt).toEqual({
				...pack.prompt,
				text: BUNDLE_PROMPT_POINTER[language],
			});
			expect(BUNDLE_PROMPT_POINTER[language]).not.toContain("\n");
			expect(canonicalJson({ ...fenced, prompt: pack.prompt })).toBe(
				canonicalJson(pack),
			);
			const firstLine = pack.prompt.text.split("\n")[0] ?? "";
			expect(occurrences(bundle, firstLine)).toBe(1);
			expect(bundle.length).toBeLessThan(
				pack.prompt.text.length + canonicalJson(pack).length,
			);
		}
	});

	it("keeps the pack's pack_id, and putting the prompt back gives the pack byte for byte", async () => {
		for (const language of PACK_LANGUAGES) {
			const pack = packOf(language);
			const { prompt, json } = partsOf(chatBundle(pack));
			const fenced = JSON.parse(json) as DataPack;
			expect(fenced.pack_id).toBe(pack.pack_id);
			const restored = canonicalJson({
				...fenced,
				prompt: { ...fenced.prompt, text: prompt },
			});
			expect(restored).toBe(canonicalJson(pack));
			expect(await packIdOf(JSON.parse(restored))).toBe(pack.pack_id);
			expect((await parsePack(restored)).valid).toBe(true);
		}
	});

	it("points back in the pack's language", () => {
		expect(BUNDLE_PROMPT_POINTER.vi).not.toBe(BUNDLE_PROMPT_POINTER.en);
		for (const language of PACK_LANGUAGES) {
			const { json } = partsOf(chatBundle(packOf(language)));
			expect(json).toContain(JSON.stringify(BUNDLE_PROMPT_POINTER[language]));
		}
	});
});
