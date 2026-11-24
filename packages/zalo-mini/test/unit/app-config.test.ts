import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	AppConfigError,
	appConfigJson,
	buildAppConfig,
	contrastRatio,
	differingFields,
	isConfiguredPath,
	MINI_APP_KINDS,
	type MiniAppRow,
	parseMiniAppConfiguration,
	readAppConfig,
	selectMiniAppRow,
	titleProblems,
	unconfiguredDifferences,
	validateMiniAppRow,
} from "../../src/app-config/index";

const packageRoot = join(import.meta.dirname, "..", "..");
const syntheticPath = join(packageRoot, "config", "synthetic-brands.json");
const synthetic = parseMiniAppConfiguration(
	JSON.parse(readFileSync(syntheticPath, "utf8")),
);

const validRow: MiniAppRow = {
	brand_key: "brand-9",
	kind: "staff",
	title: "Nhân viên Quán Thử",
	header_title_vi: "Quán Thử",
	header_title_en: "Test Shop",
	header_color_light: "#0A6B56",
	header_color_dark: "#17161A",
	text_color_light: "white",
	text_color_dark: "white",
};

function problemsOf(row: Record<string, unknown>): readonly string[] {
	try {
		validateMiniAppRow(row);
		return [];
	} catch (error) {
		if (error instanceof AppConfigError) return error.problems;
		throw error;
	}
}

describe("app-config.json per brand", () => {
	it("holds two synthetic brands with a staff and a customer Mini App each", () => {
		expect(synthetic.map((row) => `${row.brand_key} ${row.kind}`)).toEqual([
			"brand-1 staff",
			"brand-1 customer",
			"brand-2 staff",
			"brand-2 customer",
		]);
	});

	it("writes the title, header titles and colours of the row", () => {
		const config = buildAppConfig(
			selectMiniAppRow(synthetic, "brand-1", "staff"),
		);
		expect(config).toEqual({
			app: {
				title: "Nhân viên Quán Mẫu Một",
				headerTitle: { vi: "Quán Mẫu Một", en: "Sample Shop One" },
				headerColor: { light: "#0A6B56", dark: "#17161A" },
				textColor: { light: "white", dark: "white" },
				statusBarType: "normal",
				hideIOSSafeAreaBottom: false,
				hideAndroidBottomNavigationBar: false,
			},
			listCSS: [],
			listSyncJS: [],
			listAsyncJS: [],
		});
		expect(readAppConfig(JSON.parse(appConfigJson(config)))).toEqual(config);
	});

	it.each(MINI_APP_KINDS)(
		"differs between the two brands only in the configured fields (%s)",
		(kind) => {
			const first = buildAppConfig(
				selectMiniAppRow(synthetic, "brand-1", kind),
			);
			const second = buildAppConfig(
				selectMiniAppRow(synthetic, "brand-2", kind),
			);
			expect(unconfiguredDifferences(first, second)).toEqual([]);
			expect(differingFields(first, second).length).toBeGreaterThan(0);
			expect(differingFields(first, second).every(isConfiguredPath)).toBe(true);
			// the second synthetic brand carries a theme, so the comparison covers it
			expect(
				differingFields(first, second).some((path) =>
					path.startsWith("theme."),
				),
			).toBe(true);
		},
	);

	it("flags a difference outside the configured fields", () => {
		const first = buildAppConfig(validRow);
		const changed = { ...first, listCSS: ["extra.css"] };
		expect(unconfiguredDifferences(first, changed)).toEqual(["listCSS"]);
	});

	it("keeps real identifiers out: the configuration holds no Mini App id", () => {
		for (const row of JSON.parse(readFileSync(syntheticPath, "utf8"))
			.mini_apps) {
			// the row's fields and an optional theme, never an id
			expect(
				Object.keys(row)
					.filter((key) => key !== "theme")
					.sort(),
			).toEqual(Object.keys(validRow).sort());
		}
	});

	it("refuses titles against Zalo's naming rules", () => {
		expect(titleProblems("Nhân viên Quán Thử")).toEqual([]);
		expect(titleProblems("Ab")).toContain("title must be 3 to 50 characters");
		expect(titleProblems("x".repeat(51))).toContain(
			"title must be 3 to 50 characters",
		);
		expect(titleProblems("QUÁN THỬ")).toContain(
			"title must not be written in capitals only",
		);
		for (const title of ["Quán Thử Zalo", "Quán Thử App", "Mini App Quán"]) {
			expect(titleProblems(title)).toContain(
				"title must not contain Zalo, App or Mini App",
			);
		}
		expect(titleProblems("Happy Quán")).toEqual([]);
	});

	it("refuses colours, text colours and contrast that Zalo's header cannot show", () => {
		expect(problemsOf({ ...validRow, header_color_light: "teal" })).toContain(
			"header_color_light must be a colour such as #0A6B56",
		);
		expect(problemsOf({ ...validRow, text_color_dark: "grey" })).toContain(
			"text_color_dark must be white or black",
		);
		expect(
			problemsOf({ ...validRow, header_color_light: "#FFFF00" }),
		).toContain(
			"the light header colour and its text colour need a contrast of at least 4.5:1",
		);
		expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
	});

	it("refuses a missing field, an unknown kind and a key that is not neutral", () => {
		const problems = problemsOf({
			...validRow,
			brand_key: "Shop A",
			kind: "kitchen",
			header_title_en: " ",
		});
		expect(problems).toEqual([
			"brand_key must be a neutral key such as brand-1",
			"kind must be staff or customer",
			"header_title_en is required",
		]);
	});

	it("refuses two Mini Apps of one kind for a brand and a brand that is not configured", () => {
		expect(() =>
			parseMiniAppConfiguration({ mini_apps: [validRow, validRow] }),
		).toThrow("brand-9 has more than one staff Mini App");
		expect(() => selectMiniAppRow(synthetic, "brand-7", "staff")).toThrow(
			"no staff Mini App is configured for brand-7",
		);
		expect(() => parseMiniAppConfiguration({})).toThrow(
			"the configuration needs a mini_apps list",
		);
	});
});

describe("app-config command", () => {
	const directory = mkdtempSync(join(tmpdir(), "fnb-app-config-"));
	afterAll(() => rmSync(directory, { recursive: true, force: true }));
	const cli = join(packageRoot, "src", "app-config", "cli.ts");
	const tsx = join(
		packageRoot,
		"..",
		"..",
		"node_modules",
		"tsx",
		"dist",
		"cli.mjs",
	);
	const run = (args: readonly string[]) =>
		execFileSync(process.execPath, [tsx, cli, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});

	it("writes one file per brand and app, and compares two brands", () => {
		const first = join(directory, "brand-1.json");
		const second = join(directory, "brand-2.json");
		run([
			"--config",
			syntheticPath,
			"--brand",
			"brand-1",
			"--app",
			"customer",
			"--out",
			first,
		]);
		run([
			"--config",
			syntheticPath,
			"--brand",
			"brand-2",
			"--app",
			"customer",
			"--out",
			second,
		]);
		expect(
			readAppConfig(JSON.parse(readFileSync(first, "utf8"))).app.title,
		).toBe("Thành viên Quán Mẫu Một");
		expect(run(["--compare", first, second])).toContain(
			"the files differ only in configured fields",
		);
		expect(
			run(["--config", syntheticPath, "--list"]).trim().split("\n"),
		).toEqual([
			"brand-1 staff",
			"brand-1 customer",
			"brand-2 staff",
			"brand-2 customer",
		]);
	});

	it("fails when two files differ outside the configured fields", () => {
		const first = join(directory, "a.json");
		const second = join(directory, "b.json");
		writeFileSync(first, appConfigJson(buildAppConfig(validRow)));
		writeFileSync(
			second,
			JSON.stringify({ ...buildAppConfig(validRow), listSyncJS: ["x.js"] }),
		);
		expect(() => run(["--compare", first, second])).toThrow();
	});
});
