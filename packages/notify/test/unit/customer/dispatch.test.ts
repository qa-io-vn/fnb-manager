import { describe, expect, it } from "vitest";
import {
	type CustomerClaim,
	type CustomerClaimRequest,
	type CustomerFinishRequest,
	type CustomerRepository,
	createCycleBudget,
	customerBaseUrls,
	customerBaseUrlWarnings,
	customerMessagesEnabled,
	customerRoutes,
	emptyCycleReport,
	renderCustomerMessage,
	runCustomerStep,
	ZALO_OA_BASE_URL,
	ZBS_BASE_URL,
	ZBS_TEMPLATE_DRAFTS,
} from "../../../src/index.js";
import { createMockZbs, type MockZbs } from "../../../src/testing/index.js";

const TOKEN = "synthetic-oa-access-token";
const LOOPBACK = "http://127.0.0.1:9999";
const AT = new Date("2026-11-20T05:00:00.000Z");

const PARAMETERS = {
	customer_name: "Synthetic A",
	points: 6,
	stamps: 1,
	bill_no: "001234",
	store_name: "Cửa hàng 1",
	reward_name: "Một ly nước miễn phí",
	voucher_code: "SYN00001",
	expires_at: "21:00 20/11/2026",
};

function claim(overrides: Partial<CustomerClaim> = {}): CustomerClaim {
	return {
		messageId: "11111111-1111-4111-8111-111111111111",
		claimedAt: "2026-11-20 05:00:00+00",
		tenantId: "dddddddd-dddd-4ddd-8ddd-000000000001",
		kind: "coupon_issued",
		route: "template",
		attempts: 1,
		oaId: "66666666-6666-4666-8666-000000000001",
		window: null,
		templateExternalId: "syn-tpl-voucher",
		templatePurpose: "voucher",
		recipient: { kind: "phone", phone: `84${"900000"}101` },
		parameters: PARAMETERS,
		readerTimezone: "Asia/Ho_Chi_Minh",
		...overrides,
	};
}

interface MemoryCustomers extends CustomerRepository {
	readonly finished: CustomerFinishRequest[];
	readonly begun: string[];
	readonly requests: CustomerClaimRequest[];
}

function memoryCustomers(
	claims: CustomerClaim[],
	token: string | null = TOKEN,
): MemoryCustomers {
	const queue = [...claims];
	const finished: CustomerFinishRequest[] = [];
	const begun: string[] = [];
	const requests: CustomerClaimRequest[] = [];
	return {
		finished,
		begun,
		requests,
		enqueueReminders: async () => ({
			voucher_expiring: 1,
			expiry_reminder: 0,
			win_back: 0,
		}),
		claimNext: async (request) => {
			requests.push(request);
			return queue.shift() ?? null;
		},
		beginSend: async (messageId) => {
			begun.push(messageId);
			return true;
		},
		finishSend: async (request) => {
			finished.push(request);
			return request.outcome;
		},
		accessToken: async () => token,
	};
}

function zbsMock(): MockZbs {
	const mock = createMockZbs();
	mock.registerToken(TOKEN);
	mock.registerTemplate(
		"syn-tpl-voucher",
		ZBS_TEMPLATE_DRAFTS.voucher.parameters.map((parameter) => parameter.name),
	);
	return mock;
}

async function run(
	repository: CustomerRepository,
	mock: MockZbs,
	environment: Record<string, string>,
) {
	const report = emptyCycleReport();
	const logs: string[] = [];
	await runCustomerStep(
		{
			repository,
			environment,
			fetch: mock.fetch,
			clock: () => AT,
			worker: "unit",
			tenantId: null,
			budget: createCycleBudget({
				wallSeconds: 60,
				maxDigests: 0,
				maxSends: 10,
				linkPollSeconds: 0,
			}),
			log: (line) => logs.push(line),
			requestTimeoutMs: 20,
		},
		report,
	);
	return { report, logs };
}

const MOCK_ENVIRONMENT = {
	NOTIFY_ZBS_BASE_URL: LOOPBACK,
	NOTIFY_ZALO_OA_BASE_URL: LOOPBACK,
};

describe("customer message configuration", () => {
	it("is off unless switched on", () => {
		expect(customerMessagesEnabled({})).toBe(false);
		expect(customerMessagesEnabled({ NOTIFY_CUSTOMER_MESSAGES: "yes" })).toBe(
			false,
		);
		expect(customerMessagesEnabled({ NOTIFY_CUSTOMER_MESSAGES: "on" })).toBe(
			true,
		);
	});

	it("reaches the real Zalo hosts only behind the live switch", () => {
		expect(customerRoutes({})).toEqual([]);
		expect(customerBaseUrls({ NOTIFY_CUSTOMER_LIVE: "1" })).toEqual({
			consultation: ZALO_OA_BASE_URL,
			template: ZBS_BASE_URL,
		});
		expect(customerRoutes({ NOTIFY_CUSTOMER_LIVE: "1" })).toEqual([
			"consultation",
			"template",
		]);
	});

	it("takes a loopback mock and refuses any other host", () => {
		expect(customerRoutes({ NOTIFY_ZBS_BASE_URL: LOOPBACK })).toEqual([
			"template",
		]);
		expect(
			customerRoutes({ NOTIFY_ZBS_BASE_URL: "https://example.com" }),
		).toEqual([]);
		expect(
			customerBaseUrlWarnings({ NOTIFY_ZBS_BASE_URL: "https://example.com" }),
		).toHaveLength(1);
		expect(
			customerBaseUrls({
				NOTIFY_ZALO_OA_BASE_URL: LOOPBACK,
				NOTIFY_CUSTOMER_LIVE: "1",
			}).consultation,
		).toBe(LOOPBACK);
	});
});

describe("rendering a claimed customer message", () => {
	it("fills the template data of the claimed template", () => {
		expect(renderCustomerMessage(claim())).toEqual({
			route: "template",
			templateId: "syn-tpl-voucher",
			recipient: { kind: "phone", phone: `84${"900000"}101` },
			data: {
				customer_name: "Synthetic A",
				voucher_code: "SYN00001",
				reward_name: "Một ly nước miễn phí",
				expires_at: "21:00 20/11/2026",
			},
		});
	});

	it("writes the consultation text for an OA user", () => {
		const rendered = renderCustomerMessage(
			claim({
				kind: "points_confirmed",
				route: "consultation",
				recipient: { kind: "uid", userId: "syn-oa-user" },
				templateExternalId: null,
				templatePurpose: null,
			}),
		);
		expect(rendered).toEqual({
			route: "consultation",
			userId: "syn-oa-user",
			text: "Chào Synthetic A, hóa đơn 001234 tại Cửa hàng 1 đã được ghi nhận. Bạn vừa nhận 6 điểm và 1 dấu. Mở ứng dụng thành viên để xem số dư và ưu đãi của bạn.",
		});
	});
});

describe("the customer step of a cycle", () => {
	it("queues the reminders, sends a template and records it as sent", async () => {
		const mock = zbsMock();
		const repository = memoryCustomers([claim()]);
		const { report } = await run(repository, mock, MOCK_ENVIRONMENT);
		expect(repository.requests[0]?.routes).toEqual([
			"consultation",
			"template",
		]);
		expect(mock.templates()).toHaveLength(1);
		expect(mock.templates()[0]?.trackingId).toBe(claim().messageId);
		expect(repository.begun).toEqual([claim().messageId]);
		expect(
			repository.finished.map((request) => [
				request.outcome,
				request.providerMessageId,
			]),
		).toEqual([["sent", mock.templates()[0]?.msgId]]);
		expect(report.get("customer_reminders")).toBe(1);
		expect(report.get("customer_claimed")).toBe(1);
		expect(report.get("customer_sent")).toBe(1);
	});

	it("leaves a timed-out template uncertain", async () => {
		const mock = zbsMock();
		mock.failNext("/message/template", { kind: "accept_then_hang" });
		const repository = memoryCustomers([claim()]);
		const { report } = await run(repository, mock, MOCK_ENVIRONMENT);
		expect(
			repository.finished.map((request) => [request.outcome, request.code]),
		).toEqual([["uncertain", "timeout"]]);
		expect(report.get("customer_uncertain")).toBe(1);
	});

	it("hands a consultation refused by the OA back to the routing", async () => {
		const mock = zbsMock();
		const repository = memoryCustomers([
			claim({
				kind: "points_confirmed",
				route: "consultation",
				window: "free",
				recipient: { kind: "uid", userId: "syn-oa-user" },
				templateExternalId: null,
				templatePurpose: null,
			}),
		]);
		const { report } = await run(repository, mock, MOCK_ENVIRONMENT);
		expect(
			repository.finished.map((request) => [request.outcome, request.code]),
		).toEqual([["reroute", "window_closed"]]);
		expect(report.get("customer_rerouted")).toBe(1);
	});

	it("waits for an OA token without calling Zalo", async () => {
		const mock = zbsMock();
		const repository = memoryCustomers([claim()], null);
		await run(repository, mock, MOCK_ENVIRONMENT);
		expect(mock.requestHeaders()).toHaveLength(0);
		expect(repository.begun).toEqual([]);
		expect(
			repository.finished.map((request) => [
				request.outcome,
				request.code,
				request.retryAfterSeconds,
			]),
		).toEqual([["retry", "token_missing", 900]]);
	});

	it("fails a message whose parameters are missing before any call", async () => {
		const mock = zbsMock();
		const repository = memoryCustomers([
			claim({ parameters: { customer_name: "Synthetic A" } }),
		]);
		const { report } = await run(repository, mock, MOCK_ENVIRONMENT);
		expect(mock.requestHeaders()).toHaveLength(0);
		expect(
			repository.finished.map((request) => [request.outcome, request.code]),
		).toEqual([["failed", "missing_parameter"]]);
		expect(report.get("render_failed")).toBe(1);
	});

	it("claims with no route when no Zalo host is configured, so only in-app messages close", async () => {
		const mock = zbsMock();
		const repository = memoryCustomers([]);
		await run(repository, mock, {});
		expect(repository.requests[0]?.routes).toEqual([]);
	});

	it("sends the access token only in the request header and never logs it", async () => {
		const mock = zbsMock();
		const repository = memoryCustomers([claim()]);
		const { logs } = await run(repository, mock, {
			...MOCK_ENVIRONMENT,
			NOTIFY_ZBS_BASE_URL: "https://example.com",
			NOTIFY_ZALO_OA_BASE_URL: LOOPBACK,
		});
		expect(logs.join("\n")).not.toContain(TOKEN);
		expect(JSON.stringify(repository.finished)).not.toContain(TOKEN);
		expect(repository.finished[0]).toMatchObject({
			outcome: "retry",
			code: "route_unavailable",
		});
	});
});
