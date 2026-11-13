import { emptyCycleReport } from "@fnb/notify";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { digestExitCode, outcomeLine } from "../../src/commands/digest.js";
import {
	JOB_EXIT,
	jobEventInput,
	jobEventLine,
} from "../../src/commands/notify-job.js";
import {
	emailHint,
	emailSenderConfig,
} from "../../src/commands/notify-link.js";
import { collectSecrets, maskCommands } from "../../src/config/secrets.js";
import { capture } from "../support/capture.js";

async function run(argv: string[], env: Record<string, string> = {}) {
	const io = capture();
	const code = await runCli(argv, env, {
		streams: io.streams,
		loadEnvFile: false,
	});
	return { code, stdout: io.stdout(), stderr: io.stderr() };
}

const STORE = "11111111-1111-4111-8111-111111111111";

describe("fnb digest", () => {
	it("is listed and documents its options", async () => {
		const help = await run(["--help"]);
		for (const command of ["digest", "notify unlink", "notify job-failed"]) {
			expect(help.stdout).toContain(command);
		}
		const digest = await run(["digest", "--help"]);
		expect(digest.code).toBe(0);
		expect(digest.stdout).toContain("--check-ngay");
		expect(digest.stdout).toContain("pos_invoices");
	});

	it("validates its options before touching the database", async () => {
		const both = await run([
			"digest",
			"--due",
			"--date",
			"2026-11-07",
			"--tenant",
			"t",
		]);
		expect(both.code).toBe(2);
		const badDate = await run([
			"digest",
			"--tenant",
			"t",
			"--date",
			"2026-02-30",
		]);
		expect(badDate.code).toBe(2);
		const check = await run(["digest", "--check-ngay", "--date", "2026-11-07"]);
		expect(check.code).toBe(2);
		expect(check.stderr).toContain("--check-ngay needs --tenant and --date");
		const dateOnly = await run(["digest", "--date", "2026-11-07"]);
		expect(dateOnly.code).toBe(2);
		const shown = await run(
			["digest", "--tenant", "t", "--date", "2026-11-07", "--show-text"],
			{ CI: "1" },
		);
		expect(shown.code).toBe(2);
		expect(shown.stderr).toContain("refused in CI");
		const simulated = await run([
			"digest",
			"--due",
			"--at",
			"2026-11-08T03:30:00+07:00",
		]);
		expect(simulated.code).toBe(2);
		expect(simulated.stderr).toContain("--tenant is required");
		const realTenant = await run([
			"digest",
			"--due",
			"--tenant",
			"live-local",
			"--at",
			"2026-11-08T03:30:00+07:00",
		]);
		expect(realTenant.code).toBe(2);
		expect(realTenant.stderr).toContain("only for a fixture tenant");
		const revise = await run(["digest", "--due", "--revise"]);
		expect(revise.code).toBe(2);
		const resend = await run(["digest", "--tenant", "t", "--resend", "--due"]);
		expect(resend.code).toBe(2);
	});

	it("prints scopes by number and counts only", () => {
		const due = {
			tenantId: "t",
			businessDate: "2026-11-07",
			scopeKey: "0".repeat(32),
			storeIds: [STORE],
			allStores: false,
			trigger: "settled" as const,
			runAs: "u",
			channelIds: [],
			storeFacts: [],
		};
		expect(
			outcomeLine(
				{
					due,
					status: "failed",
					model: null,
					fingerprint: null,
					messages: 0,
					rendered: [],
					units: null,
					errorCode: "analytics_22023",
					failureRecorded: false,
					build: null,
				},
				1,
			),
		).toBe("digest: scope 2 (1 store) 2026-11-07 failed (analytics_22023)");
		expect(
			outcomeLine(
				{
					due,
					status: "failed",
					model: null,
					fingerprint: null,
					messages: 0,
					rendered: [],
					units: null,
					errorCode: "analytics_22023",
					failureRecorded: true,
					build: null,
				},
				0,
			),
		).toBe(
			"digest: scope 1 (1 store) 2026-11-07 failed (analytics_22023); recorded, retried on the back-off",
		);
		expect(
			outcomeLine(
				{
					due,
					status: "already_built",
					model: null,
					fingerprint: null,
					messages: 0,
					rendered: [],
					units: null,
					errorCode: null,
					failureRecorded: false,
					build: null,
				},
				0,
			),
		).toBe(
			"digest: scope 1 (1 store) 2026-11-07 already built, nothing queued",
		);
		expect(emptyCycleReport().get("digests_built")).toBe(0);
	});

	it("keeps the nightly green when every failed build was recorded for a retry", () => {
		const due = {
			tenantId: "t",
			businessDate: "2026-11-07",
			scopeKey: "0".repeat(32),
			storeIds: [STORE],
			allStores: false,
			trigger: "settled" as const,
			runAs: "u",
			channelIds: [],
			storeFacts: [],
		};
		const outcome = (status: "built" | "failed", failureRecorded: boolean) => ({
			due,
			status,
			model: null,
			fingerprint: null,
			messages: status === "built" ? 1 : 0,
			rendered: [],
			units: null,
			errorCode: status === "failed" ? "build_failed" : null,
			failureRecorded,
			build: null,
		});
		const built = outcome("built", false);
		const recorded = outcome("failed", true);
		const unrecorded = outcome("failed", false);
		expect(digestExitCode([], true)).toBe(0);
		expect(digestExitCode([built, recorded], true)).toBe(0);
		expect(digestExitCode([built, recorded, unrecorded], true)).toBe(1);
		expect(digestExitCode([built, recorded], false)).toBe(1);
		expect(digestExitCode([built], false)).toBe(0);
	});
});

describe("fnb notify job-failed", () => {
	it("maps workflow names and validates the conclusion, run id and attempt", () => {
		expect(
			jobEventInput({
				workflow: "Migrate database",
				conclusion: "timed_out",
				"run-id": "123",
				attempt: "2",
				"started-at": "2026-11-09T03:23:00+07:00",
			}),
		).toEqual({
			workflowKey: "migrate",
			conclusion: "timed_out",
			runId: "123",
			attempt: 2,
			startedAt: new Date("2026-11-08T20:23:00.000Z"),
		});
		expect(() =>
			jobEventInput({ workflow: "Sync", conclusion: "cancelled" }),
		).toThrow(
			"--conclusion must be one of failure, timed_out, startup_failure",
		);
		expect(() =>
			jobEventInput({
				workflow: "Sync",
				conclusion: "failure",
				"run-id": "x1",
			}),
		).toThrow("--run-id");
		expect(
			jobEventInput({ workflow: "Something new", conclusion: "failure" })
				.workflowKey,
		).toBe("other");
	});

	it("exits 2 on a usage error and 3 when no database is configured", async () => {
		const usage = await run(["notify", "job-failed", "--workflow", "Sync"]);
		expect(usage.code).toBe(JOB_EXIT.usage);
		const unknown = await run(["notify", "job-failed", "--nope"]);
		expect(unknown.code).toBe(JOB_EXIT.usage);
		const unreachable = await run([
			"notify",
			"job-failed",
			"--workflow",
			"Sync",
			"--conclusion",
			"failure",
		]);
		expect(unreachable.code).toBe(JOB_EXIT.unreachable);
		expect(unreachable.stderr).toContain("could not connect to the database");
		const integration = await run(
			["notify", "job-failed", "--workflow", "Sync", "--conclusion", "failure"],
			{ NOTIFY_INTEGRATION: "1" },
		);
		expect(integration.code).toBe(JOB_EXIT.usage);
	});

	it("summarises the outcomes with counts only", () => {
		const input = jobEventInput({ workflow: "Sync", conclusion: "failure" });
		expect(jobEventLine(input, [])).toBe(
			"job-failed: sync failure recorded; no tenant receives job_failed alerts",
		);
		expect(
			jobEventLine(input, [
				{ tenantId: "a", outcome: "root_cause_open", messages: 0 },
				{ tenantId: "b", outcome: "opened", messages: 2 },
			]),
		).toBe(
			"job-failed: sync failure recorded for 2 tenant(s): opened 1, root_cause_open 1; 2 message(s) queued",
		);
	});
});

describe("fnb notify unlink and e-mail links", () => {
	it("needs exactly one of --destination or --member --all", async () => {
		expect((await run(["notify", "unlink", "--tenant", "t"])).code).toBe(2);
		expect(
			(
				await run([
					"notify",
					"unlink",
					"--tenant",
					"t",
					"--destination",
					"1",
					"--member",
					"owner@example.com",
				])
			).code,
		).toBe(2);
		const confirm = await run([
			"notify",
			"unlink",
			"--tenant",
			"t",
			"--member",
			"owner@example.com",
		]);
		expect(confirm.code).toBe(2);
		expect(confirm.stderr).toContain("add --all");
		expect(
			(
				await run([
					"notify",
					"unlink",
					"--tenant",
					"t",
					"--destination",
					"1",
					"--all",
				])
			).code,
		).toBe(2);
	});

	it("needs a sender and hints the address without showing it", () => {
		expect(() => emailSenderConfig({}, {})).toThrow("NOTIFY_EMAIL_FROM");
		expect(() =>
			emailSenderConfig({ "from-email": "not-an-address" }, {}),
		).toThrow("--from-email");
		expect(
			emailSenderConfig(
				{ "from-email": "sender@example.com", "from-name": "FNB Manager" },
				{},
			),
		).toEqual({ from_email: "sender@example.com", from_name: "FNB Manager" });
		expect(
			emailSenderConfig({}, { NOTIFY_EMAIL_FROM: "a@example.com" }),
		).toEqual({});
		expect(emailHint("owner@example.com")).toBe("o…@example.com");
	});
});

describe("credential masking", () => {
	it("masks every NOTIFY_* credential and the fields of the fallback targets", () => {
		const environment = {
			GITHUB_ACTIONS: "true",
			NOTIFY_ZALO_BOT_TOKEN: "synthetic-bot-token",
			NOTIFY_EMAIL_API_KEY: "synthetic-email-key",
			NOTIFY_EMAIL_FROM: "sender@example.com",
			NOTIFY_EMAIL_FROM_NAME: "FNB Manager",
			NOTIFY_INTEGRATION: "1",
			NOTIFY_ZALO_BOT_BASE_URL: "http://127.0.0.1:8787",
			NOTIFY_FALLBACK_TARGETS: JSON.stringify([
				{ kind: "zalo_bot", chat_id: "synthetic-chat-1" },
				{
					kind: "email",
					provider: "brevo",
					from: "sender@example.com",
					to: "owner@example.com",
				},
			]),
		};
		const secrets = collectSecrets(environment);
		for (const value of [
			"synthetic-bot-token",
			"synthetic-email-key",
			"sender@example.com",
			"synthetic-chat-1",
			"owner@example.com",
		]) {
			expect(secrets).toContain(value);
		}
		for (const value of ["1", "FNB Manager", "zalo_bot", "brevo", "email"]) {
			expect(secrets).not.toContain(value);
		}
		expect(secrets.some((value) => value.startsWith("http://"))).toBe(false);
		expect(maskCommands(secrets)).toContain("::add-mask::synthetic-bot-token");
	});

	it("documents the NOTIFY_* masking", async () => {
		const help = await run(["mask-credentials", "--help"]);
		expect(help.stdout).toContain("NOTIFY_*");
		expect(help.stdout).toContain("NOTIFY_FALLBACK_TARGETS");
	});
});
