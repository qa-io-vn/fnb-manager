import type { AccountEntry } from "@fnb/runner";
import type { Output } from "../output.js";

export type AccountGroup = "account" | "other";

export interface AccountNumber {
	group: AccountGroup;
	index: number;
}

export interface ListedAccount {
	tenant_slug: string;
	account_key: string;
}

export interface NumberedAccount<T extends ListedAccount> {
	account: T;
	number: AccountNumber;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function byTenantAndKey(left: ListedAccount, right: ListedAccount): number {
	return (
		compareText(left.tenant_slug, right.tenant_slug) ||
		compareText(left.account_key, right.account_key)
	);
}

export function numberAccounts<T extends ListedAccount>(
	entries: readonly AccountEntry[],
	accounts: readonly T[],
): NumberedAccount<T>[] {
	const positions = new Map(
		entries.map((entry, index) => [entry.key, index] as const),
	);
	const configured: NumberedAccount<T>[] = [];
	const others: NumberedAccount<T>[] = [];
	for (const account of [...accounts].sort(byTenantAndKey)) {
		const position = positions.get(account.account_key);
		if (position === undefined) {
			others.push({
				account,
				number: { group: "other", index: others.length },
			});
		} else {
			configured.push({
				account,
				number: { group: "account", index: position },
			});
		}
	}
	configured.sort((left, right) => left.number.index - right.number.index);
	return [...configured, ...others];
}

export function accountLabel(
	output: Pick<Output, "label">,
	numbered: NumberedAccount<ListedAccount>,
): string {
	return output.label(
		numbered.number.group,
		numbered.number.index,
		`${numbered.account.tenant_slug}/${numbered.account.account_key}`,
	);
}
