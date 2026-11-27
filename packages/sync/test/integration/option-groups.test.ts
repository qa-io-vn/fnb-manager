// Integration (ADR-058 phase 3): the Postgres catalogue writer and the option-group tables of the migration
// online_menu_options. State transitions over three master-data runs of a synthetic tenant: groups written;
// the POS changes a group, drops another and removes an option and a target; a catalogue without option groups
// leaves everything as it was. Runs only with DATABASE_URL and once the migration is applied; the synthetic
// tenant is deleted at the end.
import { randomUUID } from "node:crypto";
import type { CanonicalCatalog, CanonicalOptionGroup } from "@fnb/core";
import { describe, expect, it } from "vitest";
import { SyncEngine } from "../../src/index.js";
import {
	createPostgresClient,
	PostgresSyncRepository,
} from "../../src/postgres/index.js";
import {
	createFakeConnector,
	EMPTY_CATALOG,
} from "../support/fake-connector.js";

const DATABASE_URL = process.env.DATABASE_URL;

async function tablesPresent(): Promise<boolean> {
	if (!DATABASE_URL) {
		return false;
	}
	const sql = createPostgresClient(DATABASE_URL, { maxConnections: 1 });
	try {
		const [row] = await sql<{ ready: boolean }[]>`
			select to_regclass('public.item_option_groups') is not null
				and to_regclass('public.item_option_group_options') is not null
				and to_regclass('public.item_option_group_targets') is not null as ready
		`;
		return row?.ready ?? false;
	} catch {
		return false;
	} finally {
		await sql.end({ timeout: 5 });
	}
}

const ready = await tablesPresent();

const STORE = {
	externalId: "STORE-1",
	name: "Cửa hàng thử",
	timezone: "Asia/Ho_Chi_Minh",
	dayStartMinutes: 0,
	currency: "VND",
};

function group(
	overrides: Partial<CanonicalOptionGroup> = {},
): CanonicalOptionGroup {
	return {
		externalId: "C1:0",
		name: "Topping",
		minSelect: 0,
		maxSelect: 2,
		optionItemExternalIds: ["OPT-A", "OPT-B"],
		appliesToItemExternalIds: ["DR-1", "DR-2"],
		active: true,
		raw: { customizationUid: "C1", position: 0 },
		...overrides,
	};
}

function catalog(optionGroups?: CanonicalOptionGroup[]): CanonicalCatalog {
	return optionGroups === undefined
		? EMPTY_CATALOG
		: { ...EMPTY_CATALOG, optionGroups };
}

describe.skipIf(!ready)("option groups in Postgres", () => {
	it("writes, follows and keeps the account's option groups", async () => {
		const sql = createPostgresClient(DATABASE_URL ?? "", { maxConnections: 2 });
		const slug = `it-options-${randomUUID().slice(0, 8)}`;
		try {
			const [tenant] = await sql<{ id: string }[]>`
				insert into public.tenants (slug, name) values (${slug}, 'Option groups test') returning id
			`;
			if (!tenant) {
				throw new Error("tenant insert failed");
			}
			const repository = new PostgresSyncRepository(sql);
			const account = await repository.upsertAccount({
				tenant_id: tenant.id,
				connector: "fake",
				account_key: "options-test",
				display_name: "Option groups test",
			});
			const run = (groups?: CanonicalOptionGroup[]) =>
				new SyncEngine({
					repository,
					connector: createFakeConnector({
						stores: [STORE],
						catalog: catalog(groups),
					}),
					calls: { sleep: async () => undefined },
				}).syncMasterData(account);
			const state = async () => ({
				groups: (
					await sql<{ key: string }[]>`
						select concat_ws(':', external_id, name, min_select, max_select, active::text) as key
						from public.item_option_groups where pos_account_id = ${account.id} order by external_id
					`
				).map((row) => row.key),
				options: (
					await sql<{ key: string }[]>`
						select concat_ws(':', group_external_id, item_external_id, sort_order) as key
						from public.item_option_group_options where pos_account_id = ${account.id}
						order by group_external_id, sort_order
					`
				).map((row) => row.key),
				targets: (
					await sql<{ key: string }[]>`
						select concat_ws(':', group_external_id, item_external_id) as key
						from public.item_option_group_targets where pos_account_id = ${account.id}
						order by group_external_id, item_external_id
					`
				).map((row) => row.key),
			});

			const first = await run([
				group(),
				group({ externalId: "C2:0", optionItemExternalIds: ["OPT-C"] }),
			]);
			expect(first.tables).toMatchObject({
				item_option_groups: 2,
				item_option_group_options: 3,
				item_option_group_targets: 4,
			});
			expect(await state()).toEqual({
				groups: ["C1:0:Topping:0:2:true", "C2:0:Topping:0:2:true"],
				options: ["C1:0:OPT-A:0", "C1:0:OPT-B:1", "C2:0:OPT-C:0"],
				targets: ["C1:0:DR-1", "C1:0:DR-2", "C2:0:DR-1", "C2:0:DR-2"],
			});

			await run([
				group({
					minSelect: 1,
					maxSelect: 1,
					optionItemExternalIds: ["OPT-B"],
					appliesToItemExternalIds: ["DR-2"],
				}),
			]);
			const changed = await state();
			expect(changed).toEqual({
				groups: ["C1:0:Topping:1:1:true", "C2:0:Topping:0:2:false"],
				options: ["C1:0:OPT-B:0"],
				targets: ["C1:0:DR-2"],
			});

			const third = await run(undefined);
			expect(third.tables.item_option_groups).toBeUndefined();
			expect(await state()).toEqual(changed);
		} finally {
			await sql`delete from public.tenants where slug = ${slug}`;
			await sql.end({ timeout: 5 });
		}
	}, 120_000);
});
