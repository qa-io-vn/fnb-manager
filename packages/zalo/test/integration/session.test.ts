import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	assertSyntheticZaloEnvironment,
	createMockZalo,
	type MockZalo,
	type MockZaloServer,
	startMockZalo,
	zaloIntegrationGate,
} from "../../src/testing/index.js";
import {
	createZaloFixture,
	type FixtureLogin,
	type ZaloFixture,
} from "../support/fixture.js";

type Handler = (
	request: Request,
	environment: Readonly<Record<string, string | undefined>>,
	dependencies?: { readonly log?: (line: string) => void },
) => Promise<Response>;

const gate = zaloIntegrationGate(process.env);
const APP_SECRET = "synthetic-app-secret-session-it";
const OTHER_SECRET = "synthetic-app-secret-other-it";
const NUMBER = "84912345678";

async function loadHandler(name: string, exported: string): Promise<Handler> {
	const path = fileURLToPath(
		new URL(
			`../../../../supabase/functions/${name}/handler.ts`,
			import.meta.url,
		),
	);
	const module = (await import(/* @vite-ignore */ path)) as Record<
		string,
		unknown
	>;
	const handler = module[exported];
	if (typeof handler !== "function") {
		throw new Error(`${name}/handler.ts exports no ${exported}`);
	}
	return handler as Handler;
}

function claimsOf(token: string): Record<string, unknown> {
	const payload = token.split(".")[1] ?? "";
	return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

describe.skipIf(!gate.enabled)(
	"zalo-session and zalo-phone against the local stack and mock-zalo",
	() => {
		let sql: Sql;
		let fixture: ZaloFixture;
		let mock: MockZalo;
		let server: MockZaloServer;
		let manager: FixtureLogin;
		let session: Handler;
		let phone: Handler;
		let environment: Record<string, string>;
		const lines: string[] = [];
		const protectedValues: string[] = [];
		const zaloUserId = `88${Date.now()}`;
		let spentCode = "";

		function post(
			handler: Handler,
			body: unknown,
			headers: Readonly<Record<string, string>> = {},
		): Promise<Response> {
			return handler(
				new Request("http://127.0.0.1:54321/functions/v1/zalo-it", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						apikey: gate.publishableKey,
						...headers,
					},
					body: JSON.stringify(body),
				}),
				environment,
				{ log: (line) => lines.push(line) },
			);
		}

		async function dataApi(
			path: string,
			accessToken: string,
		): Promise<unknown> {
			const response = await fetch(`${gate.supabaseUrl}${path}`, {
				headers: {
					apikey: gate.publishableKey,
					authorization: `Bearer ${accessToken}`,
				},
			});
			expect(response.status).toBe(200);
			return response.json();
		}

		async function signIn(token: string, code?: string) {
			const response = await post(session, {
				access_token: token,
				brand: fixture.brandKey,
				...(code === undefined ? {} : { binding_code: code }),
			});
			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			if (typeof body.access_token === "string") {
				protectedValues.push(body.access_token);
			}
			if (typeof body.refresh_token === "string") {
				protectedValues.push(body.refresh_token);
			}
			return body;
		}

		beforeAll(async () => {
			sql = postgres(gate.databaseUrl, { max: 2, onnotice: () => undefined });
			fixture = await createZaloFixture(sql);
			manager = await fixture.addMember("manager", [fixture.storeIds[0] ?? ""]);
			protectedValues.push(zaloUserId, manager.email, manager.userId);
			mock = createMockZalo({ startAt: Date.now() });
			server = await startMockZalo(mock);
			environment = {
				SUPABASE_URL: gate.supabaseUrl,
				SUPABASE_SECRET_KEYS: JSON.stringify({ default: gate.secretKey }),
				ZALO_INTEGRATION: "1",
				ZALO_TENANT_ID: fixture.tenantId,
				ZALO_GRAPH_BASE_URL: server.baseUrl,
				[fixture.secretName]: APP_SECRET,
			};
			assertSyntheticZaloEnvironment(environment);
			session = await loadHandler("zalo-session", "handleZaloSession");
			phone = await loadHandler("zalo-phone", "handleZaloPhone");
		}, 60_000);

		afterAll(async () => {
			await fixture?.cleanup();
			await server?.close();
			await sql?.end({ timeout: 5 });
		});

		it("answers unpaired, with no session, for an identity nobody bound", async () => {
			const token = mock.issueAccessToken(APP_SECRET, { id: zaloUserId });
			protectedValues.push(token);
			expect(await signIn(token)).toEqual({ status: "unpaired" });
			const [row] = await sql<{ identities: number }[]>`
				select count(*)::integer as identities from public.zalo_identities
				where tenant_id = ${fixture.tenantId}::uuid
			`;
			expect(row?.identities).toBe(0);
		});

		it("binds a fixture member with a code and mints a real session that the Data API scopes to the member's stores", async () => {
			const code = await fixture.issueBindingCode(manager.userId);
			spentCode = code;
			protectedValues.push(code);
			const token = mock.issueAccessToken(APP_SECRET, {
				id: zaloUserId,
				name: "Quản lý thử",
			});
			protectedValues.push(token);
			const body = await signIn(token, code);
			expect(body).toMatchObject({
				status: "bound",
				member: {
					display_name: "Quản lý thử",
					role: "manager",
					stores: ["Cửa hàng thử 1"],
				},
			});
			expect(body.expires_at).toBeGreaterThan(Date.now() / 1000 + 60);
			const accessToken = String(body.access_token);
			expect(claimsOf(accessToken)).toMatchObject({
				sub: manager.userId,
				role: "authenticated",
				memberships: [
					{
						tenant_id: fixture.tenantId,
						role: "manager",
						store_ids: [fixture.storeIds[0]],
					},
				],
			});
			const path = `/rest/v1/stores?select=id&tenant_id=eq.${fixture.tenantId}&order=id`;
			const miniAppRows = await dataApi(path, accessToken);
			expect(miniAppRows).toEqual([{ id: fixture.storeIds[0] }]);

			const web = await fetch(
				`${gate.supabaseUrl}/auth/v1/token?grant_type=password`,
				{
					method: "POST",
					headers: {
						apikey: gate.publishableKey,
						"content-type": "application/json",
					},
					body: JSON.stringify({
						email: manager.email,
						password: manager.password,
					}),
				},
			);
			expect(web.status).toBe(200);
			const webSession = (await web.json()) as { access_token: string };
			expect(await dataApi(path, webSession.access_token)).toEqual(miniAppRows);
			expect(claimsOf(webSession.access_token).memberships).toEqual(
				claimsOf(accessToken).memberships,
			);
		});

		it("signs the bound identity in again without a code, and a spent code binds nobody else", async () => {
			const token = mock.issueAccessToken(APP_SECRET, { id: zaloUserId });
			protectedValues.push(token);
			const again = await signIn(token);
			expect(again).toMatchObject({
				status: "bound",
				member: { role: "manager" },
			});
			const stranger = mock.issueAccessToken(APP_SECRET, {
				id: `${zaloUserId}9`,
			});
			protectedValues.push(stranger, `${zaloUserId}9`);
			const [row] = await sql<{ codes: number }[]>`
				select count(*)::integer as codes from app.zalo_binding_codes
				where tenant_id = ${fixture.tenantId}::uuid
			`;
			expect(row?.codes).toBe(0);
			expect(await signIn(stranger, spentCode)).toEqual({ status: "unpaired" });
		});

		it("refuses a wrong app-secret proof, an expired token and a brand outside the fixture tenant", async () => {
			const foreign = mock.issueAccessToken(OTHER_SECRET, { id: zaloUserId });
			const short = mock.issueAccessToken(
				APP_SECRET,
				{ id: zaloUserId },
				{ lifetimeMs: 1 },
			);
			protectedValues.push(foreign, short);
			mock.advance(1);
			for (const token of [foreign, short]) {
				const response = await post(session, {
					access_token: token,
					brand: fixture.brandKey,
				});
				expect(response.status).toBe(401);
				expect(await response.json()).toMatchObject({
					error: "zalo_token_refused",
				});
			}
			const unknown = await post(session, {
				access_token: foreign,
				brand: fixture.brandKey === "brand-1" ? "brand-2" : "brand-1",
			});
			expect(unknown.status).toBe(404);
		});

		it("decodes a phone number once for the caller's session and refuses the second use", async () => {
			const token = mock.issueAccessToken(APP_SECRET, { id: zaloUserId });
			protectedValues.push(token);
			const bound = await signIn(token);
			const phoneToken = mock.issuePhoneToken(token, NUMBER);
			protectedValues.push(phoneToken, NUMBER, "912345678");
			const body = {
				brand: fixture.brandKey,
				access_token: token,
				phone_token: phoneToken,
			};
			const withoutSession = await post(phone, body);
			expect(withoutSession.status).toBe(401);
			const authorization = {
				authorization: `Bearer ${String(bound.access_token)}`,
			};
			const first = await post(phone, body, authorization);
			expect(first.status).toBe(200);
			expect(await first.json()).toEqual({
				phone_number: `+84${NUMBER.slice(2)}`,
			});
			const second = await post(phone, body, authorization);
			expect(second.status).toBe(409);
			expect(await second.json()).toMatchObject({ error: "phone_token_used" });
			const probe = await post(
				phone,
				{
					brand: fixture.brandKey,
					access_token: token,
					mode: "probe",
					consent_error_code: -1403,
				},
				authorization,
			);
			expect(await probe.json()).toEqual({
				probe: { consent: false, exchange: "skipped", error_code: -1403 },
			});
		});

		it("writes no token, user id, phone number or e-mail in any log line", () => {
			expect(lines.length).toBeGreaterThan(5);
			for (const line of lines) {
				for (const value of protectedValues) {
					expect(line).not.toContain(value);
				}
			}
		});
	},
);
