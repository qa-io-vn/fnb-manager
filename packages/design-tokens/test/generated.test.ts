import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GENERATED_FILES, renderTokenFiles } from "../scripts/build-tokens.mjs";

describe("generated token files", () => {
	it("equal a fresh build of the token sources", async () => {
		const rendered = await renderTokenFiles();
		expect(
			readFileSync(GENERATED_FILES.css, "utf8"),
			"run pnpm --filter @fnb/design-tokens build",
		).toBe(rendered.css);
		expect(
			readFileSync(GENERATED_FILES.ts, "utf8"),
			"run pnpm --filter @fnb/design-tokens build",
		).toBe(rendered.ts);
	});
});
