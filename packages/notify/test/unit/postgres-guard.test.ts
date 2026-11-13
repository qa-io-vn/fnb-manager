import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";
import {
	createPostgresNotifyRepository,
	TenantFilterRequiredError,
	tenantFilterRequired,
} from "../../src/postgres/index.js";

function refusingSql(calls: string[]): Sql {
	const tag = (strings: TemplateStringsArray) => {
		calls.push(strings.join("?"));
		return Promise.resolve([]);
	};
	return tag as unknown as Sql;
}

const AT = new Date("2026-11-09T00:00:00.000Z");

describe("tenant-filter guard", () => {
	it.each([
		[{ NOTIFY_INTEGRATION: "1" }, false],
		[{ NOTIFY_ZALO_BOT_BASE_URL: "http://127.0.0.1:8787" }, false],
		[{ NOTIFY_RESEND_BASE_URL: "https://attacker.example.com" }, false],
		[{}, true],
	] as const)(
		"refuses unfiltered scans and skips the shared dispatch record under %j (simulated clock %s)",
		async (environment, simulated) => {
			const calls: string[] = [];
			const repository = createPostgresNotifyRepository(refusingSql(calls), {
				environment,
				simulatedClock: simulated,
			});
			await expect(repository.tick(AT, false, null)).rejects.toBeInstanceOf(
				TenantFilterRequiredError,
			);
			await expect(
				repository.claimNext({
					worker: "w",
					secretNames: ["NOTIFY_ZALO_BOT_TOKEN_IT"],
					leaseSeconds: 120,
					at: AT,
					tenantId: null,
				}),
			).rejects.toBeInstanceOf(TenantFilterRequiredError);
			await expect(repository.pendingLinkBots(AT, null)).rejects.toBeInstanceOf(
				TenantFilterRequiredError,
			);
			await repository.recordDispatch(AT, "cli", ["NOTIFY_ZALO_BOT_TOKEN_IT"], {
				sent: 1,
			});
			expect(calls).toEqual([]);
		},
	);

	it("lets a filtered scan through, and an unfiltered scan and the dispatch record in production", async () => {
		const calls: string[] = [];
		const guarded = createPostgresNotifyRepository(refusingSql(calls), {
			environment: { NOTIFY_INTEGRATION: "1" },
		});
		await guarded.pendingLinkBots(AT, "11111111-1111-4111-8111-111111111111");
		expect(calls).toHaveLength(1);
		const production = createPostgresNotifyRepository(refusingSql(calls), {
			environment: {},
		});
		await production.pendingLinkBots(AT, null);
		expect(calls).toHaveLength(2);
		await production.recordDispatch(AT, "cli", ["NOTIFY_ZALO_BOT_TOKEN"], {
			sent: 1,
		});
		expect(calls).toHaveLength(3);
		expect(tenantFilterRequired({ environment: {} })).toBe(false);
		expect(
			tenantFilterRequired({ environment: { NOTIFY_INTEGRATION: "0" } }),
		).toBe(false);
	});
});
