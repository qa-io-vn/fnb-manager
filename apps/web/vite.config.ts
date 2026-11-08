import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const basePath = process.env.VITE_BASE_PATH || "/";
const buildId = `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 8)}`;

function versionFile(id: string): Plugin {
	const body = JSON.stringify({ buildId: id });
	return {
		name: "fnb-version-file",
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				if (request.url?.split("?")[0]?.endsWith("/version.json")) {
					response.setHeader("content-type", "application/json");
					response.setHeader("cache-control", "no-store");
					response.end(body);
					return;
				}
				next();
			});
		},
		generateBundle() {
			this.emitFile({ type: "asset", fileName: "version.json", source: body });
		},
	};
}

const demoRowSourceModule = /\/src\/demo\/demo-row-source\.ts$/;

function isDemoBuild(env: Record<string, string | undefined>): boolean {
	return (
		!env.VITE_SUPABASE_URL?.trim() || !env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
	);
}

function demoRowSourcePreload(): Plugin {
	let enabled = false;
	let base = "/";
	return {
		name: "fnb-demo-row-source-preload",
		apply: "build",
		configResolved(config) {
			enabled = isDemoBuild(config.env);
			base = config.base;
		},
		transformIndexHtml: {
			order: "post",
			handler(_html, context) {
				if (!enabled || !context.bundle) return;
				const demoChunk = Object.values(context.bundle).find(
					(output) =>
						output.type === "chunk" &&
						demoRowSourceModule.test(output.facadeModuleId ?? ""),
				);
				if (!demoChunk) return;
				return [
					{
						tag: "link",
						attrs: {
							rel: "modulepreload",
							crossorigin: true,
							href: `${base}${demoChunk.fileName}`,
						},
						injectTo: "head",
					},
				];
			},
		},
	};
}

export default defineConfig({
	base: basePath,
	define: {
		__BUILD_ID__: JSON.stringify(buildId),
	},
	plugins: [
		react(),
		tailwindcss(),
		versionFile(buildId),
		demoRowSourcePreload(),
	],
	build: {
		target: "es2022",
		sourcemap: false,
		manifest: true,
		chunkSizeWarningLimit: 800,
	},
	server: {
		port: 5173,
	},
	preview: {
		port: 4173,
	},
});
