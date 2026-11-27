import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { counterConfig } from "./vite/counter-config.ts";
import { counterCsp } from "./vite/csp.ts";

const appRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
	plugins: [react(), tailwindcss(), counterConfig(appRoot), counterCsp()],
	server: {
		host: "127.0.0.1",
		port: 5761,
		strictPort: true,
	},
	preview: {
		host: "127.0.0.1",
		port: 5762,
		strictPort: true,
	},
	build: {
		target: "es2020",
		chunkSizeWarningLimit: 1500,
	},
});
