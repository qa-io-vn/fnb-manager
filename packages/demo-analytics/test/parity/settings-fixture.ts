import { MENU } from "@fnb/connector-mock";
import { addDays, daysBetween } from "@fnb/reports";
import {
	type CategoryOverride,
	DEMO_UNCATEGORISED_ITEM,
	type DemoItemCost,
	type DemoReportSource,
} from "../../src/index.js";
import {
	insertStatements,
	type ParityContext,
	type SeededDataset,
} from "./harness.js";

export const MOVED_DRINK = "DR-001-M";
export const MOVED_DRINK_TYPE = "TYPE-002";
export const SNACK_TYPE = "TYPE-009";

export interface MenuVariant {
	readonly overrides: readonly CategoryOverride[];
	readonly costs: readonly DemoItemCost[];
}

function typeName(externalId: string): string | null {
	return (
		MENU.catalog.itemTypes.find((type) => type.externalId === externalId)
			?.name ?? null
	);
}

export function menuVariant(
	seeded: SeededDataset,
	accountId: string,
): MenuVariant {
	const { from, to } = seeded.window;
	const middle = addDays(from, Math.floor(daysBetween(from, to) / 2));
	return {
		overrides: [
			{
				posAccountId: accountId,
				itemExternalId: DEMO_UNCATEGORISED_ITEM,
				itemTypeExternalId: SNACK_TYPE,
				itemTypeName: typeName(SNACK_TYPE),
			},
			{
				posAccountId: accountId,
				itemExternalId: MOVED_DRINK,
				itemTypeExternalId: MOVED_DRINK_TYPE,
				itemTypeName: typeName(MOVED_DRINK_TYPE),
			},
		],
		costs: [
			{
				storeId: null,
				itemExternalId: MOVED_DRINK,
				costAmount: 15_000,
				effectiveFrom: addDays(from, -30),
			},
			{
				storeId: "MOCK-S1",
				itemExternalId: MOVED_DRINK,
				costAmount: 16_500,
				effectiveFrom: middle,
			},
			{
				storeId: null,
				itemExternalId: "DR-008-M",
				costAmount: 14_000,
				effectiveFrom: addDays(from, -30),
			},
			{
				storeId: null,
				itemExternalId: "SN-002",
				costAmount: 7_000,
				effectiveFrom: middle,
			},
			{
				storeId: "MOCK-S2",
				itemExternalId: "TP-001",
				costAmount: 3_000,
				effectiveFrom: addDays(from, -30),
			},
		],
	};
}

export async function applyMenuVariant(
	context: ParityContext,
	seeded: SeededDataset,
	engine: DemoReportSource,
): Promise<MenuVariant> {
	const accountId = engine.settings.accountOf("MOCK-S1");
	const variant = menuVariant(seeded, accountId);
	const statements = [
		...insertStatements(
			"public.item_types",
			["tenant_id", "pos_account_id", "external_id", "name"],
			MENU.catalog.itemTypes.map((type) => ({
				tenant_id: seeded.tenantId,
				pos_account_id: seeded.posAccountId,
				external_id: type.externalId,
				name: type.name,
			})),
		),
		...insertStatements(
			"public.item_category_overrides",
			[
				"tenant_id",
				"pos_account_id",
				"item_external_id",
				"item_type_external_id",
			],
			variant.overrides.map((override) => ({
				tenant_id: seeded.tenantId,
				pos_account_id: seeded.posAccountId,
				item_external_id: override.itemExternalId,
				item_type_external_id: override.itemTypeExternalId,
			})),
		),
		...insertStatements(
			"public.item_costs",
			[
				"tenant_id",
				"store_id",
				"item_external_id",
				"cost_amount",
				"effective_from",
			],
			variant.costs.map((cost) => ({
				tenant_id: seeded.tenantId,
				store_id:
					cost.storeId === null
						? null
						: seeded.uuidOf(cost.storeId as "MOCK-S1" | "MOCK-S2"),
				item_external_id: cost.itemExternalId,
				cost_amount: cost.costAmount,
				effective_from: cost.effectiveFrom,
			})),
		),
	];
	for (const statement of statements) {
		await context.connection.rows(statement);
	}
	await context.connection.rows(
		"select app.refresh_analytics($1::uuid, $2::date, $3::date)",
		[seeded.tenantId, seeded.window.from, seeded.window.to],
	);
	engine.settings.saveOverrides(variant.overrides);
	engine.settings.saveCosts(variant.costs);
	seeded.days.useMappings(engine.settings);
	return variant;
}
