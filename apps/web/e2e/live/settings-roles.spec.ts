import type { SupabaseClient } from "@supabase/supabase-js";
import {
	type SettingsAccess,
	type SettingsArea,
	settingsAccess,
} from "../../src/settings/access";
import type { Membership } from "../../src/settings/source";
import { createSupabaseSettingsSource } from "../../src/settings/supabase-settings-source";
import { expectNoSeriousAxeViolations, PHONE_WIDTH } from "../support/checks";
import {
	anonymousClient,
	isLocalStackConfigured,
} from "../support/local-stack";
import { expect, type Locator, type Page, test } from "../support/policy-test";
import {
	type RealTenantsSnapshot,
	snapshotRealTenants,
} from "../support/real-tenants";
import { expectNoConsoleErrors, watchConsoleErrors } from "../support/reports";
import { openSettings, type SettingsSlug } from "../support/settings";
import {
	createSettingsFixture,
	FIXTURE_SLUG_PREFIX,
	openFixtureDatabase,
	SETTINGS_ROLES,
	type SettingsFixture,
	type SettingsRole,
} from "../support/settings-fixture";

test.skip(
	!isLocalStackConfigured,
	"the local Supabase stack is not configured in .env.local",
);

test.describe.configure({ mode: "serial" });

type Sql = ReturnType<typeof openFixtureDatabase>;

const FIRST_DAY = "2023-01-01";
const TIME_ZONE = "Asia/Ho_Chi_Minh";
const DESKTOP_WIDTH = 1280;
const SCREEN_HEIGHT = 800;
const LOGINS = [...SETTINGS_ROLES, "anon"] as const;

type Login = (typeof LOGINS)[number];

type Outcome = "saved" | "no row" | "42501" | "23505" | "23514";

const LOGIN_NAMES: Readonly<Record<Login, string>> = {
	owner: "the owner",
	manager: "the manager",
	"store-manager": "the manager limited to store 1",
	staff: "staff",
	viewer: "the viewer",
	anon: "anon",
};

let fixture: SettingsFixture | undefined;
let before: RealTenantsSnapshot | undefined;
const clients: SupabaseClient[] = [];
const memberships = new Map<SettingsRole, Membership>();

function created(): SettingsFixture {
	if (fixture === undefined) throw new Error("the fixture was not created");
	return fixture;
}

async function clientAs(role: SettingsRole): Promise<SupabaseClient> {
	const client = await created().clientAs(role);
	clients.push(client);
	return client;
}

async function membershipOf(role: SettingsRole): Promise<Membership> {
	const known = memberships.get(role);
	if (known !== undefined) return known;
	const source = createSupabaseSettingsSource(await clientAs(role));
	const membership = await source.membership(created().tenantId);
	if (membership === null) throw new Error(`${role} is not a member`);
	memberships.set(role, membership);
	return membership;
}

test.beforeAll(async () => {
	before = await snapshotRealTenants();
	fixture = await createSettingsFixture();
});

async function signOutAll(): Promise<void> {
	for (const client of clients.splice(0)) await client.auth.signOut();
}

test.afterAll(async () => {
	await signOutAll();
	await fixture?.teardown();
});

interface Reply {
	readonly data: unknown;
	readonly error: { readonly code?: string } | null;
}

interface ProbeContext {
	readonly index: number;
	readonly tenantId: string;
	readonly accountId: string;
	readonly store1: string;
	readonly store2: string;
	readonly lastSalesDay: string;
}

interface WriteProbe {
	readonly name: string;
	readonly access: {
		readonly area: SettingsArea;
		readonly store: 0 | 1 | null;
	} | null;
	readonly expected: Readonly<Record<Login, Outcome>>;
	readonly prepare?: (sql: Sql, context: ProbeContext) => Promise<string>;
	readonly write: (
		client: SupabaseClient,
		context: ProbeContext,
		target: string,
	) => PromiseLike<Reply>;
	readonly observe:
		| ((
				owner: SupabaseClient,
				context: ProbeContext,
				target: string,
		  ) => PromiseLike<Reply>)
		| null;
}

function byLogin(
	owner: Outcome,
	manager: Outcome,
	storeManager: Outcome,
	staff: Outcome,
	viewer: Outcome,
	anon: Outcome,
): Readonly<Record<Login, Outcome>> {
	return { owner, manager, "store-manager": storeManager, staff, viewer, anon };
}

const REFUSED_TO_EVERY_LOGIN = byLogin(
	"42501",
	"42501",
	"42501",
	"42501",
	"42501",
	"42501",
);

function pick<Value>(values: readonly [Value, ...Value[]], index: number) {
	return values[index % values.length] as Value;
}

function monthOf(index: number): string {
	return `2025-${String(index + 1).padStart(2, "0")}-01`;
}

function outcomeOf(reply: Reply): string {
	if (reply.error !== null) return reply.error.code ?? "network";
	if (Array.isArray(reply.data)) {
		return reply.data.length > 0 ? "saved" : "no row";
	}
	return reply.data === null ? "no row" : "saved";
}

async function observed(read: PromiseLike<Reply>): Promise<string> {
	const reply = await read;
	expect(reply.error, "the owner's read").toBeNull();
	return JSON.stringify(reply.data);
}

const EDITED_DRAFT = "e2e-quyen-sua";

async function editedDraft(sql: Sql, { tenantId }: ProbeContext) {
	const [found] = await sql<{ id: string }[]>`
		select id from public.legal_documents
		where tenant_id = ${tenantId} and version = ${EDITED_DRAFT}
	`;
	if (found !== undefined) return found.id;
	const [made] = await sql<{ id: string }[]>`
		insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown)
		values (${tenantId}, 'data_protection_rules', 'vi', ${EDITED_DRAFT}, 'Quy định bảo vệ dữ liệu', '## Liên hệ')
		returning id
	`;
	if (made === undefined) throw new Error("no draft to edit");
	return made.id;
}

async function draftToPublish(sql: Sql, { tenantId, index }: ProbeContext) {
	const [found] = await sql<{ id: string }[]>`
		select id from public.legal_documents
		where tenant_id = ${tenantId} and kind = 'staff_notice' and status = 'draft'
	`;
	if (found !== undefined) return found.id;
	const [made] = await sql<{ id: string }[]>`
		insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown)
		values (${tenantId}, 'staff_notice', 'vi', ${`e2e-quyen-ban-${index}`}, 'Thông báo cho nhân viên', '## Dữ liệu nhân viên')
		returning id
	`;
	if (made === undefined) throw new Error("no draft to publish");
	return made.id;
}

async function textToRetire(sql: Sql, { tenantId, index }: ProbeContext) {
	const [found] = await sql<{ id: string }[]>`
		select id from public.legal_documents
		where tenant_id = ${tenantId} and kind = 'mini_app_terms' and language = 'vi' and status = 'published'
	`;
	if (found !== undefined) return found.id;
	const [made] = await sql<{ id: string }[]>`
		insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
		values (${tenantId}, 'mini_app_terms', 'vi', ${`e2e-quyen-ngung-${index}`}, 'Điều khoản Mini App', '## Điều khoản', 'published', now())
		returning id
	`;
	if (made === undefined) throw new Error("no text to retire");
	return made.id;
}

const HOLIDAY_ADDED = "Nghỉ thử quyền";
const HOLIDAY_DELETED = "Nghỉ thử xoá";

async function holidayToDelete(sql: Sql, { tenantId }: ProbeContext) {
	const [found] = await sql<{ id: string }[]>`
		select id from public.holidays
		where tenant_id = ${tenantId} and name = ${HOLIDAY_DELETED}
	`;
	if (found !== undefined) return found.id;
	const [made] = await sql<{ id: string }[]>`
		insert into public.holidays (tenant_id, country_code, holiday_date, name, kind)
		values (${tenantId}, 'VN', '2025-04-01', ${HOLIDAY_DELETED}, 'custom')
		returning id
	`;
	if (made === undefined) throw new Error("no day off to delete");
	return made.id;
}

const PROBES: readonly WriteProbe[] = [
	{
		name: "store 1's seat count",
		access: { area: "storeProfile", store: 0 },
		expected: byLogin("saved", "saved", "saved", "no row", "no row", "42501"),
		write: (client, { store1, index }) =>
			client
				.from("stores")
				.update({ seat_count: 20 + index })
				.eq("id", store1)
				.select("id"),
		observe: (owner, { store1 }) =>
			owner.from("stores").select("seat_count").eq("id", store1),
	},
	{
		name: "store 2's seat count",
		access: { area: "storeProfile", store: 1 },
		expected: byLogin("saved", "saved", "no row", "no row", "no row", "42501"),
		write: (client, { store2, index }) =>
			client
				.from("stores")
				.update({ seat_count: 20 + index })
				.eq("id", store2)
				.select("id"),
		observe: (owner, { store2 }) =>
			owner.from("stores").select("seat_count").eq("id", store2),
	},
	{
		name: "store 1's opening hours",
		access: { area: "openingHours", store: 0 },
		expected: byLogin("saved", "42501", "42501", "no row", "no row", "42501"),
		write: (client, { store1, index }) =>
			client
				.from("stores")
				.update({ opening_hours: { mon: [["07:00", `${20 + index}:00`]] } })
				.eq("id", store1)
				.select("id"),
		observe: (owner, { store1 }) =>
			owner.from("stores").select("opening_hours").eq("id", store1),
	},
	{
		name: "store 1 given the code store 2 already has",
		access: null,
		expected: byLogin("23505", "23505", "23505", "no row", "no row", "42501"),
		write: (client, { store1 }) =>
			client
				.from("stores")
				.update({ code: " e2 " })
				.eq("id", store1)
				.select("id"),
		observe: (owner, { tenantId }) =>
			owner
				.from("stores")
				.select("id,code")
				.eq("tenant_id", tenantId)
				.order("id"),
	},
	{
		name: "store 1's name, which has no column grant",
		access: null,
		expected: REFUSED_TO_EVERY_LOGIN,
		write: (client, { store1, index }) =>
			client
				.from("stores")
				.update({ name: `Đổi tên ${index}` })
				.eq("id", store1)
				.select("id"),
		observe: (owner, { store1 }) =>
			owner.from("stores").select("name").eq("id", store1),
	},
	{
		name: "the tenant profile's legal form",
		access: { area: "tenantProfile", store: null },
		expected: byLogin("saved", "no row", "no row", "no row", "no row", "42501"),
		write: (client, { tenantId, index }) =>
			client
				.from("tenants")
				.update({
					legal_form: pick(
						[
							"household_business",
							"micro_enterprise",
							"small_enterprise",
							"enterprise",
						],
						index,
					),
				})
				.eq("id", tenantId)
				.select("id"),
		observe: (owner, { tenantId }) =>
			owner.from("tenants").select("legal_form").eq("id", tenantId),
	},
	{
		name: "an item cost for all stores",
		access: { area: "manualData", store: null },
		expected: byLogin("saved", "saved", "42501", "42501", "42501", "42501"),
		write: (client, { tenantId, index }) =>
			client
				.from("item_costs")
				.insert({
					tenant_id: tenantId,
					store_id: null,
					item_external_id: "ITEM-1",
					cost_amount: 10_000 + index * 1_000,
					effective_from: monthOf(index),
				})
				.select("id"),
		observe: (owner, { tenantId }) =>
			owner
				.from("item_costs")
				.select("effective_from,cost_amount")
				.eq("tenant_id", tenantId)
				.eq("item_external_id", "ITEM-1")
				.is("store_id", null)
				.order("effective_from"),
	},
	{
		name: "an item cost for store 1",
		access: { area: "manualData", store: 0 },
		expected: byLogin("saved", "saved", "saved", "42501", "42501", "42501"),
		write: (client, { tenantId, store1, index }) =>
			client
				.from("item_costs")
				.insert({
					tenant_id: tenantId,
					store_id: store1,
					item_external_id: "ITEM-2",
					cost_amount: 12_000 + index * 1_000,
					effective_from: monthOf(index),
				})
				.select("id"),
		observe: (owner, { store1 }) =>
			owner
				.from("item_costs")
				.select("effective_from,cost_amount")
				.eq("store_id", store1)
				.eq("item_external_id", "ITEM-2")
				.order("effective_from"),
	},
	{
		name: "an item cost for store 2",
		access: { area: "manualData", store: 1 },
		expected: byLogin("saved", "saved", "42501", "42501", "42501", "42501"),
		write: (client, { tenantId, store2, index }) =>
			client
				.from("item_costs")
				.insert({
					tenant_id: tenantId,
					store_id: store2,
					item_external_id: "ITEM-3",
					cost_amount: 9_000 + index * 1_000,
					effective_from: monthOf(index),
				})
				.select("id"),
		observe: (owner, { store2 }) =>
			owner
				.from("item_costs")
				.select("effective_from,cost_amount")
				.eq("store_id", store2)
				.eq("item_external_id", "ITEM-3")
				.order("effective_from"),
	},
	{
		name: "a fee rate for all stores",
		access: { area: "manualData", store: null },
		expected: byLogin("saved", "saved", "42501", "42501", "42501", "42501"),
		write: (client, { tenantId, index }) =>
			client
				.from("payment_fee_rates")
				.insert({
					tenant_id: tenantId,
					store_id: null,
					payment_method_external_id: "WALLET",
					fee_pct: 1 + index / 10,
					fixed_fee_amount: 0,
					effective_from: monthOf(index),
				})
				.select("id"),
		observe: (owner, { tenantId }) =>
			owner
				.from("payment_fee_rates")
				.select("effective_from,fee_pct")
				.eq("tenant_id", tenantId)
				.eq("payment_method_external_id", "WALLET")
				.is("store_id", null)
				.order("effective_from"),
	},
	{
		name: "a fee rate for store 1",
		access: { area: "manualData", store: 0 },
		expected: byLogin("saved", "saved", "saved", "42501", "42501", "42501"),
		write: (client, { tenantId, store1, index }) =>
			client
				.from("payment_fee_rates")
				.insert({
					tenant_id: tenantId,
					store_id: store1,
					payment_method_external_id: "WALLET",
					fee_pct: 2 + index / 10,
					fixed_fee_amount: 1_000,
					effective_from: monthOf(index),
				})
				.select("id"),
		observe: (owner, { store1 }) =>
			owner
				.from("payment_fee_rates")
				.select("effective_from,fee_pct")
				.eq("store_id", store1)
				.eq("payment_method_external_id", "WALLET")
				.order("effective_from"),
	},
	{
		name: "a 21 % fee rate for store 1, over the 20 % limit",
		access: null,
		expected: byLogin("23514", "23514", "23514", "42501", "42501", "42501"),
		write: (client, { tenantId, store1, index }) =>
			client
				.from("payment_fee_rates")
				.insert({
					tenant_id: tenantId,
					store_id: store1,
					payment_method_external_id: "CASH",
					fee_pct: 21,
					fixed_fee_amount: 0,
					effective_from: monthOf(index),
				})
				.select("id"),
		observe: (owner, { store1 }) =>
			owner
				.from("payment_fee_rates")
				.select("id")
				.eq("store_id", store1)
				.eq("payment_method_external_id", "CASH"),
	},
	{
		name: "store 1's monthly target",
		access: { area: "manualData", store: 0 },
		expected: byLogin("saved", "saved", "saved", "42501", "42501", "42501"),
		write: (client, { tenantId, store1, index }) =>
			client
				.from("targets")
				.insert({
					tenant_id: tenantId,
					store_id: store1,
					period_kind: "month",
					period_start: monthOf(index),
					net_target_amount: 50_000_000 + index,
				})
				.select("id"),
		observe: (owner, { store1 }) =>
			owner
				.from("targets")
				.select("period_start,net_target_amount")
				.eq("store_id", store1)
				.order("period_start"),
	},
	{
		name: "store 2's monthly target",
		access: { area: "manualData", store: 1 },
		expected: byLogin("saved", "saved", "42501", "42501", "42501", "42501"),
		write: (client, { tenantId, store2, index }) =>
			client
				.from("targets")
				.insert({
					tenant_id: tenantId,
					store_id: store2,
					period_kind: "month",
					period_start: monthOf(index),
					net_target_amount: 40_000_000 + index,
				})
				.select("id"),
		observe: (owner, { store2 }) =>
			owner
				.from("targets")
				.select("period_start,net_target_amount")
				.eq("store_id", store2)
				.order("period_start"),
	},
	{
		name: "an item type's role",
		access: { area: "roles", store: null },
		expected: byLogin("saved", "saved", "42501", "42501", "42501", "42501"),
		write: (client, { tenantId, accountId, index }) =>
			client
				.from("item_type_roles")
				.upsert(
					{
						tenant_id: tenantId,
						pos_account_id: accountId,
						item_type_external_id: "TYPE-DRINK",
						role: pick(["drink", "food", "snack", "topping", "other"], index),
					},
					{ onConflict: "pos_account_id,item_type_external_id" },
				)
				.select("role"),
		observe: (owner, { tenantId }) =>
			owner.from("item_type_roles").select("role").eq("tenant_id", tenantId),
	},
	{
		name: "an item's category override",
		access: { area: "roles", store: null },
		expected: byLogin("saved", "saved", "42501", "42501", "42501", "42501"),
		write: (client, { tenantId, accountId, index }) =>
			client
				.from("item_category_overrides")
				.upsert(
					{
						tenant_id: tenantId,
						pos_account_id: accountId,
						item_external_id: "ITEM-6",
						item_type_external_id: pick(["TYPE-SNACK", "TYPE-DRINK"], index),
					},
					{ onConflict: "pos_account_id,item_external_id" },
				)
				.select("item_type_external_id"),
		observe: (owner, { tenantId }) =>
			owner
				.from("item_category_overrides")
				.select("item_external_id,item_type_external_id")
				.eq("tenant_id", tenantId),
	},
	{
		name: "a payment method's kind override",
		access: { area: "roles", store: null },
		expected: byLogin("saved", "saved", "42501", "42501", "42501", "42501"),
		write: (client, { tenantId, accountId, index }) =>
			client
				.from("payment_kind_overrides")
				.upsert(
					{
						tenant_id: tenantId,
						pos_account_id: accountId,
						payment_method_external_id: "WALLET",
						kind: pick(
							["ewallet", "card", "bank_transfer", "voucher", "cash"],
							index,
						),
					},
					{ onConflict: "pos_account_id,payment_method_external_id" },
				)
				.select("kind"),
		observe: (owner, { tenantId }) =>
			owner
				.from("payment_kind_overrides")
				.select("payment_method_external_id,kind")
				.eq("tenant_id", tenantId),
	},
	{
		name: "a day off added",
		access: { area: "holidays", store: null },
		expected: byLogin("saved", "saved", "42501", "42501", "42501", "42501"),
		write: (client, { tenantId, index }) =>
			client
				.from("holidays")
				.insert({
					tenant_id: tenantId,
					country_code: "VN",
					holiday_date: `2025-03-1${index}`,
					name: HOLIDAY_ADDED,
					kind: "custom",
				})
				.select("id"),
		observe: (owner, { tenantId }) =>
			owner
				.from("holidays")
				.select("holiday_date")
				.eq("tenant_id", tenantId)
				.eq("name", HOLIDAY_ADDED)
				.order("holiday_date"),
	},
	{
		name: "a day off deleted",
		access: { area: "holidays", store: null },
		expected: byLogin("saved", "saved", "no row", "no row", "no row", "42501"),
		prepare: holidayToDelete,
		write: (client, _context, target) =>
			client.from("holidays").delete().eq("id", target).select("id"),
		observe: (owner, _context, target) =>
			owner.from("holidays").select("id").eq("id", target),
	},
	{
		name: "a report setting",
		access: { area: "thresholds", store: null },
		expected: byLogin("saved", "42501", "42501", "42501", "42501", "42501"),
		write: (client, { tenantId, index }) =>
			client
				.from("report_settings")
				.upsert(
					{ tenant_id: tenantId, cash_abs_threshold: 60_000 + index * 1_000 },
					{ onConflict: "tenant_id" },
				)
				.select("cash_abs_threshold"),
		observe: (owner, { tenantId }) =>
			owner
				.from("report_settings")
				.select("cash_abs_threshold")
				.eq("tenant_id", tenantId),
	},
	{
		name: "a legal draft",
		access: { area: "legal", store: null },
		expected: byLogin("saved", "42501", "42501", "42501", "42501", "42501"),
		write: (client, { tenantId, index }) =>
			client
				.from("legal_documents")
				.insert({
					tenant_id: tenantId,
					kind: "privacy_notice",
					language: "vi",
					version: `e2e-quyen-${index}`,
					title: "Thông báo bảo mật",
					body_markdown: "## Mục đích xử lý dữ liệu",
				})
				.select("id"),
		observe: (owner, { tenantId }) =>
			owner
				.from("legal_documents")
				.select("version")
				.eq("tenant_id", tenantId)
				.eq("kind", "privacy_notice")
				.order("version"),
	},
	{
		name: "a legal draft's title edited",
		access: { area: "legal", store: null },
		expected: byLogin("saved", "no row", "no row", "no row", "no row", "42501"),
		prepare: editedDraft,
		write: (client, { index }, target) =>
			client
				.from("legal_documents")
				.update({ title: `Quy định bảo vệ dữ liệu ${index}` })
				.eq("id", target)
				.select("id"),
		observe: (owner, _context, target) =>
			owner.from("legal_documents").select("title").eq("id", target),
	},
	{
		name: "a legal text inserted as published",
		access: null,
		expected: REFUSED_TO_EVERY_LOGIN,
		write: (client, { tenantId, index }) =>
			client
				.from("legal_documents")
				.insert({
					tenant_id: tenantId,
					kind: "marketing_consent_text",
					language: "vi",
					version: `e2e-quyen-cong-bo-${index}`,
					title: "Đồng ý nhận tin",
					body_markdown: "## Mục đích",
					status: "published",
					published_at: new Date().toISOString(),
				})
				.select("id"),
		observe: (owner, { tenantId }) =>
			owner
				.from("legal_documents")
				.select("id")
				.eq("tenant_id", tenantId)
				.eq("kind", "marketing_consent_text"),
	},
	{
		name: "a PATCH of a legal draft's status",
		access: null,
		expected: REFUSED_TO_EVERY_LOGIN,
		prepare: editedDraft,
		write: (client, _context, target) =>
			client
				.from("legal_documents")
				.update({ status: "published" })
				.eq("id", target)
				.select("id"),
		observe: (owner, _context, target) =>
			owner.from("legal_documents").select("status").eq("id", target),
	},
	{
		name: "a legal draft published through publish_legal_document",
		access: { area: "legal", store: null },
		expected: byLogin("saved", "42501", "42501", "42501", "42501", "42501"),
		prepare: draftToPublish,
		write: (client, _context, target) =>
			client.rpc("publish_legal_document", { p_document_id: target }),
		observe: (owner, _context, target) =>
			owner
				.from("legal_documents")
				.select("status,published_at")
				.eq("id", target),
	},
	{
		name: "a published legal text retired through retire_legal_document",
		access: { area: "legal", store: null },
		expected: byLogin("saved", "42501", "42501", "42501", "42501", "42501"),
		prepare: textToRetire,
		write: (client, _context, target) =>
			client.rpc("retire_legal_document", { p_document_id: target }),
		observe: (owner, _context, target) =>
			owner
				.from("legal_documents")
				.select("status,retired_at")
				.eq("id", target),
	},
	{
		name: "the catch-up refresh through refresh_my_analytics",
		access: null,
		expected: byLogin("saved", "saved", "saved", "42501", "42501", "42501"),
		write: (client, { tenantId, lastSalesDay }) =>
			client.rpc("refresh_my_analytics", {
				p_from: lastSalesDay,
				p_to: lastSalesDay,
				p_tenant: tenantId,
			}),
		observe: null,
	},
];

function expectedColumn(login: Login): Record<string, Outcome> {
	return Object.fromEntries(
		PROBES.map((probe) => [probe.name, probe.expected[login]]),
	);
}

test("each fixture login holds the membership the write table assumes, and the app's access rules offer exactly the writes the table saves", async () => {
	const { storeIds } = created();
	for (const role of SETTINGS_ROLES) await membershipOf(role);
	expect(Object.fromEntries(memberships)).toEqual({
		owner: { role: "owner", storeIds: null },
		manager: { role: "manager", storeIds: null },
		"store-manager": { role: "manager", storeIds: [storeIds[0]] },
		staff: { role: "staff", storeIds: null },
		viewer: { role: "viewer", storeIds: null },
	});
	const offered: Record<string, boolean> = {};
	const saved: Record<string, boolean> = {};
	for (const role of SETTINGS_ROLES) {
		const membership = memberships.get(role);
		for (const probe of PROBES) {
			if (probe.access === null) continue;
			const storeId =
				probe.access.store === null ? null : storeIds[probe.access.store];
			const key = `${role}: ${probe.name}`;
			offered[key] = settingsAccess(
				probe.access.area,
				membership,
				storeId,
			).canWrite;
			saved[key] = probe.expected[role] === "saved";
		}
	}
	expect(offered).toEqual(saved);
	expect(
		Object.fromEntries(
			LOGINS.map((login) => [
				login,
				PROBES.filter((probe) => probe.expected[login] === "saved").length,
			]),
		),
	).toEqual({
		owner: 22,
		manager: 15,
		"store-manager": 5,
		staff: 0,
		viewer: 0,
		anon: 0,
	});
});

test.describe("the write table through PostgREST", () => {
	let sql: Sql | undefined;

	test.beforeAll(() => {
		sql = openFixtureDatabase();
	});

	test.afterAll(async () => {
		await sql?.end();
	});

	for (const [index, login] of LOGINS.entries()) {
		test(`${LOGIN_NAMES[login]}: the database saves or refuses every settings write with the code the write table gives, and a read as the owner shows that only the saved writes changed anything`, async () => {
			if (sql === undefined) throw new Error("no database connection");
			const { tenantId, accountId, storeIds, sales } = created();
			const owner = await clientAs("owner");
			const client =
				login === "anon" ? anonymousClient() : await clientAs(login);
			const context: ProbeContext = {
				index,
				tenantId,
				accountId,
				store1: storeIds[0],
				store2: storeIds[1],
				lastSalesDay: sales.to,
			};
			const outcomes: Record<string, string> = {};
			const changed: Record<string, boolean> = {};
			const expectedChange: Record<string, boolean> = {};
			for (const probe of PROBES) {
				const target =
					probe.prepare === undefined ? "" : await probe.prepare(sql, context);
				const earlier =
					probe.observe === null
						? null
						: await observed(probe.observe(owner, context, target));
				outcomes[probe.name] = outcomeOf(
					await probe.write(client, context, target),
				);
				if (probe.observe === null) continue;
				const later = await observed(probe.observe(owner, context, target));
				changed[probe.name] = later !== earlier;
				expectedChange[probe.name] = probe.expected[login] === "saved";
			}
			expect(outcomes).toEqual(expectedColumn(login));
			expect(changed).toEqual(expectedChange);
		});
	}
});

function settingsContent(page: Page): Locator {
	return page.locator('section[aria-labelledby="settings-page-title"]');
}

async function offeredControls(scope: Locator): Promise<string[]> {
	const found = await scope
		.locator("input, select, textarea, button, [contenteditable='true']")
		.evaluateAll((elements) =>
			elements.flatMap((element) => {
				const toggles = new Set(["checkbox", "radio", "file"]);
				const html = element as HTMLElement;
				const isButton = element instanceof HTMLButtonElement;
				if (
					!isButton &&
					(html.getAttribute("aria-disabled") === "true" ||
						((element instanceof HTMLInputElement ||
							element instanceof HTMLSelectElement ||
							element instanceof HTMLTextAreaElement) &&
							element.disabled))
				) {
					return [];
				}
				if (element instanceof HTMLInputElement) {
					if (element.type === "hidden") return [];
					if (element.readOnly && !toggles.has(element.type)) return [];
				}
				if (element instanceof HTMLTextAreaElement && element.readOnly) {
					return [];
				}
				const name =
					html.dataset.testid ??
					html.getAttribute("aria-label") ??
					(html.textContent ?? "").trim();
				return [`${html.tagName.toLowerCase()}:${name}`];
			}),
		);
	return [...new Set(found)].sort();
}

async function openEveryDisclosure(scope: Locator): Promise<void> {
	const closed = scope.locator('button[aria-expanded="false"]');
	const count = await closed.count();
	for (let opened = 0; opened < count; opened += 1) {
		await closed.first().click();
	}
	await expect(closed).toHaveCount(0);
}

async function expectOnlyControls(
	scope: Locator,
	allowed: readonly string[],
	what: string,
): Promise<void> {
	await openEveryDisclosure(scope);
	const offered = await offeredControls(scope);
	expect(
		offered.filter((control) => !allowed.includes(control)),
		what,
	).toEqual([]);
}

async function expectReadOnly(
	notice: Locator,
	access: SettingsAccess,
	what: string,
): Promise<void> {
	expect(access.canWrite, what).toBe(false);
	await expect(notice, what).toHaveCount(1);
	await expect(notice, what).toHaveAttribute(
		"data-reason",
		access.reason ?? "",
	);
	await expect(notice, what).toBeVisible();
}

async function expectAccessShown(
	notice: Locator,
	writeControl: Locator,
	access: SettingsAccess,
	what: string,
): Promise<void> {
	if (access.canWrite) {
		await expect(notice, what).toHaveCount(0);
		await expect(writeControl.first(), what).toBeVisible();
		return;
	}
	await expectReadOnly(notice, access, what);
	await expect(writeControl, what).toHaveCount(0);
}

async function nextFrames(page: Page): Promise<void> {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
}

async function expectAccessibleAtBothWidths(page: Page): Promise<void> {
	await page.setViewportSize({ width: PHONE_WIDTH, height: SCREEN_HEIGHT });
	await nextFrames(page);
	await expectNoSeriousAxeViolations(page);
	await page.setViewportSize({ width: DESKTOP_WIDTH, height: SCREEN_HEIGHT });
	await nextFrames(page);
	await expectNoSeriousAxeViolations(page);
}

async function signedIn(page: Page, role: SettingsRole): Promise<Membership> {
	const membership = await membershipOf(role);
	watchConsoleErrors(page);
	await created().signIn(page, role);
	return membership;
}

function visibleStoresOf(membership: Membership): readonly string[] {
	const { storeIds } = created();
	return membership.storeIds === null ? storeIds : membership.storeIds;
}

const STORE_FIELDS = [
	"store-code",
	"store-opened-on",
	"store-seats",
	"store-e-invoice",
	"store-receipts",
	"store-member",
] as const;

interface SingleAreaPage {
	readonly name: string;
	readonly area: SettingsArea;
	readonly slug: SettingsSlug;
	readonly search: string;
	readonly ready: string;
	readonly rows: string;
	readonly writeControl: string;
	readonly readOnlyControls: readonly string[];
}

const SINGLE_AREA_PAGES: readonly SingleAreaPage[] = [
	{
		name: "Phân loại → Vai trò",
		area: "roles",
		slug: "phan-loai",
		search: "tab=vai-tro",
		ready: "roles-form",
		rows: "role-row",
		writeControl: "settings-save-bar",
		readOnlyControls: [],
	},
	{
		name: "Phân loại → Nhóm của món",
		area: "roles",
		slug: "phan-loai",
		search: "tab=nhom-mon",
		ready: "categories-form",
		rows: "category-row",
		writeControl: "settings-save-bar",
		readOnlyControls: ["input:categories-search"],
	},
	{
		name: "Phân loại → Loại thanh toán",
		area: "roles",
		slug: "phan-loai",
		search: "tab=thanh-toan",
		ready: "payment-kinds-form",
		rows: "payment-kind-row",
		writeControl: "settings-save-bar",
		readOnlyControls: [],
	},
	{
		name: "Ngày lễ",
		area: "holidays",
		slug: "ngay-le",
		search: "",
		ready: "holidays-custom",
		rows: "holidays-custom-list",
		writeControl: "holidays-add",
		readOnlyControls: ["select:holidays-year"],
	},
	{
		name: "Báo cáo",
		area: "thresholds",
		slug: "bao-cao",
		search: "",
		ready: "thresholds-form",
		rows: "settings-field",
		writeControl: "settings-save-bar",
		readOnlyControls: [
			"input:csv-dialect-comma",
			"input:csv-dialect-semicolon",
		],
	},
	{
		name: "Pháp lý",
		area: "legal",
		slug: "phap-ly",
		search: "",
		ready: "legal-documents",
		rows: "legal-version",
		writeControl: "legal-new",
		readOnlyControls: ["button:legal-show"],
	},
];

interface ManualTab {
	readonly name: string;
	readonly tab: string;
	readonly ready: string;
	readonly rows: string;
	readonly scope: string;
	/**
	 * The attribute that marks a scope's rows as loaded, on the `ready` element,
	 * for a tab that reloads its rows when the scope changes: until then the rows
	 * are not on the page, and they come back with every disclosure closed.
	 */
	readonly loaded?: { readonly attribute: string; readonly value: string };
	readonly readOnlyControls: readonly string[];
}

const MANUAL_TABS: readonly ManualTab[] = [
	{
		name: "Dữ liệu nhập tay → Giá vốn",
		tab: "gia-von",
		ready: "costs-form",
		rows: "cost-row",
		scope: "cost-scope",
		loaded: { attribute: "data-sales", value: "ready" },
		readOnlyControls: [
			"button:cost-history-toggle",
			"button:costs-template",
			"input:costs-search",
			"select:cost-scope",
		],
	},
	{
		name: "Dữ liệu nhập tay → Mục tiêu",
		tab: "muc-tieu",
		ready: "targets-form",
		rows: "target-month",
		scope: "target-store",
		readOnlyControls: ["select:target-store"],
	},
	{
		name: "Dữ liệu nhập tay → Phí thanh toán",
		tab: "phi",
		ready: "fees-form",
		rows: "fee-row",
		scope: "fee-scope",
		readOnlyControls: ["button:fee-history-toggle", "select:fee-scope"],
	},
];

const PHASE_12_PAGES = [
	{ name: "Cảnh báo", slug: "canh-bao", testId: "canh-bao-page" },
	{ name: "Bản tin", slug: "ban-tin", testId: "ban-tin-page" },
] as const;

async function optionValues(select: Locator): Promise<string[]> {
	return select
		.locator("option")
		.evaluateAll((options) =>
			options.map((option) => (option as HTMLOptionElement).value),
		);
}

const SETTINGS_TABLES = [
	"item_costs",
	"payment_fee_rates",
	"targets",
	"item_type_roles",
	"item_category_overrides",
	"payment_kind_overrides",
	"holidays",
	"report_settings",
	"legal_documents",
] as const;

async function seedPageData(): Promise<void> {
	const { tenantId, accountId, storeIds } = created();
	const [store1, store2] = storeIds;
	const sql = openFixtureDatabase();
	try {
		for (const table of SETTINGS_TABLES) {
			await sql`delete from ${sql(`public.${table}`)} where tenant_id = ${tenantId}`;
		}
		await sql`
			insert into public.item_costs (tenant_id, store_id, item_external_id, cost_amount, effective_from)
			values
				(${tenantId}, null, 'ITEM-1', 10000, ${FIRST_DAY}),
				(${tenantId}, null, 'ITEM-1', 11000, '2025-06-01'),
				(${tenantId}, ${store1}, 'ITEM-2', 12000, ${FIRST_DAY}),
				(${tenantId}, ${store2}, 'ITEM-3', 9000, ${FIRST_DAY})
		`;
		await sql`
			insert into public.payment_fee_rates (tenant_id, store_id, payment_method_external_id, fee_pct, fixed_fee_amount, effective_from)
			values
				(${tenantId}, null, 'WALLET', 1.5, 0, ${FIRST_DAY}),
				(${tenantId}, null, 'WALLET', 1.8, 0, '2025-06-01'),
				(${tenantId}, ${store1}, 'WALLET', 2, 1000, ${FIRST_DAY})
		`;
		await sql`
			insert into public.targets (tenant_id, store_id, period_kind, period_start, net_target_amount)
			select ${tenantId}, s.store_id, 'month', date_trunc('month', now() at time zone ${TIME_ZONE})::date, s.amount
			from (values (${store1}::uuid, 50000000), (${store2}::uuid, 40000000)) as s (store_id, amount)
		`;
		await sql`
			insert into public.item_type_roles (tenant_id, pos_account_id, item_type_external_id, role)
			values (${tenantId}, ${accountId}, 'TYPE-DRINK', 'drink'), (${tenantId}, ${accountId}, 'TYPE-SNACK', 'snack')
		`;
		await sql`
			insert into public.item_category_overrides (tenant_id, pos_account_id, item_external_id, item_type_external_id)
			values (${tenantId}, ${accountId}, 'ITEM-6', 'TYPE-SNACK')
		`;
		await sql`
			insert into public.payment_kind_overrides (tenant_id, pos_account_id, payment_method_external_id, kind)
			values (${tenantId}, ${accountId}, 'WALLET', 'ewallet')
		`;
		await sql`
			insert into public.holidays (tenant_id, country_code, holiday_date, name, kind)
			values (${tenantId}, 'VN', make_date(extract(year from now() at time zone ${TIME_ZONE})::integer, 12, 24), 'Nghỉ riêng của chuỗi', 'custom')
		`;
		await sql`
			insert into public.report_settings (tenant_id, cash_abs_threshold)
			values (${tenantId}, 60000)
		`;
		await sql`
			insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
			values
				(${tenantId}, 'privacy_notice', 'vi', 'privacy-notice-e2e-1', 'Thông báo bảo mật', '## Mục đích xử lý dữ liệu', 'published', now()),
				(${tenantId}, 'staff_notice', 'vi', 'staff-notice-e2e-1', 'Thông báo cho nhân viên', '## Dữ liệu nhân viên', 'draft', null)
		`;
		await sql`select app.refresh_analytics(${tenantId}::uuid, ${FIRST_DAY}::date, current_date + 1)`;
	} finally {
		await sql.end();
	}
}

test.describe("the settings pages for each login", () => {
	test.beforeAll(seedPageData);

	for (const role of SETTINGS_ROLES) {
		const who = LOGIN_NAMES[role];

		test(`${who} on Cửa hàng: the business block and every store in scope show write controls exactly where the database saves, the reason everywhere else, and opening hours stay with the owner`, async ({
			page,
		}) => {
			const { storeIds } = created();
			const membership = await signedIn(page, role);
			await openSettings(page, "cua-hang");
			const content = settingsContent(page);
			await expect(content.getByTestId("store-profiles")).toBeVisible();
			const tenant = content.getByTestId("tenant-profile");
			const tenantAccess = settingsAccess("tenantProfile", membership);
			await expectAccessShown(
				tenant.getByTestId("settings-read-only"),
				tenant.getByTestId("settings-save-bar"),
				tenantAccess,
				`${role} on the business block`,
			);
			if (!tenantAccess.canWrite) {
				await expectOnlyControls(tenant, [], `${role} on the business block`);
			}
			const visible = visibleStoresOf(membership);
			await expect(content.getByTestId("store-profile")).toHaveCount(
				visible.length,
			);
			let readOnlyEverywhere = !tenantAccess.canWrite;
			for (const storeId of storeIds) {
				const block = content.locator(
					`[data-testid="store-profile"][data-store="${storeId}"]`,
				);
				if (!visible.includes(storeId)) {
					await expect(block, `${role} on store ${storeId}`).toHaveCount(0);
					continue;
				}
				const what = `${role} on store ${storeId}`;
				const store = settingsAccess("storeProfile", membership, storeId);
				await expectAccessShown(
					block.getByTestId("settings-read-only"),
					block.getByTestId("settings-save-bar"),
					store,
					what,
				);
				const hoursNotice = block.getByTestId("store-hours-read-only");
				const hoursEditor = block.getByTestId("opening-hours-editor");
				if (!store.canWrite) {
					await expect(hoursNotice, what).toHaveCount(0);
					await expectOnlyControls(block, [], what);
					continue;
				}
				readOnlyEverywhere = false;
				for (const field of STORE_FIELDS) {
					await expect(
						block.getByTestId(field),
						`${what}: ${field}`,
					).toBeEditable();
				}
				const hours = settingsAccess("openingHours", membership, storeId);
				if (hours.canWrite) {
					await expect(hoursNotice, `${what}: opening hours`).toHaveCount(0);
					expect(
						(await offeredControls(hoursEditor)).length,
						`${what}: opening hours`,
					).toBeGreaterThan(0);
					continue;
				}
				await expectReadOnly(hoursNotice, hours, `${what}: opening hours`);
				await expectOnlyControls(hoursEditor, [], `${what}: opening hours`);
			}
			if (readOnlyEverywhere) {
				await expectOnlyControls(content, [], `${role} on Cửa hàng`);
				await expect(content.getByTestId("settings-save-bar")).toHaveCount(0);
			}
			if (!tenantAccess.canWrite) await expectAccessibleAtBothWidths(page);
			expectNoConsoleErrors(page);
		});

		test(`${who} on Dữ liệu nhập tay: every tab and scope shows write controls exactly where the database saves and the reason everywhere else`, async ({
			page,
		}) => {
			const membership = await signedIn(page, role);
			for (const tab of MANUAL_TABS) {
				await openSettings(page, "du-lieu-nhap-tay", `tab=${tab.tab}`);
				const content = settingsContent(page);
				await expect(content.getByTestId(tab.ready)).toBeVisible();
				await expect(content.getByTestId(tab.rows).first()).toBeVisible();
				const scope = content.getByTestId(tab.scope);
				const values = await optionValues(scope);
				expect(values.length, `${role} on ${tab.name}`).toBeGreaterThan(0);
				let checkedAxe = false;
				for (const value of values) {
					await scope.selectOption(value);
					await expect(scope).toHaveValue(value);
					const what = `${role} on ${tab.name} for ${value}`;
					if (tab.loaded !== undefined) {
						await expect(
							content.getByTestId(tab.ready),
							`${what}: rows loaded`,
						).toHaveAttribute(tab.loaded.attribute, tab.loaded.value);
					}
					const access = settingsAccess(
						"manualData",
						membership,
						value === "all" ? null : value,
					);
					await expectAccessShown(
						content.getByTestId("settings-read-only"),
						content.getByTestId("settings-save-bar"),
						access,
						what,
					);
					if (access.canWrite) continue;
					await expectOnlyControls(content, tab.readOnlyControls, what);
					if (checkedAxe) continue;
					checkedAxe = true;
					await expectAccessibleAtBothWidths(page);
				}
			}
			expectNoConsoleErrors(page);
		});

		test(`${who} on Phân loại, Ngày lễ, Báo cáo and Pháp lý: write controls exactly where the database saves and the reason everywhere else`, async ({
			page,
		}) => {
			const membership = await signedIn(page, role);
			for (const section of SINGLE_AREA_PAGES) {
				await openSettings(page, section.slug, section.search);
				const content = settingsContent(page);
				await expect(content.getByTestId(section.ready)).toBeVisible();
				await expect(content.getByTestId(section.rows).first()).toBeVisible();
				const what = `${role} on ${section.name}`;
				const access = settingsAccess(section.area, membership);
				await expectAccessShown(
					content.getByTestId("settings-read-only"),
					content.getByTestId(section.writeControl),
					access,
					what,
				);
				if (access.canWrite) continue;
				await expect(
					content.getByTestId("settings-save-bar"),
					what,
				).toHaveCount(0);
				await expectOnlyControls(content, section.readOnlyControls, what);
				await expectAccessibleAtBothWidths(page);
			}
			expectNoConsoleErrors(page);
		});

		test(`${who} on Cảnh báo and Bản tin: the planned pages hold no field and no save button`, async ({
			page,
		}) => {
			await signedIn(page, role);
			for (const built of PHASE_12_PAGES) {
				await openSettings(page, built.slug);
				const content = settingsContent(page);
				await expect(content.getByTestId(built.testId)).toBeVisible();
				await expect(content.getByTestId("settings-placeholder")).toHaveCount(
					0,
				);
				if (role === "staff" || role === "viewer") {
					await expectAccessibleAtBothWidths(page);
				}
			}
			expectNoConsoleErrors(page);
		});
	}
});

test("teardown leaves no fixture tenant or login, and every real tenant's rows and logins are as they were", async () => {
	const settings = created();
	if (before === undefined) throw new Error("no snapshot was taken");
	await signOutAll();
	await settings.teardown();
	const sql = openFixtureDatabase();
	try {
		const hex = settings.slug.slice(FIXTURE_SLUG_PREFIX.length);
		const [left] = await sql<{ tenants: number; users: number }[]>`
			select
				(select count(*)::int from public.tenants where id = ${settings.tenantId} or slug = ${settings.slug}) as tenants,
				(select count(*)::int from auth.users
					where id in ${sql(SETTINGS_ROLES.map((role) => settings.logins[role].userId))}
						or email like ${`e2e-%-${hex}@example.com`}) as users
		`;
		expect(left).toEqual({ tenants: 0, users: 0 });
	} finally {
		await sql.end();
	}
	expect(await snapshotRealTenants(before)).toEqual(before);
});
