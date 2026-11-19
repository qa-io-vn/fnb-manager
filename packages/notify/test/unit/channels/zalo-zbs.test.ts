import { describe, expect, it } from "vitest";
import {
	type CustomerSendContext,
	OA_ERRORS,
	sendConsultation,
	sendZbsTemplate,
	USER_AGENT,
	ZALO_OA_BASE_URL,
	ZBS_BASE_URL,
	ZBS_ERRORS,
	type ZbsTemplateRequest,
} from "../../../src/index.js";
import { createMockZbs } from "../../../src/testing/index.js";
import { type FakeAnswer, fakeFetch } from "../../support/fake-fetch.js";

const TOKEN = "synthetic-oa-access-token";
const AT = new Date("2026-11-20T05:00:00.000Z");
const PHONE = `84${"900000"}101`;

const REQUEST: ZbsTemplateRequest = {
	trackingId: "11111111-1111-4111-8111-111111111111",
	templateId: "syn-tpl-voucher",
	recipient: { kind: "phone", phone: PHONE },
	data: {
		customer_name: "Synthetic A",
		voucher_code: "SYN00001",
		reward_name: "Một ly nước miễn phí",
		expires_at: "21:00 20/11/2026",
	},
};

function context(
	fetchLike: CustomerSendContext["fetch"],
	baseUrl = ZBS_BASE_URL,
	timeoutMs = 10_000,
): CustomerSendContext {
	return {
		accessToken: TOKEN,
		fetch: fetchLike,
		baseUrl,
		timeoutMs,
		userAgent: USER_AGENT,
		now: () => AT,
	};
}

async function templateWith(answer: FakeAnswer) {
	const fake = fakeFetch();
	fake.answer(answer);
	const outcome = await sendZbsTemplate(REQUEST, context(fake.fetch));
	return { outcome, fake };
}

function errorAnswer(error: number): FakeAnswer {
	return { status: 200, body: { error, message: "synthetic" } };
}

describe("ZBS template channel", () => {
	it("posts the template id, the recipient, the parameters and the tracking id with the OA access token", async () => {
		const { outcome, fake } = await templateWith({
			status: 200,
			body: { error: 0, message: "Success", data: { msg_id: "zbs-1" } },
		});
		expect(outcome).toEqual({ kind: "sent", providerMessageId: "zbs-1" });
		const request = fake.requests[0];
		expect(request?.url).toBe(`${ZBS_BASE_URL}/message/template`);
		expect(request?.method).toBe("POST");
		expect(request?.headers.access_token).toBe(TOKEN);
		expect(request?.headers["content-type"]).toContain("application/json");
		expect(request?.headers["user-agent"]).toBe(USER_AGENT);
		expect(request?.body).toEqual({
			phone: PHONE,
			template_id: "syn-tpl-voucher",
			template_data: REQUEST.data,
			tracking_id: REQUEST.trackingId,
		});
	});

	it("sends to an OA user id instead of a phone when the customer has one", async () => {
		const fake = fakeFetch();
		fake.answer({ status: 200, body: { error: 0, data: { msg_id: 7 } } });
		const outcome = await sendZbsTemplate(
			{ ...REQUEST, recipient: { kind: "uid", userId: "syn-oa-user" } },
			context(fake.fetch),
		);
		expect(outcome).toEqual({ kind: "sent", providerMessageId: "7" });
		expect(fake.requests[0]?.body).toMatchObject({ user_id: "syn-oa-user" });
		expect(fake.requests[0]?.body).not.toHaveProperty("phone");
	});

	it.each([
		[
			ZBS_ERRORS.accessTokenInvalid,
			{ kind: "failed", code: "token_invalid", scope: "channel" },
		],
		[
			ZBS_ERRORS.balanceInsufficient,
			{ kind: "failed", code: "balance_insufficient", scope: "channel" },
		],
		[
			ZBS_ERRORS.notPermitted,
			{ kind: "failed", code: "not_permitted", scope: "channel" },
		],
		[
			ZBS_ERRORS.dailyQuota,
			{ kind: "retry", code: "quota_exceeded", retryAfterSeconds: 3600 },
		],
		[
			ZBS_ERRORS.templateQuota,
			{ kind: "retry", code: "quota_exceeded", retryAfterSeconds: 3600 },
		],
		[
			ZBS_ERRORS.nightTime,
			{ kind: "retry", code: "outside_hours", retryAfterSeconds: 1800 },
		],
		[
			ZBS_ERRORS.rateLimited,
			{ kind: "retry", code: "rate_limited", retryAfterSeconds: 60 },
		],
		[
			ZBS_ERRORS.phoneInvalid,
			{ kind: "failed", code: "user_unreachable", scope: "message" },
		],
		[
			ZBS_ERRORS.userInactive,
			{ kind: "failed", code: "user_unreachable", scope: "message" },
		],
		[
			ZBS_ERRORS.accountMissing,
			{ kind: "failed", code: "user_unreachable", scope: "message" },
		],
		[
			ZBS_ERRORS.cannotReceive,
			{ kind: "failed", code: "user_unreachable", scope: "message" },
		],
		[
			ZBS_ERRORS.userRefused,
			{ kind: "failed", code: "user_unreachable", scope: "message" },
		],
		[
			ZBS_ERRORS.templateInvalid,
			{ kind: "failed", code: "template_rejected", scope: "message" },
		],
		[
			ZBS_ERRORS.templateDataInvalid,
			{ kind: "failed", code: "template_rejected", scope: "message" },
		],
		[
			ZBS_ERRORS.templateNotApproved,
			{ kind: "failed", code: "template_rejected", scope: "message" },
		],
		[
			ZBS_ERRORS.parameterInvalid,
			{ kind: "failed", code: "template_rejected", scope: "message" },
		],
		[-199, { kind: "failed", code: "zbs_error_199", scope: "message" }],
	])("maps ZBS error %i", async (error, expected) => {
		const { outcome } = await templateWith(errorAnswer(error));
		expect(outcome).toEqual(expected);
	});

	it("reads the error code when ZBS sends it as text", async () => {
		const { outcome } = await templateWith({
			status: 200,
			body: { error: "-124", message: "synthetic" },
		});
		expect(outcome).toEqual({
			kind: "failed",
			code: "token_invalid",
			scope: "channel",
		});
	});

	it("maps the HTTP failures", async () => {
		expect(
			(await templateWith({ status: 429, headers: { "retry-after": "120" } }))
				.outcome,
		).toEqual({
			kind: "retry",
			code: "rate_limited",
			retryAfterSeconds: 120,
		});
		expect((await templateWith({ status: 401 })).outcome).toEqual({
			kind: "failed",
			code: "token_invalid",
			scope: "channel",
		});
		expect((await templateWith({ status: 503 })).outcome).toEqual({
			kind: "retry",
			code: "http_503",
			retryAfterSeconds: null,
		});
		expect((await templateWith({ status: 404 })).outcome).toEqual({
			kind: "failed",
			code: "http_404",
			scope: "message",
		});
	});

	it("treats an unreadable success as uncertain, never as sent", async () => {
		expect(
			(await templateWith({ status: 200, raw: "<html>" })).outcome,
		).toEqual({
			kind: "uncertain",
			code: "bad_response",
		});
	});

	it("leaves a provider timeout uncertain so the message is never resent", async () => {
		const fake = fakeFetch();
		fake.answer({ waitForAbort: true });
		const outcome = await sendZbsTemplate(
			REQUEST,
			context(fake.fetch, ZBS_BASE_URL, 20),
		);
		expect(outcome).toEqual({ kind: "uncertain", code: "timeout" });
	});

	it("retries when no connection was ever made and stays uncertain when it was lost", async () => {
		expect((await templateWith({ reject: "network" })).outcome).toEqual({
			kind: "retry",
			code: "network",
			retryAfterSeconds: null,
		});
		expect((await templateWith({ reject: "connection_lost" })).outcome).toEqual(
			{
				kind: "uncertain",
				code: "connection_lost",
			},
		);
	});

	it("never puts the access token, the phone or a parameter into an outcome", async () => {
		const answers: FakeAnswer[] = [
			{ status: 200, body: { error: 0, data: { msg_id: "x" } } },
			errorAnswer(ZBS_ERRORS.accessTokenInvalid),
			{ status: 500 },
			{ reject: "unclassified" },
			{ waitForAbort: true },
		];
		for (const answer of answers) {
			const fake = fakeFetch();
			fake.answer(answer);
			const outcome = await sendZbsTemplate(
				REQUEST,
				context(fake.fetch, ZBS_BASE_URL, 20),
			);
			const text = JSON.stringify(outcome);
			expect(text).not.toContain(TOKEN);
			expect(text).not.toContain(PHONE);
			expect(text).not.toContain("Synthetic A");
			expect(text).not.toContain("SYN00001");
		}
	});
});

describe("OA consultation messages", () => {
	async function consultationWith(answer: FakeAnswer) {
		const fake = fakeFetch();
		fake.answer(answer);
		const outcome = await sendConsultation(
			{ userId: "syn-oa-user", text: "Chào Synthetic A" },
			context(fake.fetch, ZALO_OA_BASE_URL),
		);
		return { outcome, fake };
	}

	it("posts the text to the OA user with the access token", async () => {
		const { outcome, fake } = await consultationWith({
			status: 200,
			body: { error: 0, data: { message_id: "cs-1", user_id: "syn-oa-user" } },
		});
		expect(outcome).toEqual({ kind: "sent", providerMessageId: "cs-1" });
		expect(fake.requests[0]?.url).toBe(
			`${ZALO_OA_BASE_URL}/v3.0/oa/message/cs`,
		);
		expect(fake.requests[0]?.headers.access_token).toBe(TOKEN);
		expect(fake.requests[0]?.body).toEqual({
			recipient: { user_id: "syn-oa-user" },
			message: { text: "Chào Synthetic A" },
		});
	});

	it("hands a closed window back for the template route", async () => {
		expect(
			(await consultationWith(errorAnswer(OA_ERRORS.outsideWindow))).outcome,
		).toEqual({
			kind: "reroute",
			code: "window_closed",
		});
		expect(
			(await consultationWith(errorAnswer(OA_ERRORS.userNotFollowing))).outcome,
		).toEqual({
			kind: "reroute",
			code: "user_unreachable",
		});
	});

	it("maps the token, rate and parameter errors", async () => {
		expect(
			(await consultationWith(errorAnswer(OA_ERRORS.accessTokenInvalid)))
				.outcome,
		).toEqual({
			kind: "failed",
			code: "token_invalid",
			scope: "channel",
		});
		expect(
			(await consultationWith(errorAnswer(OA_ERRORS.rateLimited))).outcome,
		).toEqual({
			kind: "retry",
			code: "rate_limited",
			retryAfterSeconds: 60,
		});
		expect(
			(await consultationWith(errorAnswer(OA_ERRORS.parameterInvalid))).outcome,
		).toEqual({
			kind: "failed",
			code: "bad_request",
			scope: "message",
		});
		expect((await consultationWith(errorAnswer(-999))).outcome).toEqual({
			kind: "failed",
			code: "zalo_oa_error_999",
			scope: "message",
		});
	});
});

describe("the mock ZBS provider", () => {
	it("accepts a registered template with exactly its parameters and refuses anything else", async () => {
		const mock = createMockZbs();
		mock.registerToken(TOKEN);
		mock.registerTemplate("syn-tpl-voucher", Object.keys(REQUEST.data));
		const send = (request: ZbsTemplateRequest, token = TOKEN) =>
			sendZbsTemplate(request, {
				...context(mock.fetch, "http://127.0.0.1:9"),
				accessToken: token,
			});
		expect((await send(REQUEST)).kind).toBe("sent");
		expect(mock.templates()).toHaveLength(1);
		expect(mock.templates()[0]).toMatchObject({
			templateId: "syn-tpl-voucher",
			phone: PHONE,
			trackingId: REQUEST.trackingId,
		});
		expect(await send(REQUEST, "wrong-token")).toEqual({
			kind: "failed",
			code: "token_invalid",
			scope: "channel",
		});
		expect(await send({ ...REQUEST, templateId: "unknown" })).toEqual({
			kind: "failed",
			code: "template_rejected",
			scope: "message",
		});
		expect(
			await send({ ...REQUEST, data: { customer_name: "Synthetic A" } }),
		).toEqual({ kind: "failed", code: "template_rejected", scope: "message" });
		expect(
			await send({
				...REQUEST,
				recipient: { kind: "phone", phone: "0900000101" },
			}),
		).toEqual({ kind: "failed", code: "user_unreachable", scope: "message" });
		expect(mock.templates()).toHaveLength(1);
	});

	it("refuses a consultation message outside the user's window", async () => {
		const mock = createMockZbs();
		mock.registerToken(TOKEN);
		const send = () =>
			sendConsultation(
				{ userId: "syn-oa-user", text: "Chào" },
				context(mock.fetch, "http://127.0.0.1:9"),
			);
		expect(await send()).toEqual({ kind: "reroute", code: "window_closed" });
		mock.openWindow("syn-oa-user");
		expect((await send()).kind).toBe("sent");
		expect(mock.consultations()).toHaveLength(1);
	});

	it("can hang to stand for a provider timeout", async () => {
		const mock = createMockZbs();
		mock.registerToken(TOKEN);
		mock.registerTemplate("syn-tpl-voucher", Object.keys(REQUEST.data));
		mock.failNext("/message/template", { kind: "accept_then_hang" });
		const outcome = await sendZbsTemplate(
			REQUEST,
			context(mock.fetch, "http://127.0.0.1:9", 20),
		);
		expect(outcome).toEqual({ kind: "uncertain", code: "timeout" });
		expect(mock.templates()).toHaveLength(1);
	});
});
