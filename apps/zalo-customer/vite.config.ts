import { fileURLToPath } from "node:url";
import { miniApp } from "@fnb/zalo-mini/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		react(),
		tailwindcss(),
		...miniApp({
			kind: "customer",
			developmentOnlyMarkers: ["phone-probe"],
			appRoot: fileURLToPath(new URL(".", import.meta.url)),
		}),
	],
	server: {
		host: "127.0.0.1",
		port: 5751,
		strictPort: true,
	},
	preview: {
		host: "127.0.0.1",
		port: 5754,
		strictPort: true,
	},
});
