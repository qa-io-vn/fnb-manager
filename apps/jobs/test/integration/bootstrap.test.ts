import { randomUUID } from "node:crypto";
import { createPostgresClient } from "@fnb/sync/postgres";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { capture } from "../support/capture.js";

const DATABASE_URL = process.env.DATABASE_URL;

async function bootstrap(
	argv: string[],
	env: Record<string, string>,
): Promise<{ code: number; text: string }> {
	const io = capture();
	const code = await runCli(["bootstrap", ...argv], env, {
		streams: io.streams,
		loadEnvFile: false,
	});
	return { code, text: `${io.stdout()}${io.stderr()}` };
}

describe.skipIf(!DATABASE_URL)("fnb bootstrap on the local stack", () => {
	it("loads two months, then skips the closed one and reloads the current month", async () => {
		const suffix = randomUUID().slice(0, 8);
		const slug = `it-boot-${suffix}`;
		const accountKey = `it-boot-${suffix}`;
		const env = {
			CI: "1",
			DATABASE_URL: DATABASE_URL ?? "",
			POS_ACCOUNTS_JSON: JSON.stringify([
				{ key: accountKey, connector: "mock", seed: 13 },
			]),
		};
		const sql = createPostgresClient(DATABASE_URL ?? "");
		try {
			const first = await bootstrap(
				["--tenant", slug, "--max-months", "2"],
				env,
			);
			expect(first.code, first.text).toBe(0);
			expect(first.text).toContain("tenant: the tenant was created");
			expect(first.text).toContain("account 1: onboarding");
			expect(first.text.match(/: loaded, \d+ sales/g)).toHaveLength(2);
			expect(first.text).toContain("analytics: refreshed");
			const second = await bootstrap(
				["--tenant", slug, "--max-months", "2"],
				env,
			);
			expect(second.code, second.text).toBe(0);
			expect(second.text).toContain("tenant: the tenant exists");
			expect(second.text).toContain("onboarded with its catalogue, kept");
			expect(second.text.match(/: loaded, \d+ sales/g)).toHaveLength(1);
			expect(second.text).toMatch(/already loaded, skipped \([1-9]\d* sales/);
			for (const output of [first.text, second.text]) {
				expect(output).not.toContain(slug);
				expect(output).not.toContain(accountKey);
			}
			const runs = await sql<{ kind: string; status: string }[]>`
				select r.kind::text as kind, r.status::text as status
				from public.sync_runs r
				join public.tenants t on t.id = r.tenant_id
				where t.slug = ${slug}
				order by r.started_at
			`;
			expect(runs.map((run) => run.kind)).toEqual([
				"master_data",
				"backfill",
				"backfill",
				"backfill",
			]);
			expect(runs.every((run) => run.status === "succeeded")).toBe(true);
		} finally {
			await sql`delete from public.tenants where slug = ${slug}`;
			await sql.end({ timeout: 5 });
		}
	}, 300_000);
});
