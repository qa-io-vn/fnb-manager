import { connectAccount } from "@fnb/runner";
import { MasterDataRunError, SyncEngine } from "@fnb/sync";
import { requireTenant } from "../admin/tenants.js";
import { accountEntry, isCi } from "../config/config.js";
import {
	type CommandContext,
	flag,
	type OptionValues,
	requiredString,
	stringOption,
	triggeredBy,
	UsageError,
} from "../context.js";
import { countsText } from "./formatting.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";
import { printFlags } from "./sync-report.js";

async function onboard(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	if (flag(values, "print-secret-entry") && isCi(context.env)) {
		throw new UsageError(
			"--print-secret-entry is refused in CI: it prints credentials",
		);
	}
	const slug = requiredString(values, "tenant");
	const key = requiredString(values, "account");
	const entry = accountEntry(context.env, key);
	const { sql, repository } = context.services.db();
	const tenant = await requireTenant(sql, slug, context.output.ci);
	const existing = (await repository.findAccounts(key, slug))[0];
	const session = await connectAccount(entry, context.env);
	context.output.line(
		`authenticated ${context.output.ci ? "the account" : key} through ${entry.connector}`,
	);
	const account = await repository.upsertAccount({
		tenant_id: tenant.id,
		connector: entry.connector,
		account_key: key,
		display_name:
			stringOption(values, "display-name") ?? existing?.display_name ?? key,
	});
	const engine = new SyncEngine({
		repository,
		connector: session.connector,
		redact: context.redact,
		triggeredBy: triggeredBy(context.env),
	});
	try {
		const summary = await engine.syncMasterData(account);
		const stores = await repository.listStores(account.id);
		context.output.line(
			`account ${existing ? "updated" : "created"}; ${summary.stores.discovered} store(s) discovered, ${summary.stores.deactivated} inactive`,
		);
		context.output.table(
			["store", "timezone", "day start", "opened on", "active"],
			stores.map((store, index) => [
				context.output.label(
					"store",
					index,
					`${store.name} (${store.external_id})`,
				),
				store.timezone,
				`${String(Math.floor(store.business_day_start_minutes / 60)).padStart(2, "0")}:${String(store.business_day_start_minutes % 60).padStart(2, "0")}`,
				store.opened_on,
				store.active ? "yes" : "no",
			]),
		);
		context.output.line(`catalogue: ${countsText(summary.tables)}`);
		context.output.line(
			`connector calls ${summary.connectorCalls}, POS HTTP requests ${session.httpRequests()}`,
		);
		printFlags(context, summary.flags);
	} catch (error) {
		if (error instanceof MasterDataRunError) {
			context.output.error(`master data sync failed: ${error.message}`);
			return 1;
		}
		throw error;
	}
	if (flag(values, "print-secret-entry")) {
		context.output.line(
			"POS_ACCOUNTS_JSON entry for this account (add it to the JSON array of the GitHub secret):",
		);
		context.output.raw(JSON.stringify(entry));
	}
	return 0;
}

export const onboardCommand: CommandSpec = {
	path: ["onboard"],
	summary:
		"Add a POS account to a tenant, discover its stores and load its catalogue",
	usage:
		"fnb onboard --tenant <slug> --account <key> [--display-name <label>] [--print-secret-entry]",
	options: {
		...HELP_OPTION,
		tenant: { type: "string" },
		account: { type: "string" },
		"display-name": { type: "string" },
		"print-secret-entry": { type: "boolean" },
	},
	details: [
		"Needs DATABASE_URL and the account's entry in POS_ACCOUNTS_JSON (plus IPOS_APP_KEY for ipos-fabi).",
		"Authenticates through the connector registry, writes pos_accounts and stores (timezone and business-day start from the POS), then runs the master-data sync.",
		"Re-running refreshes store attributes and the catalogue; it never deletes rows.",
		"--print-secret-entry prints the account's JSON entry with its credentials for the GitHub secret; refused when CI or GITHUB_ACTIONS is set.",
	],
	run: onboard,
};
