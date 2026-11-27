import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			environment: "jsdom",
			include: ["src/**/*.test.ts", "src/**/*.test.tsx", "vite/**/*.test.ts"],
			setupFiles: ["src/test/setup.ts"],
			css: false,
		},
	}),
);
