import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import {
	alertSource,
	type BrandTokenStatus,
	brandLabel,
	formatDuration,
	nextRefreshText,
	redirectUri,
	refreshLine,
	statusLines,
	zaloMaskCommands,
	zaloSecretVariables,
} from "../../src/commands/zalo-tokens.js";
import { UsageError } from "../../src/context.js";
import { capture } from "../support/capture.js";

const NOW = new Date("2026-11-18T03:00:00.000Z");
const HOUR = 3_600_000;
const SECRET = "synthetic-app-secret-%-value";
const TARGET = { tenantSlug: "zalo-it-unit", brandKey: "brand-2" };

function refusal(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(UsageError);
		return (error as Error).message;
	}
	throw new Error("nothing was refused");
}

async function fnb(
	argv: readonly string[],
	environment: Readonly<Record<string, string>>,
) {
	const out = capture();
	const code = await runCli(argv, environment, {
		streams: out.streams,
		loadEnvFile: false,
	});
	return { code, stdout: out.stdout(), stderr: out.stderr() };
}

describe("the age display", () => {
	it("rounds durations to minutes, hours or days", () => {
		expect(formatDuration(0)).toBe("0 min");
		expect(formatDuration(89 * 60)).toBe("89 min");
		expect(formatDuration(90 * 60)).toBe("2 h");
		expect(formatDuration(11 * 3_600)).toBe("11 h");
		expect(formatDuration(47 * 3_600)).toBe("47 h");
		expect(formatDuration(48 * 3_600)).toBe("2 days");
		expect(formatDuration(-5)).toBe("0 min");
	});

	it("says a pair is due once its refresh time has come, and when it comes otherwise", () => {
		expect(nextRefreshText("oa", new Date(NOW.getTime() + 8 * HOUR), NOW)).toBe(
			"next refresh in 8 h",
		);
		expect(nextRefreshText("oa", NOW, NOW)).toBe("refresh due now");
		expect(
			nextRefreshText("developer", new Date(NOW.getTime() - HOUR), NOW),
		).toBe("rotation due now");
	});
});

describe("numbered output", () => {
	it("numbers brands with CI set and names them otherwise", () => {
		expect(brandLabel(true, 1, TARGET)).toBe("brand 2");
		expect(brandLabel(false, 1, TARGET)).toBe("zalo-it-unit brand-2");
	});

	it("tells each outcome of a refresh in one line", () => {
		expect(
			refreshLine("brand 1", "oa", {
				outcome: "refreshed",
				version: 3,
				ageSeconds: 12 * 3_600,
			}),
		).toBe("brand 1: OA token refreshed (version 3; it was 12 h old)");
		expect(
			refreshLine("brand 1", "oa", {
				outcome: "fresh",
				version: 3,
				ageSeconds: 600,
			}),
		).toBe("brand 1: OA token fresh (10 min old, version 3); nothing to do");
		expect(
			refreshLine("brand 2", "oa", {
				outcome: "refused",
				errorCode: -216,
				alert: "opened",
			}),
		).toBe(
			"brand 2: Zalo refused the OA token refresh (error -216); zalo_token_failed opened",
		);
		expect(
			refreshLine("brand 2", "developer", {
				outcome: "uncertain",
				failure: "timeout",
				alert: "opened",
			}),
		).toBe(
			"brand 2: no usable answer for the developer token refresh (timeout); not retried, the next run reads the row again; zalo_token_failed opened",
		);
		expect(refreshLine("brand 1", "developer", { outcome: "missing" })).toBe(
			"brand 1: no developer token stored yet; run fnb zalo zmp seed",
		);
		expect(
			refreshLine("brand 1", "oa", {
				outcome: "not_configured",
				alert: "repeated",
			}),
		).toBe(
			"brand 1: the brand's App secret is not set in this environment; zalo_token_failed repeated",
		);
	});

	it("prints the status of each brand, numbered with CI set and without slugs", () => {
		const brands: BrandTokenStatus[] = [
			{
				tenantSlug: "zalo-it-unit",
				brandKey: "brand-1",
				appStatus: "active",
				packageTier: "tang_truong",
				packageExpiresOn: "2027-06-30",
				packageDaysLeft: 224,
				webhookMode: "observe",
				oa: {
					refreshedAt: new Date(NOW.getTime() - 3 * HOUR),
					nextRefreshAt: new Date(NOW.getTime() + 8 * HOUR),
					version: 3,
					accessExpiresAt: new Date(NOW.getTime() + 22 * HOUR),
				},
				developer: null,
				openAlerts: 1,
			},
			{
				tenantSlug: "zalo-it-unit",
				brandKey: "brand-2",
				appStatus: null,
				packageTier: null,
				packageExpiresOn: null,
				packageDaysLeft: null,
				webhookMode: null,
				oa: null,
				developer: {
					refreshedAt: new Date(NOW.getTime() - 21 * HOUR),
					nextRefreshAt: new Date(NOW.getTime() - HOUR),
					version: 1,
					accessExpiresAt: new Date(NOW.getTime() - 20 * HOUR),
				},
				openAlerts: 0,
			},
		];
		const ci = statusLines(brands, true, NOW);
		expect(ci).toEqual([
			"brand 1: Zalo App active; OA token 3 h old, 2 refresh(es) since stored, next refresh in 8 h, access valid 22 h; package tang_truong until 2027-06-30 (224 days); webhook observe; developer token not stored; 1 open zalo_token_failed episode(s)",
			"brand 2: Zalo App missing; no OA; developer token 21 h old, 0 rotation(s) since stored, rotation due now, access expired; 0 open zalo_token_failed episode(s)",
		]);
		expect(ci.join("\n")).not.toContain("zalo-it-unit");
		expect(statusLines(brands, false, NOW)[0]).toMatch(
			/^zalo-it-unit brand-1: /,
		);
		expect(statusLines([], true, NOW)).toEqual([
			"no brand is configured; add one with fnb zalo config set",
		]);
	});
});

describe("masking registration", () => {
	const environment = {
		GITHUB_ACTIONS: "true",
		ZALO_APP_SECRET_BRAND_1: SECRET,
		ZALO_ZMP_REFRESH_TOKEN: "synthetic-zmp-refresh-token",
		ZALO_INTEGRATION: "0",
		ZALO_TENANT_ID: "11111111-1111-4111-8111-111111111111",
		ZALO_OAUTH_BASE_URL: "http://127.0.0.1:8788",
		ZALO_OAUTH_REDIRECT_URI: "https://example.invalid/functions/v1/zalo-oauth",
		ZALO_SHORT: "abc",
	};

	it("registers every ZALO_ secret value but not the switches, filters and URLs", () => {
		expect(zaloSecretVariables(environment)).toEqual([
			"ZALO_APP_SECRET_BRAND_1",
			"ZALO_ZMP_REFRESH_TOKEN",
		]);
		expect(zaloMaskCommands(environment)).toEqual([
			"::add-mask::synthetic-app-secret-%25-value",
			"::add-mask::synthetic-zmp-refresh-token",
		]);
	});

	it("registers nothing outside GitHub Actions", () => {
		expect(
			zaloMaskCommands({ ...environment, GITHUB_ACTIONS: undefined }),
		).toEqual([]);
	});

	it("masks the Zalo secrets before anything else the command prints", async () => {
		const result = await fnb(["zalo", "oa", "refresh"], {
			GITHUB_ACTIONS: "true",
			ZALO_APP_SECRET_BRAND_1: SECRET,
		});
		expect(result.code).toBe(1);
		const lines = result.stdout.split("\n");
		expect(lines[0]).toBe("::add-mask::synthetic-app-secret-%25-value");
		expect(result.stdout.replace(lines[0] ?? "", "")).not.toContain(SECRET);
		expect(result.stderr).not.toContain(SECRET);
	});

	it("tells the source of an alert apart on GitHub Actions", () => {
		expect(alertSource({ GITHUB_ACTIONS: "true" })).toBe("actions");
		expect(alertSource({})).toBe("cli");
	});
});

describe("fnb zalo oa authorize", () => {
	it("takes the callback from the flag, the variable or SUPABASE_URL", () => {
		expect(
			redirectUri({}, { SUPABASE_URL: "https://project.example.com/" }),
		).toBe("https://project.example.com/functions/v1/zalo-oauth");
		expect(
			redirectUri(
				{},
				{
					ZALO_OAUTH_REDIRECT_URI: "https://other.example.com/cb",
					SUPABASE_URL: "https://project.example.com",
				},
			),
		).toBe("https://other.example.com/cb");
		expect(
			redirectUri(
				{ "redirect-uri": "http://127.0.0.1:54321/functions/v1/zalo-oauth" },
				{},
			),
		).toBe("http://127.0.0.1:54321/functions/v1/zalo-oauth");
	});

	it("refuses a missing, plain-http or credential-carrying callback", () => {
		expect(refusal(() => redirectUri({}, {}))).toContain("--redirect-uri");
		expect(
			refusal(() =>
				redirectUri({ "redirect-uri": "http://example.com/cb" }, {}),
			),
		).toContain("https");
		expect(
			refusal(() =>
				redirectUri({ "redirect-uri": "https://user:pw@example.com/cb" }, {}),
			),
		).toContain("credentials");
	});

	it("is refused in CI", async () => {
		const result = await fnb(
			[
				"zalo",
				"oa",
				"authorize",
				"--tenant",
				"zalo-it-unit",
				"--brand",
				"brand-1",
			],
			{ CI: "1" },
		);
		expect(result.code).toBe(2);
		expect(result.stderr).toContain("not in CI");
	});

	it("refuses an OAuth override outside an integration run before touching a database", async () => {
		const result = await fnb(["zalo", "oa", "refresh"], {
			ZALO_OAUTH_BASE_URL: "http://127.0.0.1:8788",
		});
		expect(result.code).toBe(2);
		expect(result.stderr).toContain("ZALO_INTEGRATION=1");
	});

	it("refuses a seed without the refresh token variable", async () => {
		const result = await fnb(
			["zalo", "zmp", "seed", "--tenant", "zalo-it-unit", "--brand", "brand-1"],
			{},
		);
		expect(result.code).toBe(2);
		expect(result.stderr).toContain("ZALO_ZMP_REFRESH_TOKEN");
	});
});
