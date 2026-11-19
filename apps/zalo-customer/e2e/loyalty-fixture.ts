import { spawnSync } from "node:child_process";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { localDatabaseUrl, ROOT } from "./local-loop";

const ZALO_PACKAGE = new URL(
	"../../../packages/zalo/package.json",
	import.meta.url,
);
const SALE_SCRIPT = fileURLToPath(
	new URL("../../../scripts/simulate-sale.mjs", import.meta.url),
);
const AUTH_INSTANCE_ID = "00000000-0000-0000-0000-000000000000";
export const SIM_TENANT = "loyalty-sim";
export const SIM_BRAND = "brand-1";
const MOCK_USER_PREFIX = "mock-it-";
const CUSTOMER_LOGIN_SUFFIX = "@zalo-customer.invalid";
const STAFF_EMAIL_PREFIX = "loyalty-sim-it-";
const STAFF_EMAIL_DOMAIN = "@example.com";
const SALE_TIMEOUT_MS = 120_000;
const QUIET_MAX_MS = 180_000;

type Row = Record<string, unknown>;

interface Sql {
	<T extends Row = Row>(
		strings: TemplateStringsArray,
		...values: readonly unknown[]
	): Promise<T[]>;
	begin<T>(run: (sql: Sql) => Promise<T>): Promise<T>;
	end(options?: { readonly timeout?: number }): Promise<void>;
}

export interface SimStore {
	readonly id: string;
	readonly code: string;
	readonly name: string;
}

export interface SimTenant {
	readonly id: string;
	readonly programmeId: string;
	readonly programmeName: string;
	readonly stampsPerCard: number;
	readonly welcomeStamps: number;
	readonly stores: readonly SimStore[];
}

export interface SyntheticCustomer {
	readonly mockUser: string;
	readonly mockName: string;
	readonly phone: string;
}

export interface SyntheticStaff {
	readonly email: string;
	readonly mockUser: string;
	readonly mockName: string;
	readonly userId: string;
}

export interface SeededReward {
	readonly couponId: string;
	readonly rewardKey: string;
	readonly name: string;
	readonly discountName: string;
	readonly costStamps: number;
	readonly storeCode: string;
}

export interface RedemptionState {
	readonly held: number;
	readonly verified: number;
	readonly confirmed: number;
	readonly released: number;
}

export interface Sale {
	readonly store: string;
	readonly businessDate: string;
	readonly receiptNo: string;
	readonly amount: number;
	readonly output: string;
}

export interface SaleInput {
	readonly store: string;
	readonly amount: number;
	readonly discountName?: string;
	readonly discountAmount?: number;
}

export interface CustomerState {
	readonly customers: number;
	readonly memberships: number;
	readonly welcomeStamps: number;
	readonly earnsByPath: Readonly<Record<string, number>>;
	readonly matchedClaims: number;
	readonly matchedCheckins: number;
	readonly loyaltyConsents: number;
	readonly marketingConsents: number;
}

export interface CleanupCounts {
	readonly customers: number;
	readonly memberships: number;
	readonly consents: number;
	readonly customerLogins: number;
	readonly staffLogins: number;
	readonly rewards: number;
}

export interface LoyaltyFixture {
	readonly tenant: SimTenant;
	readonly sql: Sql;
	newCustomer(): Promise<SyntheticCustomer>;
	newStaff(storeCode: string): Promise<SyntheticStaff>;
	seedReward(storeCode: string, costStamps: number): Promise<SeededReward>;
	quietStore(storeCode: string): Promise<number>;
	redemptionState(reward: SeededReward): Promise<RedemptionState>;
	customerState(customer: SyntheticCustomer): Promise<CustomerState>;
	ringSale(input: SaleInput): Promise<Sale>;
	cleanup(): Promise<CleanupCounts>;
}

async function connect(url: string): Promise<Sql> {
	const require = createRequire(ZALO_PACKAGE);
	const loaded = await import(pathToFileURL(require.resolve("postgres")).href);
	const postgres = (loaded.default ?? loaded) as (
		url: string,
		options: Row,
	) => Sql;
	return postgres(url, {
		max: 1,
		connect_timeout: 10,
		onnotice: () => undefined,
	});
}

export function e164(national: string): string {
	return `+84${national.slice(1)}`;
}

async function loadTenant(sql: Sql): Promise<SimTenant> {
	const [tenant] = await sql<{ id: string }>`
		select id::text as id from public.tenants where slug = ${SIM_TENANT}
	`;
	if (tenant === undefined)
		throw new Error(
			`the local stack has no ${SIM_TENANT}; run pnpm loyalty:sale -- --setup --tenant ${SIM_TENANT}`,
		);
	const [programme] = await sql<{
		id: string;
		name: string;
		stamps_per_card: number;
		welcome_stamps: number;
	}>`
		select id::text as id, name, stamps_per_card, welcome_stamps from public.loyalty_programmes
		where tenant_id = ${tenant.id}::uuid and status = 'active'
	`;
	if (programme === undefined)
		throw new Error(`${SIM_TENANT} has no active programme`);
	const [privacy] = await sql<{ version: string }>`
		select version from public.legal_documents
		where tenant_id = ${tenant.id}::uuid and kind = 'privacy_notice' and status = 'published'
		limit 1
	`;
	if (privacy === undefined)
		throw new Error(`${SIM_TENANT} has no published privacy notice`);
	const stores = await sql<{ id: string; code: string; name: string }>`
		select s.id::text as id, coalesce(nullif(btrim(s.code), ''), s.external_id) as code, s.name
		from public.stores s
		where s.tenant_id = ${tenant.id}::uuid and s.active
		order by s.external_id
	`;
	return {
		id: tenant.id,
		programmeId: programme.id,
		programmeName: programme.name,
		stampsPerCard: Number(programme.stamps_per_card),
		welcomeStamps: Number(programme.welcome_stamps),
		stores,
	};
}

async function eraseCustomers(
	sql: Sql,
	tenantId: string,
	where: { readonly phones: readonly string[]; readonly mockUsers: string[] },
): Promise<Omit<CleanupCounts, "staffLogins" | "rewards">> {
	const found = await sql<{ id: string }>`
		select c.id::text as id from public.customers c
		where c.tenant_id = ${tenantId}::uuid
			and (c.phone = any(${where.phones as string[]})
				or c.id in (
					select l.customer_id from app.customer_logins l
					where l.tenant_id = ${tenantId}::uuid and l.zalo_user_id = any(${where.mockUsers})
				))
	`;
	const counts = {
		customers: 0,
		memberships: 0,
		consents: 0,
		customerLogins: 0,
	};
	for (const { id } of found) {
		const [request] = await sql<{ id: string }>`
			insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type, notes)
			values (${tenantId}::uuid, 'customer', ${id}::uuid, 'mini_app', 'deletion',
				'synthetic customer of the local loyalty trial')
			returning id::text as id
		`;
		if (request === undefined) throw new Error("no deletion request");
		const [erased] = await sql<{ result: Row }>`
			select app.dsr_erase_customer(${request.id}::uuid, null, now()) as result
		`;
		const done = (erased?.result.counts ?? {}) as Record<string, number>;
		counts.customers += Number(done.customers ?? 0);
		counts.memberships += Number(done.memberships ?? 0);
		counts.consents += Number(done.consent_records ?? 0);
		counts.customerLogins += Number(done.customer_logins ?? 0);
		await sql`
			delete from public.data_subject_requests
			where id = ${request.id}::uuid and tenant_id = ${tenantId}::uuid
		`;
	}
	const visitors = await sql<{ id: string }>`
		select u.id::text as id from auth.users u
		join app.customer_logins l on l.user_id = u.id
		where l.tenant_id = ${tenantId}::uuid
			and l.zalo_user_id = any(${where.mockUsers})
			and u.email like ${`%${CUSTOMER_LOGIN_SUFFIX}`}
	`;
	for (const login of visitors) {
		await sql`delete from auth.users where id = ${login.id}::uuid`;
	}
	counts.customerLogins += visitors.length;
	return counts;
}

async function removeStaff(sql: Sql, userIds: readonly string[]) {
	if (userIds.length === 0) return 0;
	await sql`delete from app.zalo_binding_codes where user_id = any(${userIds as string[]}::uuid[])`;
	const removed = await sql`
		delete from auth.users
		where id = any(${userIds as string[]}::uuid[])
			and email like ${`${STAFF_EMAIL_PREFIX}%${STAFF_EMAIL_DOMAIN}`}
		returning id
	`;
	return removed.length;
}

async function deleteStaleFixtures(sql: Sql, tenantId: string): Promise<void> {
	const users = await sql<{ zalo_user_id: string }>`
		select l.zalo_user_id from app.customer_logins l
		where l.tenant_id = ${tenantId}::uuid
			and l.zalo_user_id like ${`${MOCK_USER_PREFIX}%`}
			and l.created_at < now() - interval '1 hour'
	`;
	if (users.length > 0)
		await eraseCustomers(sql, tenantId, {
			phones: [],
			mockUsers: users.map((row) => row.zalo_user_id),
		});
	const staff = await sql<{ id: string }>`
		select u.id::text as id from auth.users u
		where u.email like ${`${STAFF_EMAIL_PREFIX}%${STAFF_EMAIL_DOMAIN}`}
			and u.created_at < now() - interval '1 hour'
	`;
	await removeStaff(
		sql,
		staff.map((row) => row.id),
	);
}

async function insertLogin(sql: Sql, email: string): Promise<string> {
	const userId = randomUUID();
	const password = randomBytes(18).toString("base64url");
	await sql`
		insert into auth.users (
			instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
			confirmation_token, recovery_token, email_change_token_new, email_change,
			email_change_token_current, phone_change, phone_change_token, reauthentication_token,
			is_sso_user, is_anonymous
		)
		values (
			${AUTH_INSTANCE_ID}::uuid, ${userId}::uuid, 'authenticated', 'authenticated', ${email},
			extensions.crypt(${password}, extensions.gen_salt('bf')), now(),
			'{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb, now(), now(),
			'', '', '', '', '', '', '', '', false, false
		)
	`;
	await sql`
		insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
		values (
			gen_random_uuid(), ${userId}::uuid, ${userId}, 'email',
			jsonb_build_object('sub', ${userId}::text, 'email', ${email}::text, 'email_verified', true, 'phone_verified', false),
			now(), now(), now()
		)
	`;
	return userId;
}

function saleLine(output: string, label: string): string {
	const match = output.match(new RegExp(`^\\s*${label}:\\s*(\\S+)`, "m"));
	if (match?.[1] === undefined)
		throw new Error(`the simulated till printed no ${label}:\n${output}`);
	return match[1];
}

export async function openLoyaltyFixture(): Promise<LoyaltyFixture> {
	const url = localDatabaseUrl();
	if (url === "") throw new Error("DATABASE_URL is not the local stack");
	const sql = await connect(url);
	let tenant: SimTenant;
	try {
		tenant = await loadTenant(sql);
		await deleteStaleFixtures(sql, tenant.id);
	} catch (error) {
		await sql.end({ timeout: 5 });
		throw error;
	}
	const customers: SyntheticCustomer[] = [];
	const staff: SyntheticStaff[] = [];
	const seeded: { coupon: string; mapping: string; rail: string | null }[] = [];
	const removeRewards = async (): Promise<number> => {
		let removed = 0;
		for (const reward of seeded.splice(0)) {
			const coupons = await sql`
				delete from public.coupons where id = ${reward.coupon}::uuid returning id
			`;
			removed += coupons.length;
			await sql`delete from public.coupon_rail_rewards where id = ${reward.mapping}::uuid`;
			if (reward.rail !== null)
				await sql`delete from public.coupon_rails where id = ${reward.rail}::uuid`;
		}
		return removed;
	};
	const used = new Set<string>();
	return {
		tenant,
		sql,
		async newCustomer() {
			const taken = await sql<{ phone: string }>`
				select phone from public.customers where tenant_id = ${tenant.id}::uuid and phone is not null
			`;
			for (const row of taken) used.add(row.phone);
			let phone = "";
			do {
				phone = `0900000${randomInt(100, 700)}`;
			} while (used.has(e164(phone)));
			used.add(e164(phone));
			const customer = {
				mockUser: `${MOCK_USER_PREFIX}c-${randomBytes(4).toString("hex")}`,
				mockName: "Khách thử nghiệm",
				phone,
			};
			customers.push(customer);
			return customer;
		},
		async newStaff(storeCode) {
			const store = tenant.stores.find((entry) => entry.code === storeCode);
			if (store === undefined) throw new Error(`no store ${storeCode}`);
			const suffix = randomBytes(4).toString("hex");
			const email = `${STAFF_EMAIL_PREFIX}${suffix}${STAFF_EMAIL_DOMAIN}`;
			const userId = await insertLogin(sql, email);
			await sql`
				insert into public.tenant_members (tenant_id, user_id, role, store_ids)
				values (${tenant.id}::uuid, ${userId}::uuid, 'manager', array[${store.id}::uuid])
			`;
			const member = {
				email,
				userId,
				mockUser: `${MOCK_USER_PREFIX}s-${suffix}`,
				mockName: "Quản lý thử nghiệm",
			};
			staff.push(member);
			return member;
		},
		async seedReward(storeCode, costStamps) {
			const store = tenant.stores.find((entry) => entry.code === storeCode);
			if (store === undefined) throw new Error(`no store ${storeCode}`);
			const suffix = randomBytes(3).toString("hex");
			const rewardKey = `it-${suffix}`;
			const name = `Tặng 1 ly thử nghiệm ${suffix}`;
			const discountName = `Quà thành viên thử ${suffix}`;
			const [live] = await sql<{ id: string; rail: string }>`
				select id::text as id, rail::text as rail from public.coupon_rails
				where store_id = ${store.id}::uuid and active_until is null
			`;
			if (live !== undefined && live.rail !== "pos_payment_discount")
				throw new Error(
					`${storeCode} runs the rail ${live.rail}; the trial needs pos_payment_discount`,
				);
			let rail: string | null = null;
			if (live === undefined) {
				const [created] = await sql<{ id: string }>`
					insert into public.coupon_rails (tenant_id, store_id, rail)
					values (${tenant.id}::uuid, ${store.id}::uuid, 'pos_payment_discount')
					returning id::text as id
				`;
				rail = created?.id ?? null;
			}
			const [mapping] = await sql<{ id: string }>`
				insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, einvoice_display)
				values (${tenant.id}::uuid, ${store.id}::uuid, ${rewardKey}, ${discountName}, 'discount')
				returning id::text as id
			`;
			const [coupon] = await sql<{ id: string }>`
				insert into public.coupons (tenant_id, programme_id, reward_key, name, description, reward_kind,
					cost_stamps, cost_points, hold_hours, store_ids, status, active)
				values (${tenant.id}::uuid, ${tenant.programmeId}::uuid, ${rewardKey}, ${name},
					'Phần thưởng của bộ kiểm thử, không phải ưu đãi thật.', 'free_item',
					${costStamps}, 0, 24, array[${store.id}::uuid], 'active', true)
				returning id::text as id
			`;
			if (mapping === undefined || coupon === undefined)
				throw new Error("the trial reward was not created");
			seeded.push({ coupon: coupon.id, mapping: mapping.id, rail });
			return {
				couponId: coupon.id,
				rewardKey,
				name,
				discountName,
				costStamps,
				storeCode,
			};
		},
		async quietStore(storeCode) {
			const store = tenant.stores.find((entry) => entry.code === storeCode);
			if (store === undefined) throw new Error(`no store ${storeCode}`);
			const [row] = await sql<{ wait_ms: number | null }>`
				select ceil(extract(epoch from (
					max(i.sold_at) + make_interval(mins => p.checkin_window_before_minutes) + interval '5 seconds' - now()
				)) * 1000)::integer as wait_ms
				from public.invoices i
				join public.loyalty_programmes p on p.id = ${tenant.programmeId}::uuid
				where i.store_id = ${store.id}::uuid
					and i.status = 'completed'
					and i.sold_at > now() - make_interval(mins => p.checkin_window_before_minutes)
					and not exists (select 1 from public.loyalty_ledger l where l.invoice_id = i.id and l.entry_kind = 'earn')
					and not exists (select 1 from public.pending_checkins o where o.matched_invoice_id = i.id)
					and not exists (select 1 from public.receipt_claims r where r.invoice_id = i.id)
				group by p.checkin_window_before_minutes
			`;
			const wait = Math.max(
				0,
				Math.min(Number(row?.wait_ms ?? 0), QUIET_MAX_MS),
			);
			if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
			return wait;
		},
		async redemptionState(reward) {
			const [row] = await sql<Row>`
				select
					count(*) filter (where state = 'held')::integer as held,
					count(*) filter (where verified_at is not null)::integer as verified,
					count(*) filter (where state = 'confirmed')::integer as confirmed,
					count(*) filter (where state = 'released')::integer as released
				from public.redemptions where coupon_id = ${reward.couponId}::uuid
			`;
			return {
				held: Number(row?.held ?? 0),
				verified: Number(row?.verified ?? 0),
				confirmed: Number(row?.confirmed ?? 0),
				released: Number(row?.released ?? 0),
			};
		},
		async customerState(customer) {
			const [row] = await sql<Row>`
				with c as (
					select c.id from public.customers c
					where c.tenant_id = ${tenant.id}::uuid and c.phone = ${e164(customer.phone)}
				),
				m as (select m.id from public.memberships m where m.customer_id in (select id from c))
				select
					(select count(*) from c)::integer as customers,
					(select count(*) from m)::integer as memberships,
					coalesce((
						select sum(l.stamp_delta) from public.loyalty_ledger l
						where l.membership_id in (select id from m) and l.entry_kind = 'adjust' and l.reason = 'welcome'
					), 0)::integer as welcome_stamps,
					coalesce((
						select jsonb_object_agg(x.path, x.n) from (
							select l.matched_path as path, count(*)::integer as n from public.loyalty_ledger l
							where l.membership_id in (select id from m) and l.entry_kind = 'earn'
							group by l.matched_path
						) x
					), '{}'::jsonb) as earns_by_path,
					(select count(*) from public.receipt_claims r where r.membership_id in (select id from m) and r.status = 'matched')::integer as matched_claims,
					(select count(*) from public.pending_checkins k where k.membership_id in (select id from m) and k.status = 'matched')::integer as matched_checkins,
					(select count(*) from public.consent_records r where r.subject_type = 'customer' and r.subject_id in (select id from c) and r.purpose = 'loyalty' and r.revoked_at is null)::integer as loyalty_consents,
					(select count(*) from public.consent_records r where r.subject_type = 'customer' and r.subject_id in (select id from c) and r.purpose = 'marketing' and r.revoked_at is null)::integer as marketing_consents
			`;
			return {
				customers: Number(row?.customers ?? 0),
				memberships: Number(row?.memberships ?? 0),
				welcomeStamps: Number(row?.welcome_stamps ?? 0),
				earnsByPath: (row?.earns_by_path ?? {}) as Record<string, number>,
				matchedClaims: Number(row?.matched_claims ?? 0),
				matchedCheckins: Number(row?.matched_checkins ?? 0),
				loyaltyConsents: Number(row?.loyalty_consents ?? 0),
				marketingConsents: Number(row?.marketing_consents ?? 0),
			};
		},
		async ringSale(input) {
			const args = [
				SALE_SCRIPT,
				"--tenant",
				SIM_TENANT,
				"--amount",
				String(input.amount),
				"--store",
				input.store,
				...(input.discountName === undefined
					? []
					: ["--discount-name", input.discountName]),
				...(input.discountAmount === undefined
					? []
					: ["--discount-amount", String(input.discountAmount)]),
			];
			const result = spawnSync(process.execPath, args, {
				cwd: ROOT,
				env: { ...process.env, DATABASE_URL: url },
				encoding: "utf8",
				timeout: SALE_TIMEOUT_MS,
				windowsHide: true,
			});
			const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
			if (result.status !== 0)
				throw new Error(
					`pnpm loyalty:sale exited with ${result.status}:\n${output}`,
				);
			return {
				store: input.store,
				businessDate: saleLine(output, "business date"),
				receiptNo: saleLine(output, "receipt no"),
				amount: input.amount,
				output,
			};
		},
		async cleanup() {
			try {
				const counts = await eraseCustomers(sql, tenant.id, {
					phones: customers.map((customer) => e164(customer.phone)),
					mockUsers: customers.map((customer) => customer.mockUser),
				});
				const staffLogins = await removeStaff(
					sql,
					staff.map((member) => member.userId),
				);
				const rewards = await removeRewards();
				return { ...counts, staffLogins, rewards };
			} finally {
				await sql.end({ timeout: 5 });
			}
		},
	};
}
