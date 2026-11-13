import { shiftIsoDate, zonedInstant } from "@fnb/core";
import {
	asOfDate,
	createRpcAnalyticsSource,
	dayReport,
	maxDate,
	periodContaining,
	runReport,
} from "@fnb/reports";
import { staleSyncNotification } from "@fnb/runner";
import { createPostgresClient } from "@fnb/sync/postgres";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	compareDigestWithNgay,
	type DueDigest,
	defaultRuleSet,
	localIsoDate,
} from "../../src/index.js";
import { OutboxNotifier } from "../../src/outbox/index.js";
import {
	activeStoreIds,
	buildScopeDigest,
	dueDigests,
	perCallMemberClient,
	scopeKeyOf,
	scopeStores,
} from "../../src/postgres/index.js";
import {
	correctionDelta,
	type DigestModel,
	isEmptyDelta,
	parseDigestModel,
} from "../../src/render/index.js";
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
const HOUR = 60 * MINUTE;

function localInstant(day: string, hour: number, minute = 0): Date {
	return zonedInstant(day, hour * 60 + minute, ZONE);
}

function chatTexts(mock: MockProviders, chatId: string): string[] {
	return mock
		.zaloMessages()
		.filter((message) => message.chatId === chatId && message.accepted)
		.map((message) => message.text);
}

function digestTexts(mock: MockProviders, chatId: string): string[] {
	return chatTexts(mock, chatId).filter((text) =>
		text.startsWith("Bản tin ngày"),
	);
}

async function storedDigest(
	sql: Sql,
	tenantId: string,
	businessDate: string,
): Promise<
	{
		id: string;
		trigger: string;
		dataState: string;
		model: DigestModel | null;
	}[]
> {
	const rows = await sql<
		{ id: string; trigger: string; data_state: string; model: unknown }[]
	>`
		select id::text as id, trigger, data_state, model
		from public.digests
		where tenant_id = ${tenantId}::uuid and business_date = ${businessDate}::date and state = 'built'
		order by created_at
	`;
	return rows.map((row) => ({
		id: row.id,
		trigger: row.trigger,
		dataState: row.data_state,
		model: parseDigestModel(row.model),
	}));
}

async function separateNgay(sql: Sql, ownerId: string, model: DigestModel) {
	const stores = await scopeStores(sql, model.scope.storeIds);
	const builtAt = new Date(model.builtAt);
	const context = {
		tenantId: model.tenantId,
		stores,
		allStoresSelected: model.scope.allStores,
		period: periodContaining(
			"day",
			model.businessDate,
			maxDate(model.businessDate, asOfDate(stores, builtAt)),
		),
		sample: false,
	};
	return runReport(
		dayReport,
		context,
		createRpcAnalyticsSource(perCallMemberClient(sql, ownerId), "postgres"),
	);
}

async function asOwner<T>(
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

describe.skipIf(!ENABLED)("digests and alerts on the local stack", () => {
	let sql: Sql;
	let mock: MockProviders;
	let fixture: FixtureTenant;
	let ownerChannel: string;
	const today = localIsoDate(new Date(), ZONE);
	const ownerChat = `synthetic-chat-digest-${today.replaceAll("-", "")}`;

	beforeAll(async () => {
		sql = createPostgresClient(DATABASE_URL ?? "", {
			maxConnections: 4,
			applicationName: "notify-it-digests",
		});
		mock = await startMockProviders();
		fixture = await createFixtureTenant(sql, {
			mock,
			databaseUrl: DATABASE_URL ?? "",
			salesDays: 70,
		});
		ownerChannel = await fixture.linkZaloBot(fixture.owner, {
			chatId: ownerChat,
			at: localInstant(shiftIsoDate(today, 1), 9),
		});
	}, 600_000);

	afterAll(async () => {
		await fixture?.cleanup();
		await mock?.close();
		await sql?.end({ timeout: 5 });
	});

	it("three nights", async () => {
		const nights = [1, 2, 3].map((offset) => shiftIsoDate(today, offset));
		const before = digestTexts(mock, ownerChat).length;
		for (const [index, day] of nights.entries()) {
			const next = shiftIsoDate(day, 1);
			if (index === 0) {
				const atClose = await fixture.windowRun(
					day,
					day,
					localInstant(next, 0),
				);
				expect(atClose.status).toBe("succeeded");
				const early = await fixture.cycle({
					at: localInstant(next, 0, 35),
					runSqlTick: true,
					buildDigests: true,
				});
				expect(early.get("digests_built")).toBe(0);
				expect(await storedDigest(sql, fixture.tenantId, day)).toHaveLength(0);
			}
			const nightly = await fixture.windowRun(
				day,
				day,
				localInstant(next, 3, 23),
			);
			expect(nightly.status).toBe("succeeded");
			const built = await fixture.cycle({
				at: localInstant(next, 3, 30),
				runSqlTick: true,
				buildDigests: true,
			});
			expect(built.get("digests_built")).toBe(1);
			expect(built.get("sent")).toBe(0);
			const again = await fixture.cycle({
				at: localInstant(next, 3, 31),
				runSqlTick: true,
				buildDigests: true,
			});
			expect(again.get("digests_built")).toBe(0);
			expect(again.get("sent")).toBe(0);
			expect(digestTexts(mock, ownerChat)).toHaveLength(before + index);
			const morning = await fixture.cycle({
				at: localInstant(next, 6, 0),
				runSqlTick: true,
				buildDigests: true,
			});
			expect(morning.get("sent")).toBeGreaterThanOrEqual(1);
			expect(digestTexts(mock, ownerChat)).toHaveLength(before + index + 1);
			const [stored] = await storedDigest(sql, fixture.tenantId, day);
			expect(stored?.trigger).toBe("settled");
			const comparison = compareDigestWithNgay(
				stored?.model ?? null,
				await separateNgay(
					sql,
					fixture.owner.userId,
					stored?.model as DigestModel,
				),
			);
			expect(comparison.differing).toEqual([]);
			expect(comparison.equal).toBe(true);
			const text = digestTexts(mock, ownerChat).at(-1) ?? "";
			expect(text.length).toBeLessThanOrEqual(1900);
			expect(text).not.toContain(fixture.owner.email);
		}
		const late = await fixture.cycle({
			at: localInstant(shiftIsoDate(nights[2] ?? today, 1), 6, 10),
			runSqlTick: true,
			buildDigests: true,
		});
		expect(late.get("sent")).toBe(0);
		expect(digestTexts(mock, ownerChat)).toHaveLength(before + 3);
		const [message] = await sql<{ count: string }[]>`
			select count(*)::text as count from public.outbound_messages
			where tenant_id = ${fixture.tenantId}::uuid and kind = 'digest' and channel_id = ${ownerChannel}::uuid
		`;
		expect(Number(message?.count)).toBe(3);
	}, 600_000);

	it("low revenue", async () => {
		const day = shiftIsoDate(today, -2);
		const [storeA] = await activeStoreIds(sql, fixture.tenantId);
		const storeIds = await activeStoreIds(sql, fixture.tenantId);
		await sql`
			update public.invoices i
			set status = 'voided'
			where i.id in (
				select id from public.invoices
				where tenant_id = ${fixture.tenantId}::uuid
					and store_id = ${storeA ?? ""}::uuid
					and business_date = ${day}::date
					and status <> 'voided'
				order by id
				limit (
					select ceil(count(*) * 0.6)::integer from public.invoices
					where tenant_id = ${fixture.tenantId}::uuid
						and store_id = ${storeA ?? ""}::uuid
						and business_date = ${day}::date
						and status <> 'voided'
				)
			)
		`;
		await sql`select app.refresh_analytics(${fixture.tenantId}::uuid, ${day}::date, ${day}::date)`;
		const due: DueDigest = {
			tenantId: fixture.tenantId,
			businessDate: day,
			scopeKey: await scopeKeyOf(sql, storeIds),
			storeIds: [...storeIds].sort(),
			allStores: true,
			trigger: "manual",
			runAs: fixture.owner.userId,
			channelIds: [ownerChannel],
			storeFacts: storeIds.map((storeId) => ({
				storeId,
				openingMinutes: null,
				closeAt: localInstant(shiftIsoDate(day, 1), 0).toISOString(),
				lastShiftClosedAt: null,
				openShifts: 0,
				settledAt: localInstant(shiftIsoDate(day, 1), 3, 30).toISOString(),
				dayEnded: true,
			})),
		};
		const at = localInstant(shiftIsoDate(day, 1), 4);
		const first = await buildScopeDigest(sql, due, { at, dryRun: true });
		expect(first.status).toBe("dry_run");
		const finding = first.model?.findings.find(
			(entry) =>
				entry.ruleKey === "revenue_below_baseline" && entry.storeId === storeA,
		);
		expect(finding).toBeDefined();
		const zalo = first.rendered.find((entry) => entry.channel === "zalo_bot");
		expect(zalo?.text).toContain("chỉ bằng");

		await expect(
			asOwner(sql, fixture.manager.userId, (transaction) =>
				transaction`
					insert into public.alert_rules (tenant_id, rule_key, enabled)
					values (${fixture.tenantId}::uuid, 'revenue_below_baseline', false)
				`.then(() => undefined),
			),
		).rejects.toMatchObject({ code: "42501" });
		await asOwner(sql, fixture.owner.userId, (transaction) =>
			transaction`
				insert into public.alert_rules (tenant_id, rule_key, enabled)
				values (${fixture.tenantId}::uuid, 'revenue_below_baseline', false)
			`.then(() => undefined),
		);
		const second = await buildScopeDigest(sql, due, { at, dryRun: true });
		expect(
			second.model?.findings.some(
				(entry) => entry.ruleKey === "revenue_below_baseline",
			),
		).toBe(false);
		const secondZalo = second.rendered.find(
			(entry) => entry.channel === "zalo_bot",
		);
		expect(secondZalo?.text).not.toContain("chỉ bằng");
		const without = (text: string | undefined) =>
			(text ?? "")
				.split("\n")
				.filter(
					(line) => !line.includes("chỉ bằng") && !line.startsWith("Cần chú ý"),
				);
		expect(without(secondZalo?.text)).toEqual(without(zalo?.text));
		expect(
			isEmptyDelta(
				correctionDelta(
					first.model as DigestModel,
					second.model as DigestModel,
				),
			),
		).toBe(true);
		await sql`
			delete from public.alert_rules
			where tenant_id = ${fixture.tenantId}::uuid and rule_key = 'revenue_below_baseline'
		`;
		expect(defaultRuleSet().tenant.revenue_below_baseline?.enabled).toBe(true);
	}, 300_000);

	it("stale store not repeated", async () => {
		const [storeId] = await activeStoreIds(sql, fixture.tenantId);
		const day = shiftIsoDate(today, 10);
		const start = localInstant(day, 10);
		const notifier = new OutboxNotifier(() => sql, "incremental");
		const baseline = chatTexts(mock, ownerChat).length;
		const stale = (at: Date) =>
			notifier.notify(
				staleSyncNotification({
					subject: {
						tenantId: fixture.tenantId,
						accountId: fixture.accountId,
						storeId: storeId ?? "",
					},
					label: "store 1",
					occurredAt: at,
					minutes: 120,
					thresholdMinutes: 90,
					facts: { scope: "now" },
				}),
			);
		await sql`
			insert into app.sync_alerts (tenant_id, store_id, kind, opened_at, last_seen_at, minutes, occurrences)
			values (${fixture.tenantId}::uuid, ${storeId ?? ""}::uuid, 'sync_stale', ${start}::timestamptz, ${start}::timestamptz, 120, 1)
		`;
		for (let step = 0; step < 10; step += 1) {
			const at = new Date(start.getTime() + step * 5 * MINUTE);
			await stale(at);
			await sql`
				update app.sync_alerts
				set last_seen_at = ${at}::timestamptz, occurrences = occurrences + 1, minutes = 120 + ${step * 5}
				where store_id = ${storeId ?? ""}::uuid and kind = 'sync_stale' and resolved_at is null
			`;
			await fixture.cycle({
				at: new Date(at.getTime() + MINUTE),
				runSqlTick: true,
			});
		}
		const opened = chatTexts(mock, ownerChat).slice(baseline);
		expect(opened.filter((text) => text.startsWith("Cảnh báo:"))).toHaveLength(
			1,
		);
		const [episode] = await sql<{ occurrences: number; state: string }[]>`
			select occurrences, state from public.alert_events
			where tenant_id = ${fixture.tenantId}::uuid and dedupe_key = ${`sync_stale:store:${storeId}`}
			order by opened_at desc limit 1
		`;
		expect(episode?.state).toBe("open");
		expect(episode?.occurrences).toBeGreaterThanOrEqual(10);

		const nextDay = new Date(start.getTime() + 24 * HOUR + 10 * MINUTE);
		await stale(nextDay);
		await fixture.cycle({ at: new Date(nextDay.getTime() + MINUTE) });
		const reminded = chatTexts(mock, ownerChat).slice(baseline);
		expect(
			reminded.filter((text) => text.startsWith("Nhắc lại:")),
		).toHaveLength(1);

		const recovered = new Date(nextDay.getTime() + HOUR);
		const run = await fixture.windowRun(
			shiftIsoDate(day, 1),
			shiftIsoDate(day, 1),
			recovered,
			"backfill",
		);
		expect(run.status).toBe("succeeded");
		await sql`
			update app.sync_alerts set resolved_at = ${recovered}::timestamptz
			where store_id = ${storeId ?? ""}::uuid and resolved_at is null
		`;
		await fixture.cycle({
			at: new Date(recovered.getTime() + 5 * MINUTE),
			runSqlTick: true,
		});
		await fixture.cycle({ at: new Date(recovered.getTime() + 6 * MINUTE) });
		const all = chatTexts(mock, ownerChat).slice(baseline);
		expect(all.filter((text) => text.startsWith("Cảnh báo:"))).toHaveLength(1);
		expect(all.filter((text) => text.startsWith("Nhắc lại:"))).toHaveLength(1);
		expect(all.filter((text) => text.startsWith("Đã khôi phục:"))).toHaveLength(
			1,
		);
	}, 300_000);

	it("channel failure", async () => {
		const emailChannel = await fixture.linkEmail(fixture.owner, {
			at: localInstant(shiftIsoDate(today, 12), 9),
		});
		const at = localInstant(shiftIsoDate(today, 12), 10);
		await fixture.cycle({ at });
		const emailsBefore = mock.emails().length;
		await sql`
			select app.enqueue_message(
				${fixture.tenantId}::uuid, ${ownerChannel}::uuid, 'test', 'test.v1',
				${`test:${ownerChannel}:channel-failure`}, '{}'::jsonb, null, null, null, null, null, null, null,
				${new Date(at.getTime() + HOUR)}::timestamptz, ${at}::timestamptz
			)
		`;
		mock.failNext("sendMessage", { kind: "status", status: 401 });
		const failing = await fixture.cycle({
			at: new Date(at.getTime() + MINUTE),
		});
		expect(failing.get("failed")).toBe(1);
		const [destination] = await sql<
			{ status: string; last_error_code: string | null }[]
		>`
			select status, last_error_code from public.notification_channels where id = ${ownerChannel}::uuid
		`;
		expect(destination).toEqual({
			status: "failing",
			last_error_code: "token_invalid",
		});
		await fixture.cycle({
			at: new Date(at.getTime() + 2 * MINUTE),
			runSqlTick: true,
		});
		await fixture.cycle({
			at: new Date(at.getTime() + 3 * MINUTE),
			runSqlTick: true,
		});
		const alerts = mock.emails().slice(emailsBefore);
		const channelAlerts = alerts.filter((email) =>
			email.text.includes("không gửi được tin"),
		);
		expect(channelAlerts).toHaveLength(1);
		expect(channelAlerts[0]?.subject).toBe("Cảnh báo vận hành từ FNB Manager");
		const [rows] = await sql<{ count: string }[]>`
			select count(*)::text as count
			from public.outbound_messages o
			join public.alert_events e on e.id = o.alert_event_id
			where o.tenant_id = ${fixture.tenantId}::uuid and e.rule_key = 'channel_failed' and o.kind = 'alert'
		`;
		expect(Number(rows?.count)).toBe(1);
		const [recipient] = await sql<{ channel_id: string }[]>`
			select o.channel_id::text as channel_id
			from public.outbound_messages o
			join public.alert_events e on e.id = o.alert_event_id
			where o.tenant_id = ${fixture.tenantId}::uuid and e.rule_key = 'channel_failed'
		`;
		expect(recipient?.channel_id).toBe(emailChannel);
		await sql`
			update public.notification_channels set status = 'active', consecutive_failures = 0
			where id = ${ownerChannel}::uuid
		`;
	}, 300_000);

	it("different close times", async () => {
		const [storeA, storeB] = await activeStoreIds(sql, fixture.tenantId);
		const everyDay = (span: [string, string]) =>
			JSON.stringify(
				Object.fromEntries(
					["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((weekday) => [
						weekday,
						[span],
					]),
				),
			);
		await sql`
			update public.stores set opening_hours = ${everyDay(["08:00", "22:00"])}::text::jsonb
			where id = ${storeA ?? ""}::uuid
		`;
		await sql`
			update public.stores
			set opening_hours = ${everyDay(["08:00", "01:00"])}::text::jsonb, business_day_start_minutes = 300
			where id = ${storeB ?? ""}::uuid
		`;
		const day = shiftIsoDate(today, 20);
		const next = shiftIsoDate(day, 1);
		await fixture.windowRun(day, day, localInstant(next, 0));
		expect(
			(
				await dueDigests(sql, localInstant(next, 0, 5), fixture.tenantId)
			).filter((entry) => entry.businessDate === day),
		).toHaveLength(0);
		await fixture.windowRun(day, day, localInstant(next, 2));
		const due = (
			await dueDigests(sql, localInstant(next, 2, 5), fixture.tenantId)
		).filter((entry) => entry.businessDate === day);
		expect(due).toHaveLength(1);
		expect(due[0]?.trigger).toBe("settled");
		const built = await fixture.cycle({
			at: localInstant(next, 2, 5),
			runSqlTick: true,
			buildDigests: true,
		});
		expect(built.get("digests_built")).toBe(1);

		const partialDay = shiftIsoDate(today, 22);
		const partialNext = shiftIsoDate(partialDay, 1);
		await fixture.windowRun(
			partialDay,
			partialDay,
			localInstant(partialNext, 0),
		);
		expect(
			(
				await dueDigests(
					sql,
					localInstant(partialNext, 6, 29),
					fixture.tenantId,
				)
			).filter((entry) => entry.businessDate === partialDay),
		).toHaveLength(0);
		const deadline = await fixture.cycle({
			at: localInstant(partialNext, 6, 31),
			runSqlTick: true,
			buildDigests: true,
		});
		expect(deadline.get("digests_built")).toBe(1);
		const [stored] = await storedDigest(sql, fixture.tenantId, partialDay);
		expect(stored?.trigger).toBe("deadline");
		expect(stored?.dataState).toBe("partial");
		expect(
			stored?.model?.stores.find((store) => store.storeId === storeB)?.state,
		).toBe("unsettled");
	}, 300_000);
});
