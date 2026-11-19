import type { CustomerInput } from "@fnb/zalo/oa";
import { createMockZalo, MOCK_OA_PATHS } from "@fnb/zalo/testing";
import { type FunctionEnvironment, serveFunction } from "../_shared/http.ts";
import {
	type CustomerStep,
	parseCustomerStep,
	type Reply,
	type ReplyRecord,
	replyMessage,
	zaloErrorCode,
} from "./customer.ts";
import {
	createOaWebhookHandler,
	FUNCTION_NAME,
	type OaTarget,
	type OaWebhookStore,
	type ReceivedEvent,
	type Reception,
} from "./handler.ts";
import { oaSignature, SIGNATURE_HEADER } from "./signature.ts";

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

const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/oa-webhook";
const APP_ID = "synthetic-app-1";
const OA_ID = "synthetic-oa-1";
const USER_ID = "synthetic-user-1";
const SECRET_NAME = "ZALO_OA_SECRET_BRAND_1";
const SECRET = "synthetic-oa-secret-key";
const TIMESTAMP = "1794970800000";
const NOW = new Date("2026-11-18T03:00:01.000Z");
const TENANT = "11111111-1111-4111-8111-111111111111";
const OA_ROW = "00000000-0000-4000-8000-000000000001";
const OA_USER_ROW = "22222222-2222-4222-8222-222222222222";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const MINI_APP = "synthetic-mini-app-1";
const SUBSCRIBER = "900000777";
const NAME = "Khách Thử Nghiệm";

const BUTTONS = [
	{ action: "join", label: "Tham gia thành viên", target: "query" },
	{ action: "points", label: "Điểm của tôi", target: "mini_app" },
] as const;

const SENDING: FunctionEnvironment = {
	[SECRET_NAME]: SECRET,
	SUPABASE_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
	ZALO_INTEGRATION: "1",
	ZALO_TENANT_ID: TENANT,
	ZALO_OA_API_BASE_URL: "http://127.0.0.1:9",
	ZALO_OA_MESSAGES: "1",
};

const WELCOME: Reply = {
	kind: "welcome",
	text: "Cảm ơn bạn đã quan tâm.",
	buttons: BUTTONS,
	miniAppId: MINI_APP,
};

class CustomerFakeStore implements OaWebhookStore {
	readonly steps: { eventRow: string; input: CustomerInput }[] = [];
	readonly replies: ReplyRecord[] = [];
	answer: CustomerStep = {
		step: "ignored",
		oaUserRow: null,
		recipient: null,
		customerId: null,
		reply: null,
	};
	token: string | null = null;
	tenantId = TENANT;
	private rows = 0;

	async targets(): Promise<readonly OaTarget[]> {
		return [
			{
				oaId: OA_ROW,
				tenantId: this.tenantId,
				secretName: SECRET_NAME,
				webhookMode: "observe",
			},
		];
	}

	async receive(event: ReceivedEvent): Promise<Reception> {
		this.rows += 1;
		const verified = event.signature === "raw" || event.signature === "compact";
		return {
			outcome: "recorded",
			eventRow: `row-${this.rows}`,
			unverified: verified ? null : 1,
		};
	}

	async apply(): Promise<string> {
		return "ignored";
	}

	async raiseAlert(): Promise<string> {
		return "not_crossed";
	}

	async customerStep(
		eventRow: string,
		input: CustomerInput,
	): Promise<CustomerStep> {
		this.steps.push({ eventRow, input });
		return this.answer;
	}

	async accessToken(): Promise<string | null> {
		return this.token;
	}

	async recordReply(record: ReplyRecord): Promise<void> {
		this.replies.push(record);
	}
}

function stepWith(step: string, reply: Reply | null): CustomerStep {
	return {
		step,
		oaUserRow: OA_USER_ROW,
		recipient: USER_ID,
		customerId: reply?.kind === "joined" ? CUSTOMER : null,
		reply,
	};
}

function setup() {
	const mock = createMockZalo({ startAt: NOW.getTime() });
	const store = new CustomerFakeStore();
	store.token = mock.issueTokens(APP_ID, "oa").accessToken;
	mock.oaInteraction(APP_ID, USER_ID);
	const lines: string[] = [];
	const pending: Promise<unknown>[] = [];
	const handler = createOaWebhookHandler({
		store: () => store,
		clock: () => NOW,
		waitUntil: (promise) => {
			pending.push(promise);
		},
		ackDeadlineMs: 200,
		fetch: mock.fetch,
	});
	const send = async (body: string, environment = SENDING) => {
		const mac = await oaSignature(APP_ID, body, TIMESTAMP, SECRET);
		const response = await serveFunction(
			new Request(FUNCTION_URL, {
				method: "POST",
				body,
				headers: { [SIGNATURE_HEADER]: `mac=${mac}` },
			}),
			environment,
			handler,
			{ name: FUNCTION_NAME, origins: [], log: (line) => lines.push(line) },
		);
		await Promise.all(pending.splice(0));
		return response.status;
	};
	return { mock, store, lines, send };
}

function event(eventName: string, extra: Record<string, unknown> = {}): string {
	return JSON.stringify({
		app_id: APP_ID,
		oa_id: OA_ID,
		event_name: eventName,
		timestamp: TIMESTAMP,
		...(eventName === "follow"
			? { follower: { id: USER_ID } }
			: { sender: { id: USER_ID }, recipient: { id: OA_ID } }),
		...extra,
	});
}

Deno.test("a follow in the mock sends one welcome under the consultation policy, with the menu buttons", async () => {
	const test = setup();
	test.store.answer = stepWith("welcome", WELCOME);
	assertEquals(await test.send(event("follow")), 200, "answered");
	const messages = test.mock.oaMessages(APP_ID);
	assertEquals(messages.length, 1, "one message");
	assertEquals(
		messages[0]?.body,
		{
			recipient: { user_id: USER_ID },
			message: {
				text: "Cảm ơn bạn đã quan tâm.",
				attachment: {
					type: "template",
					payload: {
						buttons: [
							{
								title: "Tham gia thành viên",
								type: "oa.query.hide",
								payload: "#join",
							},
							{
								title: "Điểm của tôi",
								type: "oa.open.url",
								payload: {
									url: `https://zalo.me/s/${MINI_APP}/the-thanh-vien?src=oa`,
								},
							},
						],
					},
				},
			},
		},
		"the consultation message",
	);
	assertEquals(
		test.mock.requests(MOCK_OA_PATHS.message).length,
		1,
		"one call to the cs endpoint, none to another",
	);
	assertEquals(
		test.store.replies.map((reply) => [
			reply.kind,
			reply.status,
			reply.errorCode,
			reply.providerMessageId,
			reply.oaUserRow,
		]),
		[["welcome", "sent", null, messages[0]?.messageId, OA_USER_ROW]],
		"the send is logged",
	);
	assert(
		test.lines.some((line) =>
			line.endsWith("customer step welcome, welcome reply sent"),
		),
		`the outcome is logged: ${test.lines.join(" | ")}`,
	);
});

Deno.test("a form answer passes only the E.164 phone and the name to the step, and no log line carries them", async () => {
	const test = setup();
	test.store.answer = stepWith("joined", {
		kind: "joined",
		text: "Bạn đã là thành viên.",
		buttons: BUTTONS,
		miniAppId: MINI_APP,
	});
	await test.send(
		event("user_submit_info", {
			info: {
				name: NAME,
				phone: `0${SUBSCRIBER}`,
				address: "Số 1 Đường Thử",
				city: "Thành phố",
				user_dob: "01/01/2000",
				gender: "1",
			},
		}),
	);
	assertEquals(
		test.store.steps.map((step) => step.input),
		[{ kind: "form", phone: `+84${SUBSCRIBER}`, name: NAME }],
		"the step input",
	);
	assertEquals(
		test.store.replies.map((reply) => [
			reply.kind,
			reply.status,
			reply.customerId,
		]),
		[["joined", "sent", CUSTOMER]],
		"the joined reply is logged against the customer",
	);
	for (const line of test.lines) {
		for (const secret of [SUBSCRIBER, NAME, USER_ID, "Số 1 Đường Thử"]) {
			assert(!line.includes(secret), `a log line carries ${secret}: ${line}`);
		}
	}
});

Deno.test("the join keyword is answered with Zalo's request_user_info form", async () => {
	const test = setup();
	test.store.answer = stepWith("form", {
		kind: "form",
		title: "Tham gia thành viên",
		subtitle: "Chia sẻ tên và số điện thoại.",
		imageUrl: "https://example.com/brand-logo.png",
		buttons: BUTTONS,
		miniAppId: MINI_APP,
	});
	await test.send(
		event("user_send_text", { message: { text: "#join", msg_id: "m-1" } }),
	);
	assertEquals(
		test.store.steps.map((step) => step.input),
		[{ kind: "keyword", action: "join" }],
		"the keyword",
	);
	assertEquals(
		test.mock.oaMessages(APP_ID)[0]?.body.message,
		{
			attachment: {
				type: "template",
				payload: {
					template_type: "request_user_info",
					elements: [
						{
							title: "Tham gia thành viên",
							subtitle: "Chia sẻ tên và số điện thoại.",
							image_url: "https://example.com/brand-logo.png",
						},
					],
				},
			},
		},
		"the form",
	);
});

Deno.test("nothing is sent while ZALO_OA_MESSAGES is off, without a token or outside the fixture tenant", async () => {
	const off = setup();
	off.store.answer = stepWith("welcome", WELCOME);
	await off.send(event("follow"), { ...SENDING, ZALO_OA_MESSAGES: undefined });
	const tokenless = setup();
	tokenless.store.answer = stepWith("welcome", WELCOME);
	tokenless.store.token = null;
	await tokenless.send(event("follow"));
	const outside = setup();
	outside.store.answer = stepWith("welcome", WELCOME);
	outside.store.tenantId = "44444444-4444-4444-8444-444444444444";
	await outside.send(event("follow"));
	const misconfigured = setup();
	misconfigured.store.answer = stepWith("welcome", WELCOME);
	await misconfigured.send(event("follow"), {
		...SENDING,
		ZALO_OA_API_BASE_URL: undefined,
	});
	for (const test of [off, tokenless, outside, misconfigured]) {
		assertEquals(test.mock.oaMessages().length, 0, "nothing sent");
	}
	assertEquals(
		[off, tokenless, outside, misconfigured].map((test) =>
			test.store.replies.map((reply) => `${reply.status}:${reply.errorCode}`),
		),
		[
			["cancelled:messages_off"],
			["cancelled:no_token"],
			["cancelled:outside_fixture"],
			["cancelled:not_configured"],
		],
		"each reason is logged",
	);
});

Deno.test("a refusal by Zalo and an HTTP error are logged as failures", async () => {
	const refused = setup();
	refused.store.answer = stepWith("welcome", WELCOME);
	refused.mock.advance(8 * 86_400_000);
	refused.store.token = refused.mock.issueTokens(APP_ID, "oa").accessToken;
	await refused.send(event("follow"));
	const broken = setup();
	broken.store.answer = stepWith("welcome", WELCOME);
	broken.mock.failNext(MOCK_OA_PATHS.message, { kind: "status", status: 502 });
	assertEquals(await broken.send(event("follow")), 200, "still answered 200");
	assertEquals(
		[refused, broken].map((test) =>
			test.store.replies.map((reply) => `${reply.status}:${reply.errorCode}`),
		),
		[["failed:zalo_m230"], ["failed:upstream_status"]],
		"outside the API window Zalo refuses with -230; a 502 is a failure",
	);
	assertEquals(
		refused.mock.oaMessages().length + broken.mock.oaMessages().length,
		0,
		"nothing delivered",
	);
});

Deno.test("no reply is sent for a step without one", async () => {
	const test = setup();
	test.store.answer = stepWith("already_welcomed", null);
	await test.send(event("follow"));
	assertEquals(test.mock.oaMessages().length, 0, "nothing sent");
	assertEquals(test.store.replies.length, 0, "nothing logged");
	assert(
		test.lines.some((line) => line.endsWith("customer step already_welcomed")),
		"the step is logged",
	);
});

Deno.test("the step answer of the database is read strictly", () => {
	assertEquals(
		parseCustomerStep({
			step: "member",
			oa_user_row: OA_USER_ROW,
			recipient: USER_ID,
			customer_id: CUSTOMER,
			reply: {
				kind: "member",
				text: "Bạn đã là thành viên.",
				buttons: BUTTONS,
				mini_app_id: null,
			},
		}),
		{
			step: "member",
			oaUserRow: OA_USER_ROW,
			recipient: USER_ID,
			customerId: CUSTOMER,
			reply: {
				kind: "member",
				text: "Bạn đã là thành viên.",
				buttons: BUTTONS,
				miniAppId: null,
			},
		},
		"a member reply",
	);
	for (const bad of [
		{},
		{ step: "Bad Step" },
		{
			step: "welcome",
			reply: { kind: "promotion", text: "x", buttons: BUTTONS },
		},
		{ step: "welcome", reply: { kind: "welcome", text: "", buttons: BUTTONS } },
		{ step: "welcome", reply: { kind: "welcome", text: "x", buttons: [] } },
	]) {
		let threw = false;
		try {
			parseCustomerStep(bad);
		} catch {
			threw = true;
		}
		assert(threw, `refused ${JSON.stringify(bad)}`);
	}
	assertEquals(
		replyMessage(USER_ID, { ...WELCOME, miniAppId: null }).message,
		{
			text: "Cảm ơn bạn đã quan tâm.",
			attachment: {
				type: "template",
				payload: {
					buttons: [
						{
							title: "Tham gia thành viên",
							type: "oa.query.hide",
							payload: "#join",
						},
					],
				},
			},
		},
		"without a Mini App only the keyword button remains",
	);
	assertEquals(zaloErrorCode(-230), "zalo_m230", "error code");
});
