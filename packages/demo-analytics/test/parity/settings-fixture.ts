import { randomUUID } from "node:crypto";
import { MENU } from "@fnb/connector-mock";
import { addDays, daysBetween } from "@fnb/reports";
import {
	type CategoryOverride,
	DEMO_UNCATEGORISED_ITEM,
	type DemoItemCost,
	type DemoReportSource,
	type DemoRole,
	demoRoles,
} from "../../src/index.js";
import {
	insertStatements,
	type ParityContext,
	type SeededDataset,
} from "./harness.js";

export const MOVED_DRINK = "DR-001-M";
export const MOVED_DRINK_TYPE = "TYPE-002";
export const SNACK_TYPE = "TYPE-009";
export const COSTED_TOPPINGS = [
	"TP-001",
	"TP-002",
	"TP-003",
	"TP-004",
	"TP-005",
	"TP-006",
	"FT-001",
	"FT-002",
] as const;
export const SECOND_ACCOUNT = "parity-second-account";
const SECOND_ACCOUNT_TYPES: readonly (readonly [string, DemoRole["role"]])[] = [
	["TYPE-001", "drink"],
	["TYPE-002", "drink"],
	["TYPE-003", "drink"],
	["TYPE-004", "drink"],
	["TYPE-005", "drink"],
	["TYPE-006", "drink"],
	["TYPE-009", "snack"],
];

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
			...COSTED_TOPPINGS.map((itemExternalId, index) => ({
				storeId: null,
				itemExternalId,
				costAmount: itemExternalId.startsWith("FT-") ? 0 : 2_000 + 500 * index,
				effectiveFrom: addDays(from, -60),
			})),
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

export async function applySecondAccount(
	context: ParityContext,
	seeded: SeededDataset,
	engine: DemoReportSource,
): Promise<void> {
	const second = randomUUID();
	const youngStore = seeded.uuidOf("MOCK-S2");
	const statements = [
		...insertStatements(
			"public.pos_accounts",
			["id", "tenant_id", "connector", "account_key", "display_name"],
			[
				{
					id: second,
					tenant_id: seeded.tenantId,
					connector: "mock",
					account_key: `parity-${seeded.dataset.id}-second`,
					display_name: "Parity second",
				},
			],
		),
		...insertStatements(
			"public.payment_methods",
			["tenant_id", "pos_account_id", "external_id", "name", "kind"],
			MENU.catalog.paymentMethods.map((method) => ({
				tenant_id: seeded.tenantId,
				pos_account_id: second,
				external_id: method.externalId,
				name: method.name,
				kind: method.kind,
			})),
		),
		...insertStatements(
			"public.item_type_roles",
			["tenant_id", "pos_account_id", "item_type_external_id", "role"],
			SECOND_ACCOUNT_TYPES.map(([type, role]) => ({
				tenant_id: seeded.tenantId,
				pos_account_id: second,
				item_type_external_id: type,
				role,
			})),
		),
	];
	for (const statement of statements) {
		await context.connection.rows(statement);
	}
	await context.connection.rows(
		"update public.stores set pos_account_id = $1::uuid where id = $2::uuid",
		[second, youngStore],
	);
	await context.connection.rows(
		"update public.invoices set pos_account_id = $1::uuid where store_id = $2::uuid",
		[second, youngStore],
	);
	await context.connection.rows(
		"select app.refresh_analytics($1::uuid, $2::date, $3::date)",
		[seeded.tenantId, seeded.window.from, seeded.window.to],
	);
	engine.settings.saveStoreAccounts({ "MOCK-S2": SECOND_ACCOUNT });
	engine.settings.saveRoles([
		...demoRoles(),
		...SECOND_ACCOUNT_TYPES.map(([itemTypeExternalId, role]) => ({
			posAccountId: SECOND_ACCOUNT,
			itemTypeExternalId,
			role,
		})),
	]);
}
