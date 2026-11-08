import { describe, expect, it } from "vitest";
import { accountEntries, databaseSetting } from "../../src/config/config.js";
import { parseEnvFile, withEnvFile } from "../../src/config/env-file.js";
import { collectSecrets, maskCommands } from "../../src/config/secrets.js";

describe("parseEnvFile", () => {
	it("reads KEY=VALUE lines, quotes, comments and export prefixes", () => {
		expect(
			parseEnvFile(
				[
					"# comment",
					"",
					"PLAIN=value with spaces",
					'QUOTED="a=b"',
					"SINGLE='x y'",
					"export EXPORTED=1",
					'JSON=[{"key":"a","connector":"mock"}]',
					"not a line",
					"1BAD=x",
				].join("\n"),
			),
		).toEqual({
			PLAIN: "value with spaces",
			QUOTED: "a=b",
			SINGLE: "x y",
			EXPORTED: "1",
			JSON: '[{"key":"a","connector":"mock"}]',
		});
	});

	it("lets the process environment win over the file", () => {
		const merged = withEnvFile({ TZ: "UTC" }, "/nonexistent-directory");
		expect(merged).toEqual({ TZ: "UTC" });
	});
});

describe("POS_ACCOUNTS_JSON", () => {
	it("accepts ipos-fabi and mock entries", () => {
		const entries = accountEntries({
			POS_ACCOUNTS_JSON: JSON.stringify([
				{
					key: "shop-a",
					connector: "ipos-fabi",
					email: "owner@example.com",
					password: "pw",
					appAccessToken: "f".repeat(32),
				},
				{ key: "demo", connector: "mock", seed: 3 },
			]),
		});
		expect(entries.map((entry) => entry.connector)).toEqual([
			"ipos-fabi",
			"mock",
		]);
	});

	it("rejects unknown connectors and repeated keys without echoing values", () => {
		expect(() =>
			accountEntries({
				POS_ACCOUNTS_JSON: JSON.stringify([
					{ key: "a", connector: "other", password: "do-not-echo" },
				]),
			}),
		).toThrow(/POS_ACCOUNTS_JSON is invalid/);
		try {
			accountEntries({
				POS_ACCOUNTS_JSON: JSON.stringify([
					{ key: "a", connector: "ipos-fabi", email: "x", password: "" },
				]),
			});
		} catch (error) {
			expect(String(error)).not.toContain("do-not-echo");
		}
		expect(() =>
			accountEntries({
				POS_ACCOUNTS_JSON: JSON.stringify([
					{ key: "a", connector: "mock" },
					{ key: "a", connector: "mock" },
				]),
			}),
		).toThrow(/unique/);
		expect(() => accountEntries({ POS_ACCOUNTS_JSON: "{not json" })).toThrow(
			/not valid JSON/,
		);
	});
});

describe("databaseSetting", () => {
	const local = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
	const pooler = "postgresql://postgres.ref:secret@example.com:5432/postgres";

	it("prefers DATABASE_URL locally and SUPABASE_DB_URL in CI", () => {
		expect(
			databaseSetting({ DATABASE_URL: local, SUPABASE_DB_URL: pooler })
				.variable,
		).toBe("DATABASE_URL");
		expect(
			databaseSetting({
				DATABASE_URL: local,
				SUPABASE_DB_URL: pooler,
				CI: "true",
			}).variable,
		).toBe("SUPABASE_DB_URL");
		expect(databaseSetting({ SUPABASE_DB_URL: pooler }).url).toBe(pooler);
	});

	it("refuses a missing or non-postgres URL", () => {
		expect(() => databaseSetting({})).toThrow(/DATABASE_URL/);
		expect(() =>
			databaseSetting({ DATABASE_URL: "https://example.com" }),
		).toThrow(/postgresql/);
	});
});

describe("secret masking", () => {
	it("collects every credential field, key and database password", () => {
		const secrets = collectSecrets({
			POS_ACCOUNTS_JSON: JSON.stringify([
				{
					key: "a",
					connector: "ipos-fabi",
					email: "owner@example.com",
					password: "p4ss-word",
					appAccessToken: "0".repeat(32),
				},
			]),
			IPOS_APP_KEY: "f".repeat(32),
			SUPABASE_SECRET_KEY: "sb_secret_example",
			SUPABASE_DB_URL:
				"postgresql://postgres.projectref:db-pass%21@example.com:5432/postgres",
			DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
		});
		expect(secrets).toEqual(
			expect.arrayContaining([
				"owner@example.com",
				"p4ss-word",
				"0".repeat(32),
				"f".repeat(32),
				"sb_secret_example",
				"db-pass!",
				"db-pass%21",
				"postgres.projectref",
			]),
		);
		expect(secrets).not.toContain("postgres");
		expect(maskCommands(["a\nb"])).toEqual(["::add-mask::a", "::add-mask::b"]);
	});

	it("adds the account keys only in CI, where they must not reach the log", () => {
		const accounts = JSON.stringify([
			{ key: "shop-one", connector: "mock" },
			{ key: "shop-two", connector: "mock" },
		]);
		expect(collectSecrets({ POS_ACCOUNTS_JSON: accounts })).toEqual([]);
		expect(
			collectSecrets({ POS_ACCOUNTS_JSON: accounts, GITHUB_ACTIONS: "true" }),
		).toEqual(["shop-one", "shop-two"]);
	});

	it("escapes percent signs and line breaks the way the runner decodes them", () => {
		expect(maskCommands(["Fake%25Pw%40word9", "a%b\rc"])).toEqual([
			"::add-mask::Fake%2525Pw%2540word9",
			"::add-mask::a%25b%0Dc",
		]);
		const secrets = collectSecrets({
			GITHUB_ACTIONS: "true",
			SUPABASE_DB_URL:
				"postgresql://postgres.abcref:Fake%25Pw%40word9@127.0.0.1:54322/postgres",
		});
		expect(maskCommands(secrets)).toEqual(
			expect.arrayContaining([
				"::add-mask::Fake%2525Pw%2540word9",
				"::add-mask::Fake%25Pw@word9",
			]),
		);
	});

	it("masks the whole value when the accounts JSON cannot be parsed", () => {
		expect(collectSecrets({ POS_ACCOUNTS_JSON: "[{broken" })).toEqual([
			"[{broken",
		]);
	});
});
