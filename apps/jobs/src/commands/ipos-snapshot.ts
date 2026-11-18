import { relative } from "node:path";
import { writeSnapshot } from "@fnb/connector-ipos/snapshot";
import { replaceAccountSnapshot } from "@fnb/runner/snapshot-files";
import {
	iposAccountsOf,
	snapshotFromDatabase,
} from "../admin/snapshot-source.js";
import { requireTenant } from "../admin/tenants.js";
import {
	type CommandContext,
	type OptionValues,
	requiredString,
	stringOption,
	UsageError,
} from "../context.js";
import { snapshotRoot } from "./ipos.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";

async function fromDatabase(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const { output } = context;
	const slug = requiredString(values, "tenant");
	const only = stringOption(values, "account");
	const { sql, runner } = context.services.db();
	const tenant = await requireTenant(sql, slug, output.ci);
	if ((await runner.iposSource(tenant.id)) === "snapshot") {
		throw new UsageError(
			"that tenant was loaded from the iPOS snapshot; build the snapshot from a tenant that holds real iPOS data",
		);
	}
	const accounts = (await iposAccountsOf(sql, tenant.id)).filter(
		(account) => only === undefined || account.account_key === only,
	);
	if (accounts.length === 0) {
		throw new UsageError(
			only === undefined
				? "that tenant has no ipos-fabi account"
				: "that tenant has no ipos-fabi account with that key",
		);
	}
	const root = snapshotRoot(context);
	for (const [index, account] of accounts.entries()) {
		const label = output.label("account", index, account.account_key);
		const built = await snapshotFromDatabase(sql, account);
		const replaced = await replaceAccountSnapshot(
			root,
			account.account_key,
			(storage) =>
				writeSnapshot(storage, built.content, {
					origin: "database",
					now: context.now,
				}),
		);
		const { counts } = built;
		output.line(
			`${label}: snapshot ${replaced ? "replaced" : "written"}, covering ${built.content.coveredFrom ?? "no date"}..${built.content.coveredTo ?? "no date"}: ${counts.stores} store(s), ${counts.salesDays} business dates with sales, ${counts.invoices} invoices, ${counts.lines} lines, ${counts.payments} payments, ${counts.shifts} shifts, ${counts.controlTotals} store-days of control totals, ${counts.editedOrDeleted} edited or deleted invoices, ${counts.removedItemEvents} removed-item events, ${counts.items} items; ${counts.voidedLeftOut} voided invoices left out`,
		);
		if (index === 0) {
			for (const line of built.rebuilt) {
				output.line(`rebuilt: ${line}`);
			}
		}
	}
	output.line(
		`snapshot folder: ${relative(context.rootDir, root) || "."} (git-ignored; it holds real business data, keep it on this machine)`,
	);
	output.line(
		"next: set IPOS_REAL_API=off and run pnpm db:load-real to load it into mock-local",
	);
	return 0;
}

export const iposSnapshotCommands: CommandSpec[] = [
	{
		path: ["ipos-snapshot", "from-db"],
		summary:
			"Build the local iPOS snapshot from the iPOS payloads a real sync stored in the database, without calling iPOS",
		usage: "fnb ipos-snapshot from-db --tenant <slug> [--account <key>]",
		options: {
			...HELP_OPTION,
			tenant: { type: "string" },
			account: { type: "string" },
		},
		details: [
			"Needs DATABASE_URL. Only reads the database; never calls iPOS.",
			"Rebuilds, for every ipos-fabi account of the tenant (or only --account), the answers the iPOS endpoints gave: the sale, sale-detail and payment reports from sale_payloads, shifts and adjustments from their stored payloads, the daily control totals from sync_checks, and the master data from the catalogue tables. Prints counts only.",
			"Writes .ipos-snapshot/<account key>/ at the repository root (or IPOS_SNAPSHOT_DIR), replacing the account's previous snapshot as a whole. The folder is git-ignored and holds real business data.",
			"With IPOS_REAL_API=off every runner then answers iPOS requests from it; with on, real answers keep refreshing it while the folder exists.",
			"Refuses a tenant that was itself loaded from the snapshot.",
		],
		run: fromDatabase,
	},
];
