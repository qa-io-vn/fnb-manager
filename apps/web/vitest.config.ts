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
			env: {
				VITE_SUPABASE_URL: "",
				VITE_SUPABASE_PUBLISHABLE_KEY: "",
			},
		},
	}),
);
