import { shiftIsoDate, zonedInstant } from "@fnb/core";
import { createPostgresClient } from "@fnb/sync/postgres";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localIsoDate } from "../../src/index.js";
import { activeStoreIds, reviseDueDigests } from "../../src/postgres/index.js";
import {
	createFixtureTenant,
	type FixtureTenant,
	type MockProviders,
	startMockProviders,
} from "../../src/testing/index.js";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.NOTIFY_INTEGRATION === "1" && Boolean(DATABASE_URL);
const ZONE = "Asia/Ho_Chi_Minh";

function localInstant(day: string, hour: number, minute = 0): Date {
	return zonedInstant(day, hour * 60 + minute, ZONE);
}

function chatTexts(mock: MockProviders, chatId: string): string[] {
	return mock
		.zaloMessages()
		.filter((message) => message.chatId === chatId && message.accepted)
		.map((message) => message.text);
}

describe.skipIf(!ENABLED)("digest corrections on the local stack", () => {
	let sql: Sql;
	let mock: MockProviders;
	let fixture: FixtureTenant;
	const today = localIsoDate(new Date(), ZONE);
	const ownerChat = `synthetic-chat-correction-${today.replaceAll("-", "")}`;

	beforeAll(async () => {
		sql = createPostgresClient(DATABASE_URL ?? "", {
			maxConnections: 4,
			applicationName: "notify-it-corrections",
		});
		mock = await startMockProviders();
		fixture = await createFixtureTenant(sql, {
			mock,
			databaseUrl: DATABASE_URL ?? "",
			salesDays: 3,
		});
		await fixture.linkZaloBot(fixture.owner, {
			chatId: ownerChat,
			at: localInstant(shiftIsoDate(today, 1), 9),
		});
	}, 600_000);

	afterAll(async () => {
		await fixture?.cleanup();
		await mock?.close();
		await sql?.end({ timeout: 5 });
	});

	it("correction after the nightly: one correction for a changed store net, none on a second revise", async () => {
		const day = shiftIsoDate(today, 5);
		const next = shiftIsoDate(day, 1);
		const revise = (at: Date) =>
			reviseDueDigests(sql, {
				at,
				dryRun: false,
				tenantId: fixture.tenantId,
				repositoryOptions: { environment: fixture.environment },
			});
		const corrections = () =>
			chatTexts(mock, ownerChat).filter((text) =>
				text.startsWith("Cập nhật bản tin ngày"),
			);

		expect(
			(await fixture.windowRun(day, day, localInstant(next, 3, 23))).status,
		).toBe("succeeded");
		const built = await fixture.cycle({
			at: localInstant(next, 3, 30),
			runSqlTick: true,
			buildDigests: true,
		});
		expect(built.get("digests_built")).toBe(1);
		const morning = await fixture.cycle({
			at: localInstant(next, 6, 0),
			runSqlTick: true,
			buildDigests: true,
		});
		expect(morning.get("sent")).toBeGreaterThanOrEqual(1);

		const unchanged = await revise(localInstant(next, 6, 10));
		expect(unchanged.every((outcome) => outcome.status !== "corrected")).toBe(
			true,
		);

		expect(
			(await fixture.windowRun(day, day, localInstant(next, 9, 0))).status,
		).toBe("succeeded");
		const [storeA] = await activeStoreIds(sql, fixture.tenantId);
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
				limit 1
			)
		`;
		await sql`select app.refresh_analytics(${fixture.tenantId}::uuid, ${day}::date, ${day}::date)`;

		const first = await revise(localInstant(next, 9, 30));
		expect(first.map((outcome) => outcome.status)).toEqual(["corrected"]);
		expect(first[0]?.messages).toBe(1);
		await fixture.cycle({ at: localInstant(next, 9, 31), runSqlTick: true });
		expect(corrections()).toHaveLength(1);
		const text = corrections()[0] ?? "";
		expect(text).toContain("Sau lần đồng bộ đêm, số liệu đã thay đổi:");
		expect(text).toContain("(trước đó");
		expect(text.split("\n")[0]).not.toContain("₫");

		const second = await revise(localInstant(next, 9, 40));
		expect(second.some((outcome) => outcome.status === "corrected")).toBe(
			false,
		);
		await fixture.cycle({ at: localInstant(next, 9, 41), runSqlTick: true });
		expect(corrections()).toHaveLength(1);
		const [revision] = await sql<{ revision: number }[]>`
			select revision::integer as revision from public.digests
			where tenant_id = ${fixture.tenantId}::uuid and business_date = ${day}::date and state = 'built'
		`;
		expect(revision?.revision).toBe(1);
	}, 600_000);
});
