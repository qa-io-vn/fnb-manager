import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			environment: "jsdom",
			include: [
				"src/**/*.test.ts",
				"src/**/*.test.tsx",
				"scripts/**/*.test.ts",
			],
			setupFiles: ["src/test/setup.ts"],
			css: false,
			testTimeout: 30_000,
		},
	}),
);
