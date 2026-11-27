import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		// the two gated integration files both take the shared database's e-invoice work list, so files run one at a time
		fileParallelism: false,
	},
});
