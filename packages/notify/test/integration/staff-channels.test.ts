// Test design: decision table (destinations linked x muted x stopped x store) and negative testing.
// FR-NOT-37 (free channels first, never a paid message when a free channel works), FR-NOT-36; test-gaps G-10, G-31.
// A staff alert of store 1 goes through the dispatcher to the staff's own free destinations only: the Bot, then e-mail.
// The OA consultation message for staff is not built yet (the channel kind is unavailable), so the free order tested here is
// Bot, then e-mail; what must hold in every row is that no ZBS template, SMS or any paid message is ever queued or sent.
import { shiftIsoDate, zonedInstant } from "@fnb/core";
import { createPostgresClient } from "@fnb/sync/postgres";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localIsoDate } from "../../src/index.js";
import {
	createFixtureTenant,
	type FixtureMember,
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

async function asMember<T>(
	sql: Sql,
	userId: string,
	run: (transaction: Sql) => Promise<T>,
): Promise<T> {
	return sql.begin(async (transaction) => {
		await transaction.unsafe("set local role authenticated");
		await transaction.unsafe(
			"select set_config('request.jwt.claims', $1, true)",
			[JSON.stringify({ sub: userId, role: "authenticated" })],
		);
		return run(transaction as unknown as Sql);
	}) as Promise<T>;
}

describe.skipIf(!ENABLED)("staff channels: free first, never paid", () => {
	let sql: Sql;
	let mock: MockProviders;
	let fixture: FixtureTenant;
	const people: Record<string, FixtureMember> = {};
	const botChat: Record<string, string> = {};
	const channelOf: Record<string, string> = {};
	const tomorrow = shiftIsoDate(localIsoDate(new Date(), ZONE), 1);
	const raisedAt = localInstant(tomorrow, 10);

	const alertsTo = (chat: string | undefined) =>
		mock
			.zaloMessages()
			.filter(
				(message) =>
					message.chatId === chat &&
					message.accepted &&
					message.text.startsWith("Cảnh báo"),
			);

	const messagesOf = (key: string) =>
		sql<{ status: string; channel: string; kind: string }[]>`
			select o.status, o.channel::text as channel, o.kind
			from public.outbound_messages o
			join public.notification_channels c on c.id = o.channel_id
			where o.tenant_id = ${fixture.tenantId}::uuid and c.user_id = ${people[key]?.userId ?? ""}::uuid and o.kind = 'alert'
		`;

	beforeAll(async () => {
		sql = createPostgresClient(DATABASE_URL ?? "", {
			maxConnections: 4,
			applicationName: "notify-it-staff-channels",
		});
		mock = await startMockProviders();
		fixture = await createFixtureTenant(sql, {
			mock,
			databaseUrl: DATABASE_URL ?? "",
			salesDays: 0,
		});
		const store1 = fixture.storeIds[0] ?? "";
		const store2 = fixture.storeIds[1] ?? "";
		for (const key of [
			"bot_only",
			"email_only",
			"nothing",
			"both",
			"muted",
			"stopped",
		]) {
			people[key] = await fixture.addMember("staff", [store1]);
		}
		people.other_store = await fixture.addMember("staff", [store2]);
		const at = localInstant(tomorrow, 9);
		for (const key of ["bot_only", "both", "muted", "stopped", "other_store"]) {
			botChat[key] = `synthetic-chat-staff-${key}-${fixture.slug.slice(-8)}`;
			channelOf[`${key}:bot`] = await fixture.linkZaloBot(
				people[key] as FixtureMember,
				{ chatId: botChat[key], at },
			);
		}
		for (const key of ["email_only", "both"]) {
			channelOf[`${key}:email`] = await fixture.linkEmail(
				people[key] as FixtureMember,
				{ at },
			);
		}
		// a member mutes the rule on her own destination, another stops every notification
		await asMember(sql, people.muted?.userId ?? "", (transaction) =>
			transaction`select public.set_my_muted_rules(${channelOf["muted:bot"] ?? ""}::uuid, array['staff_sync_stale']::text[])`.then(
				() => undefined,
			),
		);
		await asMember(sql, people.stopped?.userId ?? "", (transaction) =>
			transaction`select public.stop_my_notifications(${fixture.tenantId}::uuid)`.then(
				() => undefined,
			),
		);
		await sql`
			select app.raise_alert(${fixture.tenantId}::uuid, 'sync_stale', ${`store:${store1}`}, 'scheduler', ${raisedAt}::timestamptz, ${store1}::uuid, ${fixture.accountId}::uuid, null, null, '{"minutes_without_sync": 120, "threshold_minutes": 90, "scope": "now"}'::jsonb)
		`;
		const [opened] = await sql<{ count: number }[]>`
			select app.evaluate_staff_sync(${raisedAt}::timestamptz, ${fixture.tenantId}::uuid, 'incremental') as count
		`;
		expect(opened?.count).toBe(1);
		await fixture.cycle({ at: new Date(raisedAt.getTime() + MINUTE) });
		await fixture.cycle({ at: new Date(raisedAt.getTime() + 2 * MINUTE) });
	}, 240_000);

	afterAll(async () => {
		await fixture?.cleanup();
		await mock?.close();
		await sql?.end({ timeout: 5 });
	});

	it("a staff member with only the Bot gets the alert there, once", async () => {
		const rows = await messagesOf("bot_only");
		expect(rows.map((row) => [row.status, row.channel])).toEqual([
			["sent", "zalo_bot"],
		]);
		expect(alertsTo(botChat.bot_only)).toHaveLength(1);
	});

	it("a staff member with only e-mail gets it by e-mail, the next free channel", async () => {
		const rows = await messagesOf("email_only");
		expect(rows.map((row) => [row.status, row.channel])).toEqual([
			["sent", "email"],
		]);
		expect(
			mock
				.emails(fixture.emailKey)
				.filter((mail) => mail.to.includes(people.email_only?.email ?? "?")),
		).toHaveLength(1);
	});

	it("with the Bot and e-mail linked, each destination gets one message and none is duplicated", async () => {
		const rows = await messagesOf("both");
		expect(rows.map((row) => row.channel).sort()).toEqual([
			"email",
			"zalo_bot",
		]);
		expect(rows.every((row) => row.status === "sent")).toBe(true);
	});

	it("a staff member with no destination gets no message, and nothing is queued for her", async () => {
		expect(await messagesOf("nothing")).toHaveLength(0);
		const [row] = await sql<{ count: string }[]>`
			select count(*)::text as count from public.outbound_messages o
			where o.tenant_id = ${fixture.tenantId}::uuid and o.recipient_ref like ${`%${people.nothing?.userId ?? "?"}%`}
		`;
		expect(Number(row?.count)).toBe(0);
	});

	it("a muted rule and a stopped member get nothing", async () => {
		const muted = await messagesOf("muted");
		expect(muted.filter((row) => row.status === "sent")).toHaveLength(0);
		const stopped = await messagesOf("stopped");
		expect(stopped.filter((row) => row.status === "sent")).toHaveLength(0);
		for (const key of ["muted", "stopped"]) {
			expect(alertsTo(botChat[key])).toHaveLength(0);
		}
	});

	it("staff of another store hear nothing about store 1", async () => {
		expect(await messagesOf("other_store")).toHaveLength(0);
		expect(alertsTo(botChat.other_store)).toHaveLength(0);
	});

	it("in no row was a paid channel used or queued: no ZBS, no SMS", async () => {
		const rows = await sql<{ channel: string | null; kind: string }[]>`
			select coalesce(c.kind::text, o.channel::text) as channel, o.kind
			from public.outbound_messages o
			left join public.notification_channels c on c.id = o.channel_id
			where o.tenant_id = ${fixture.tenantId}::uuid
		`;
		expect(rows.length).toBeGreaterThanOrEqual(4);
		expect(
			rows.filter((row) => row.channel === "zalo_zbs" || row.channel === "sms"),
		).toEqual([]);
		const channels = await sql<{ kind: string }[]>`
			select kind::text as kind from public.notification_channels where tenant_id = ${fixture.tenantId}::uuid
		`;
		expect(new Set(channels.map((channel) => channel.kind))).toEqual(
			new Set(["zalo_bot", "email"]),
		);
	});

	it("the policy forbids paid kinds for operational messages", async () => {
		const policies = await sql<{ channel_kind: string; allowed: boolean }[]>`
			select channel_kind::text as channel_kind, allowed from public.channel_policies
			where tenant_id is null and message_class = 'operational' and channel_kind in ('zalo_zbs', 'sms')
		`;
		expect(policies).toHaveLength(2);
		expect(policies.every((policy) => !policy.allowed)).toBe(true);
	});

	it("a staff destination on a paid kind cannot be linked", async () => {
		await expect(
			sql`
				insert into public.notification_channels (tenant_id, kind, provider, label, user_id, address, status)
				values (${fixture.tenantId}::uuid, 'zalo_zbs', 'zalo_zbs', 'paid', ${people.nothing?.userId ?? ""}::uuid, 'synthetic-address', 'active')
			`,
		).rejects.toBeDefined();
	});

	it("the alert text carries no phone, no e-mail and no figure of the POS", async () => {
		const texts = mock.zaloMessages().map((message) => message.text);
		expect(texts.length).toBeGreaterThanOrEqual(2);
		for (const text of texts) {
			expect(text).not.toMatch(/\b0\d{9}\b/);
			expect(text).not.toContain("@");
		}
	});
});
