import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		coverage: {
			// Reported, not gated (docs/test-gaps.md G-40): no threshold anywhere.
			provider: "v8",
			reportOnFailure: true,
			include: ["src/**/*.ts"],
			reporter: ["text-summary", "json-summary", "html"],
			reportsDirectory: "coverage",
		},
	},
});
