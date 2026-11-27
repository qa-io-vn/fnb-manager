import { defineConfig } from "vitest/config";

// counter:integration: the counter's calls against the real RPCs of the local stack (synthetic tenants only).
export default defineConfig({
	test: {
		environment: "node",
		include: ["test/integration/**/*.test.ts"],
		testTimeout: 60_000,
		hookTimeout: 120_000,
		fileParallelism: false,
	},
});
