import { randomUUID } from "node:crypto";
import { shiftIsoDate, zonedInstant } from "@fnb/core";
import { createPostgresClient } from "@fnb/sync/postgres";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createZaloBotAdapter,
	localIsoDate,
	type NotifyRepository,
	pollBot,
} from "../../src/index.js";
import {
	createPostgresNotifyRepository,
	destinationState,
	enqueueMessage,
	issueLinkCode,
	prepareBotDestination,
} from "../../src/postgres/index.js";
import {
	createFixtureTenant,
	type FixtureTenant,
	type MockProviders,
	startMockProviders,
} from "../../src/testing/index.js";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.NOTIFY_INTEGRATION === "1" && Boolean(DATABASE_URL);
const ZONE = "Asia/Ho_Chi_Minh";
const MINUTE = 60_000;

function localInstant(day: string, hour: number, minute = 0): Date {
	return zonedInstant(day, hour * 60 + minute, ZONE);
}

function sentTo(mock: MockProviders, chatId: string): number {
	return mock
		.zaloMessages()
		.filter((message) => message.chatId === chatId && message.accepted).length;
}

async function enqueueAlert(
	sql: Sql,
	fixture: FixtureTenant,
	channelId: string,
	at: Date,
	body: string,
): Promise<string> {
	return enqueueMessage(sql, {
		tenantId: fixture.tenantId,
		channelId,
		kind: "alert",
		templateRef: "alert.sync_stale.v1",
		dedupeKey: `alert:it-${randomUUID()}:${channelId}:open`,
		title: "Cảnh báo thử nghiệm",
		body,
		severity: "warning",
		expiresAt: new Date(at.getTime() + 24 * 60 * MINUTE),
		at,
	});
}

interface MessageRow {
	status: string;
	not_before: Date | null;
	hold_reason: string | null;
	send_started_at: Date | null;
	provider_message_id: string | null;
	channel_id: string | null;
	decision: string | null;
}

async function messageRow(
	sql: Sql,
	id: string,
): Promise<MessageRow | undefined> {
	const [row] = await sql<MessageRow[]>`
		select status, not_before, hold_reason, send_started_at, provider_message_id, channel_id::text as channel_id, decision
		from public.outbound_messages where id = ${id}::uuid
	`;
	return row;
}

describe.skipIf(!ENABLED)("notify dispatch on the local stack", () => {
	let sql: Sql;
	let mock: MockProviders;
	let fixture: FixtureTenant;
	let ownerChannel: string;
	const ownerChat = `synthetic-chat-owner-${randomUUID().slice(0, 8)}`;
	const tomorrow = shiftIsoDate(localIsoDate(new Date(), ZONE), 1);

	beforeAll(async () => {
		sql = createPostgresClient(DATABASE_URL ?? "", {
			maxConnections: 4,
			applicationName: "notify-it",
		});
		mock = await startMockProviders();
		fixture = await createFixtureTenant(sql, {
			mock,
			databaseUrl: DATABASE_URL ?? "",
			salesDays: 0,
		});
		ownerChannel = await fixture.linkZaloBot(fixture.owner, {
			chatId: ownerChat,
		});
	}, 120_000);

	afterAll(async () => {
		await fixture?.cleanup();
		await mock?.close();
		await sql?.end({ timeout: 5 });
	});

	it("held until the window opens", async () => {
		const enqueuedAt = localInstant(tomorrow, 0, 30);
		const id = await enqueueAlert(
			sql,
			fixture,
			ownerChannel,
			enqueuedAt,
			"Cảnh báo thử nghiệm ngoài giờ.",
		);
		const before = sentTo(mock, ownerChat);
		await fixture.cycle({ at: localInstant(tomorrow, 0, 31) });
		expect(sentTo(mock, ownerChat)).toBe(before);
		const held = await messageRow(sql, id);
		expect(held?.status).toBe("held");
		expect(held?.hold_reason).toBe("outside_hours");
		expect(held?.not_before?.toISOString()).toBe(
			localInstant(tomorrow, 6, 0).toISOString(),
		);
		await fixture.cycle({ at: localInstant(tomorrow, 5, 59) });
		expect(sentTo(mock, ownerChat)).toBe(before);
		await fixture.cycle({ at: localInstant(tomorrow, 6, 0) });
		expect(sentTo(mock, ownerChat)).toBe(before + 1);
		await fixture.cycle({ at: localInstant(tomorrow, 6, 10) });
		expect(sentTo(mock, ownerChat)).toBe(before + 1);
		expect((await messageRow(sql, id))?.status).toBe("sent");
	}, 60_000);

	it("crash between send and record (Zalo half): the row turns uncertain and is never resent", async () => {
		const day = shiftIsoDate(tomorrow, 1);
		const at = localInstant(day, 10, 0);
		const id = await enqueueAlert(
			sql,
			fixture,
			ownerChannel,
			at,
			"Cảnh báo thử nghiệm sự cố ghi nhận.",
		);
		const before = sentTo(mock, ownerChat);
		const base = fixture.repository();
		const crashing: NotifyRepository = {
			...base,
			finishSend: async () => {
				throw new Error("synthetic crash after the provider accepted");
			},
		};
		const report = await fixture.cycle({ at, repository: crashing });
		expect(report.get("finish_errors")).toBe(1);
		expect(sentTo(mock, ownerChat)).toBe(before + 1);
		const sending = await messageRow(sql, id);
		expect(sending?.status).toBe("sending");
		expect(sending?.send_started_at).not.toBeNull();
		await sql`select app.recover_message_leases(${new Date(at.getTime() + 3 * MINUTE)}::timestamptz, ${fixture.tenantId}::uuid)`;
		expect((await messageRow(sql, id))?.status).toBe("uncertain");
		await fixture.cycle({ at: new Date(at.getTime() + 4 * MINUTE) });
		await fixture.cycle({ at: new Date(at.getTime() + 60 * MINUTE) });
		expect(sentTo(mock, ownerChat)).toBe(before + 1);
		expect((await messageRow(sql, id))?.status).toBe("uncertain");
	}, 60_000);

	it("connection lost after the provider accepted (Zalo half): the row turns uncertain at once and is never resent", async () => {
		const day = shiftIsoDate(tomorrow, 2);
		const at = localInstant(day, 10, 0);
		const id = await enqueueAlert(
			sql,
			fixture,
			ownerChannel,
			at,
			"Cảnh báo thử nghiệm mất kết nối.",
		);
		const before = sentTo(mock, ownerChat);
		mock.failNext("sendMessage", { kind: "accept_then_drop" });
		const report = await fixture.cycle({ at });
		expect(report.get("uncertain")).toBe(1);
		expect(report.get("retried")).toBe(0);
		expect(sentTo(mock, ownerChat)).toBe(before + 1);
		const row = await messageRow(sql, id);
		expect(row?.status).toBe("uncertain");
		expect(row?.decision).toBe("send");
		for (const minutes of [2, 10, 60]) {
			await fixture.cycle({ at: new Date(at.getTime() + minutes * MINUTE) });
		}
		expect(sentTo(mock, ownerChat)).toBe(before + 1);
		expect((await messageRow(sql, id))?.status).toBe("uncertain");
	}, 60_000);

	it("concurrent dispatchers: every message has exactly one accepted request and no destination exceeds its cap", async () => {
		const cap = 8;
		const channels: { id: string; chat: string }[] = [
			{ id: ownerChannel, chat: ownerChat },
		];
		const managerChat = `synthetic-chat-manager-${randomUUID().slice(0, 8)}`;
		channels.push({
			id: await fixture.linkZaloBot(fixture.manager, { chatId: managerChat }),
			chat: managerChat,
		});
		while (channels.length < 10) {
			const member = await fixture.addMember("manager", null);
			const chat = `synthetic-chat-${channels.length}-${randomUUID().slice(0, 8)}`;
			channels.push({
				id: await fixture.linkZaloBot(member, { chatId: chat }),
				chat,
			});
		}
		await sql`
			insert into public.channel_policies (tenant_id, channel_kind, message_class, allowed, window_start, window_end, max_per_day, cap_window, consent_purpose, requires_consent, source_note)
			values (${fixture.tenantId}::uuid, 'zalo_bot', 'operational', true, '06:00', '24:00', ${cap}, 'local_day', 'notifications', true, 'integration test cap')
		`;
		const day = shiftIsoDate(tomorrow, 2);
		const at = localInstant(day, 9, 0);
		const ids: string[] = [];
		for (let index = 0; index < 100; index += 1) {
			const channel = channels[index % channels.length];
			if (!channel) {
				throw new Error("no channel");
			}
			ids.push(
				await enqueueAlert(
					sql,
					fixture,
					channel.id,
					at,
					`Cảnh báo thử nghiệm số ${index + 1}.`,
				),
			);
		}
		const second = createPostgresClient(DATABASE_URL ?? "", {
			maxConnections: 2,
			applicationName: "notify-it-b",
		});
		try {
			const other = createPostgresNotifyRepository(second, {
				environment: fixture.environment,
				simulatedClock: true,
			});
			const later = new Date(at.getTime() + MINUTE);
			const [left, right] = await Promise.all([
				fixture.cycle({ at: later, worker: "it-a", budget: { maxSends: 200 } }),
				fixture.cycle({
					at: later,
					worker: "it-b",
					repository: other,
					budget: { maxSends: 200 },
				}),
			]);
			expect(left.get("sent") + right.get("sent")).toBe(channels.length * cap);
			expect(left.get("sent")).toBeGreaterThan(0);
			expect(right.get("sent")).toBeGreaterThan(0);
		} finally {
			await second.end({ timeout: 5 });
		}
		const texts = mock
			.zaloMessages()
			.filter((message) => message.text.startsWith("Cảnh báo thử nghiệm số "))
			.map((message) => message.text);
		expect(new Set(texts).size).toBe(texts.length);
		expect(texts).toHaveLength(channels.length * cap);
		for (const channel of channels) {
			const received = mock
				.zaloMessages()
				.filter(
					(message) =>
						message.chatId === channel.chat &&
						message.text.startsWith("Cảnh báo thử nghiệm số "),
				);
			expect(received.length).toBeLessThanOrEqual(cap);
		}
		const rows = await sql<
			{
				status: string;
				hold_reason: string | null;
				channel_id: string;
				provider_message_id: string | null;
			}[]
		>`
			select status, hold_reason, channel_id::text as channel_id, provider_message_id
			from public.outbound_messages
			where id in (select jsonb_array_elements_text(${JSON.stringify(ids)}::text::jsonb)::uuid)
		`;
		const sent = rows.filter((row) => row.status === "sent");
		expect(sent).toHaveLength(channels.length * cap);
		expect(new Set(sent.map((row) => row.provider_message_id)).size).toBe(
			sent.length,
		);
		expect(
			rows
				.filter((row) => row.status === "held")
				.every((row) => row.hold_reason === "daily_cap"),
		).toBe(true);
		for (const channel of channels) {
			expect(
				sent.filter((row) => row.channel_id === channel.id).length,
			).toBeLessThanOrEqual(cap);
		}
	}, 240_000);

	it("link: a code, the notice, the member's own ĐỒNG Ý, one consent and one confirmation", async () => {
		const member = await fixture.addMember("manager", null);
		const chat = `synthetic-chat-link-${randomUUID().slice(0, 8)}`;
		const stranger = `synthetic-stranger-${randomUUID().slice(0, 8)}`;
		const otherChat = `synthetic-chat-other-${randomUUID().slice(0, 8)}`;
		const now = new Date();
		const prepared = await prepareBotDestination(sql, {
			tenantId: fixture.tenantId,
			userId: member.userId,
			kind: "zalo_bot",
			provider: "zalo_bot",
			label: "Zalo Bot",
			secretName: fixture.secretName,
			timezone: null,
			storeIds: null,
		});
		const code = await issueLinkCode(sql, prepared.channelId, "bot_link", now);
		expect(code).toMatch(/^FNB-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
		mock.queueZaloUpdate(fixture.token, { chatId: stranger, text: "xin chào" });
		mock.queueZaloUpdate(fixture.token, {
			chatId: chat,
			text: ` ${code.toLowerCase()} `,
		});
		const first = await fixture.cycle({ at: now });
		expect(first.get("links_matched")).toBe(1);
		const pending = await destinationState(sql, prepared.channelId);
		expect(pending?.status).toBe("pending");
		expect(pending?.address).toBe(chat);
		expect(pending?.addressHint).toBe(`…${chat.slice(-4)}`);
		const notices = mock
			.zaloMessages()
			.filter((message) => message.chatId === chat);
		expect(notices).toHaveLength(1);
		expect(notices[0]?.text).toContain(
			"Trả lời ĐỒNG Ý để nhận bản tin và cảnh báo.",
		);
		expect(sentTo(mock, stranger)).toBe(0);
		const [strangerRows] = await sql<{ count: string }[]>`
			select count(*)::text as count from public.notification_channels where address = ${stranger}
		`;
		expect(Number(strangerRows?.count)).toBe(0);

		mock.queueZaloUpdate(fixture.token, { chatId: otherChat, text: "ĐỒNG Ý" });
		await fixture.cycle({ at: new Date(now.getTime() + 1000) });
		expect((await destinationState(sql, prepared.channelId))?.status).toBe(
			"pending",
		);

		mock.queueZaloUpdate(fixture.token, { chatId: chat, text: "đồng ý." });
		const accepted = await fixture.cycle({
			at: new Date(now.getTime() + 2000),
		});
		expect(accepted.get("links_accepted")).toBe(1);
		const active = await destinationState(sql, prepared.channelId);
		expect(active?.status).toBe("active");
		expect(active?.linkedAt).not.toBeNull();
		const consents = await sql<
			{ id: string; channel: string; evidence: Record<string, unknown> }[]
		>`
			select id::text as id, channel, evidence
			from public.consent_records
			where tenant_id = ${fixture.tenantId}::uuid
				and subject_type = 'staff'
				and subject_id = ${member.userId}::uuid
				and purpose = 'notifications'
				and revoked_at is null
		`;
		expect(consents).toHaveLength(1);
		expect(consents[0]?.evidence.notice_channel).toBe("bot_chat");
		expect(consents[0]?.evidence.method).toBe("bot_reply");
		expect(JSON.stringify(consents[0]?.evidence)).not.toContain(chat);
		expect(active?.consentRecordId).toBe(consents[0]?.id);
		const confirmations = mock
			.zaloMessages()
			.filter((message) => message.chatId === chat);
		expect(confirmations).toHaveLength(2);
		expect(confirmations[1]?.text).toContain("Đã liên kết.");
		expect(sentTo(mock, otherChat)).toBe(0);

		const repository = fixture.repository();
		const leaseAt = new Date();
		expect(
			await repository.takePollLease(
				fixture.secretName,
				"zalo_bot",
				"it-holder",
				30,
				leaseAt,
			),
		).toBe(true);
		try {
			expect(
				await repository.takePollLease(
					fixture.secretName,
					"zalo_bot",
					"it-second",
					30,
					leaseAt,
				),
			).toBe(false);
			const polls = mock.requestCount("getUpdates");
			const refused = await pollBot({
				repository,
				adapter: createZaloBotAdapter(),
				kind: "zalo_bot",
				secretName: fixture.secretName,
				secret: fixture.token,
				baseUrl: mock.baseUrl,
				worker: "it-second",
				clock: () => leaseAt,
				fetch: (input, init) => fetch(input, init),
				waitSeconds: 1,
				release: true,
			});
			expect(refused.outcome).toBe("lease_held");
			expect(mock.requestCount("getUpdates")).toBe(polls);
		} finally {
			await repository.releasePollLease(fixture.secretName, "it-holder");
		}
		expect(
			await repository.takePollLease(
				fixture.secretName,
				"zalo_bot",
				"it-second",
				30,
				new Date(),
			),
		).toBe(true);
		await repository.releasePollLease(fixture.secretName, "it-second");
		expect(mock.maxConcurrentPolls()).toBe(1);
	}, 60_000);
});
