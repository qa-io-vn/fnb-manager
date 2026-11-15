import { expect, test } from "@playwright/test";
import { isLocalStackConfigured } from "../support/local-stack";
import {
	createSettingsFixture,
	FIXTURE_SLUG_PREFIX,
	fixtureDatabaseUrl,
	openFixtureDatabase,
	SETTINGS_ROLES,
	type SettingsFixture,
} from "../support/settings-fixture";

test.skip(
	!isLocalStackConfigured,
	"the local Supabase stack is not configured in .env.local",
);

test.describe.configure({ mode: "serial" });

const OTHER_FIXTURE_PREFIXES = [
	"it-",
	"notify-it-",
	"parity-",
	FIXTURE_SLUG_PREFIX,
];

interface Snapshot {
	readonly tenants: readonly string[];
	readonly users: readonly string[];
	readonly rows: Readonly<Record<string, number>>;
	readonly userRows: number;
}

async function snapshot(
	known: Pick<Snapshot, "tenants" | "users"> | null,
): Promise<Snapshot> {
	const sql = openFixtureDatabase();
	try {
		const tenants =
			known?.tenants ??
			(
				await sql<
					{ id: string; slug: string }[]
				>`select id, slug from public.tenants`
			)
				.filter(
					(tenant) =>
						!OTHER_FIXTURE_PREFIXES.some((prefix) =>
							tenant.slug.startsWith(prefix),
						),
				)
				.map((tenant) => tenant.id);
		const users =
			known?.users ??
			(
				await sql<{ id: string }[]>`
					select u.id from auth.users u
					where exists (
						select 1 from public.tenant_members m
						where m.user_id = u.id and m.tenant_id = any(${[...tenants]}::uuid[])
					)
				`
			).map((user) => user.id);
		const tables = await sql<{ table_name: string }[]>`
			select c.table_name
			from information_schema.columns c
			join information_schema.tables t
				on t.table_schema = c.table_schema and t.table_name = c.table_name
			where c.table_schema = 'public'
				and c.column_name = 'tenant_id'
				and t.table_type = 'BASE TABLE'
			order by c.table_name
		`;
		const rows: Record<string, number> = {};
		for (const { table_name } of tables) {
			const [count] = await sql<{ n: number }[]>`
				select count(*)::int as n
				from ${sql(`public.${table_name}`)}
				where tenant_id = any(${[...tenants]}::uuid[])
			`;
			rows[table_name] = count?.n ?? 0;
		}
		const [userCount] = await sql<{ n: number }[]>`
			select count(*)::int as n from auth.users where id = any(${[...users]}::uuid[])
		`;
		return { tenants, users, rows, userRows: userCount?.n ?? 0 };
	} finally {
		await sql.end();
	}
}

let fixture: SettingsFixture | undefined;
let before: Snapshot;

function created(): SettingsFixture {
	if (fixture === undefined) throw new Error("the fixture was not created");
	return fixture;
}

test.beforeAll(async () => {
	before = await snapshot(null);
	fixture = await createSettingsFixture();
});

test.afterAll(async () => {
	await fixture?.teardown();
});

test("a database outside this machine is refused before any connection, however the URL names it", () => {
	for (const url of [
		"postgresql://db.example.com:5432/postgres",
		"postgresql://127.0.0.1:54322/postgres?host=db.example.com",
		["postgresql://u@127.0.0.1#x", "db.example.com/postgres"].join("@"),
	]) {
		expect(() => openFixtureDatabase({ E2E_DATABASE_URL: url }), url).toThrow(
			/loopback/,
		);
	}
	expect(fixtureDatabaseUrl({})).toContain("127.0.0.1");
	expect(
		fixtureDatabaseUrl({
			E2E_DATABASE_URL: "postgresql://localhost:54322/postgres",
		}),
	).toContain("localhost");
});

test("each of the five logins signs in and reads its own tenant within its scope", async () => {
	const settings = created();
	const visible: Record<string, readonly string[]> = {};
	for (const role of SETTINGS_ROLES) {
		const client = await settings.clientAs(role);
		const { data: tenants, error } = await client
			.from("tenants")
			.select("id, slug");
		expect(error, role).toBeNull();
		expect(
			tenants?.map((tenant) => tenant.slug),
			role,
		).toEqual([settings.slug]);
		const { data: stores } = await client
			.from("stores")
			.select("id")
			.order("id");
		visible[role] = (stores ?? []).map((store) => store.id);
		await client.auth.signOut();
	}
	const both = [...settings.storeIds].sort();
	expect(visible).toEqual({
		owner: both,
		manager: both,
		"store-manager": [settings.storeIds[0]],
		staff: both,
		viewer: both,
	});
});

test("the fixture holds five weeks of sales per store, refreshed into the aggregates", async () => {
	const settings = created();
	const client = await settings.clientAs("owner");
	const { data } = await client
		.from("agg_daily_sales")
		.select("store_id, business_date")
		.eq("tenant_id", settings.tenantId);
	const days = [
		...new Set((data ?? []).map((row) => row.business_date)),
	].sort();
	expect(days).toHaveLength(35);
	expect(days[0]).toBe(settings.sales.from);
	expect(days.at(-1)).toBe(settings.sales.to);
	expect(new Set((data ?? []).map((row) => row.store_id)).size).toBe(2);
	const { data: items } = await client
		.from("items")
		.select("external_id, item_type_external_id")
		.eq("tenant_id", settings.tenantId);
	expect(items).toHaveLength(6);
	expect(
		items?.filter((item) => item.item_type_external_id === null),
	).toHaveLength(1);
	const { data: methods } = await client
		.from("payment_methods")
		.select("external_id, kind")
		.eq("tenant_id", settings.tenantId)
		.order("external_id");
	expect(methods).toEqual([
		{ external_id: "CASH", kind: "cash" },
		{ external_id: "WALLET", kind: "other" },
	]);
	await client.auth.signOut();
});

for (const role of SETTINGS_ROLES) {
	test(`the ${role} signs in through the page`, async ({ page }) => {
		await created().signIn(page, role);
		await expect(
			page.getByRole("heading", { level: 1, name: "Hôm nay" }),
		).toBeVisible();
	});
}

test("teardown leaves no fixture tenant or login, and no other tenant's row or login changed", async () => {
	const settings = created();
	await settings.teardown();
	await settings.teardown();
	const sql = openFixtureDatabase();
	try {
		const [left] = await sql<{ tenants: number; users: number }[]>`
			select
				(select count(*)::int from public.tenants where id = ${settings.tenantId}) as tenants,
				(select count(*)::int from auth.users where id in ${sql(SETTINGS_ROLES.map((role) => settings.logins[role].userId))}) as users
		`;
		expect(left).toEqual({ tenants: 0, users: 0 });
	} finally {
		await sql.end();
	}
	expect(await snapshot(before)).toEqual(before);
});
