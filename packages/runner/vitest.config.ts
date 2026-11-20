import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

function source(path: string): string {
	return fileURLToPath(new URL(path, import.meta.url));
}

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@fnb\/runner\/postgres$/,
				replacement: source("./src/postgres/index.ts"),
			},
			{ find: /^@fnb\/runner$/, replacement: source("./src/index.ts") },
			{
				find: /^@fnb\/sync\/postgres$/,
				replacement: source("../sync/src/postgres/index.ts"),
			},
			{ find: /^@fnb\/sync$/, replacement: source("../sync/src/index.ts") },
			{
				find: /^@fnb\/notify\/outbox$/,
				replacement: source("../notify/src/outbox/index.ts"),
			},
			{ find: /^@fnb\/notify$/, replacement: source("../notify/src/index.ts") },
		],
	},
	test: {
		include: ["test/**/*.test.ts"],
	},
});
