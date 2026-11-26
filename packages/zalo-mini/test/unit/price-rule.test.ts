import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// A price is written by PriceText only (design spec 5.2 and 5.3): that is what puts data-price on every price, so a
// check can find each one and see that no other text looks like one. This scan keeps it so: no shipped source builds a
// price by hand or calls the price formatters, except the formatters themselves and the component that uses them.

const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");
const shippedSources = [
	"packages/zalo-mini/src",
	"apps/zalo-staff/src",
	"apps/zalo-customer/src",
];
const mayWritePrices = new Set([
	"packages/zalo-mini/src/format/index.ts",
	"packages/zalo-mini/src/react/ui-kit/price-text.tsx",
]);
const formatterCalls = /\b(formatVnd|formatVndDelta|DONG_SUFFIX)\b/;
// a template literal or a sum that ends in the đồng sign: `${amount}đ`, amount + "đ"
const handBuiltPrice = /\$\{[^}]*\}\s?[đ₫](?![\p{L}])|\+\s*["'`]\s?[đ₫]["'`]/u;

function sourceFiles(path: string): string[] {
	if (!statSync(path).isDirectory()) return [path];
	return readdirSync(path).flatMap((name) => sourceFiles(join(path, name)));
}

const files = shippedSources
	.flatMap((path) => sourceFiles(join(repoRoot, path)))
	.map((file) => relative(repoRoot, file).replaceAll("\\", "/"))
	.filter((file) => /\.(ts|tsx)$/.test(file))
	.filter((file) => !/\.test\.tsx?$/.test(file))
	.filter((file) => !mayWritePrices.has(file));

function writesAPrice(text: string): boolean {
	return formatterCalls.test(text) || handBuiltPrice.test(text);
}

// the dollar sign of a template placeholder, kept out of the fixtures below so they stay plain strings
const D = "$";

describe("the Mini Apps' sources", () => {
	it("write a price through PriceText only", () => {
		expect(files.length).toBeGreaterThan(50);
		const offenders = files.filter((file) =>
			writesAPrice(readFileSync(join(repoRoot, file), "utf8")),
		);
		expect(offenders).toEqual([]);
	});

	it("catch a throwaway price", () => {
		for (const bad of [
			"formatVnd(35000)",
			"formatVndDelta(-5000)",
			`const x = \`${D}{total}đ\`;`,
			`const y = \`${D}{total} ₫\`;`,
			'const z = total + "đ";',
		]) {
			expect(writesAPrice(bad), bad).toBe(true);
		}
		for (const fine of [
			"<PriceText amount={total} />",
			`const n = \`${D}{count} điểm\`;`,
			`const t = \`${D}{open}–${D}{close}\`;`,
			'const w = count + "điểm";',
		]) {
			expect(writesAPrice(fine), fine).toBe(false);
		}
	});
});
