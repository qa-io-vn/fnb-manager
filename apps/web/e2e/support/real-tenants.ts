import { FIXTURE_SLUG_PREFIX, openFixtureDatabase } from "./settings-fixture";

const FIXTURE_PREFIXES = [
	"it-",
	"notify-it-",
	"parity-",
	FIXTURE_SLUG_PREFIX,
] as const;

export interface RealTenantsSnapshot {
	readonly tenants: readonly string[];
	readonly users: readonly string[];
	readonly rows: Readonly<Record<string, number>>;
	readonly userRows: number;
}

export async function snapshotRealTenants(
	known: Pick<RealTenantsSnapshot, "tenants" | "users"> | null = null,
): Promise<RealTenantsSnapshot> {
	const sql = openFixtureDatabase();
	try {
		const tenants =
			known?.tenants ??
			(
				await sql<
					{ id: string; slug: string }[]
				>`select id, slug from public.tenants order by id`
			)
				.filter(
					(tenant) =>
						!FIXTURE_PREFIXES.some((prefix) => tenant.slug.startsWith(prefix)),
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
					order by u.id
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
