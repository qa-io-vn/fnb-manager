import { emptyCycleReport } from "@fnb/notify";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { decisionLine, tickLine } from "../../src/commands/notify.js";
import { capture } from "../support/capture.js";

async function run(argv: string[], env: Record<string, string> = {}) {
	const io = capture();
	const code = await runCli(argv, env, {
		streams: io.streams,
		loadEnvFile: false,
	});
	return { code, stdout: io.stdout(), stderr: io.stderr() };
}

const LOOPBACK = {
	NOTIFY_ZALO_BOT_BASE_URL: "http://127.0.0.1:8787",
	NOTIFY_BREVO_BASE_URL: "http://127.0.0.1:8787",
};

describe("fnb notify", () => {
	it("lists the notify commands and documents each one", async () => {
		const help = await run(["--help"]);
		for (const command of [
			"notify tick",
			"notify status",
			"notify test",
			"notify link",
		]) {
			expect(help.stdout).toContain(command);
		}
		const group = await run(["notify"]);
		expect(group.code).toBe(2);
		expect(group.stdout).toContain("fnb notify tick");
		const tick = await run(["notify", "tick", "--help"]);
		expect(tick.code).toBe(0);
		expect(tick.stdout).toContain("--skip-if-scheduler-healthy");
		expect(tick.stdout).toContain(
			"held until 2026-11-09 06:00 +07, outside_hours",
		);
		const link = await run(["help", "notify", "link"]);
		expect(link.stdout).toContain("ĐỒNG Ý");
	});

	it("requires a tenant whenever the clock is simulated or a test override is set", async () => {
		const simulated = await run([
			"notify",
			"tick",
			"--at",
			"2026-11-09T00:31:00+07:00",
			"--dry-run",
		]);
		expect(simulated.code).toBe(2);
		expect(simulated.stderr).toContain("--tenant is required");
		const override = await run(["notify", "tick"], LOOPBACK);
		expect(override.code).toBe(2);
		const integration = await run(["notify", "tick"], {
			NOTIFY_INTEGRATION: "1",
		});
		expect(integration.code).toBe(2);
	});

	it("sends at a simulated time only to a loopback mock server", async () => {
		const real = await run([
			"notify",
			"tick",
			"--tenant",
			"notify-it-x",
			"--at",
			"2026-11-09T00:31:00+07:00",
		]);
		expect(real.code).toBe(2);
		expect(real.stderr).toContain("loopback mock server");
		const badInstant = await run([
			"notify",
			"tick",
			"--tenant",
			"notify-it-x",
			"--at",
			"2026-11-09 00:31",
		]);
		expect(badInstant.code).toBe(2);
		expect(badInstant.stderr).toContain("ISO instant with an offset");
		const badBudget = await run(["notify", "tick", "--budget-seconds", "0"]);
		expect(badBudget.code).toBe(2);
	});

	it("sends at a simulated time or through a test override only for a fixture tenant", async () => {
		const at = "2026-11-09T00:31:00+07:00";
		for (const slug of ["live-local", "demo-fnb", "notify-it-"]) {
			const simulated = await run(
				["notify", "tick", "--tenant", slug, "--at", at],
				LOOPBACK,
			);
			expect(simulated.code).toBe(2);
			expect(simulated.stderr).toContain("only for a fixture tenant");
			expect(simulated.stderr).toContain("--dry-run");
		}
		const override = await run(
			["notify", "tick", "--tenant", "live-local"],
			LOOPBACK,
		);
		expect(override.code).toBe(2);
		expect(override.stderr).toContain("only for a fixture tenant");
		const integration = await run(["notify", "tick", "--tenant", "demo-fnb"], {
			NOTIFY_INTEGRATION: "1",
		});
		expect(integration.code).toBe(2);
		expect(integration.stderr).toContain("only for a fixture tenant");
		const testSend = await run(
			["notify", "test", "--tenant", "live-local"],
			LOOPBACK,
		);
		expect(testSend.code).toBe(2);
		expect(testSend.stderr).toContain("only for a fixture tenant");
		const linkSend = await run(
			[
				"notify",
				"link",
				"--tenant",
				"live-local",
				"--kind",
				"zalo_bot",
				"--member",
				"owner@example.com",
			],
			LOOPBACK,
		);
		expect(linkSend.code).toBe(2);
		expect(linkSend.stderr).toContain("only for a fixture tenant");
		const dryRun = await run(
			["notify", "tick", "--tenant", "live-local", "--dry-run", "--at", at],
			LOOPBACK,
		);
		const fixture = await run(
			["notify", "tick", "--tenant", "notify-it-x", "--at", at],
			LOOPBACK,
		);
		for (const allowed of [dryRun, fixture]) {
			expect(allowed.stderr).not.toContain("only for a fixture tenant");
			expect(allowed.code).toBe(1);
			expect(allowed.stderr).toContain("set DATABASE_URL");
		}
	});

	it("validates status and test options before touching the database", async () => {
		expect((await run(["notify", "status", "--days", "0"])).code).toBe(2);
		expect((await run(["notify", "test"])).code).toBe(2);
		expect(
			(await run(["notify", "test", "--tenant", "t", "--destination", "zero"]))
				.code,
		).toBe(2);
	});

	it("refuses linking in CI and kinds whose adapter is not built yet", async () => {
		const ci = await run(
			[
				"notify",
				"link",
				"--tenant",
				"t",
				"--kind",
				"zalo_bot",
				"--member",
				"owner@example.com",
			],
			{
				CI: "1",
			},
		);
		expect(ci.code).toBe(2);
		expect(ci.stderr).toContain("refused in CI");
		const resend = await run([
			"notify",
			"link",
			"--tenant",
			"t",
			"--kind",
			"email",
			"--provider",
			"resend",
			"--member",
			"owner@example.com",
		]);
		expect(resend.code).toBe(2);
		expect(resend.stderr).toContain("not built yet");
		const webhook = await run([
			"notify",
			"link",
			"--tenant",
			"t",
			"--kind",
			"webhook",
			"--url",
			"https://hooks.example.com/fnb/alerts",
		]);
		expect(webhook.code).toBe(2);
		expect(webhook.stderr).toContain("not built yet");
		const unknown = await run([
			"notify",
			"link",
			"--tenant",
			"t",
			"--kind",
			"sms",
		]);
		expect(unknown.code).toBe(2);
		const url = await run([
			"notify",
			"link",
			"--tenant",
			"t",
			"--kind",
			"zalo_bot",
			"--member",
			"owner@example.com",
			"--url",
			"https://hooks.example.com/fnb/alerts",
		]);
		expect(url.code).toBe(2);
		expect(url.stderr).toContain("--url applies to --kind webhook");
	});

	it("accepts only the kind's own secret names and needs the token in the environment", async () => {
		const wrong = await run([
			"notify",
			"link",
			"--tenant",
			"t",
			"--kind",
			"zalo_bot",
			"--member",
			"owner@example.com",
			"--secret",
			"POS_ACCOUNTS_JSON",
		]);
		expect(wrong.code).toBe(2);
		expect(wrong.stderr).toContain("NOTIFY_ZALO_BOT_TOKEN_<SUFFIX>");
		const missing = await run([
			"notify",
			"link",
			"--tenant",
			"t",
			"--kind",
			"zalo_bot",
			"--member",
			"owner@example.com",
		]);
		expect(missing.code).toBe(1);
		expect(missing.stderr).toContain(
			"configuration: NOTIFY_ZALO_BOT_TOKEN is not set here",
		);
		const badMember = await run(
			[
				"notify",
				"link",
				"--tenant",
				"t",
				"--kind",
				"zalo_bot",
				"--member",
				"nobody",
			],
			{
				NOTIFY_ZALO_BOT_TOKEN: "synthetic-bot-token",
			},
		);
		expect(badMember.code).toBe(2);
	});
});

describe("notify output lines", () => {
	it("prints a held decision in the reader's zone", () => {
		expect(
			decisionLine(
				{
					number: 3,
					id: "11111111-1111-4111-8111-111111111111",
					kind: "alert",
					status: "held",
					decision: "hold",
					releaseAt: new Date("2026-11-08T23:00:00.000Z"),
					reason: "outside_hours",
					readerTimezone: "Asia/Ho_Chi_Minh",
				},
				new Date("2026-11-08T17:31:00.000Z"),
			),
		).toBe("message 3: held until 2026-11-09 06:00 +07, outside_hours");
	});

	it("summarises a cycle with counts only", () => {
		const report = emptyCycleReport();
		report.add("sent", 1);
		report.tick = { imported: 0, reconciled: 1 };
		const line = tickLine(
			report,
			{
				queued: 0,
				held: 1,
				uncertain: 0,
				nextReleaseAt: new Date("2026-11-08T23:00:00.000Z"),
				nextReleaseTimezone: "Asia/Ho_Chi_Minh",
				oldestQueuedAt: null,
			},
			new Date("2026-11-08T20:30:00.000Z"),
		);
		expect(line).toBe(
			"tick: imported 0 · reconciled 1 · digests built 0 · messages sent 1 · held 1 (next release 06:00 +07) · uncertain 0 · failed 0",
		);
	});
});
