import { describe, expect, it } from "vitest";
import {
	AccountConfigError,
	accountLabel,
	collectSecretValues,
	credentialsFor,
	entryForKey,
	isTicket,
	parseAccountEntries,
	storeLabel,
} from "../../src/index.js";

const ENTRIES_JSON = JSON.stringify([
	{
		key: "account-1",
		connector: "ipos-fabi",
		email: "owner@example.com",
		password: "pw-one",
	},
	{ key: "account-2", connector: "mock", seed: 3 },
]);

describe("account entries", () => {
	it("parses POS_ACCOUNTS_JSON and numbers entries from 1", () => {
		const entries = parseAccountEntries(ENTRIES_JSON);
		expect(entries.map((entry) => entry.connector)).toEqual([
			"ipos-fabi",
			"mock",
		]);
		expect(entryForKey(entries, "account-2")?.position).toBe(2);
		expect(entryForKey(entries, "missing")).toBeNull();
		expect(parseAccountEntries(undefined)).toEqual([]);
		expect(accountLabel(entries, "account-1")).toBe("account 1");
		expect(accountLabel(entries, "other")).toBe(
			"an account missing from POS_ACCOUNTS_JSON",
		);
	});

	it("refuses broken JSON and repeated keys without echoing a value", () => {
		expect(() => parseAccountEntries("{not json")).toThrow(AccountConfigError);
		const repeated = JSON.stringify([
			{ key: "same", connector: "mock" },
			{ key: "same", connector: "mock" },
		]);
		expect(() => parseAccountEntries(repeated)).toThrow(
			"POS_ACCOUNTS_JSON is invalid (1.key: account keys must be unique)",
		);
	});

	it("takes the iPOS application key from the entry or the environment", () => {
		const [ipos, mock] = parseAccountEntries(ENTRIES_JSON);
		if (!ipos || !mock) {
			throw new Error("fixture entries missing");
		}
		expect(credentialsFor(mock, {})).toEqual({ seed: 3 });
		expect(credentialsFor(ipos, { IPOS_APP_KEY: "f".repeat(32) })).toEqual({
			email: "owner@example.com",
			password: "pw-one",
			appAccessToken: "f".repeat(32),
		});
		expect(() => credentialsFor(ipos, {})).toThrow(AccountConfigError);
	});

	it("passes rejectLogin through to the mock connector's credentials", () => {
		const [entry] = parseAccountEntries(
			JSON.stringify([
				{ key: "account-3", connector: "mock", seed: 1, rejectLogin: true },
			]),
		);
		if (!entry) {
			throw new Error("fixture entry missing");
		}
		expect(credentialsFor(entry, {})).toEqual({ seed: 1, rejectLogin: true });
		expect(() =>
			parseAccountEntries(
				JSON.stringify([
					{ key: "account-4", connector: "mock", rejectLogin: false },
				]),
			),
		).toThrow(AccountConfigError);
	});

	it("collects every credential for the redactor, keys included when asked", () => {
		const environment = {
			POS_ACCOUNTS_JSON: ENTRIES_JSON,
			IPOS_APP_KEY: "app-key-value",
			SUPABASE_DB_URL: "postgresql://postgres.ref:db%40pass@host:5432/postgres",
			SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_abcdef" }),
		};
		const values = collectSecretValues(environment, {
			variables: ["IPOS_APP_KEY"],
			databaseVariables: ["SUPABASE_DB_URL"],
			dictionaryVariables: ["SUPABASE_SECRET_KEYS"],
			includeAccountKeys: true,
		});
		expect(values).toEqual(
			expect.arrayContaining([
				"owner@example.com",
				"pw-one",
				"account-1",
				"account-2",
				"app-key-value",
				"db@pass",
				"db%40pass",
				"postgres.ref",
				"sb_secret_abcdef",
			]),
		);
		expect(
			collectSecretValues(environment, {
				variables: [],
				includeAccountKeys: false,
			}),
		).not.toContain("account-1");
	});

	it("labels stores by external id within their account", () => {
		const stores = [
			{ id: "b", external_id: "S-2" },
			{ id: "a", external_id: "S-1" },
		];
		expect(storeLabel(stores, "a")).toBe("store 1");
		expect(storeLabel(stores, "b")).toBe("store 2");
		expect(storeLabel(stores, "c")).toBe("store ?");
	});

	it("recognises a dispatch ticket", () => {
		expect(isTicket("77777777-7777-4777-8777-777777777777")).toBe(true);
		expect(isTicket("not-a-ticket")).toBe(false);
		expect(isTicket(42)).toBe(false);
	});
});
