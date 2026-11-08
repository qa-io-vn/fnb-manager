import { describe, expect, it } from "vitest";
import {
	accountLabel,
	numberAccounts,
} from "../../src/commands/account-numbers.js";
import type { AccountEntry } from "../../src/config/accounts.js";
import { Output } from "../../src/output.js";
import { capture } from "../support/capture.js";

const ENTRIES: AccountEntry[] = [
	{ key: "zeta", connector: "mock" },
	{ key: "alpha", connector: "mock" },
];

const LISTED = [
	{ tenant_slug: "tenant-b", account_key: "omega" },
	{ tenant_slug: "tenant-a", account_key: "alpha" },
	{ tenant_slug: "tenant-a", account_key: "omega" },
	{ tenant_slug: "tenant-b", account_key: "beta" },
	{ tenant_slug: "tenant-a", account_key: "zeta" },
];

function output(ci: boolean): Output {
	return new Output({ ci, streams: capture().streams, redact: (text) => text });
}

function labels(
	ci: boolean,
	entries: readonly AccountEntry[],
	listed: readonly { tenant_slug: string; account_key: string }[],
): string[] {
	return numberAccounts(entries, listed).map((numbered) =>
		accountLabel(output(ci), numbered),
	);
}

describe("account numbers", () => {
	it("keeps the POS_ACCOUNTS_JSON position of a configured account and numbers the other accounts apart by tenant and key", () => {
		expect(
			numberAccounts(ENTRIES, LISTED).map(({ account, number }) => [
				`${account.tenant_slug}/${account.account_key}`,
				number.group,
				number.index,
			]),
		).toEqual([
			["tenant-a/zeta", "account", 0],
			["tenant-a/alpha", "account", 1],
			["tenant-a/omega", "other", 0],
			["tenant-b/beta", "other", 1],
			["tenant-b/omega", "other", 2],
		]);
	});

	it("labels an account in CI by its 1-based position and any other account with a distinct other label", () => {
		const ci = labels(true, ENTRIES, LISTED);
		expect(ci).toEqual([
			"account 1",
			"account 2",
			"other 1",
			"other 2",
			"other 3",
		]);
		expect(new Set(ci).size).toBe(ci.length);
	});

	it("never gives an account missing from POS_ACCOUNTS_JSON a number that looks like a position", () => {
		const ci = labels(true, ENTRIES, [
			{ tenant_slug: "demo", account_key: "seeded-one" },
			{ tenant_slug: "demo", account_key: "seeded-two" },
			{ tenant_slug: "live", account_key: "alpha" },
		]);
		expect(ci).toEqual(["account 2", "other 1", "other 2"]);
		expect(ci).not.toContain("account 3");
		expect(ci).not.toContain("account 1");
	});

	it("labels every tenant's row of a configured key by that key's position", () => {
		expect(
			labels(true, ENTRIES, [
				{ tenant_slug: "tenant-b", account_key: "alpha" },
				{ tenant_slug: "tenant-a", account_key: "alpha" },
			]),
		).toEqual(["account 2", "account 2"]);
	});

	it("names accounts by tenant and key outside CI", () => {
		expect(labels(false, ENTRIES, LISTED)).toEqual([
			"tenant-a/zeta",
			"tenant-a/alpha",
			"tenant-a/omega",
			"tenant-b/beta",
			"tenant-b/omega",
		]);
	});
});
