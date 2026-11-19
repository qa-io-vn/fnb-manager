import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

function source(path: string): string {
	return fileURLToPath(new URL(path, import.meta.url));
}

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@fnb\/zalo\/testing$/,
				replacement: source("./src/testing/index.ts"),
			},
			{
				find: /^@fnb\/zalo\/tokens\/testing$/,
				replacement: source("./src/tokens/testing.ts"),
			},
			{
				find: /^@fnb\/zalo\/oa$/,
				replacement: source("./src/oa/index.ts"),
			},
			{
				find: /^@fnb\/zalo\/tokens$/,
				replacement: source("./src/tokens/index.ts"),
			},
			{ find: /^@fnb\/zalo$/, replacement: source("./src/index.ts") },
			{ find: /^@fnb\/sync$/, replacement: source("../sync/src/index.ts") },
			{
				find: /^@fnb\/sync\/postgres$/,
				replacement: source("../sync/src/postgres/index.ts"),
			},
		],
	},
	test: {
		include: ["test/**/*.test.ts"],
	},
});
