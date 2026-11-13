import { describe, expect, it } from "vitest";
import type { DigestBuilder } from "../../../src/index.js";
import {
	type AdapterRegistry,
	type ChannelAdapter,
	CLI_CYCLE_LIMITS,
	type CycleBudgetLimits,
	createAdapterRegistry,
	createCycleBudget,
	failureOutcome,
	runNotifyCycle,
	timedFetch,
	USER_AGENT,
} from "../../../src/index.js";
import { type FakeAnswer, fakeFetch } from "../../support/fake-fetch.js";
import { MemoryRepository } from "../../support/memory-repository.js";

const TOKEN = "synthetic-bot-token";
const ENVIRONMENT = {
	NOTIFY_ZALO_BOT_TOKEN: TOKEN,
	NOTIFY_EMAIL_API_KEY: "synthetic-email-key",
};

interface Harness {
	repository: MemoryRepository;
	fake: ReturnType<typeof fakeFetch>;
	sleeps: number[];
	logs: string[];
}

function harness(...answers: FakeAnswer[]): Harness {
	const fake = fakeFetch();
	fake.answer(...answers);
	return { repository: new MemoryRepository(), fake, sleeps: [], logs: [] };
}

function run(
	h: Harness,
	options: {
		at?: Date;
		adapters?: AdapterRegistry;
		environment?: Record<string, string>;
		limits?: Partial<CycleBudgetLimits>;
		dryRun?: boolean;
		runSqlTick?: boolean;
		tenantId?: string | null;
		digests?: DigestBuilder;
	} = {},
) {
	return runNotifyCycle({
		...(options.digests === undefined ? {} : { digests: options.digests }),
		repository: h.repository,
		adapters: options.adapters ?? createAdapterRegistry(),
		environment: options.environment ?? ENVIRONMENT,
		runtime: "cli",
		worker: "cli:test",
		tenantId: options.tenantId === undefined ? "tenant-1" : options.tenantId,
		clock: () => options.at ?? new Date("2026-11-09T02:05:00.000Z"),
		fetch: h.fake.fetch,
		log: (line) => h.logs.push(line),
		budget: createCycleBudget({
			...CLI_CYCLE_LIMITS,
			linkPollSeconds: 0,
			...(options.limits ?? {}),
		}),
		runSqlTick: options.runSqlTick ?? false,
		dryRun: options.dryRun ?? false,
		sleep: async (milliseconds) => {
			h.sleeps.push(milliseconds);
		},
	});
}

function idempotentAdapter(): ChannelAdapter {
	return {
		provider: "resend",
		kind: "email",
		available: true,
		limits: {
			maxTextUnits: 8000,
			maxSubjectChars: 120,
			supportsHtml: true,
			idempotent: true,
			minSpacingMs: 0,
		},
		async send(message, destination, context) {
			const result = await timedFetch(
				context.fetch,
				`${context.baseUrl}/emails`,
				{
					method: "POST",
					headers: {
						"user-agent": context.userAgent,
						"idempotency-key": message.messageId,
					},
					body: JSON.stringify({
						to: [destination.address],
						subject: message.subject,
						text: message.text,
					}),
				},
				context.timeoutMs,
			);
			if (result.kind === "failure") {
				return failureOutcome(result.code, true);
			}
			return { kind: "sent", providerMessageId: "email-1" };
		},
	};
}

describe("runNotifyCycle", () => {
	it("claims, renders, begins, sends and finishes, and records the secret names it holds", async () => {
		const h = harness({
			status: 200,
			body: { ok: true, result: { message_id: "zalo-1" } },
		});
		const message = h.repository.addMessage({ kind: "test" });
		const report = await run(h);
		expect(report.get("sent")).toBe(1);
		expect(message.status).toBe("sent");
		expect(message.providerMessageId).toBe("zalo-1");
		expect(message.body).toBe(
			"Tin thử từ FNB Manager: kênh Zalo Bot hoạt động lúc 09:05 09/11/2026. Đây là tin nhắn tự động.",
		);
		expect(h.fake.requests[0]?.body).toEqual({
			chat_id: "synthetic-chat-1",
			text: message.body,
		});
		expect(h.fake.requests[0]?.headers["user-agent"]).toBe(USER_AGENT);
		expect(h.repository.dispatches).toHaveLength(1);
		expect(h.repository.dispatches[0]?.secretNames).toEqual([
			"NOTIFY_EMAIL_API_KEY",
			"NOTIFY_ZALO_BOT_TOKEN",
		]);
		expect(JSON.stringify(h.repository.dispatches)).not.toContain(TOKEN);
		expect(h.repository.claims[0]?.secretNames).toEqual([
			"NOTIFY_EMAIL_API_KEY",
			"NOTIFY_ZALO_BOT_TOKEN",
		]);
		expect(h.repository.claims[0]?.tenantId).toBe("tenant-1");
	});

	it("stores the render once and sends the same bytes on a retry", async () => {
		const h = harness(
			{ status: 503, body: {} },
			{ status: 200, body: { ok: true, result: { message_id: "zalo-2" } } },
		);
		const message = h.repository.addMessage({ kind: "test" });
		const first = await run(h, { at: new Date("2026-11-09T02:05:00.000Z") });
		expect(first.get("retried")).toBe(1);
		expect(message.status).toBe("queued");
		const second = await run(h, { at: new Date("2026-11-09T03:40:00.000Z") });
		expect(second.get("sent")).toBe(1);
		expect(message.begins).toBe(2);
		expect(h.fake.requests).toHaveLength(2);
		expect(h.fake.requests[1]?.body).toEqual(h.fake.requests[0]?.body);
		expect(message.body).toContain("09:05");
	});

	it("skips a message whose lease was lost before the send started", async () => {
		const h = harness();
		h.repository.stealLeaseOnBegin = true;
		h.repository.addMessage({ kind: "test" });
		const report = await run(h);
		expect(report.get("lost_lease")).toBe(1);
		expect(h.fake.requests).toHaveLength(0);
	});

	it("passes the provider's retry-after to the finish", async () => {
		const h = harness({
			status: 429,
			body: {},
			headers: { "retry-after": "120" },
		});
		const message = h.repository.addMessage({ kind: "test" });
		await run(h);
		expect(message.finishes[0]).toMatchObject({
			outcome: "retry",
			code: "quota_exceeded",
			retryAfterSeconds: 120,
			idempotent: false,
		});
	});

	it("marks a Zalo timeout uncertain and retries a timeout on an idempotent provider", async () => {
		const h = harness({ reject: "timeout" }, { reject: "timeout" });
		const zalo = h.repository.addMessage({ kind: "test" });
		const email = h.repository.addMessage({
			kind: "test",
			channelId: "channel-2",
			channelKind: "email",
			provider: "resend",
			secretName: "NOTIFY_EMAIL_API_KEY",
			address: "owner@example.com",
		});
		const adapters = {
			...createAdapterRegistry(),
			resend: idempotentAdapter(),
		};
		const report = await run(h, { adapters });
		expect(zalo.status).toBe("uncertain");
		expect(zalo.finishes[0]).toMatchObject({
			outcome: "uncertain",
			code: "timeout",
			idempotent: false,
		});
		expect(email.status).toBe("queued");
		expect(email.finishes[0]).toMatchObject({
			outcome: "retry",
			code: "timeout",
			idempotent: true,
		});
		expect(report.get("uncertain")).toBe(1);
		expect(report.get("retried")).toBe(1);
	});

	it("sends a digest e-mail whose inbox preview carries no amount", async () => {
		const h = harness({
			status: 201,
			body: { messageId: "<brevo-1@example.com>" },
		});
		const body = [
			"Bản tin ngày 07/11/2026 (Thứ Bảy)",
			"Tất cả 2 cửa hàng · đã đối soát",
			"",
			"Doanh thu thuần: 12.345.000 ₫",
			"• So với mức nền cùng thứ: -8,2%",
		].join("\n");
		const message = h.repository.addMessage({
			kind: "digest",
			channelId: "channel-2",
			channelKind: "email",
			provider: "brevo",
			secretName: "NOTIFY_EMAIL_API_KEY",
			address: "owner@example.com",
			title: "Bản tin ngày 07/11/2026 · Tất cả 2 cửa hàng",
			body,
		});
		await run(h, {
			environment: { ...ENVIRONMENT, NOTIFY_EMAIL_FROM: "sender@example.com" },
		});
		expect(message.status).toBe("sent");
		const sent = h.fake.requests[0]?.body as {
			htmlContent: string;
			textContent: string;
		};
		const visible = sent.htmlContent
			.replace(/<head>.*?<\/head>/s, "")
			.replace(/<[^>]+>/g, " ")
			.replaceAll("&zwnj;", "‌")
			.replaceAll("&nbsp;", " ")
			.replaceAll("&amp;", "&")
			.replace(/\s+/g, " ")
			.trim();
		const preview = visible.slice(0, 150);
		expect(
			preview.startsWith(
				"Bản tin ngày 07/11/2026 (Thứ Bảy) · Tất cả 2 cửa hàng · đã đối soát",
			),
		).toBe(true);
		expect(preview).not.toContain("₫");
		expect(preview).not.toContain("%");
		expect(visible).toContain("Doanh thu thuần: 12.345.000 ₫");
		expect(sent.textContent).toBe(body);
	});

	it("never claims a message whose secret this runtime lacks", async () => {
		const h = harness();
		const other = h.repository.addMessage({
			kind: "test",
			secretName: "NOTIFY_ZALO_BOT_TOKEN_2",
		});
		const report = await run(h);
		expect(report.get("claimed")).toBe(0);
		expect(other.status).toBe("queued");
		expect(h.fake.requests).toHaveLength(0);
	});

	it("claims nothing when no secret of a built adapter is present", async () => {
		const h = harness();
		h.repository.addMessage({ kind: "test" });
		await run(h, {
			environment: { NOTIFY_TELEGRAM_BOT_TOKEN: "synthetic-telegram-token" },
		});
		expect(h.repository.claims).toHaveLength(0);
	});

	it("stops taking new work when the budget is spent", async () => {
		const h = harness();
		for (let index = 0; index < 5; index += 1) {
			h.repository.addMessage({
				kind: "test",
				channelId: `channel-${index}`,
				address: `synthetic-chat-${index}`,
			});
		}
		const report = await run(h, { limits: { maxSends: 2 } });
		expect(report.get("sent")).toBe(2);
		expect(report.stoppedBy).toBe("sends");
		expect(
			h.repository.messages.filter((message) => message.status === "queued"),
		).toHaveLength(3);
		const expired = await run(h, { limits: { wallSeconds: 0 } });
		expect(expired.get("claimed")).toBe(0);
		expect(expired.stoppedBy).toBe("wall_clock");
	});

	it("waits the provider's spacing between two sends to one chat", async () => {
		const h = harness();
		h.repository.addMessage({ kind: "test" });
		h.repository.addMessage({ kind: "test" });
		h.repository.addMessage({
			kind: "test",
			channelId: "channel-9",
			address: "synthetic-chat-9",
		});
		const report = await run(h);
		expect(report.get("sent")).toBe(3);
		expect(h.sleeps).toHaveLength(1);
		expect(h.sleeps[0]).toBeGreaterThan(1000);
		expect(h.sleeps[0]).toBeLessThanOrEqual(1100);
	});

	it("retries a failed finish three times and then leaves the row to the lease recovery", async () => {
		const h = harness();
		const recorded = h.repository.addMessage({ kind: "test" });
		h.repository.failFinishes = 2;
		await run(h);
		expect(recorded.status).toBe("sent");
		const h2 = harness();
		const stuck = h2.repository.addMessage({ kind: "test" });
		h2.repository.failFinishes = 10;
		const report = await run(h2);
		expect(report.get("finish_errors")).toBe(1);
		expect(stuck.status).toBe("sending");
		expect(h2.sleeps).toEqual([200, 1000, 3000]);
		expect(h2.logs.join("\n")).not.toContain(TOKEN);
	});

	it("fails a message it cannot render instead of sending a placeholder", async () => {
		const h = harness();
		const alert = h.repository.addMessage({ kind: "digest" });
		const report = await run(h);
		expect(report.get("render_failed")).toBe(1);
		expect(alert.status).toBe("failed");
		expect(alert.finishes[0]).toMatchObject({
			outcome: "failed",
			code: "render_failed",
			scope: "message",
		});
		expect(h.fake.requests).toHaveLength(0);
	});

	it("sends a stored body as it is and fits it to the provider's limit", async () => {
		const h = harness();
		const message = h.repository.addMessage({
			kind: "alert",
			body: "x".repeat(2500),
		});
		await run(h);
		const sent = h.fake.requests[0]?.body as { text: string };
		expect(sent.text.length).toBe(1900);
		expect(sent.text.endsWith("…")).toBe(true);
		expect(message.body?.length).toBe(2500);
	});

	it("runs the SQL tick only when asked and does nothing in a dry run", async () => {
		const h = harness();
		h.repository.addMessage({ kind: "test" });
		const dry = await run(h, { dryRun: true });
		expect(dry.get("claimed")).toBe(0);
		expect(h.repository.claims).toHaveLength(0);
		expect(h.repository.dispatches).toHaveLength(0);
		await run(h, { runSqlTick: true });
		expect(h.repository.ticks).toEqual([
			{ at: new Date("2026-11-09T02:05:00.000Z"), tenantId: "tenant-1" },
		]);
	});

	it("warns once about a provider host override that is not a loopback server", async () => {
		const h = harness();
		await run(h, {
			environment: {
				...ENVIRONMENT,
				NOTIFY_ZALO_BOT_BASE_URL: "https://attacker.example.com",
			},
		});
		expect(
			h.logs.filter((line) =>
				line.includes("NOTIFY_ZALO_BOT_BASE_URL ignored"),
			),
		).toHaveLength(1);
	});

	it("builds the due digests before it dispatches and survives a failing scan", async () => {
		const h = harness();
		const order: string[] = [];
		const message = h.repository.addMessage({ kind: "test" });
		const digests: DigestBuilder = {
			async buildDue(at, tenantId, budget) {
				order.push(`build:${tenantId}:${at.toISOString()}`);
				expect(budget.allows("digest")).toBe(true);
				budget.spend("digest");
				return { built: 2, failed: 1, messages: 3 };
			},
		};
		const report = await run(h, { digests });
		expect(order).toEqual(["build:tenant-1:2026-11-09T02:05:00.000Z"]);
		expect(report.get("digests_built")).toBe(2);
		expect(report.get("digests_failed")).toBe(1);
		expect(report.get("digest_messages")).toBe(3);
		expect(message.status).toBe("sent");
		const failing = harness();
		const queued = failing.repository.addMessage({ kind: "test" });
		const broken = await run(failing, {
			digests: {
				buildDue: () => Promise.reject(new Error("synthetic scan failure")),
			},
		});
		expect(broken.get("digests_failed")).toBe(1);
		expect(queued.status).toBe("sent");
		expect(failing.logs.join("\n")).toContain("the due-digest scan failed");
		const skipped = harness();
		let calls = 0;
		await run(skipped, {
			digests: {
				async buildDue() {
					calls += 1;
					return { built: 0, failed: 0, messages: 0 };
				},
			},
			limits: { maxDigests: 0 },
		});
		expect(calls).toBe(0);
	});
});
