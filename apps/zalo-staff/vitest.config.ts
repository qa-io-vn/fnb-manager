import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			environment: "jsdom",
			include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
			setupFiles: ["src/test/setup.ts"],
			css: false,
			coverage: {
				// Reported, not gated (docs/test-gaps.md G-40): no threshold anywhere.
				provider: "v8",
				reportOnFailure: true,
				include: ["src/**/*.ts", "src/**/*.tsx"],
				reporter: ["text-summary", "json-summary", "html"],
				reportsDirectory: "coverage",
			},
		},
	}),
);
