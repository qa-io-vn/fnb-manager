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

		async function rpcAs(
			accessToken: string,
			name: string,
			args: Readonly<Record<string, unknown>>,
		): Promise<{ readonly status: number; readonly body: unknown }> {
			const response = await fetch(`${gate.supabaseUrl}/rest/v1/rpc/${name}`, {
				method: "POST",
				headers: {
					apikey: gate.publishableKey,
					authorization: `Bearer ${accessToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(args),
			});
			const text = await response.text();
			return {
				status: response.status,
				body: text === "" ? null : JSON.parse(text),
			};
		}

		async function passwordSession(login: FixtureLogin): Promise<string> {
			const response = await fetch(
				`${gate.supabaseUrl}/auth/v1/token?grant_type=password`,
				{
					method: "POST",
					headers: {
						apikey: gate.publishableKey,
						"content-type": "application/json",
					},
					body: JSON.stringify({
						email: login.email,
						password: login.password,
					}),
				},
			);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { access_token: string };
			protectedValues.push(body.access_token);
			return body.access_token;
		}

		const NOTICE_VERSION = "staff-notice-it-1";
		const staffZaloId = `77${Date.now()}`;
		let managerToken = "";
		let rosterId = "";
		let staffToken = "";
		let staffSession = "";

		it("a manager adds a person to the roster and issues a pairing code through the Data API", async () => {
			await fixture.publishStaffNotice(NOTICE_VERSION);
			managerToken = await passwordSession(manager);
			const added = await rpcAs(managerToken, "add_staff", {
				p_tenant_id: fixture.tenantId,
				p_display_name: "Nhân viên thử",
				p_role: "staff",
				p_store_ids: [fixture.storeIds[0]],
			});
			expect(added.status).toBe(200);
			rosterId = String(added.body);
			const outside = await rpcAs(managerToken, "issue_pairing_code", {
				p_roster_id: "00000000-0000-4000-8000-000000000000",
			});
			expect(outside.status).toBe(403);
			staffToken = mock.issueAccessToken(APP_SECRET, {
				id: staffZaloId,
				name: "Nhân viên Zalo",
			});
			protectedValues.push(staffToken, staffZaloId, "Nhân viên Zalo");
		});

		it("an unpaired person is shown the staff notice, a code without the notice accepted is not checked, and with it the code pairs", async () => {
			const first = await post(session, {
				access_token: staffToken,
				brand: fixture.brandKey,
			});
			expect(await first.json()).toMatchObject({
				status: "unpaired",
				notice: { version: NOTICE_VERSION, title: "Thông báo cho nhân viên" },
			});
			const issued = await rpcAs(managerToken, "issue_pairing_code", {
				p_roster_id: rosterId,
			});
			expect(issued.status).toBe(200);
			const code = String(issued.body);
			protectedValues.push(code);
			const refused = await post(session, {
				access_token: staffToken,
				brand: fixture.brandKey,
				pairing_code: code,
			});
			expect(await refused.json()).toMatchObject({
				status: "unpaired",
				reason: "notice_outdated",
			});
			const [row] = await sql<{ consents: number; status: string }[]>`
				select r.status,
					(select count(*)::integer from public.consent_records c where c.tenant_id = r.tenant_id and c.purpose = 'staff_ops') as consents
				from public.staff_roster r where r.id = ${rosterId}::uuid
			`;
			expect(row).toEqual({ consents: 0, status: "invited" });
			const paired = await post(session, {
				access_token: staffToken,
				brand: fixture.brandKey,
				pairing_code: code,
				notice: { version: NOTICE_VERSION, shown_at: new Date().toISOString() },
			});
			const body = (await paired.json()) as Record<string, unknown>;
			expect(body).toMatchObject({
				status: "bound",
				member: {
					display_name: "Nhân viên Zalo",
					role: "staff",
					stores: ["Cửa hàng thử 1"],
					tenant_id: fixture.tenantId,
				},
			});
			staffSession = String(body.access_token);
			protectedValues.push(staffSession, String(body.refresh_token));
		});

		it("pairing created the login, the membership with the roster role and stores, and the consent", async () => {
			const [row] = await sql<
				{
					status: string;
					email: string;
					user_id: string;
					role: string;
					stores: string[];
					consent: string;
				}[]
			>`
				select r.status, u.email, u.id::text as user_id, m.role::text as role,
					array(select unnest(m.store_ids)::text) as stores,
					(select c.policy_version from public.consent_records c
					 where c.tenant_id = r.tenant_id and c.subject_id = r.user_id and c.purpose = 'staff_ops' and c.revoked_at is null) as consent
				from public.staff_roster r
				join auth.users u on u.id = r.user_id
				join public.tenant_members m on m.tenant_id = r.tenant_id and m.user_id = r.user_id
				where r.id = ${rosterId}::uuid
			`;
			expect(row).toMatchObject({
				status: "active",
				role: "staff",
				stores: [fixture.storeIds[0]],
				consent: NOTICE_VERSION,
			});
			expect(row?.email).toMatch(/^staff-[0-9a-f-]{36}@zalo-staff\.invalid$/);
			protectedValues.push(row?.email ?? "", row?.user_id ?? "");
			expect(claimsOf(staffSession).sub).toBe(row?.user_id);
			const [hook] = await sql<{ memberships: unknown }[]>`
				select app.custom_access_token_claims(
					jsonb_build_object('user_id', ${row?.user_id ?? ""}::text, 'claims', '{}'::jsonb)
				) -> 'claims' -> 'memberships' as memberships
			`;
			expect(hook?.memberships).toEqual([
				{
					tenant_id: fixture.tenantId,
					role: "staff",
					store_ids: [fixture.storeIds[0]],
				},
			]);
		});

		it("the new member reads through RLS only their store and their own roster row", async () => {
			expect(
				await dataApi(
					`/rest/v1/stores?select=id&tenant_id=eq.${fixture.tenantId}&order=id`,
					staffSession,
				),
			).toEqual([{ id: fixture.storeIds[0] }]);
			expect(
				await dataApi("/rest/v1/staff_roster?select=id,status", staffSession),
			).toEqual([{ id: rosterId, status: "active" }]);
			const state = await rpcAs(staffSession, "my_staff_notice", {
				p_tenant_id: fixture.tenantId,
			});
			expect(state.body).toMatchObject({
				consent: "current",
				notice: { version: NOTICE_VERSION },
			});
			const again = await post(session, {
				access_token: staffToken,
				brand: fixture.brandKey,
			});
			expect(await again.json()).toMatchObject({
				status: "bound",
				member: { role: "staff" },
			});
		});

		it("the person links the phone zalo-phone decodes, on their own row only", async () => {
			const phoneToken = mock.issuePhoneToken(staffToken, NUMBER);
			protectedValues.push(phoneToken);
			const decoded = await post(
				phone,
				{
					brand: fixture.brandKey,
					access_token: staffToken,
					phone_token: phoneToken,
				},
				{ authorization: `Bearer ${staffSession}` },
			);
			const { phone_number: number } = (await decoded.json()) as {
				phone_number: string;
			};
			const linked = await rpcAs(staffSession, "link_my_phone", {
				p_tenant_id: fixture.tenantId,
				p_phone: number,
			});
			expect(linked).toEqual({ status: 200, body: `…${NUMBER.slice(-3)}` });
			const refused = await rpcAs(managerToken, "link_my_phone", {
				p_tenant_id: fixture.tenantId,
				p_phone: number,
			});
			expect(refused.status).toBe(403);
			const [row] = await sql<{ same: boolean }[]>`
				select r.phone = ${number} as same from public.staff_roster r where r.id = ${rosterId}::uuid
			`;
			expect(row?.same).toBe(true);
		});

		it("deactivating the roster row unpairs the person at their next call and their session reads nothing", async () => {
			const deactivated = await rpcAs(managerToken, "deactivate_staff", {
				p_roster_id: rosterId,
			});
			expect(deactivated.status).toBe(204);
			const next = await post(session, {
				access_token: staffToken,
				brand: fixture.brandKey,
			});
			expect(await next.json()).toMatchObject({ status: "unpaired" });
			expect(
				await dataApi(
					`/rest/v1/stores?select=id&tenant_id=eq.${fixture.tenantId}`,
					staffSession,
				),
			).toEqual([]);
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
