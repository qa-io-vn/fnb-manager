import type { LegalText, SupabaseBackend } from "@fnb/zalo";
import {
	createFakeBackend,
	createMockZalo,
	type FakeBackend,
	type MockZalo,
} from "@fnb/zalo/testing";
import type { FunctionEnvironment } from "../_shared/http.ts";
import { handleZaloSession } from "./handler.ts";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

function assertEquals(actual: unknown, expected: unknown, label: string): void {
	const left = JSON.stringify(actual);
	const right = JSON.stringify(expected);
	assert(left === right, `${label}: expected ${right}, got ${left}`);
}

const APP_SECRET = "synthetic-app-secret-brand-1";
const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const APP = "33333333-3333-4333-8333-333333333333";
const OTHER_APP = "33333333-3333-4333-8333-333333333335";
const DISABLED_APP = "33333333-3333-4333-8333-333333333336";
const MEMBER = "44444444-4444-4444-8444-444444444444";
const STORE = "77777777-7777-4777-8777-777777777771";
const ZALO_USER = "8800000000000000201";
const CONTACT =
	"Gặp quản lý ca tại quầy.\nGọi số của cửa hàng hoặc gửi thư tới hr@example.com.";
const ENVIRONMENT: FunctionEnvironment = {
	ZALO_APP_SECRET_BRAND_1: APP_SECRET,
};
const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/zalo-session";
const NOTICE = {
	version: "staff-notice-2026-01",
	title: "Thông báo cho nhân viên",
	bodyMarkdown: "# Thông báo\n\nVăn bản thử.",
	publishedAt: "2026-11-01T00:00:00+00:00",
};
const DOCUMENTS: readonly LegalText[] = [
	{
		kind: "privacy_notice",
		language: "vi",
		version: "privacy-2026-01",
		title: "Thông báo quyền riêng tư",
		bodyMarkdown: "# Quyền riêng tư\n\nVăn bản thử.",
		publishedAt: "2026-11-01T00:00:00+00:00",
	},
	{
		kind: "privacy_notice",
		language: "en",
		version: "privacy-2026-01-en",
		title: "Privacy notice",
		bodyMarkdown: "Synthetic privacy text.",
		publishedAt: "2026-11-01T00:00:00+00:00",
	},
	{
		kind: "mini_app_terms",
		language: "vi",
		version: "terms-2026-01",
		title: "Điều khoản sử dụng",
		bodyMarkdown: "Điều khoản thử.",
		publishedAt: "2026-11-02T00:00:00+00:00",
	},
];
const DOCUMENTS_ANSWER = DOCUMENTS.map((document) => ({
	kind: document.kind,
	language: document.language,
	version: document.version,
	title: document.title,
	body_markdown: document.bodyMarkdown,
	published_at: document.publishedAt,
}));

interface Harness {
	readonly zalo: MockZalo;
	readonly backend: FakeBackend;
	readonly lines: string[];
	send(
		body: unknown,
		options?: {
			readonly environment?: FunctionEnvironment;
			readonly backend?: SupabaseBackend;
		},
	): Promise<Response>;
}

function harness(): Harness {
	const zalo = createMockZalo();
	const backend = createFakeBackend();
	backend.addApp({
		brandKey: "brand-1",
		tenantId: TENANT,
		tenantSlug: "synthetic-tenant",
		zaloAppId: APP,
		secretName: "ZALO_APP_SECRET_BRAND_1",
		status: "active",
	});
	backend.addApp({
		brandKey: "brand-2",
		tenantId: OTHER_TENANT,
		tenantSlug: "synthetic-other",
		zaloAppId: OTHER_APP,
		secretName: "ZALO_APP_SECRET_BRAND_2",
		status: "active",
	});
	backend.addApp({
		brandKey: "brand-3",
		tenantId: TENANT,
		tenantSlug: "synthetic-tenant",
		zaloAppId: DISABLED_APP,
		secretName: "ZALO_APP_SECRET_BRAND_3",
		status: "disabled",
	});
	backend.publishTexts(TENANT, DOCUMENTS);
	const lines: string[] = [];
	return {
		zalo,
		backend,
		lines,
		send(body, options = {}) {
			return handleZaloSession(
				new Request(FUNCTION_URL, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						apikey: "sb_publishable_synthetic",
					},
					body: JSON.stringify(body),
				}),
				options.environment ?? ENVIRONMENT,
				{
					fetch: zalo.fetch,
					backend: options.backend ?? backend,
					log: (line) => lines.push(line),
					requestId: () => "request-1",
				},
			);
		},
	};
}

Deno.test("the texts request answers the published texts and the contact without a Zalo identity", async () => {
	const test = harness();
	test.backend.setContact(TENANT, CONTACT);
	const response = await test.send(
		{ brand: "brand-1", texts: true },
		{ environment: {} },
	);
	assertEquals(response.status, 200, "status");
	assertEquals(
		await response.json(),
		{ status: "texts", documents: DOCUMENTS_ANSWER, contact: CONTACT },
		"answer",
	);
	assertEquals(
		response.headers.get("cache-control"),
		"no-store",
		"cache-control",
	);
	assertEquals(test.zalo.requests(), [], "Zalo was not called");
	assertEquals(
		test.backend.calls(),
		["rpc zalo_session_app", "rpc zalo_session_texts"],
		"backend calls",
	);
	assertEquals(
		test.lines,
		["zalo-session request-1: texts: 3 documents, contact set"],
		"log",
	);
});

Deno.test("a tenant without contact instructions answers a null contact, and another tenant its own texts", async () => {
	const test = harness();
	const own = await test.send({ brand: "brand-1", texts: true });
	assertEquals(
		await own.json(),
		{ status: "texts", documents: DOCUMENTS_ANSWER, contact: null },
		"own tenant",
	);
	const other = await test.send({ brand: "brand-2", texts: true });
	assertEquals(
		await other.json(),
		{ status: "texts", documents: [], contact: null },
		"other tenant",
	);
	assertEquals(
		test.lines.at(-1),
		"zalo-session request-1: texts: 0 documents, contact not set",
		"log",
	);
});

Deno.test("a held-back app answers 429 with Retry-After and reveals nothing", async () => {
	const test = harness();
	test.backend.setContact(TENANT, CONTACT);
	test.backend.holdTexts(APP, 41);
	const response = await test.send({ brand: "brand-1", texts: true });
	assertEquals(response.status, 429, "status");
	assertEquals(response.headers.get("retry-after"), "41", "retry-after");
	assertEquals(
		await response.json(),
		{ error: "too_many_requests", request_id: "request-1" },
		"answer",
	);
	assertEquals(
		test.lines,
		[
			"zalo-session request-1: texts: held back for 41 s after too many requests for the app",
		],
		"log",
	);
	test.backend.holdTexts(APP, null);
	const later = await test.send({ brand: "brand-1", texts: true });
	assertEquals(later.status, 200, "answered again");
});

Deno.test("an unknown brand and a disabled app answer no texts", async () => {
	const test = harness();
	const unknown = await test.send({ brand: "brand-9", texts: true });
	assertEquals(
		[unknown.status, (await unknown.json()).error],
		[404, "unknown_brand"],
		"unknown",
	);
	const disabled = await test.send({ brand: "brand-3", texts: true });
	assertEquals(
		[disabled.status, (await disabled.json()).error],
		[403, "app_disabled"],
		"disabled",
	);
	assertEquals(
		test.backend.calls().filter((call) => call === "rpc zalo_session_texts"),
		[],
		"no texts were read",
	);
});

Deno.test("a texts request carries the brand and nothing else", async () => {
	const test = harness();
	const cases: [unknown, string][] = [
		[{ brand: "brand-1", texts: false }, "invalid_texts"],
		[{ brand: "brand-1", texts: "yes" }, "invalid_texts"],
		[{ brand: "brand-1", texts: null }, "invalid_texts"],
		[{ brand: "brand-1", texts: true, access_token: "token" }, "invalid_texts"],
		[
			{ brand: "brand-1", texts: true, pairing_code: "123456" },
			"invalid_texts",
		],
		[
			{
				brand: "brand-1",
				texts: true,
				notice: { version: NOTICE.version, shown_at: "2026-11-18T03:00:00Z" },
			},
			"invalid_texts",
		],
		[{ texts: true }, "invalid_brand"],
		[{ brand: "Brand One", texts: true }, "invalid_brand"],
	];
	for (const [body, code] of cases) {
		const response = await test.send(body);
		assertEquals(
			[response.status, (await response.json()).error],
			[400, code],
			JSON.stringify(body),
		);
	}
	assertEquals(test.backend.calls(), [], "the database was not asked");
	assertEquals(test.zalo.requests(), [], "Zalo was not called");
});

Deno.test("an unreadable texts answer is backend_unavailable", async () => {
	const test = harness();
	const broken: SupabaseBackend = {
		...test.backend,
		async rpc(name, args) {
			return name === "zalo_session_texts"
				? { status: "texts", documents: [{ kind: "privacy_notice" }] }
				: test.backend.rpc(name, args);
		},
	};
	const response = await test.send(
		{ brand: "brand-1", texts: true },
		{ backend: broken },
	);
	assertEquals(
		[response.status, (await response.json()).error],
		[503, "backend_unavailable"],
		"unreadable",
	);
});

Deno.test("the unpaired and notice_required answers carry the contact instructions", async () => {
	const test = harness();
	test.backend.publishNotice(TENANT, NOTICE);
	test.backend.setContact(TENANT, CONTACT);
	const token = test.zalo.issueAccessToken(APP_SECRET, { id: ZALO_USER });
	const unpaired = await test.send({ access_token: token, brand: "brand-1" });
	const unpairedBody = await unpaired.json();
	assertEquals(unpairedBody.status, "unpaired", "unpaired");
	assertEquals(unpairedBody.contact, CONTACT, "unpaired contact");
	const refused = await test.send({
		access_token: token,
		brand: "brand-1",
		pairing_code: "000000",
		notice: { version: NOTICE.version, shown_at: "2026-11-18T03:00:00Z" },
	});
	const refusedBody = await refused.json();
	assertEquals(
		[refusedBody.reason, refusedBody.contact],
		["code_refused", CONTACT],
		"refused code",
	);
	test.backend.addMember({
		userId: MEMBER,
		tenantId: TENANT,
		role: "staff",
		storeIds: [STORE],
		stores: ["Cửa hàng Mẫu 1"],
		email: "texts-staff@example.com",
	});
	test.backend.addRosterEntry({
		id: "66666666-6666-4666-8666-666666666611",
		tenantId: TENANT,
		role: "staff",
		storeIds: [STORE],
		stores: ["Cửa hàng Mẫu 1"],
		status: "active",
		userId: MEMBER,
	});
	test.backend.bind(APP, ZALO_USER, MEMBER, null);
	const required = await test.send({ access_token: token, brand: "brand-1" });
	const requiredBody = await required.json();
	assertEquals(
		Object.keys(requiredBody),
		["status", "notice", "contact"],
		"notice_required fields",
	);
	assertEquals(requiredBody.contact, CONTACT, "notice_required contact");
	test.backend.setContact(TENANT, null);
	const without = await test.send({ access_token: token, brand: "brand-1" });
	assertEquals(
		Object.keys(await without.json()),
		["status", "notice"],
		"no contact when none is set",
	);
	for (const line of test.lines) {
		assert(!line.includes("quầy"), `a log line holds the contact: ${line}`);
	}
});
