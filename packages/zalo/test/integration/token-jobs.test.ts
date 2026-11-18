import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createMockZalo,
	MOCK_OAUTH_PATHS,
	type MockZalo,
} from "../../src/testing/mock-zalo.js";
import {
	beginOaAuthorization,
	OA_TOKEN_ERRORS,
	PostgresTokenStore,
	type TokenStore,
	type TokenTarget,
} from "../../src/tokens/index.js";

type Environment = Readonly<Record<string, string | undefined>>;

interface HandlerModule {
	createZaloOauthHandler(dependencies: {
		database: () => unknown;
		fetch?: MockZalo["fetch"];
		clock: () => Date;
	}): unknown;
	FUNCTION_NAME: string;
}

interface DatabaseModule {
	PostgresZaloOauthDatabase: new (
		sql: Sql,
	) => {
		readonly tokens: TokenStore;
	};
}

interface HttpModule {
	serveFunction(
		request: Request,
		environment: Environment,
		handler: unknown,
		options: {
			name: string;
			origins: readonly string[];
			log: (line: string) => void;
		},
	): Promise<Response>;
}

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const ENABLED = process.env.ZALO_INTEGRATION === "1" && DATABASE_URL !== "";
const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/zalo-oauth";
const SECRET_NAME = "ZALO_APP_SECRET_IT_OAUTH_FN";
const APP_SECRET = "synthetic-app-secret-oauth-fn-it";
const HOUR = 3_600_000;

async function load<T>(relative: string): Promise<T> {
	const path = fileURLToPath(
		new URL(`../../../../supabase/functions/${relative}`, import.meta.url),
	);
	return (await import(/* @vite-ignore */ path)) as T;
}

describe.skipIf(!ENABLED)(
	"zalo-oauth against the local stack and mock-zalo",
	() => {
		const suffix = randomBytes(4).toString("hex");
		const slug = `zalo-it-${suffix}-oauth-fn`;
		const appId = `synthetic-oauth-fn-app-${suffix}`;
		const oaId = `synthetic-oauth-fn-oa-${suffix}`;
		let sql: Sql;
		let mock: MockZalo;
		let handlerModule: HandlerModule;
		let database: { readonly tokens: TokenStore };
		let http: HttpModule;
		let tenantId = "";
		let brandId = "";
		const logs: string[] = [];

		function environment(): Environment {
			return {
				[SECRET_NAME]: APP_SECRET,
				ZALO_INTEGRATION: "1",
				ZALO_TENANT_ID: tenantId,
				ZALO_OAUTH_BASE_URL: "http://127.0.0.1:9",
			};
		}

		async function call(request: Request, clock: Date = new Date()) {
			const handler = handlerModule.createZaloOauthHandler({
				database: () => database,
				fetch: mock.fetch,
				clock: () => clock,
			});
			const response = await http.serveFunction(
				request,
				environment(),
				handler,
				{
					name: handlerModule.FUNCTION_NAME,
					origins: [],
					log: (line) => logs.push(line),
				},
			);
			return {
				status: response.status,
				body: (await response.json()) as Record<string, unknown>,
			};
		}

		function target(): TokenTarget {
			return {
				tenantId,
				tenantSlug: slug,
				brandId,
				brandKey: "brand-1",
				kind: "oa",
				appId,
				appSecretName: SECRET_NAME,
				hasToken: false,
			};
		}

		async function callbackUrl(): Promise<string> {
			const link = await beginOaAuthorization(
				{
					store: new PostgresTokenStore(sql),
					oauthBaseUrl: "http://127.0.0.1:9",
					clock: () => new Date(),
				},
				target(),
				FUNCTION_URL,
			);
			const response = await mock.handle(new Request(link.url));
			return response.headers.get("location") ?? "";
		}

		async function issueTicket(): Promise<string> {
			const [row] = await sql<{ ticket: string }[]>`
				select app.issue_zalo_token_ticket(${brandId}::uuid, 'oa')::text as ticket
			`;
			return row?.ticket ?? "";
		}

		function ticketRequest(ticket: string): Request {
			return new Request(FUNCTION_URL, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ticket }),
			});
		}

		beforeAll(async () => {
			handlerModule = await load<HandlerModule>("zalo-oauth/handler.ts");
			const databaseModule = await load<DatabaseModule>(
				"zalo-oauth/database.ts",
			);
			http = await load<HttpModule>("_shared/http.ts");
			sql = postgres(DATABASE_URL, {
				max: 2,
				onnotice: () => undefined,
				connection: { application_name: "zalo-oauth-it" },
			});
			database = new databaseModule.PostgresZaloOauthDatabase(sql);
			mock = createMockZalo();
			mock.registerApp({ appId, appSecret: APP_SECRET, oaId });
			const [tenant] = await sql<{ id: string }[]>`
				insert into public.tenants (slug, name) values (${slug}, ${`Zalo OAuth function fixture ${suffix}`})
				returning id::text as id
			`;
			tenantId = tenant?.id ?? "";
			const [brand] = await sql<{ id: string }[]>`
				with account as (
					insert into public.pos_accounts (tenant_id, connector, account_key, display_name)
					values (${tenantId}::uuid, 'mock', ${`${slug}-account`}, 'Synthetic account')
					returning id
				),
				store as (
					insert into public.stores (tenant_id, pos_account_id, external_id, name)
					select ${tenantId}::uuid, account.id, ${`${slug}-store`}, 'Synthetic store' from account
					returning id
				)
				insert into public.brands (tenant_id, brand_key, display_name, store_ids)
				select ${tenantId}::uuid, 'brand-1', 'Synthetic brand', array[store.id] from store
				returning id::text as id
			`;
			brandId = brand?.id ?? "";
			await sql`
				insert into public.zalo_apps (tenant_id, brand_id, external_id, secret_name)
				values (${tenantId}::uuid, ${brandId}::uuid, ${appId}, ${SECRET_NAME})
			`;
			await sql`
				insert into public.oas (tenant_id, brand_id, external_id, package_tier, verified, secret_name)
				values (${tenantId}::uuid, ${brandId}::uuid, ${oaId}, 'tang_truong', true, 'ZALO_OA_SECRET_IT_OAUTH_FN')
			`;
		}, 60_000);

		afterAll(async () => {
			if (sql !== undefined) {
				await sql`delete from public.tenants where slug = ${slug}`;
				await sql.end({ timeout: 5 });
			}
		});

		it("stores the pair once through the callback and refuses the state again", async () => {
			const location = await callbackUrl();
			const stored = await call(new Request(location));
			expect(stored).toEqual({
				status: 200,
				body: { ok: true, brand: "brand-1" },
			});
			const [row] = await sql<{ version: number; access_token: string }[]>`
				select version::integer as version, access_token from public.zalo_tokens
				where brand_id = ${brandId}::uuid and kind = 'oa'
			`;
			expect(row?.version).toBe(1);
			expect(mock.accessTokenLive(row?.access_token ?? "")).toBe(true);
			expect((await call(new Request(location))).body.error).toBe(
				"invalid_state",
			);
			const [pending] = await sql<{ rows: number }[]>`
				select count(*)::integer as rows from app.zalo_oauth_pending where tenant_id = ${tenantId}::uuid
			`;
			expect(pending?.rows).toBe(0);
		});

		it("refuses a wrong and an expired state", async () => {
			const wrong = new URL(await callbackUrl());
			wrong.searchParams.set("state", "w".repeat(32));
			expect(await call(new Request(wrong))).toMatchObject({
				status: 400,
				body: { error: "invalid_state" },
			});
			const late = await callbackUrl();
			expect(
				await call(new Request(late), new Date(Date.now() + 11 * 60_000)),
			).toMatchObject({ status: 400, body: { error: "expired_state" } });
		});

		it("claims a ticket once: a fresh pair stays, a due pair is refreshed under the lock", async () => {
			const fresh = await call(ticketRequest(await issueTicket()));
			expect(fresh.status).toBe(200);
			expect(fresh.body).toMatchObject({ outcome: "fresh", version: 1 });
			const ticket = await issueTicket();
			const refreshed = await call(
				ticketRequest(ticket),
				new Date(Date.now() + 12 * HOUR),
			);
			expect(refreshed).toEqual({
				status: 200,
				body: { outcome: "refreshed", version: 2 },
			});
			expect((await call(ticketRequest(ticket))).status).toBe(401);
			expect(mock.oauthCounts().refreshes).toBe(1);
		});

		it("raises zalo_token_failed from the scheduler when Zalo refuses with -220", async () => {
			mock.failNext(MOCK_OAUTH_PATHS.oaAccessToken, {
				kind: "error",
				error: OA_TOKEN_ERRORS.accessTokenExpired,
			});
			const refused = await call(
				ticketRequest(await issueTicket()),
				new Date(Date.now() + 30 * HOUR),
			);
			expect(refused).toEqual({
				status: 502,
				body: { outcome: "refused", zalo_error: -220, alert: "opened" },
			});
			const [episode] = await sql<
				{ source: string; state: string; facts: Record<string, unknown> }[]
			>`
				select source, state, facts from public.alert_events
				where tenant_id = ${tenantId}::uuid and rule_key = 'zalo_token_failed'
			`;
			expect(episode).toEqual({
				source: "scheduler",
				state: "open",
				facts: {
					kind: "oa",
					brand: "brand-1",
					reason: "refused",
					error_code: -220,
				},
			});
		});

		it("never logs a token, a code, a state or the App secret", async () => {
			const [row] = await sql<
				{ access_token: string; refresh_token: string }[]
			>`
				select access_token, refresh_token from public.zalo_tokens
				where brand_id = ${brandId}::uuid and kind = 'oa'
			`;
			expect(logs.length).toBeGreaterThan(0);
			for (const line of logs) {
				expect(line).not.toContain(APP_SECRET);
				expect(line).not.toContain(row?.access_token ?? "-");
				expect(line).not.toContain(row?.refresh_token ?? "-");
				expect(line).not.toMatch(/mock-zalo-(code|oa)-/);
			}
		});
	},
);
