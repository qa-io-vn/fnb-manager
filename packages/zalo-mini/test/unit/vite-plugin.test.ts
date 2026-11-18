import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { appConfigJson, buildAppConfig } from "../../src/app-config/index";
import {
	deployedAppConfig,
	developmentOnlyLeaks,
	forbiddenImport,
	forbidHeavyImports,
	loadMiniAppConfig,
	MOCK_SDK_PATH,
	miniAppSettings,
} from "../../src/vite/index";

const appRoot = mkdtempSync(join(tmpdir(), "fnb-mini-plugin-"));
afterAll(() => rmSync(appRoot, { recursive: true, force: true }));

describe("Mini App build settings", () => {
	it("default to the browser runtime, a Development dev server and a Testing build", () => {
		expect(miniAppSettings({}, "serve", appRoot)).toEqual({
			runtime: "browser",
			stage: "development",
			brand: "brand-1",
			appConfigPath: join(appRoot, "app-config.json"),
		});
		expect(miniAppSettings({}, "build", appRoot).stage).toBe("testing");
	});

	it("need the brand and the Supabase variables for a Zalo build", () => {
		expect(() =>
			miniAppSettings({ VITE_ZALO_RUNTIME: "zalo" }, "build", appRoot),
		).toThrow(
			"a Zalo build needs VITE_BRAND_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY",
		);
		const settings = miniAppSettings(
			{
				VITE_ZALO_RUNTIME: "zalo",
				VITE_MINI_APP_STAGE: "development",
				VITE_BRAND_KEY: "brand-2",
				VITE_SUPABASE_URL: "https://project.example.com",
				VITE_SUPABASE_PUBLISHABLE_KEY: "publishable-test",
				MINI_APP_CONFIG: "configs/brand-2.json",
			},
			"build",
			appRoot,
		);
		expect(settings).toEqual({
			runtime: "zalo",
			stage: "development",
			brand: "brand-2",
			appConfigPath: join(appRoot, "configs", "brand-2.json"),
		});
	});

	it("refuse an unknown runtime or stage", () => {
		expect(() =>
			miniAppSettings({ VITE_ZALO_RUNTIME: "native" }, "build", appRoot),
		).toThrow("VITE_ZALO_RUNTIME must be one of browser, zalo");
		expect(() =>
			miniAppSettings({ VITE_MINI_APP_STAGE: "release" }, "build", appRoot),
		).toThrow("VITE_MINI_APP_STAGE must be one of development, testing");
	});

	it("fall back to the synthetic brand in browser mode and refuse that for Zalo", () => {
		const browser = miniAppSettings({}, "build", appRoot);
		expect(loadMiniAppConfig(browser, "customer").app.title).toBe(
			"Thành viên Quán Mẫu Một",
		);
		expect(() =>
			loadMiniAppConfig({ ...browser, runtime: "zalo" }, "customer"),
		).toThrow("a Zalo build needs the generated app-config.json of its brand");
	});

	it("read the generated app-config.json when it exists", () => {
		const path = join(appRoot, "app-config.json");
		const generated = buildAppConfig({
			brand_key: "brand-2",
			kind: "staff",
			title: "Nhân viên Quán Mẫu Hai",
			header_title_vi: "Quán Mẫu Hai",
			header_title_en: "Sample Shop Two",
			header_color_light: "#F6F4EF",
			header_color_dark: "#121114",
			text_color_light: "black",
			text_color_dark: "white",
		});
		writeFileSync(path, appConfigJson(generated));
		expect(
			loadMiniAppConfig(miniAppSettings({}, "build", appRoot), "staff"),
		).toEqual(generated);
		rmSync(path);
	});

	it("point zmp-sdk at the mocked SDK in browser mode", () => {
		expect(MOCK_SDK_PATH.replaceAll("\\", "/")).toMatch(
			/packages\/zalo-mini\/src\/testing\/mock-sdk\.ts$/,
		);
	});
});

describe("forbidden imports", () => {
	it("catch ECharts and zrender imports", () => {
		expect(forbiddenImport("echarts")).toBe("echarts");
		expect(forbiddenImport("echarts/core")).toBe("echarts");
		expect(forbiddenImport("zrender/lib/canvas")).toBe("zrender");
		expect(forbiddenImport("echarts-for-react")).toBeNull();
		expect(forbiddenImport("react")).toBeNull();
	});

	it("fail the build on a throwaway ECharts import", () => {
		const plugin = forbidHeavyImports();
		const hook = plugin.resolveId as unknown as (
			this: { error(message: string): never },
			source: string,
		) => unknown;
		const context = {
			error(message: string): never {
				throw new Error(message);
			},
		};
		expect(() => hook.call(context, "echarts")).toThrow(
			"echarts is not allowed in a Mini App (bundle budget, NFR-PERF-09)",
		);
		expect(hook.call(context, "react")).toBeNull();
	});
});

describe("Development-only screens", () => {
	const bundle = {
		"assets/index.module.js": {
			fileName: "assets/index.module.js",
			code: "render()",
		},
		"assets/probe.module.js": {
			fileName: "assets/probe.module.js",
			code: 'data-testid="phone-probe"',
		},
	};

	it("fail a Testing build that still contains them", () => {
		expect(developmentOnlyLeaks("testing", ["phone-probe"], bundle)).toEqual([
			"assets/probe.module.js contains phone-probe",
		]);
	});

	it("are allowed in a Development build", () => {
		expect(
			developmentOnlyLeaks("development", ["phone-probe"], bundle),
		).toEqual([]);
	});
});

describe("the deployed app-config.json", () => {
	it("lists the CSS, the entry and the chunks it imports, as zmp-vite-plugin does", () => {
		const config = buildAppConfig({
			brand_key: "brand-1",
			kind: "staff",
			title: "Nhân viên Quán Mẫu Một",
			header_title_vi: "Quán Mẫu Một",
			header_title_en: "Sample Shop One",
			header_color_light: "#0A6B56",
			header_color_dark: "#17161A",
			text_color_light: "white",
			text_color_dark: "white",
		});
		const deployed = deployedAppConfig(config, {
			"assets/index.css": { type: "asset", fileName: "assets/index.css" },
			"assets/index.module.js": {
				type: "chunk",
				fileName: "assets/index.module.js",
				isEntry: true,
				imports: ["assets/vendor.module.js"],
			},
			"assets/vendor.module.js": {
				type: "chunk",
				fileName: "assets/vendor.module.js",
				isEntry: false,
				imports: [],
			},
			"assets/probe.module.js": {
				type: "chunk",
				fileName: "assets/probe.module.js",
				isEntry: false,
				imports: [],
			},
		});
		expect(deployed).toEqual({
			app: config.app,
			listCSS: ["assets/index.css"],
			listSyncJS: ["assets/index.module.js"],
			listAsyncJS: ["assets/vendor.module.js"],
		});
	});
});
