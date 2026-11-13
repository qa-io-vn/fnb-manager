import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { shiftIsoDate, zonedInstant } from "@fnb/core";
import { localIsoDate } from "@fnb/notify";
import { CompositeNotifier, OutboxNotifier } from "@fnb/notify/outbox";
import {
	destinationState,
	enqueueMessage,
	listDestinations,
} from "@fnb/notify/postgres";
import {
	assertSyntheticEnvironment,
	createFixtureTenant,
	type FixtureTenant,
	type MockProviders,
	startMockProviders,
} from "@fnb/notify/testing";
import {
	type AccountEntry,
	MemoryNotifier,
	runIncrementalStore,
} from "@fnb/runner";
import { PostgresRunnerDatabase } from "@fnb/runner/postgres";
import { createRedactor } from "@fnb/sync";
import {
	createPostgresClient,
	PostgresSyncRepository,
} from "@fnb/sync/postgres";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli.js";
import type { OutputStreams } from "../../src/output.js";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.NOTIFY_INTEGRATION === "1" && Boolean(DATABASE_URL);
const ZONE = "Asia/Ho_Chi_Minh";

interface Result {
	code: number;
	stdout: string;
	stderr: string;
}

async function fnb(
	argv: string[],
	environment: Readonly<Record<string, string>>,
	onStdout: (text: string) => void = () => undefined,
	now?: () => Date,
): Promise<Result> {
	assertSyntheticEnvironment(environment);
	const out: string[] = [];
	const err: string[] = [];
	const streams: OutputStreams = {
		stdout: (text) => {
			out.push(text);
			onStdout(out.join(""));
		},
		stderr: (text) => {
			err.push(text);
		},
	};
	const code = await runCli(
		argv,
		{ ...environment },
		{ streams, loadEnvFile: false, ...(now === undefined ? {} : { now }) },
	);
	return { code, stdout: out.join(""), stderr: err.join("") };
}

describe.skipIf(!ENABLED)("fnb notify on the local stack", () => {
	let sql: Sql;
	let mock: MockProviders;
	let fixture: FixtureTenant;
	const tomorrow = shiftIsoDate(localIsoDate(new Date(), ZONE), 1);

	beforeAll(async () => {
		sql = createPostgresClient(DATABASE_URL ?? "", {
			maxConnections: 3,
			applicationName: "notify-cli-it",
		});
		mock = await startMockProviders();
		fixture = await createFixtureTenant(sql, {
			mock,
			databaseUrl: DATABASE_URL ?? "",
			salesDays: 0,
		});
	}, 120_000);

	afterAll(async () => {
		await fixture?.cleanup();
		await mock?.close();
		await sql?.end({ timeout: 5 });
	});

	it("links a member's Zalo Bot chat through the two-step flow and sends a test message", async () => {
		const chat = `synthetic-chat-cli-${randomUUID().slice(0, 8)}`;
		let codeQueued = false;
		let acceptanceQueued = false;
		const link = await fnb(
			[
				"notify",
				"link",
				"--tenant",
				fixture.slug,
				"--kind",
				"zalo_bot",
				"--member",
				fixture.owner.email,
				"--secret",
				fixture.secretName,
				"--wait",
				"60",
			],
			fixture.environment,
			(text) => {
				const code = /Gửi mã (FNB-[A-Z0-9]{8}) cho/.exec(text)?.[1];
				if (code && !codeQueued) {
					codeQueued = true;
					mock.queueZaloUpdate(fixture.token, { chatId: chat, text: code });
				}
				if (
					text.includes("waiting for the member to reply") &&
					!acceptanceQueued
				) {
					acceptanceQueued = true;
					mock.queueZaloUpdate(fixture.token, { chatId: chat, text: "ĐỒNG Ý" });
				}
			},
		);
		expect(link.code, link.stderr).toBe(0);
		expect(link.stdout).toContain(
			"Thông báo cho người nhận (ops-notifications-v1):",
		);
		expect(link.stdout).toContain(
			"Gửi nguyên khối này cho người nhận nếu bạn liên kết giúp họ:",
		);
		expect(link.stdout).toContain(
			`destination 1 (zalo_bot): linked, chat …${chat.slice(-4)}`,
		);
		expect(link.stdout).not.toContain(chat);
		const [destination] = await listDestinations(sql, fixture.tenantId);
		expect(destination?.status).toBe("active");
		expect(
			(await destinationState(sql, destination?.id ?? ""))?.consentRecordId,
		).not.toBeNull();
		expect(
			mock.zaloMessages().filter((message) => message.chatId === chat),
		).toHaveLength(2);

		const test = await fnb(
			["notify", "test", "--tenant", fixture.slug],
			fixture.environment,
		);
		expect(test.code, test.stderr).toBe(0);
		expect(test.stdout.trim()).toBe("destination 1 (zalo_bot): sent");
		const received = mock
			.zaloMessages()
			.filter((message) => message.chatId === chat);
		expect(received).toHaveLength(3);
		expect(received[2]?.text).toMatch(
			/^Tin thử từ FNB Manager: kênh Zalo Bot hoạt động lúc \d{2}:\d{2} \d{2}\/\d{2}\/\d{4}\./,
		);

		const missing = await fnb(["notify", "test", "--tenant", fixture.slug], {
			...fixture.environment,
			NOTIFY_ZALO_BOT_TOKEN_IT: "",
		});
		expect(missing.stdout.trim()).toBe(
			"destination 1 (zalo_bot): queued for the Supabase dispatcher",
		);
	}, 120_000);

	it("links a member's login e-mail with the code the notice e-mail carried", async () => {
		const input = new PassThrough();
		const stdin = vi
			.spyOn(process, "stdin", "get")
			.mockReturnValue(input as unknown as typeof process.stdin);
		const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		try {
			const before = mock.emails().length;
			const pending = fnb(
				[
					"notify",
					"link",
					"--tenant",
					fixture.slug,
					"--kind",
					"email",
					"--member",
					fixture.owner.email,
					"--secret",
					"NOTIFY_EMAIL_API_KEY_IT",
				],
				fixture.environment,
			);
			let code: string | undefined;
			for (let attempt = 0; attempt < 100 && code === undefined; attempt += 1) {
				await new Promise((resolve) => setTimeout(resolve, 50));
				const email = mock.emails().slice(before)[0];
				code = /: (\d{6})\. Mã hết hạn/.exec(email?.text ?? "")?.[1];
			}
			expect(code).toMatch(/^\d{6}$/);
			input.write("000000\n");
			input.write(`${code}\n`);
			const result = await pending;
			expect(result.code, result.stderr).toBe(0);
			expect(result.stdout).toContain("destination 2 (email): linked, ");
			expect(result.stdout).not.toContain(fixture.owner.email);
			const linkEmail = mock.emails().slice(before)[0];
			expect(linkEmail?.subject).toBe("Mã xác nhận nhận bản tin");
			expect(linkEmail?.to).toBe(fixture.owner.email);
			expect(linkEmail?.text).toContain("Khi liên kết,");
			const [destination] = (
				await listDestinations(sql, fixture.tenantId)
			).filter((entry) => entry.kind === "email");
			expect(destination?.status).toBe("active");
			const state = await destinationState(sql, destination?.id ?? "");
			expect(state?.consentRecordId).not.toBeNull();
			const [codeBody] = await sql<{ body: string | null }[]>`
				select body from public.outbound_messages
				where channel_id = ${destination?.id ?? ""}::uuid and kind = 'link_code'
			`;
			expect(codeBody?.body).toBeNull();
		} finally {
			stdin.mockRestore();
			write.mockRestore();
		}
	}, 60_000);

	it("prints the held decision at a simulated time and status without names in CI", async () => {
		const [destination] = await listDestinations(sql, fixture.tenantId);
		const enqueuedAt = zonedInstant(tomorrow, 30, ZONE);
		await enqueueMessage(sql, {
			tenantId: fixture.tenantId,
			channelId: destination?.id ?? "",
			kind: "alert",
			templateRef: "alert.sync_stale.v1",
			dedupeKey: `alert:it-${randomUUID()}:cli:open`,
			title: "Cảnh báo thử nghiệm",
			body: "Cảnh báo thử nghiệm qua dòng lệnh.",
			severity: "warning",
			expiresAt: new Date(enqueuedAt.getTime() + 86_400_000),
			at: enqueuedAt,
		});
		const dry = await fnb(
			[
				"notify",
				"tick",
				"--tenant",
				fixture.slug,
				"--dry-run",
				"--at",
				`${tomorrow}T00:31:00+07:00`,
			],
			{ ...fixture.environment, CI: "1" },
		);
		expect(dry.code, dry.stderr).toBe(0);
		expect(dry.stdout).toContain(
			`held until ${tomorrow} 06:00 +07, outside_hours`,
		);
		expect(dry.stdout).toContain("nothing claimed or sent");
		const unscoped = await fnb(
			["notify", "tick", "--dry-run"],
			fixture.environment,
		);
		expect(unscoped.code).toBe(2);

		const status = await fnb(["notify", "status", "--tenant", fixture.slug], {
			...fixture.environment,
			CI: "1",
		});
		expect(status.code, status.stderr).toBe(0);
		expect(status.stdout).toContain("tenant 1: messages 14 d:");
		expect(status.stdout).toContain("destination 1 (zalo_bot): active");
		expect(status.stdout).toContain("of 3000 Zalo Bot messages this month");
		for (const secret of [
			fixture.slug,
			fixture.name,
			fixture.owner.email,
			"synthetic-chat-cli",
			fixture.token,
		]) {
			expect(status.stdout).not.toContain(secret);
			expect(dry.stdout).not.toContain(secret);
		}
	}, 60_000);
	it("unlinks one destination, then withdraws the member's consent", async () => {
		const removed = await fnb(
			["notify", "unlink", "--tenant", fixture.slug, "--destination", "2"],
			{ ...fixture.environment, CI: "1" },
		);
		expect(removed.code, removed.stderr).toBe(0);
		expect(removed.stdout).toContain("destination 2 (email): removed");
		expect(
			(await listDestinations(sql, fixture.tenantId)).map(
				(entry) => entry.kind,
			),
		).toEqual(["zalo_bot"]);
		const withdrawn = await fnb(
			[
				"notify",
				"unlink",
				"--tenant",
				fixture.slug,
				"--member",
				fixture.owner.email,
				"--all",
			],
			{ ...fixture.environment, CI: "1" },
		);
		expect(withdrawn.code, withdrawn.stderr).toBe(0);
		expect(withdrawn.stdout).toContain(
			"member 1: notifications consent withdrawn, 1 destination(s) disabled or removed",
		);
		expect(withdrawn.stdout).not.toContain(fixture.owner.email);
		const [destination] = await listDestinations(sql, fixture.tenantId);
		expect(destination?.status).toBe("disabled");
		const [consent] = await sql<{ revoked: boolean }[]>`
			select revoked_at is not null as revoked from public.consent_records
			where tenant_id = ${fixture.tenantId}::uuid and purpose = 'notifications'
		`;
		expect(consent?.revoked).toBe(true);
	}, 60_000);
});

describe.skipIf(!ENABLED)("alerts through the CLI on the local stack", () => {
	let sql: Sql;
	let mock: MockProviders;
	let fixture: FixtureTenant;
	const today = localIsoDate(new Date(), ZONE);
	const chat = `synthetic-chat-alerts-${randomUUID().slice(0, 8)}`;
	const MINUTE = 60_000;

	beforeAll(async () => {
		sql = createPostgresClient(DATABASE_URL ?? "", {
			maxConnections: 4,
			applicationName: "notify-cli-alerts-it",
		});
		mock = await startMockProviders();
		fixture = await createFixtureTenant(sql, {
			mock,
			databaseUrl: DATABASE_URL ?? "",
			salesDays: 3,
		});
		await fixture.linkZaloBot(fixture.owner, {
			chatId: chat,
			at: zonedInstant(shiftIsoDate(today, 30), 9 * 60, ZONE),
		});
	}, 300_000);

	afterAll(async () => {
		await fixture?.cleanup();
		await mock?.close();
		await sql?.end({ timeout: 5 });
	});

	function alertsToChat(): string[] {
		return mock
			.zaloMessages()
			.filter((message) => message.chatId === chat && message.accepted)
			.map((message) => message.text);
	}

	it("job failed", async () => {
		const night = zonedInstant(shiftIsoDate(today, 31), 3 * 60 + 30, ZONE);
		const before = alertsToChat().length;
		const held = await fnb(
			[
				"notify",
				"job-failed",
				"--tenant",
				fixture.slug,
				"--workflow",
				"Backup database",
				"--conclusion",
				"failure",
				"--run-id",
				"123456",
				"--attempt",
				"1",
			],
			{ ...fixture.environment, CI: "1" },
			() => undefined,
			() => night,
		);
		expect(held.code, held.stderr).toBe(0);
		expect(held.stdout).toContain(
			"job-failed: backup failure recorded for 1 tenant(s)",
		);
		expect(held.stdout).not.toContain(fixture.slug);
		const [message] = await sql<
			{ status: string; not_before: Date | null; hold_reason: string | null }[]
		>`
			select o.status, o.not_before, o.hold_reason
			from public.outbound_messages o
			join public.alert_events e on e.id = o.alert_event_id
			where o.tenant_id = ${fixture.tenantId}::uuid and e.rule_key = 'job_failed'
		`;
		expect(message?.status).toBe("held");
		expect(message?.hold_reason).toBe("outside_hours");
		expect(message?.not_before?.toISOString()).toBe(
			zonedInstant(shiftIsoDate(today, 31), 6 * 60, ZONE).toISOString(),
		);
		expect(alertsToChat()).toHaveLength(before);

		const unreachable = await fnb(
			[
				"notify",
				"job-failed",
				"--tenant",
				fixture.slug,
				"--workflow",
				"Sync",
				"--conclusion",
				"failure",
			],
			{
				...fixture.environment,
				DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:9/postgres",
			},
		);
		expect(unreachable.code).toBe(3);
		const usage = await fnb(
			["notify", "job-failed", "--workflow", "Sync"],
			fixture.environment,
		);
		expect(usage.code).toBe(2);
	}, 120_000);

	it("credential failure", async () => {
		const start = zonedInstant(shiftIsoDate(today, 32), 10 * 60, ZONE);
		const requestsBefore = mock.requestCount("sendMessage");
		const entry = fixture.accountEntry({ rejectLogin: true });
		const entries = [entry] as unknown as AccountEntry[];
		const memory = new MemoryNotifier();
		const notifier = new CompositeNotifier([
			memory,
			new OutboxNotifier(() => sql, "incremental"),
		]);
		const repository = new PostgresSyncRepository(sql);
		const database = new PostgresRunnerDatabase(sql);
		const redact = createRedactor([]);
		const runRound = (at: Date) =>
			Promise.all(
				fixture.storeIds.map((storeId) =>
					runIncrementalStore({
						repository,
						database,
						entries,
						environment: {},
						storeId,
						notifier,
						redact,
						triggeredBy: "test",
						now: () => at,
						log: () => undefined,
					}),
				),
			);
		const synced = await fixture.windowRun(
			shiftIsoDate(today, 31),
			shiftIsoDate(today, 31),
			new Date(start.getTime() - 30 * MINUTE),
			"backfill",
		);
		expect(synced.status).toBe("succeeded");
		const first = await runRound(start);
		expect(first.map((outcome) => outcome.kind)).toEqual(["failed", "failed"]);
		await runRound(new Date(start.getTime() + 30 * MINUTE));
		expect(
			memory.sent.filter((sent) => sent.kind === "auth_failed"),
		).toHaveLength(1);
		expect(
			memory.sent.filter((sent) => sent.kind !== "auth_failed"),
		).toHaveLength(0);

		const twoHours = new Date(start.getTime() + 120 * MINUTE);
		for (const storeId of fixture.storeIds) {
			await sql`
				insert into app.sync_alerts (tenant_id, store_id, kind, opened_at, last_seen_at, minutes, occurrences)
				values (${fixture.tenantId}::uuid, ${storeId}::uuid, 'sync_stale', ${twoHours}::timestamptz, ${twoHours}::timestamptz, 120, 1)
			`;
		}
		await fixture.cycle({ at: twoHours, runSqlTick: true });
		const threeHours = new Date(start.getTime() + 180 * MINUTE);
		await sql`
			update app.sync_alerts set last_seen_at = ${threeHours}::timestamptz, minutes = 180, occurrences = occurrences + 1
			where tenant_id = ${fixture.tenantId}::uuid and resolved_at is null
		`;
		await fixture.cycle({ at: threeHours, runSqlTick: true });

		const nightly = await fnb(
			[
				"sync",
				"window",
				"--all-accounts",
				"--from",
				shiftIsoDate(today, -1),
				"--to",
				shiftIsoDate(today, -1),
				"--kind",
				"nightly",
			],
			{ ...fixture.environment, POS_ACCOUNTS_JSON: JSON.stringify([entry]) },
		);
		expect(nightly.code).toBe(1);
		expect(nightly.stderr).toContain("authentication failed");
		expect(nightly.stderr).not.toContain("configuration:");

		const job = await fnb(
			[
				"notify",
				"job-failed",
				"--tenant",
				fixture.slug,
				"--workflow",
				"Sync",
				"--conclusion",
				"failure",
				"--started-at",
				new Date(threeHours.getTime() + MINUTE).toISOString(),
			],
			fixture.environment,
			() => undefined,
			() => new Date(threeHours.getTime() + 10 * MINUTE),
		);
		expect(job.code, job.stderr).toBe(0);
		await fixture.cycle({ at: new Date(threeHours.getTime() + 15 * MINUTE) });

		const [account] = await sql<{ status: string }[]>`
			select status::text as status from public.pos_accounts where id = ${fixture.accountId}::uuid
		`;
		expect(account?.status).toBe("auth_failed");
		const episodes = await sql<{ state: string; folded_occurrences: number }[]>`
			select state, folded_occurrences from public.alert_events
			where tenant_id = ${fixture.tenantId}::uuid and rule_key = 'auth_failed'
		`;
		expect(episodes).toHaveLength(1);
		expect(episodes[0]?.state).toBe("open");
		expect(episodes[0]?.folded_occurrences).toBeGreaterThanOrEqual(2);
		const [alerts] = await sql<{ count: string }[]>`
			select count(*)::text as count
			from public.outbound_messages o
			where o.tenant_id = ${fixture.tenantId}::uuid and o.kind = 'alert' and o.created_at >= ${start}::timestamptz
		`;
		expect(Number(alerts?.count)).toBe(1);
		const received = alertsToChat().filter((text) =>
			text.includes("POS từ chối đăng nhập"),
		);
		expect(received).toHaveLength(1);
		expect(mock.requestCount("sendMessage")).toBe(requestsBefore + 1);
		const [suppressed] = await sql<{ count: string }[]>`
			select count(*)::text as count from public.alert_events
			where tenant_id = ${fixture.tenantId}::uuid and rule_key = 'job_failed'
				and suppressed_reason = 'root_cause_open'
		`;
		expect(Number(suppressed?.count)).toBe(1);
	}, 300_000);
});
