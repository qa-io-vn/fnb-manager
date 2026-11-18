import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ZALO_PACKAGE = new URL(
	"../../../packages/zalo/package.json",
	import.meta.url,
);
const LOOPBACK_DATABASE =
	/^postgres(ql)?:\/\/[^@/]+@(127\.0\.0\.1|localhost)(:\d+)?\//;
const AUTH_INSTANCE_ID = "00000000-0000-0000-0000-000000000000";
const STAFF_LOGIN_SUFFIX = "@zalo-staff.invalid";
const FIXTURE_PREFIX = "zalo-it-";
const FIXTURE_NAME = "Staff pairing fixture";
const FORBIDDEN_SLUGS: readonly string[] = [
	"live-local",
	"mock-local",
	"demo-fnb",
];

type Row = Record<string, unknown>;

interface Sql {
	<T extends Row = Row>(
		strings: TemplateStringsArray,
		...values: readonly unknown[]
	): Promise<T[]>;
	begin<T>(run: (sql: Sql) => Promise<T>): Promise<T>;
	end(options?: { readonly timeout?: number }): Promise<void>;
}

export interface FixtureText {
	readonly version: string;
	readonly title: string;
}

export interface PairingState {
	readonly rosterActive: boolean;
	readonly identityPaired: boolean;
	readonly staffMember: boolean;
	readonly memberStores: number;
	readonly consentNamesNotice: boolean;
	readonly consentEvidenceKeys: string;
	readonly revokedConsents: number;
	readonly liveCodes: number;
}

export interface PairingFixture {
	readonly slug: string;
	readonly brandKey: string;
	readonly ownerEmail: string;
	readonly mockUser: string;
	readonly mockName: string;
	readonly appTitle: string;
	readonly notice: FixtureText;
	readonly privacy: FixtureText;
	readonly terms: FixtureText;
	unbindMockUser(): Promise<number>;
	issueCode(): Promise<string>;
	publishNewNotice(): Promise<FixtureText>;
	state(noticeVersion: string): Promise<PairingState>;
	cleanup(): Promise<void>;
}

export function localDatabaseUrl(): string {
	const file = `${ROOT}.env`;
	const fromFile = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
	const url = (process.env.DATABASE_URL || fromFile.DATABASE_URL || "").trim();
	return LOOPBACK_DATABASE.test(url) ? url : "";
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

function asOwner(sql: Sql, ownerId: string) {
	const claims = JSON.stringify({ sub: ownerId, role: "authenticated" });
	return async <T extends Row>(
		run: (tx: Sql) => Promise<T[]>,
	): Promise<T | undefined> =>
		sql.begin(async (tx) => {
			await tx`select set_config('request.jwt.claims', ${claims}, true)`;
			const [row] = await run(tx);
			return row;
		});
}

async function deleteStaleFixtures(sql: Sql): Promise<void> {
	const stale = await sql<{ id: string }>`
		select id::text as id from public.tenants
		where slug like ${`${FIXTURE_PREFIX}%`} and name like ${`${FIXTURE_NAME}%`}
			and created_at < now() - interval '1 hour'
	`;
	for (const tenant of stale) await removeTenant(sql, tenant.id);
}

async function removeTenant(sql: Sql, tenantId: string): Promise<void> {
	const logins = await sql<{ id: string }>`
		select u.id::text as id from auth.users u
		where u.id in (
			select r.user_id from public.staff_roster r where r.tenant_id = ${tenantId}::uuid
			union
			select m.user_id from public.tenant_members m where m.tenant_id = ${tenantId}::uuid
		)
		and (u.email like ${`%${STAFF_LOGIN_SUFFIX}`} or u.email like ${`${FIXTURE_PREFIX}%@example.com`})
	`;
	const [tenant] = await sql<{ slug: string }>`
		select slug from public.tenants where id = ${tenantId}::uuid
	`;
	if (
		tenant === undefined ||
		!tenant.slug.startsWith(FIXTURE_PREFIX) ||
		FORBIDDEN_SLUGS.includes(tenant.slug)
	) {
		return;
	}
	await sql`delete from public.tenants where id = ${tenantId}::uuid`;
	for (const login of logins) {
		await sql`delete from auth.users where id = ${login.id}::uuid`;
	}
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

const NOTICE_BODY = [
	"## Mục đích",
	"Văn bản kiểm thử của bộ kiểm thử, không phải văn bản pháp lý.",
	"",
	"- Mã định danh Zalo trong ứng dụng",
	"- Tên hiển thị",
].join("\n");

export async function createPairingFixture(): Promise<PairingFixture> {
	const url = localDatabaseUrl();
	if (url === "") throw new Error("DATABASE_URL is not the local stack");
	const sql = await connect(url);
	await deleteStaleFixtures(sql);
	const suffix = randomBytes(4).toString("hex");
	const slug = `${FIXTURE_PREFIX}${suffix}`;
	const brandNumber = randomInt(500, 1000);
	const brandKey = `brand-${brandNumber}`;
	const ownerEmail = `${slug}-owner@example.com`;
	const mockUser = `mock-it-${suffix}`;
	const appTitle = "Nhân viên Quán Kiểm Thử";
	const notice = {
		version: `it-notice-${suffix}-1`,
		title: "Thông báo cho nhân viên (bản kiểm thử)",
	};
	const privacy = {
		version: `it-privacy-${suffix}`,
		title: "Chính sách quyền riêng tư (bản kiểm thử)",
	};
	const terms = {
		version: `it-terms-${suffix}`,
		title: "Điều khoản sử dụng (bản kiểm thử)",
	};
	const [tenant] = await sql<{ id: string }>`
		insert into public.tenants (slug, name) values (${slug}, ${`${FIXTURE_NAME} ${suffix}`})
		returning id::text as id
	`;
	if (tenant === undefined)
		throw new Error("the fixture tenant was not created");
	const tenantId = tenant.id;
	let ownerId = "";
	let appId = "";
	let rosterId = "";
	const cleanup = async () => {
		try {
			await removeTenant(sql, tenantId);
		} finally {
			await sql.end({ timeout: 5 });
		}
	};
	try {
		const [account] = await sql<{ id: string }>`
			insert into public.pos_accounts (tenant_id, connector, account_key, display_name)
			values (${tenantId}::uuid, 'mock', ${`${slug}-account`}, 'Synthetic account')
			returning id::text as id
		`;
		const storeIds: string[] = [];
		for (const number of [1, 2]) {
			const [store] = await sql<{ id: string }>`
				insert into public.stores (tenant_id, pos_account_id, external_id, name)
				values (${tenantId}::uuid, ${account?.id ?? ""}::uuid, ${`${slug}-store-${number}`},
					${`Cửa hàng kiểm thử ${number}`})
				returning id::text as id
			`;
			storeIds.push(store?.id ?? "");
		}
		const [brand] = await sql<{ id: string }>`
			insert into public.brands (tenant_id, brand_key, display_name, store_ids)
			values (${tenantId}::uuid, ${brandKey}, 'Synthetic brand',
				array(select jsonb_array_elements_text(${JSON.stringify(storeIds)}::text::jsonb)::uuid))
			returning id::text as id
		`;
		const [app] = await sql<{ id: string }>`
			insert into public.zalo_apps (tenant_id, brand_id, external_id, secret_name)
			values (${tenantId}::uuid, ${brand?.id ?? ""}::uuid, ${`mock-app-${suffix}`},
				${`ZALO_APP_SECRET_IT_${brandNumber}`})
			returning id::text as id
		`;
		appId = app?.id ?? "";
		await sql`
			insert into public.mini_apps (tenant_id, brand_id, kind, external_id, browsable, title,
				header_title_vi, header_title_en, header_color_light, header_color_dark,
				text_color_light, text_color_dark)
			values (${tenantId}::uuid, ${brand?.id ?? ""}::uuid, 'staff', ${`mock-mini-${suffix}`}, false,
				${appTitle}, 'Quán Kiểm Thử', 'Test Shop', '#0A6B56', '#17161A', 'white', 'white')
		`;
		ownerId = await insertLogin(sql, ownerEmail);
		await sql`
			insert into public.tenant_members (tenant_id, user_id, role, store_ids)
			values (${tenantId}::uuid, ${ownerId}::uuid, 'owner', null)
		`;
		for (const [kind, text, body] of [
			["staff_notice", notice, NOTICE_BODY],
			[
				"privacy_notice",
				privacy,
				"Văn bản kiểm thử, không phải văn bản pháp lý.",
			],
			[
				"mini_app_terms",
				terms,
				"Văn bản kiểm thử, không phải văn bản pháp lý.",
			],
		] as const) {
			await sql`
				insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
				values (${tenantId}::uuid, ${kind}::public.legal_document_kind, 'vi', ${text.version}, ${text.title},
					${body}, 'published', now() - interval '1 minute')
			`;
		}
		const owner = asOwner(sql, ownerId);
		const roster = await owner<{ id: string }>(
			(tx) => tx`
				select public.add_staff(${tenantId}::uuid, 'Nhân viên thử', 'staff',
					array[${storeIds[0] ?? ""}::uuid])::text as id
			`,
		);
		rosterId = roster?.id ?? "";
	} catch (error) {
		await cleanup();
		throw error;
	}
	const owner = asOwner(sql, ownerId);
	return {
		slug,
		brandKey,
		ownerEmail,
		mockUser,
		mockName: "Nhân viên thử",
		appTitle,
		notice,
		privacy,
		terms,
		async unbindMockUser() {
			const removed = await sql`
				delete from public.zalo_identities
				where zalo_app_id = ${appId}::uuid and zalo_user_id = ${mockUser}
				returning id
			`;
			return removed.length;
		},
		async issueCode() {
			const row = await owner<{ code: string }>(
				(tx) => tx`select public.issue_pairing_code(${rosterId}::uuid) as code`,
			);
			if (row === undefined) throw new Error("no pairing code was issued");
			return row.code;
		},
		async publishNewNotice() {
			const next = {
				version: `it-notice-${suffix}-2`,
				title: "Thông báo cho nhân viên (bản kiểm thử, phiên bản mới)",
			};
			const [draft] = await sql<{ id: string }>`
				insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status)
				values (${tenantId}::uuid, 'staff_notice', 'vi', ${next.version}, ${next.title}, ${NOTICE_BODY}, 'draft')
				returning id::text as id
			`;
			await owner(
				(tx) =>
					tx`select public.publish_legal_document(${draft?.id ?? ""}::uuid)::text as id`,
			);
			return next;
		},
		async state(noticeVersion) {
			const [row] = await sql<Row>`
				select
					r.status = 'active' as roster_active,
					exists (
						select 1 from public.zalo_identities i
						where i.zalo_app_id = ${appId}::uuid and i.zalo_user_id = ${mockUser}
							and i.user_id = r.user_id
					) as identity_paired,
					exists (
						select 1 from public.tenant_members m
						where m.tenant_id = r.tenant_id and m.user_id = r.user_id and m.role = 'staff'
					) as staff_member,
					coalesce((
						select cardinality(m.store_ids) from public.tenant_members m
						where m.tenant_id = r.tenant_id and m.user_id = r.user_id
					), 0) as member_stores,
					exists (
						select 1 from public.consent_records c
						where c.tenant_id = r.tenant_id and c.subject_type = 'staff' and c.subject_id = r.user_id
							and c.purpose = 'staff_ops' and c.revoked_at is null
							and c.policy_version = ${noticeVersion} and c.channel = 'mini_app'
					) as consent_names_notice,
					coalesce((
						select string_agg(key, ',' order by key)
						from public.consent_records c, jsonb_object_keys(c.evidence) as key
						where c.tenant_id = r.tenant_id and c.subject_id = r.user_id
							and c.purpose = 'staff_ops' and c.revoked_at is null
					), '') as evidence_keys,
					(
						select count(*) from public.consent_records c
						where c.tenant_id = r.tenant_id and c.subject_id = r.user_id
							and c.purpose = 'staff_ops' and c.revoked_at is not null
					)::integer as revoked_consents,
					(select count(*) from app.staff_pairing_codes p where p.roster_id = r.id)::integer as live_codes
				from public.staff_roster r
				where r.id = ${rosterId}::uuid
			`;
			return {
				rosterActive: row?.roster_active === true,
				identityPaired: row?.identity_paired === true,
				staffMember: row?.staff_member === true,
				memberStores: Number(row?.member_stores ?? 0),
				consentNamesNotice: row?.consent_names_notice === true,
				consentEvidenceKeys: String(row?.evidence_keys ?? ""),
				revokedConsents: Number(row?.revoked_consents ?? 0),
				liveCodes: Number(row?.live_codes ?? 0),
			};
		},
		cleanup,
	};
}
