import { spawnSync } from "node:child_process";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { RpcCredentials } from "@fnb/zalo-mini/testing/network-scan";
import { localApiUrl, localDatabaseUrl, ROOT } from "./local-loop";

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
	readonly password: string;
	readonly mockUser: string;
	readonly mockName: string;
	readonly userId: string;
}

export type StoreMode = "pos_sync" | "staff";

export interface SeededMember extends SyntheticCustomer {
	readonly membershipId: string;
}

export interface BillRow {
	readonly id: string;
	readonly billNo: string;
	readonly total: number;
	readonly state: string;
	readonly evidenceLevel: number;
	readonly queueReason: string | null;
	readonly earns: number;
	readonly confirms: number;
	readonly clawbacks: number;
	readonly stamps: number;
	readonly points: number;
	readonly customerAnswers: number;
	readonly source: string;
	readonly autoApproved: boolean;
	readonly decisionReason: string | null;
	readonly staffAnswers: number;
}

/** what a store of loyalty-sim may be changed to for a counter-claim spec; cleanup puts every changed value back */
export interface ClaimSettings {
	readonly selfClaim?: boolean;
	readonly counterTtlSeconds?: number;
	readonly autoApproveMaxAmount?: number;
	readonly autoApprovePerDay?: number;
}

/** a counter code made by the fixture with a chosen life, relative to now */
export interface CounterCodeWindow {
	/** seconds since the code was issued; negative: issued in the future */
	readonly issuedAgo: number;
	/** seconds until the code expires; negative: expired that many seconds ago */
	readonly expiresIn: number;
}

export interface SeededCounterCode {
	readonly id: string;
	readonly token: string;
	/** the QR text a customer scans: fnb-counter:1:<store code>:<token> */
	readonly payload: string;
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
	readonly openDeletionRequests: number;
}

export interface DeletionDueDates {
	readonly firstResponse: string;
	readonly completion: string;
}

export interface CleanupCounts {
	readonly customers: number;
	readonly memberships: number;
	readonly consents: number;
	readonly customerLogins: number;
	readonly staffLogins: number;
	readonly rewards: number;
	readonly stores: number;
	readonly auditEvents: number;
	readonly alerts: number;
	readonly counterCodes: number;
	readonly attempts: number;
}

export interface LoyaltyFixture {
	readonly tenant: SimTenant;
	readonly sql: Sql;
	newCustomer(): Promise<SyntheticCustomer>;
	newStaff(
		storeCode: string,
		role?: "manager" | "staff",
		alsoStores?: readonly string[],
	): Promise<SyntheticStaff>;
	/** puts a store of loyalty-sim in a confirmation mode (and no random audit); cleanup puts every changed store back */
	setStoreMode(storeCode: string, mode: StoreMode): Promise<void>;
	/** changes the counter-claim settings of a store of loyalty-sim; cleanup puts every changed store back to the baseline */
	configureStore(storeCode: string, settings: ClaimSettings): Promise<void>;
	/** a counter code row with the given life (the function would issue it at now), for window and partition tests */
	insertCounterCode(
		storeCode: string,
		window: CounterCodeWindow,
	): Promise<SeededCounterCode>;
	/** moves the life of a counter code relative to now (a code issued earlier has less of its life left) */
	moveCounterCode(token: string, window: CounterCodeWindow): Promise<void>;
	/** the session of a synthetic staff login as the data API sees it (a password sign-in), for role checks by RPC */
	staffSession(member: SyntheticStaff): Promise<RpcCredentials>;
	/** a customer and a joined membership made by the loyalty functions, for specs that do not drive the join screens */
	seedMember(storeCode: string): Promise<SeededMember>;
	/** a fresh single-use member code of a seeded member at a store, as the customer app would show it */
	issueCode(member: SeededMember, storeCode: string): Promise<string>;
	/** the bills (path E) of a customer with what each one wrote to the ledger */
	bills(customer: SyntheticCustomer): Promise<BillRow[]>;
	storeId(storeCode: string): string;
	/** whether a member code is still a live single-use code at a store (a later code of the member replaces it) */
	codeIsLive(storeCode: string, code: string): Promise<boolean>;
	seedReward(storeCode: string, costStamps: number): Promise<SeededReward>;
	quietStore(storeCode: string): Promise<number>;
	redemptionState(reward: SeededReward): Promise<RedemptionState>;
	customerState(customer: SyntheticCustomer): Promise<CustomerState>;
	deletionDueDates(customer: SyntheticCustomer): Promise<DeletionDueDates>;
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
): Promise<
	Omit<
		CleanupCounts,
		| "staffLogins"
		| "rewards"
		| "stores"
		| "auditEvents"
		| "alerts"
		| "counterCodes"
		| "attempts"
	>
> {
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
		const [asked] = await sql<{ id: string }>`
			select r.id::text as id from public.data_subject_requests r
			where r.tenant_id = ${tenantId}::uuid and r.subject_type = 'customer'
				and r.subject_id = ${id}::uuid and r.request_type = 'deletion'
				and r.status in ('received', 'in_progress')
			order by r.received_at desc
			limit 1
		`;
		const [request] =
			asked === undefined
				? await sql<{ id: string }>`
						insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type, notes)
						values (${tenantId}::uuid, 'customer', ${id}::uuid, 'mini_app', 'deletion',
							'synthetic customer of the local loyalty trial')
						returning id::text as id
					`
				: [asked];
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

async function insertLogin(
	sql: Sql,
	email: string,
): Promise<{ userId: string; password: string }> {
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
	return { userId, password };
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
		// the baseline of loyalty-sim is the POS sync: heal a store a crashed bill spec left in staff mode
		await sql`
			update public.loyalty_store_settings
			set confirmation = 'pos_sync', self_claim = false, counter_code_ttl_seconds = 90,
				auto_approve_max_amount = 0, auto_approve_per_day = 0
			where tenant_id = ${tenant.id}::uuid
				and (confirmation <> 'pos_sync' or self_claim or counter_code_ttl_seconds <> 90
					or auto_approve_max_amount <> 0 or auto_approve_per_day <> 0)
		`;
		await sql`delete from public.loyalty_counter_codes where tenant_id = ${tenant.id}::uuid`;
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
	const [opened] = await sql<{ at: string }>`select now()::text as at`;
	const startedAt = opened?.at ?? new Date().toISOString();
	const removeBillTraces = async (): Promise<{
		auditEvents: number;
		alerts: number;
	}> => {
		const phones = customers.map((customer) => e164(customer.phone));
		const staffIds = staff.map((member) => member.userId);
		const audits = await sql`
			delete from public.loyalty_audit_events e
			where e.tenant_id = ${tenant.id}::uuid
				and (e.actor = any(${staffIds}::uuid[])
					or e.membership_id in (
						select m.id from public.memberships m join public.customers c on c.id = m.customer_id
						where m.tenant_id = ${tenant.id}::uuid and c.phone = any(${phones})
					))
			returning e.id
		`;
		const alerts = await sql`
			delete from public.alert_events
			where tenant_id = ${tenant.id}::uuid and rule_key = 'loyalty_staff_anomaly'
				and opened_at >= ${startedAt}::timestamptz
			returning id
		`;
		return { auditEvents: audits.length, alerts: alerts.length };
	};
	const changedStores = new Map<string, number>();
	const claimStores = new Set<string>();
	const restoreStores = async (): Promise<number> => {
		let restored = 0;
		for (const [storeId, auditPct] of changedStores) {
			const rows = await sql`
				update public.loyalty_store_settings
				set confirmation = 'pos_sync', bill_audit_sample_pct = ${auditPct}
				where store_id = ${storeId}::uuid
				returning store_id
			`;
			restored += rows.length;
		}
		changedStores.clear();
		for (const storeId of claimStores) {
			await sql`
				update public.loyalty_store_settings
				set self_claim = false, counter_code_ttl_seconds = 90, auto_approve_max_amount = 0, auto_approve_per_day = 0
				where store_id = ${storeId}::uuid
			`;
		}
		claimStores.clear();
		return restored;
	};
	/** the counter codes of the tenant and the counter-claim attempt counters, which only these specs write */
	const removeCounterTraces = async (): Promise<{
		counterCodes: number;
		attempts: number;
	}> => {
		const codes = await sql`
			delete from public.loyalty_counter_codes where tenant_id = ${tenant.id}::uuid returning id
		`;
		const attempts = await sql`
			delete from app.code_attempts
			where tenant_id = ${tenant.id}::uuid and endpoint = 'customer_counter_claim'
			returning endpoint
		`;
		return { counterCodes: codes.length, attempts: attempts.length };
	};
	const storeOf = (storeCode: string): SimStore => {
		const store = tenant.stores.find((entry) => entry.code === storeCode);
		if (store === undefined) throw new Error(`no store ${storeCode}`);
		return store;
	};
	const newCustomer = async (): Promise<SyntheticCustomer> => {
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
	};
	return {
		storeId: (storeCode) => storeOf(storeCode).id,
		async codeIsLive(storeCode, code) {
			const [row] = await sql<{ live: boolean }>`
				select (status = 'issued' and expires_at > now()) as live from public.pending_checkins
				where store_id = ${storeOf(storeCode).id}::uuid and code = ${code}
				order by created_at desc limit 1
			`;
			return row?.live === true;
		},
		tenant,
		sql,
		newCustomer,
		async configureStore(storeCode, settings) {
			const store = storeOf(storeCode);
			claimStores.add(store.id);
			await sql`
				update public.loyalty_store_settings
				set self_claim = coalesce(${settings.selfClaim ?? null}::boolean, self_claim),
					counter_code_ttl_seconds = coalesce(${settings.counterTtlSeconds ?? null}::smallint, counter_code_ttl_seconds),
					auto_approve_max_amount = coalesce(${settings.autoApproveMaxAmount ?? null}::numeric, auto_approve_max_amount),
					auto_approve_per_day = coalesce(${settings.autoApprovePerDay ?? null}::smallint, auto_approve_per_day)
				where store_id = ${store.id}::uuid
			`;
		},
		async insertCounterCode(storeCode, window) {
			const store = storeOf(storeCode);
			const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
			let token = "";
			for (let i = 0; i < 12; i += 1)
				token += alphabet[randomInt(alphabet.length)];
			const [row] = await sql<{ id: string }>`
				insert into public.loyalty_counter_codes (tenant_id, store_id, token, issued_at, expires_at)
				values (${tenant.id}::uuid, ${store.id}::uuid, ${token},
					now() - make_interval(secs => ${window.issuedAgo}::float8),
					now() + make_interval(secs => ${window.expiresIn}::float8))
				returning id::text as id
			`;
			if (row === undefined) throw new Error("no counter code was made");
			claimStores.add(store.id);
			return {
				id: row.id,
				token,
				payload: `fnb-counter:1:${storeCode}:${token}`,
			};
		},
		async moveCounterCode(token, window) {
			await sql`
				update public.loyalty_counter_codes
				set issued_at = now() - make_interval(secs => ${window.issuedAgo}::float8),
					expires_at = now() + make_interval(secs => ${window.expiresIn}::float8)
				where tenant_id = ${tenant.id}::uuid and token = ${token}
			`;
		},
		async staffSession(member) {
			const api = localApiUrl();
			const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
			if (api === "" || key === "")
				throw new Error("the local API address and publishable key are needed");
			const response = await fetch(`${api}/auth/v1/token?grant_type=password`, {
				method: "POST",
				headers: { "content-type": "application/json", apikey: key },
				body: JSON.stringify({
					email: member.email,
					password: member.password,
				}),
			});
			const body = (await response.json()) as { access_token?: string };
			if (!response.ok || body.access_token === undefined)
				throw new Error(`the staff sign-in answered ${response.status}`);
			return {
				url: `${api}/rest/v1/rpc/staff_recent_bills`,
				headers: { authorization: `Bearer ${body.access_token}`, apikey: key },
			};
		},
		async setStoreMode(storeCode, mode) {
			const store = storeOf(storeCode);
			const [before] = await sql<{ pct: string }>`
				select bill_audit_sample_pct::text as pct from public.loyalty_store_settings
				where store_id = ${store.id}::uuid
			`;
			if (before === undefined)
				throw new Error(`${storeCode} has no loyalty settings`);
			if (!changedStores.has(store.id))
				changedStores.set(store.id, Number(before.pct));
			await sql`
				update public.loyalty_store_settings
				set confirmation = ${mode}, bill_audit_sample_pct = 0
				where store_id = ${store.id}::uuid
			`;
		},
		async seedMember(storeCode) {
			const store = storeOf(storeCode);
			const customer = await newCustomer();
			const [brand] = await sql<{ id: string }>`
				select id::text as id from public.brands
				where tenant_id = ${tenant.id}::uuid and brand_key = ${SIM_BRAND}
			`;
			if (brand === undefined) throw new Error(`no brand ${SIM_BRAND}`);
			const [made] = await sql<{ id: string }>`
				select app.loyalty_customer_for_phone(${tenant.id}::uuid, ${customer.phone}, now())::text as id
			`;
			const [joined] = await sql<{ id: string }>`
				select app.loyalty_join(${tenant.id}::uuid, ${made?.id ?? null}::uuid, 'mini_app', ${store.id}::uuid,
					${brand.id}::uuid, ${customer.mockUser}, now())::text as id
			`;
			if (joined === undefined) throw new Error("the member was not joined");
			return { ...customer, membershipId: joined.id };
		},
		async issueCode(member, storeCode) {
			const store = storeOf(storeCode);
			const [issued] = await sql<{ code: string }>`
				select code from app.loyalty_issue_checkin_code(${member.membershipId}::uuid, ${store.id}::uuid, now())
			`;
			if (issued === undefined) throw new Error("no member code was issued");
			return issued.code;
		},
		async bills(customer) {
			const rows = await sql<Row>`
				select b.id::text as id, b.bill_no, b.total::float8 as total, b.state, b.evidence_level, b.queue_reason,
					(select count(*) from public.loyalty_ledger l where l.bill_id = b.id and l.entry_kind = 'earn')::integer as earns,
					(select count(*) from public.loyalty_ledger l where l.bill_id = b.id and l.entry_kind = 'confirm')::integer as confirms,
					(select count(*) from public.loyalty_ledger l where l.bill_id = b.id and l.entry_kind = 'clawback')::integer as clawbacks,
					coalesce((select sum(l.stamp_delta) from public.loyalty_ledger l where l.bill_id = b.id), 0)::integer as stamps,
					coalesce((select sum(l.point_delta) from public.loyalty_ledger l where l.bill_id = b.id), 0)::integer as points,
					(select count(*) from public.bill_confirmations c where c.bill_id = b.id and c.source = 'customer')::integer as customer_answers,
					b.source, b.auto_approved, b.decision_reason,
					(select count(*) from public.bill_confirmations c where c.bill_id = b.id and c.source = 'staff')::integer as staff_answers
				from public.bill_captures b
				join public.memberships m on m.id = b.membership_id
				join public.customers c on c.id = m.customer_id
				where b.tenant_id = ${tenant.id}::uuid and c.phone = ${e164(customer.phone)}
				order by b.created_at, b.bill_no
			`;
			return rows.map((row) => ({
				id: String(row.id),
				billNo: String(row.bill_no),
				total: Number(row.total),
				state: String(row.state),
				evidenceLevel: Number(row.evidence_level),
				queueReason:
					row.queue_reason === null ? null : String(row.queue_reason),
				earns: Number(row.earns),
				confirms: Number(row.confirms),
				clawbacks: Number(row.clawbacks),
				stamps: Number(row.stamps),
				points: Number(row.points),
				customerAnswers: Number(row.customer_answers),
				source: String(row.source),
				autoApproved: row.auto_approved === true,
				decisionReason:
					row.decision_reason === null ? null : String(row.decision_reason),
				staffAnswers: Number(row.staff_answers),
			}));
		},
		async newStaff(storeCode, role = "manager", alsoStores = []) {
			const stores = [storeCode, ...alsoStores].map((code) => storeOf(code).id);
			const suffix = randomBytes(4).toString("hex");
			const email = `${STAFF_EMAIL_PREFIX}${suffix}${STAFF_EMAIL_DOMAIN}`;
			const { userId, password } = await insertLogin(sql, email);
			await sql`
				insert into public.tenant_members (tenant_id, user_id, role, store_ids)
				values (${tenant.id}::uuid, ${userId}::uuid, ${role}::public.tenant_role, ${stores}::uuid[])
			`;
			const member = {
				email,
				password,
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
					(select count(*) from public.consent_records r where r.subject_type = 'customer' and r.subject_id in (select id from c) and r.purpose = 'marketing' and r.revoked_at is null)::integer as marketing_consents,
					(select count(*) from public.data_subject_requests r where r.tenant_id = ${tenant.id}::uuid and r.subject_type = 'customer' and r.subject_id in (select id from c) and r.request_type = 'deletion' and r.status = 'received' and r.contact = 'mini_app' and r.completion_due_at > r.first_response_due_at)::integer as open_deletion_requests
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
				openDeletionRequests: Number(row?.open_deletion_requests ?? 0),
			};
		},
		async deletionDueDates(customer) {
			const [row] = await sql<Row>`
				select
					to_char(r.first_response_due_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY') as first_response,
					to_char(r.completion_due_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY') as completion
				from public.data_subject_requests r
				join public.customers c on c.id = r.subject_id
				where r.tenant_id = ${tenant.id}::uuid and c.phone = ${e164(customer.phone)}
					and r.subject_type = 'customer' and r.request_type = 'deletion' and r.status = 'received'
			`;
			if (row === undefined) throw new Error("no open deletion request");
			return {
				firstResponse: String(row.first_response),
				completion: String(row.completion),
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
				const stores = await restoreStores();
				const traces = await removeBillTraces();
				const counter = await removeCounterTraces();
				const counts = await eraseCustomers(sql, tenant.id, {
					phones: customers.map((customer) => e164(customer.phone)),
					mockUsers: customers.map((customer) => customer.mockUser),
				});
				const staffLogins = await removeStaff(
					sql,
					staff.map((member) => member.userId),
				);
				const rewards = await removeRewards();
				return {
					...counts,
					staffLogins,
					rewards,
					stores,
					...traces,
					...counter,
				};
			} finally {
				await sql.end({ timeout: 5 });
			}
		},
	};
}
