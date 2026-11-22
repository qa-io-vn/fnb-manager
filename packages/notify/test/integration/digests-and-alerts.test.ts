import { createMockConnector } from "@fnb/connector-mock";
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
import { SyncEngine } from "@fnb/sync";
import {
	createPostgresClient,
	PostgresSyncRepository,
} from "@fnb/sync/postgres";
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
	formatViDate,
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
		const sectionsWithoutRevenueFinding = (text: string | undefined) =>
			(text ?? "")
				.split("\n\n")
				.map((section) =>
					section
						.split("\n")
						.filter(
							(line) =>
								!line.includes("chỉ bằng") && !line.startsWith("Cần chú ý"),
						)
						.join("\n"),
				)
				.filter((section) => section !== "");
		expect(sectionsWithoutRevenueFinding(secondZalo?.text)).toEqual(
			sectionsWithoutRevenueFinding(zalo?.text),
		);
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
		// the intraday rules of the same tick also tell the owner that no nightly ran (nightly_missing), so count the stale-sync alerts
		const isStaleAlert = (text: string) =>
			text.startsWith("Cảnh báo:") && text.includes("chưa đồng bộ thành công");
		expect(opened.filter(isStaleAlert)).toHaveLength(1);
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
		expect(all.filter(isStaleAlert)).toHaveLength(1);
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

	it("cash count variance", async () => {
		const storeId = fixture.manager.storeIds?.[0] ?? "";
		const managerChat = `synthetic-chat-cash-${today.replaceAll("-", "")}`;
		const managerChannel = await fixture.linkZaloBot(fixture.manager, {
			chatId: managerChat,
		});
		const staff = await fixture.addMember("staff", [storeId]);

		const closedAt = new Date(Date.now() - 5 * MINUTE);
		const day = localIsoDate(closedAt, ZONE);
		const closeMinutes = Math.floor(
			(closedAt.getTime() - localInstant(day, 0).getTime()) / MINUTE,
		);
		const openMinutes = Math.max(0, closeMinutes - 180);
		const repository = new PostgresSyncRepository(sql);
		const [account] = await repository.findAccounts(
			fixture.accountKey,
			fixture.slug,
		);
		if (account === undefined) {
			throw new Error("the fixture account is missing");
		}
		const connector = createMockConnector({
			profile: {
				shifts: [
					{
						name: "Ca thử",
						startMinutes: openMinutes,
						endMinutes: closeMinutes,
					},
				],
			},
		});
		await connector.authenticate({ seed: fixture.seed, storeCount: 2 });
		const engine = new SyncEngine({
			repository,
			connector,
			calls: { sleep: async () => undefined },
		});
		const stores = (await repository.listStores(account.id)).filter(
			(store) => store.id === storeId,
		);
		const synced = await engine.syncWindow(
			account,
			stores,
			{ fromDate: day, toDate: day },
			"manual",
		);
		expect(synced.status).toBe("succeeded");
		const [shift] = await sql<
			{ id: string; expected: string | null; number: number | null }[]
		>`
			select s.id::text as id, a.expected_cash_amount::text as expected, app.shift_number(s.id) as number
			from public.shifts s
			join public.agg_shift_cash a on a.shift_id = s.id
			where s.store_id = ${storeId}::uuid and s.closed_at = ${localInstant(day, 0, closeMinutes)}::timestamptz
		`;
		expect(shift?.expected).not.toBeNull();
		const expected = Number(shift?.expected);
		const dedupeKey = `cash_count_variance:shift:${shift?.id ?? ""}`;

		const count = (staffAmount: number, replaces: string | null = null) =>
			asOwner(sql, staff.userId, async (transaction) => {
				const [row] = await transaction<{ result: Record<string, unknown> }[]>`
					select public.record_cash_count(${storeId}::uuid, ${staffAmount}::numeric, null, null, ${replaces}::uuid) as result
				`;
				return row?.result ?? {};
			});
		const reopen = (countId: string) =>
			asOwner(sql, fixture.manager.userId, (transaction) =>
				transaction`select public.reopen_cash_count(${countId}::uuid)`.then(
					() => undefined,
				),
			);
		const episodes = () =>
			sql<
				{
					id: string;
					state: string;
					resolution: string | null;
					occurrences: number;
					facts: Record<string, unknown>;
				}[]
			>`
				select id::text as id, state, resolution, occurrences, facts
				from public.alert_events
				where tenant_id = ${fixture.tenantId}::uuid and dedupe_key = ${dedupeKey}
			`;
		const alertMessages = (episodeId: string) =>
			sql<
				{ channel_id: string; kind: string; params: Record<string, unknown> }[]
			>`
				select channel_id::text as channel_id, kind, params
				from public.outbound_messages
				where tenant_id = ${fixture.tenantId}::uuid and alert_event_id = ${episodeId}::uuid
			`;
		const managerAlerts = () =>
			chatTexts(mock, managerChat).filter((text) =>
				text.startsWith("Cảnh báo:"),
			);

		const first = await count(expected - 60_000);
		expect(first.matched).toBe(true);
		expect(Object.keys(first).sort()).toEqual([
			"business_date",
			"cash_count_id",
			"counted_at",
			"matched",
			"status",
		]);
		const [opened] = await episodes();
		expect(opened?.state).toBe("open");
		expect(Object.keys(opened?.facts ?? {}).sort()).toEqual([
			"over_abs",
			"over_rel",
			"over_z",
			"recounts",
			"shift_number",
			"shortfall",
		]);
		expect(opened?.facts.shortfall).toBe(true);
		expect(opened?.facts.over_abs).toBe(true);
		const queued = await alertMessages(opened?.id ?? "");
		expect(
			queued.filter((row) => row.channel_id === managerChannel),
		).toHaveLength(1);
		expect(queued.some((row) => row.channel_id === ownerChannel)).toBe(true);
		for (const row of queued) {
			expect(row.kind).toBe("alert");
			expect(JSON.stringify(row.params)).not.toContain(String(expected));
		}

		const soon = new Date(Date.now() + MINUTE);
		const quietEnds = localInstant(localIsoDate(soon, ZONE), 6, 1);
		const deliverAt = soon.getTime() < quietEnds.getTime() ? quietEnds : soon;
		await fixture.cycle({ at: deliverAt });
		const delivered = managerAlerts();
		expect(delivered).toHaveLength(1);
		const text = delivered[0] ?? "";
		expect(text).toContain(
			`, Ca ${shift?.number ?? "?"} ngày ${formatViDate(day)}: tiền mặt đếm khi đóng ca thiếu so với POS, vượt ngưỡng tuyệt đối`,
		);
		expect(text).not.toMatch(/₫|\d{1,3}(\.\d{3})+/);
		expect(text).not.toContain("Ca thử");
		expect(text.length).toBeLessThanOrEqual(1900);

		await reopen(String(first.cash_count_id));
		const recount = await count(expected - 70_000, String(first.cash_count_id));
		expect(recount.matched).toBe(true);
		const [repeated] = await episodes();
		expect(repeated?.id).toBe(opened?.id);
		expect(repeated?.state).toBe("open");
		expect(repeated?.occurrences).toBe(2);
		expect(repeated?.facts.recounts).toBe(1);
		expect(await alertMessages(opened?.id ?? "")).toHaveLength(queued.length);
		await fixture.cycle({ at: new Date(deliverAt.getTime() + MINUTE) });
		expect(managerAlerts()).toHaveLength(1);

		await reopen(String(recount.cash_count_id));
		await count(expected, String(recount.cash_count_id));
		const all = await episodes();
		expect(all).toHaveLength(1);
		expect(all[0]?.state).toBe("resolved");
		expect(all[0]?.resolution).toBe("cleared");
		await fixture.cycle({ at: new Date(deliverAt.getTime() + 2 * MINUTE) });
		expect(managerAlerts()).toHaveLength(1);
		expect(chatTexts(mock, managerChat).join("\n")).not.toContain(
			"Đã khôi phục",
		);
	}, 300_000);

	it("redemption mismatch", async () => {
		const storeId = fixture.manager.storeIds?.[0] ?? "";
		const managerChat = `synthetic-chat-redeem-${today.replaceAll("-", "")}`;
		const manager = await fixture.addMember("manager", [storeId]);
		const managerChannel = await fixture.linkZaloBot(manager, {
			chatId: managerChat,
		});
		const day = shiftIsoDate(today, -1);
		const discountName = "Doi thuong IT";
		const [invoice] = await sql<{ id: string; store_name: string }[]>`
			select i.id::text as id, s.name as store_name
			from public.invoices i
			join public.stores s on s.id = i.store_id
			where i.store_id = ${storeId}::uuid and i.business_date = ${day}::date and i.status = 'completed'
			order by i.sold_at desc, i.id
			limit 1
		`;
		if (invoice === undefined) {
			throw new Error("the fixture store has no completed invoice yesterday");
		}
		await sql`
			insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, einvoice_display)
			values (${fixture.tenantId}::uuid, ${storeId}::uuid, 'it-reward', ${discountName}, 'discount')
		`;
		await sql`
			update public.invoices
			set bill_discount_name = ${` ${discountName.toUpperCase()} `}
			where id = ${invoice.id}::uuid
		`;
		const reconcile = async (at: Date) => {
			const [row] = await sql<{ result: Record<string, number> }[]>`
				select app.reconcile_redemptions(${fixture.tenantId}::uuid, ${day}::date, ${day}::date, ${at}::timestamptz) as result
			`;
			return row?.result ?? {};
		};
		const dedupeKey = `redemption_mismatch:store:${storeId}`;
		const episodes = () =>
			sql<
				{
					id: string;
					state: string;
					resolution: string | null;
					facts: Record<string, unknown>;
				}[]
			>`
				select id::text as id, state, resolution, facts
				from public.alert_events
				where tenant_id = ${fixture.tenantId}::uuid and dedupe_key = ${dedupeKey}
			`;
		const alertMessages = (episodeId: string) =>
			sql<
				{ channel_id: string; kind: string; params: Record<string, unknown> }[]
			>`
				select channel_id::text as channel_id, kind, params
				from public.outbound_messages
				where tenant_id = ${fixture.tenantId}::uuid and alert_event_id = ${episodeId}::uuid
			`;
		const managerAlerts = () =>
			chatTexts(mock, managerChat).filter((text) =>
				text.startsWith("Cảnh báo:"),
			);

		const first = await reconcile(new Date());
		expect(first.mismatches_found).toBe(1);
		expect(first.mismatch_alerts).toBe(1);
		const [opened] = await episodes();
		expect(opened?.state).toBe("open");
		expect(opened?.facts).toEqual({
			open_items: 1,
			verified_without_invoice: 0,
			discount_without_redemption: 1,
			amount_mismatch: 0,
		});
		const queued = await alertMessages(opened?.id ?? "");
		expect(
			queued.filter((row) => row.channel_id === managerChannel),
		).toHaveLength(1);
		expect(queued.some((row) => row.channel_id === ownerChannel)).toBe(true);
		for (const row of queued) {
			expect(row.kind).toBe("alert");
			const params = JSON.stringify(row.params);
			expect(params).not.toContain(invoice.id);
			expect(params.toLowerCase()).not.toContain(discountName.toLowerCase());
		}

		const soon = new Date(Date.now() + MINUTE);
		const quietEnds = localInstant(localIsoDate(soon, ZONE), 6, 1);
		const deliverAt = soon.getTime() < quietEnds.getTime() ? quietEnds : soon;
		await fixture.cycle({ at: deliverAt });
		const delivered = managerAlerts();
		expect(delivered).toHaveLength(1);
		const text = delivered[0] ?? "";
		expect(text).toBe(
			`Cảnh báo: ${invoice.store_name} có 1 mục đổi thưởng chưa khớp với hóa đơn POS: 1 hóa đơn có giảm giá đổi thưởng nhưng không có lượt đổi nào. Đối chiếu với POS rồi xử lý các mục này trong hàng chờ đối soát.\nTắt hoặc đổi kênh nhận: Cài đặt → Cảnh báo.`,
		);
		expect(text).not.toMatch(/₫|\d{1,3}(\.\d{3})+|https?:/);
		expect(text).not.toContain(discountName);
		expect(text.length).toBeLessThanOrEqual(1900);

		const again = await reconcile(new Date());
		expect(again.mismatches_found).toBe(0);
		expect(again.mismatch_alerts).toBe(0);
		expect(await alertMessages(opened?.id ?? "")).toHaveLength(queued.length);

		const [item] = await sql<{ id: string }[]>`
			select id::text as id from public.loyalty_queue
			where invoice_id = ${invoice.id}::uuid and reason = 'discount_without_redemption' and state = 'open'
		`;
		await asOwner(sql, fixture.owner.userId, (transaction) =>
			transaction`select public.resolve_loyalty_queue_item(${item?.id ?? ""}::uuid, null, 'checked with the POS')`.then(
				() => undefined,
			),
		);
		await reconcile(new Date());
		const [cleared] = await episodes();
		expect(cleared?.state).toBe("resolved");
		expect(cleared?.resolution).toBe("cleared");
		await fixture.cycle({ at: new Date(deliverAt.getTime() + MINUTE) });
		expect(managerAlerts()).toHaveLength(1);
		expect(chatTexts(mock, managerChat).join("\n")).not.toContain(
			"Đã khôi phục",
		);
	}, 300_000);

	// Test design (ISTQB): state transition (no episode, open, still open, resolved), boundary values at the 3-day
	// horizon of the completion deadline (1 second before, exactly), a decision table over who is told (the owner and a
	// manager of every store; a manager of one store is not), and security (the message and the episode carry counts only).
	// Every instant is fixed from the fixture's own date; the request is received 18 days before the scenario's reading.
	it("data-subject deadline", async () => {
		const DAY = 24 * HOUR;
		const receivedAt = localInstant(shiftIsoDate(today, 2), 8);
		const horizon = new Date(receivedAt.getTime() + 17 * DAY);
		const eighteenDays = new Date(receivedAt.getTime() + 18 * DAY);
		const linkAt = localInstant(shiftIsoDate(today, 3), 9);
		const stamp = today.replaceAll("-", "");
		const managerChat = `synthetic-chat-dsr-manager-${stamp}`;
		const limitedChat = `synthetic-chat-dsr-limited-${stamp}`;
		const contact = `synthetic-contact-dsr-${stamp}`;
		const note = `synthetic-note-dsr-${stamp}`;
		const manager = await fixture.addMember("manager", null);
		await fixture.linkZaloBot(manager, { chatId: managerChat, at: linkAt });
		await fixture.linkZaloBot(fixture.manager, {
			chatId: limitedChat,
			at: linkAt,
		});
		const dsrTexts = (chatId: string) =>
			chatTexts(mock, chatId).filter((text) =>
				text.includes("yêu cầu về dữ liệu cá nhân"),
			);
		const episodes = () =>
			sql<
				{
					id: string;
					state: string;
					resolution: string | null;
					facts: Record<string, unknown>;
					opened: number;
				}[]
			>`
				select id::text as id, state, resolution, facts, extract(epoch from opened_at)::float8 as opened
				from public.alert_events
				where tenant_id = ${fixture.tenantId}::uuid and dedupe_key = 'dsr_due_soon:tenant'
				order by opened_at
			`;
		const tickAt = async (at: Date) => {
			const report = await fixture.cycle({ at, runSqlTick: true });
			return Number(report.tick?.dsr_due_soon);
		};
		const expectedText =
			"Cảnh báo: 0 yêu cầu về dữ liệu cá nhân đã quá hạn trả lời và 1 yêu cầu đến hạn trong 3 ngày tới. Mở Khách hàng → Yêu cầu dữ liệu để xử lý.\nTắt hoặc đổi kênh nhận: Cài đặt → Cảnh báo.";

		// negative baseline: no request, no episode, nobody told
		expect(await tickAt(new Date(horizon.getTime() - MINUTE))).toBe(0);
		expect(await episodes()).toHaveLength(0);

		// the request was answered the day after it was received, so only its completion deadline (20 days) counts
		const [request] = await sql<{ id: string; exact: boolean }[]>`
			insert into public.data_subject_requests (tenant_id, subject_type, contact, request_type, received_at, status, responded_at, notes)
			values (
				${fixture.tenantId}::uuid, 'customer', ${contact}, 'access', ${receivedAt}::timestamptz, 'in_progress',
				${new Date(receivedAt.getTime() + DAY)}::timestamptz, ${note}
			)
			returning id::text as id, completion_due_at = ${new Date(receivedAt.getTime() + 20 * DAY)}::timestamptz as exact
		`;
		expect(request?.exact).toBe(true);

		// boundary: 1 second before the 3-day horizon nothing opens; exactly on it one episode opens
		expect(await tickAt(new Date(horizon.getTime() - 1000))).toBe(0);
		expect(await episodes()).toHaveLength(0);
		expect(await tickAt(horizon)).toBe(1);
		const [opened] = await episodes();
		expect(await episodes()).toHaveLength(1);
		expect(opened?.state).toBe("open");
		expect(opened?.opened).toBe(horizon.getTime() / 1000);
		expect(opened?.facts).toEqual({ overdue: 0, due_soon: 1, days: 3 });
		expect(dsrTexts(ownerChat)).toEqual([expectedText]);
		expect(dsrTexts(managerChat)).toEqual([expectedText]);
		expect(dsrTexts(limitedChat)).toEqual([]);

		// the reading of the scenario, 18 days after receipt: still the one episode, nobody told twice
		expect(await tickAt(eighteenDays)).toBe(0);
		expect(await episodes()).toHaveLength(1);
		expect(dsrTexts(ownerChat)).toEqual([expectedText]);
		expect(dsrTexts(managerChat)).toEqual([expectedText]);

		// decision table over who is told: the owner's and the every-store manager's destinations, once each, nobody else's
		const queued = await sql<
			{ user_id: string; kind: string; count: string; params: unknown }[]
		>`
			select c.user_id::text as user_id, c.kind::text as kind, count(*)::text as count, (array_agg(o.params))[1] as params
			from public.outbound_messages o
			join public.notification_channels c on c.id = o.channel_id
			where o.tenant_id = ${fixture.tenantId}::uuid and o.alert_event_id = ${opened?.id ?? ""}::uuid
			group by c.user_id, c.kind
		`;
		expect(new Set(queued.map((row) => row.user_id))).toEqual(
			new Set([fixture.owner.userId, manager.userId]),
		);
		expect(queued.every((row) => row.count === "1")).toBe(true);
		expect(queued.some((row) => row.kind === "zalo_bot")).toBe(true);
		const dsrEmails = mock
			.emails()
			.filter((email) => email.text.includes("yêu cầu về dữ liệu cá nhân"));
		expect(dsrEmails).toHaveLength(
			queued.filter((row) => row.kind === "email").length,
		);

		// security: counts only, in the episode, the queued messages and every text sent
		const traces = [
			JSON.stringify(opened),
			JSON.stringify(queued),
			...dsrTexts(ownerChat),
			...dsrTexts(managerChat),
			...dsrEmails.map((email) => `${email.subject}\n${email.text}`),
		].join("\n");
		for (const secret of [
			contact,
			note,
			request?.id ?? "",
			fixture.owner.email,
		]) {
			expect(traces).not.toContain(secret);
		}
		expect(expectedText).not.toMatch(/https?:|\d{1,3}(\.\d{3})+/);

		// completing the request resolves the episode without a recovery message, and a later reading opens nothing
		await sql`
			update public.data_subject_requests
			set status = 'completed', completed_at = ${new Date(eighteenDays.getTime() + HOUR)}::timestamptz
			where id = ${request?.id ?? ""}::uuid
		`;
		expect(await tickAt(new Date(eighteenDays.getTime() + 2 * HOUR))).toBe(0);
		const [resolved] = await episodes();
		expect(resolved?.id).toBe(opened?.id);
		expect(resolved?.state).toBe("resolved");
		expect(resolved?.resolution).toBe("cleared");
		expect(await tickAt(new Date(eighteenDays.getTime() + 3 * HOUR))).toBe(0);
		expect(await episodes()).toHaveLength(1);
		expect(dsrTexts(ownerChat)).toEqual([expectedText]);
		expect(dsrTexts(managerChat)).toEqual([expectedText]);
		expect(dsrTexts(limitedChat)).toEqual([]);
	}, 300_000);
});
