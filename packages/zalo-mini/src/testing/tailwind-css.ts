import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

// Compiles an app's style sheet entry with Tailwind, in a unit test, so that a test can see which CSS a class produces
// from the shell's tokens and defaults. The package has no Tailwind of its own: the app's test hands over `compile`
// (`import { compile } from "tailwindcss"`) and its folder.

interface Compiler {
	build(candidates: string[]): string;
}

export type TailwindCompile = (
	css: string,
	options: {
		readonly base: string;
		readonly loadStylesheet: (
			id: string,
			base: string,
		) => Promise<{
			readonly path: string;
			readonly base: string;
			readonly content: string;
		}>;
	},
) => Promise<Compiler>;

/** The entry style sheet that both Mini Apps share, without the ZaUI sheet, which no test reads. */
export const APP_STYLE_ENTRY = [
	'@import "tailwindcss";',
	'@import "@fnb/design-tokens/tokens.css";',
	'@import "@fnb/zalo-mini/styles.css";',
].join("\n");

export async function compileAppCss(
	compile: TailwindCompile,
	appRoot: string,
	candidates: readonly string[],
	entry: string = APP_STYLE_ENTRY,
): Promise<string> {
	const require = createRequire(join(appRoot, "package.json"));
	const compiler = await compile(entry, {
		base: appRoot,
		async loadStylesheet(id, base) {
			let path: string;
			if (id.startsWith(".") || id.startsWith("/")) {
				path = resolve(base, id);
			} else if (id === "tailwindcss") {
				path = join(dirname(require.resolve("tailwindcss")), "..", "index.css");
			} else {
				path = require.resolve(id, { paths: [base] });
			}
			return {
				path,
				base: dirname(path),
				content: readFileSync(path, "utf8"),
			};
		},
	});
	return compiler.build([...candidates]);
}
