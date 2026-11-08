import type { AccountRecord, SyncRepository } from "@fnb/sync";
import { UsageError } from "../context.js";

export async function resolveAccount(
	repository: SyncRepository,
	accountKey: string,
	tenantSlug: string | undefined,
): Promise<AccountRecord> {
	const accounts = await repository.findAccounts(accountKey, tenantSlug);
	const [account] = accounts;
	if (!account) {
		throw new UsageError(
			`this account is not onboarded${tenantSlug ? " in that tenant" : ""}; run fnb onboard first`,
		);
	}
	if (accounts.length > 1) {
		throw new UsageError(
			`this account exists in ${accounts.length} tenants; pass --tenant`,
		);
	}
	return account;
}
