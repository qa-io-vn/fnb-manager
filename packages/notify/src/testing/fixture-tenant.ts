import { randomBytes, randomUUID } from "node:crypto";
import { createMockConnector } from "@fnb/connector-mock";
import { shiftIsoDate } from "@fnb/core";
import { SyncEngine } from "@fnb/sync";
import { PostgresSyncRepository } from "@fnb/sync/postgres";
import type { Sql } from "postgres";
import { createAdapterRegistry } from "../channels/registry.js";
import { FIXTURE_TENANT_SLUG_PREFIX } from "../channels/secrets.js";
import {
	CLI_CYCLE_LIMITS,
	type CycleBudgetLimits,
	createCycleBudget,
} from "../dispatch/budget.js";
import { runNotifyCycle } from "../dispatch/cycle.js";
import type { CycleReport } from "../dispatch/report.js";
import type { NotifyRepository } from "../dispatch/repository.js";
import {
	destinationState,
	issueLinkCode,
	prepareBotDestination,
} from "../postgres/destinations.js";
import { createPostgresDigestBuilder } from "../postgres/digest-builder.js";
import { createPostgresNotifyRepository } from "../postgres/repository.js";
import { localIsoDate } from "../render/format.js";
import {
	INTEGRATION_SECRET_NAMES,
	SYNTHETIC_BOT_TOKEN,
	SYNTHETIC_EMAIL_KEY,
	syntheticEnvironment,
} from "./environment.js";
import type { MockProviders } from "./mock-providers.js";

export const FIXTURE_SLUG_PREFIX = FIXTURE_TENANT_SLUG_PREFIX;
const FIXTURE_TIMEZONE = "Asia/Ho_Chi_Minh";
const AUTH_INSTANCE_ID = "00000000-0000-0000-0000-000000000000";

export type FixtureRole = "owner" | "manager" | "staff" | "viewer";

export interface FixtureMember {
	readonly userId: string;
	readonly email: string;
	readonly role: FixtureRole;
	readonly storeIds: readonly string[] | null;
}

export interface FixtureCycleOptions {
	readonly at?: Date | (() => Date);
	readonly worker?: string;
	readonly runSqlTick?: boolean;
	readonly repository?: NotifyRepository;
	readonly budget?: Partial<CycleBudgetLimits>;
	readonly buildDigests?: boolean;
}

export interface FixtureAccountEntry {
	readonly key: string;
	readonly connector: "mock";
	readonly seed: number;
	readonly storeCount: number;
	readonly rejectLogin?: true;
}

export interface FixtureWindowRun {
	readonly status: string;
	readonly runId: string | null;
}

export interface FixtureLinkOptions {
	readonly chatId?: string;
	readonly label?: string;
	readonly at?: Date;
}

export interface FixtureTenant {
	readonly tenantId: string;
	readonly slug: string;
	readonly name: string;
	readonly accountId: string;
	readonly accountKey: string;
	readonly storeIds: readonly string[];
	readonly owner: FixtureMember;
	readonly manager: FixtureMember;
	readonly environment: Readonly<Record<string, string>>;
	readonly mock: MockProviders;
	readonly secretName: string;
	readonly token: string;
	readonly seed: number;
	readonly emailKey: string;
	addMember(
		role: FixtureRole,
		storeIds?: readonly string[] | null,
	): Promise<FixtureMember>;
	linkZaloBot(
		member: FixtureMember,
		options?: FixtureLinkOptions,
	): Promise<string>;
	linkEmail(
		member: FixtureMember,
		options?: Omit<FixtureLinkOptions, "chatId">,
	): Promise<string>;
	accountEntry(overrides?: {
		readonly rejectLogin?: true;
	}): FixtureAccountEntry;
	windowRun(
		fromDate: string,
		toDate: string,
		at: Date,
		kind?: "nightly" | "backfill" | "manual",
	): Promise<FixtureWindowRun>;
	repository(): NotifyRepository;
	cycle(options?: FixtureCycleOptions): Promise<CycleReport>;
	cleanup(): Promise<void>;
}

export interface FixtureOptions {
	readonly mock: MockProviders;
	readonly databaseUrl: string;
	readonly salesDays?: number;
	readonly seed?: number;
	readonly today?: Date;
}

function suffix(): string {
	return randomBytes(4).toString("hex");
}

export async function deleteStaleFixtureTenants(sql: Sql): Promise<number> {
	const tenants = await sql`
		delete from public.tenants
		where slug like ${`${FIXTURE_SLUG_PREFIX}%`}
			and created_at < now() - interval '1 hour'
		returning id
	`;
	await sql`
		delete from auth.users
		where email like ${`${FIXTURE_SLUG_PREFIX}%@example.com`}
			and created_at < now() - interval '1 hour'
	`;
	return tenants.length;
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

export async function createFixtureTenant(
	sql: Sql,
	options: FixtureOptions,
): Promise<FixtureTenant> {
	await deleteStaleFixtureTenants(sql);
	const id = suffix();
	const slug = `${FIXTURE_SLUG_PREFIX}${id}`;
	const name = `Notify fixture ${id}`;
	const [tenant] = await sql<{ id: string }[]>`
		insert into public.tenants (slug, name, country_code, currency_code, timezone, legal_form)
		values (${slug}, ${name}, 'VN', 'VND', ${FIXTURE_TIMEZONE}, 'household_business')
		returning id::text as id
	`;
	if (!tenant) {
		throw new Error("the fixture tenant insert returned no row");
	}
	const tenantId = tenant.id;
	const logins: string[] = [];
	const environment = syntheticEnvironment({
		databaseUrl: options.databaseUrl,
		mockEnvironment: options.mock.environment(),
	});
	options.mock.registerZaloBot(SYNTHETIC_BOT_TOKEN, "Bot synthetic");
	options.mock.registerEmailKey(SYNTHETIC_EMAIL_KEY);
	const seed = options.seed ?? 1;

	const cleanup = async () => {
		await sql`delete from public.tenants where id = ${tenantId}::uuid`;
		if (logins.length > 0) {
			await sql`
				delete from auth.users
				where id in (select jsonb_array_elements_text(${JSON.stringify(logins)}::text::jsonb)::uuid)
			`;
		}
	};

	const addMember = async (
		role: FixtureRole,
		memberStores: readonly string[] | null = null,
	): Promise<FixtureMember> => {
		const email = `${FIXTURE_SLUG_PREFIX}${id}-${role}-${logins.length + 1}@example.com`;
		const userId = await insertLogin(sql, email);
		logins.push(userId);
		const storeJson =
			memberStores === null ? null : JSON.stringify([...memberStores]);
		await sql`
			insert into public.tenant_members (tenant_id, user_id, role, store_ids)
			values (
				${tenantId}::uuid,
				${userId}::uuid,
				${role}::public.tenant_role,
				case when ${storeJson}::text::jsonb is null then null else array(select jsonb_array_elements_text(${storeJson}::text::jsonb)::uuid) end
			)
		`;
		return { userId, email, role, storeIds: memberStores };
	};

	const prepare = async () => {
		const syncRepository = new PostgresSyncRepository(sql);
		const accountKey = `${FIXTURE_SLUG_PREFIX}account-${id}`;
		const account = await syncRepository.upsertAccount({
			tenant_id: tenantId,
			connector: "mock",
			account_key: accountKey,
			display_name: "Fixture account",
		});
		const connector = createMockConnector();
		await connector.authenticate({ seed, storeCount: 2 });
		const engine = new SyncEngine({
			repository: syncRepository,
			connector,
			calls: { sleep: async () => undefined },
		});
		await engine.syncMasterData(account);
		const stores = await syncRepository.listStores(account.id);
		const salesDays = options.salesDays ?? 70;
		if (salesDays > 0) {
			const today = localIsoDate(options.today ?? new Date(), FIXTURE_TIMEZONE);
			await engine.syncWindow(
				account,
				stores,
				{
					fromDate: shiftIsoDate(today, -salesDays),
					toDate: shiftIsoDate(today, -1),
				},
				"backfill",
			);
		}
		const storeIds = stores.map((store) => store.id);

		const owner = await addMember("owner", null);
		const firstStore = storeIds[0];
		const manager = await addMember(
			"manager",
			firstStore === undefined ? null : [firstStore],
		);

		return { account, accountKey, storeIds, owner, manager };
	};

	let prepared: Awaited<ReturnType<typeof prepare>>;
	try {
		prepared = await prepare();
	} catch (error) {
		await cleanup();
		throw error;
	}
	const { account, accountKey, storeIds, owner, manager } = prepared;

	const repository = (): NotifyRepository =>
		createPostgresNotifyRepository(sql, { environment, simulatedClock: true });

	const cycle = (
		cycleOptions: FixtureCycleOptions = {},
	): Promise<CycleReport> => {
		const at = cycleOptions.at;
		const clock =
			at === undefined
				? () => new Date()
				: typeof at === "function"
					? at
					: () => at;
		return runNotifyCycle({
			...(cycleOptions.buildDigests === true
				? {
						digests: createPostgresDigestBuilder(sql, {
							environment,
							simulatedClock: true,
						}),
					}
				: {}),
			repository: cycleOptions.repository ?? repository(),
			adapters: createAdapterRegistry(),
			environment,
			runtime: "cli",
			worker: cycleOptions.worker ?? `it-${id}`,
			tenantId,
			clock,
			fetch: (input, init) => fetch(input, init),
			log: () => undefined,
			budget: createCycleBudget({
				...CLI_CYCLE_LIMITS,
				linkPollSeconds: 5,
				...(cycleOptions.budget ?? {}),
			}),
			runSqlTick: cycleOptions.runSqlTick ?? false,
			dryRun: false,
			sleep: async () => undefined,
		});
	};

	const linkZaloBot = async (
		member: FixtureMember,
		linkOptions: FixtureLinkOptions = {},
	): Promise<string> => {
		const chatId = linkOptions.chatId ?? `synthetic-chat-${suffix()}`;
		const at = linkOptions.at ?? new Date();
		const prepared = await prepareBotDestination(sql, {
			tenantId,
			userId: member.userId,
			kind: "zalo_bot",
			provider: "zalo_bot",
			label: linkOptions.label ?? "Zalo Bot",
			secretName: INTEGRATION_SECRET_NAMES.zalo_bot,
			timezone: null,
			storeIds: null,
		});
		const code = await issueLinkCode(sql, prepared.channelId, "bot_link", at);
		options.mock.queueZaloUpdate(SYNTHETIC_BOT_TOKEN, { chatId, text: code });
		await cycle({ at });
		options.mock.queueZaloUpdate(SYNTHETIC_BOT_TOKEN, {
			chatId,
			text: "ĐỒNG Ý",
		});
		await cycle({ at });
		const state = await destinationState(sql, prepared.channelId);
		if (state?.status !== "active") {
			throw new Error(
				`the fixture destination did not become active (status ${state?.status ?? "missing"})`,
			);
		}
		return prepared.channelId;
	};

	const linkEmail = async (
		member: FixtureMember,
		linkOptions: Omit<FixtureLinkOptions, "chatId"> = {},
	): Promise<string> => {
		const at = linkOptions.at ?? new Date();
		const prepared = await prepareBotDestination(sql, {
			tenantId,
			userId: member.userId,
			kind: "email",
			provider: "brevo",
			label: linkOptions.label ?? "E-mail",
			secretName: INTEGRATION_SECRET_NAMES.email,
			timezone: null,
			storeIds: null,
		});
		const code = await issueLinkCode(
			sql,
			prepared.channelId,
			"email_confirm",
			at,
		);
		const [confirmed] = await sql<{ ok: boolean | null }[]>`
			select app.confirm_email_link(${prepared.channelId}::uuid, ${code}::text, ${at}::timestamptz) as ok
		`;
		if (confirmed?.ok !== true) {
			throw new Error("the fixture e-mail destination was not confirmed");
		}
		return prepared.channelId;
	};

	const accountEntry = (
		overrides: { readonly rejectLogin?: true } = {},
	): FixtureAccountEntry => ({
		key: accountKey,
		connector: "mock",
		seed,
		storeCount: 2,
		...overrides,
	});

	const windowRun = async (
		fromDate: string,
		toDate: string,
		at: Date,
		kind: "nightly" | "backfill" | "manual" = "nightly",
	): Promise<FixtureWindowRun> => {
		const syncRepository = new PostgresSyncRepository(sql);
		const connector = createMockConnector();
		await connector.authenticate({ seed, storeCount: 2 });
		const engine = new SyncEngine({
			repository: syncRepository,
			connector,
			now: () => at,
			calls: { sleep: async () => undefined },
		});
		const stores = await syncRepository.listStores(account.id);
		const summary = await engine.syncWindow(
			account,
			stores,
			{ fromDate, toDate },
			kind,
		);
		return { status: summary.status, runId: summary.runId ?? null };
	};

	return {
		tenantId,
		slug,
		name,
		seed,
		emailKey: SYNTHETIC_EMAIL_KEY,
		linkEmail,
		accountEntry,
		windowRun,
		accountId: account.id,
		accountKey,
		storeIds,
		owner,
		manager,
		environment,
		mock: options.mock,
		secretName: INTEGRATION_SECRET_NAMES.zalo_bot,
		token: SYNTHETIC_BOT_TOKEN,
		addMember,
		linkZaloBot,
		repository,
		cycle,
		cleanup,
	};
}
