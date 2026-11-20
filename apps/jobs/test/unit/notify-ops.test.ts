import type { NotifyHealth, RevisionOutcome } from "@fnb/notify/postgres";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { revisionLine } from "../../src/commands/digest.js";
import {
	notifyDestinationsCheck,
	notifyScheduleChecks,
	notifySecretsCheck,
	zaloBotQuotaCheck,
} from "../../src/commands/doctor-checks.js";
import { resendableLine } from "../../src/commands/notify.js";
import {
	appBaseUrlOption,
	checkReport,
	resendRefusal,
} from "../../src/commands/notify-ops.js";
import { notificationsLine } from "../../src/commands/status.js";
import { capture } from "../support/capture.js";

async function run(argv: string[], env: Record<string, string> = {}) {
	const io = capture();
	const code = await runCli(argv, env, {
		streams: io.streams,
		loadEnvFile: false,
	});
	return { code, stdout: io.stdout(), stderr: io.stderr() };
}

const AT = new Date("2026-11-09T01:00:00.000Z");
const TENANT = "33333333-3333-4333-8333-333333333333";
const MESSAGE = "55555555-5555-4555-8555-555555555555";

function minutesBefore(minutes: number): Date {
	return new Date(AT.getTime() - minutes * 60_000);
}

function health(overrides: Partial<NotifyHealth> = {}): NotifyHealth {
	return {
		at: AT,
		scheduleEnabled: true,
		lastTickAt: minutesBefore(4),
		lastTicketExpiredAt: null,
		overdueMessages: 0,
		missingSecrets: [],
		staleLeases: 0,
		overdueDigests: 0,
		failingDestinations: [],
		...overrides,
	};
}

describe("fnb notify check", () => {
	it("is listed with setup and resend, and documents its conditions", async () => {
		const help = await run(["--help"]);
		for (const command of ["notify check", "notify setup", "notify resend"]) {
			expect(help.stdout).toContain(command);
		}
		const checkHelp = await run(["notify", "check", "--help"]);
		expect(checkHelp.code).toBe(0);
		expect(checkHelp.stdout).toContain("no_dispatcher_secret");
		const resendHelp = await run(["notify", "resend", "--help"]);
		expect(resendHelp.stdout).toContain(":resend:<n>");
	});

	it("is green with one summary line when nothing is wrong", () => {
		const report = checkReport(health());
		expect(report.code).toBe(0);
		expect(report.lines).toEqual([
			"check: green · schedule enabled · last tick 4 min ago · nothing overdue, no failing destination",
		]);
		const disabled = checkReport(
			health({
				scheduleEnabled: false,
				lastTickAt: null,
				overdueMessages: 3,
				lastTicketExpiredAt: minutesBefore(10),
			}),
		);
		expect(disabled.code).toBe(0);
		expect(disabled.lines[0]).toContain(
			"schedule disabled · no notify tick yet",
		);
	});

	it("turns red for every condition and names each with its count", () => {
		const cases: [Partial<NotifyHealth>, string][] = [
			[{ lastTickAt: minutesBefore(31) }, "no_recent_tick"],
			[{ lastTickAt: null }, "no_recent_tick"],
			[{ overdueMessages: 2 }, "messages_overdue"],
			[{ lastTicketExpiredAt: minutesBefore(119) }, "ticket_expired"],
			[
				{ missingSecrets: [{ key: "NOTIFY_EMAIL_API_KEY", count: 4 }] },
				"no_dispatcher_secret",
			],
			[{ staleLeases: 1 }, "lease_not_recovered"],
			[{ overdueDigests: 1 }, "digest_overdue"],
			[
				{
					failingDestinations: [
						{ tenantId: TENANT, number: 2, kind: "zalo_bot", failures: 3 },
					],
				},
				"destination_failing",
			],
		];
		for (const [overrides, condition] of cases) {
			const report = checkReport(health(overrides));
			expect(report.code, condition).toBe(1);
			expect(report.problems.map((problem) => problem.condition)).toEqual([
				condition,
			]);
			expect(report.lines.at(-1)).toBe(
				`check: red, 1 problem(s): ${condition}`,
			);
		}
		const secret = checkReport(
			health({ missingSecrets: [{ key: "NOTIFY_EMAIL_API_KEY", count: 4 }] }),
		);
		expect(secret.lines[0]).toContain(
			"4 message(s) cancelled in the last 7 days because no dispatcher holds NOTIFY_EMAIL_API_KEY",
		);
		const failing = checkReport(
			health({
				failingDestinations: [
					{ tenantId: TENANT, number: 2, kind: "zalo_bot", failures: 3 },
				],
			}),
			(destination) =>
				`tenant 1 destination ${destination.number} (${destination.kind})`,
		);
		expect(failing.lines[0]).toBe(
			"check: red · destination_failing: tenant 1 destination 2 (zalo_bot) failed 3 times in a row",
		);
	});

	it("keeps the boundaries: 30 min of tick age, 2 h of an expired ticket", () => {
		expect(checkReport(health({ lastTickAt: minutesBefore(30) })).code).toBe(0);
		expect(
			checkReport(health({ lastTicketExpiredAt: minutesBefore(121) })).code,
		).toBe(0);
		expect(checkReport(health({ overdueDigests: null })).code).toBe(0);
	});

	it("needs a tenant under a test override before touching the database", async () => {
		const integration = await run(["notify", "check"], {
			NOTIFY_INTEGRATION: "1",
		});
		expect(integration.code).toBe(2);
		expect(integration.stderr).toContain("--tenant is required");
	});
});

describe("fnb notify setup", () => {
	it("stores https addresses with a trailing slash and loopback test servers", () => {
		expect(appBaseUrlOption("https://example.github.io/repo")).toBe(
			"https://example.github.io/repo/",
		);
		expect(appBaseUrlOption("https://example.github.io/repo/")).toBe(
			"https://example.github.io/repo/",
		);
		expect(appBaseUrlOption("http://127.0.0.1:5173/")).toBe(
			"http://127.0.0.1:5173/",
		);
		expect(appBaseUrlOption("http://localhost:5173")).toBe(
			"http://localhost:5173/",
		);
	});

	it("refuses plain http, user information, a query, a fragment and garbage", async () => {
		for (const value of [
			"http://example.github.io/repo/",
			"http://127.0.0.1:5173/app/",
			"https://user:pw@example.com/repo/",
			"https://example.github.io/repo/?x=1",
			"https://example.github.io/repo/#/ngay",
			"ftp://example.com/",
			"not a url",
		]) {
			expect(() => appBaseUrlOption(value), value).toThrow();
		}
		const refused = await run([
			"notify",
			"setup",
			"--app-url",
			"http://example.github.io/repo/",
		]);
		expect(refused.code).toBe(2);
		expect(refused.stderr).toContain("https");
	});
});

describe("fnb notify resend", () => {
	it("validates the tenant and the message id before touching the database", async () => {
		const missing = await run(["notify", "resend", "--tenant", "t"]);
		expect(missing.code).toBe(2);
		expect(missing.stderr).toContain("--message is required");
		const bad = await run([
			"notify",
			"resend",
			"--tenant",
			"t",
			"--message",
			"3",
		]);
		expect(bad.code).toBe(2);
		const fixtureOnly = await run(
			["notify", "resend", "--tenant", "real-shop", "--message", MESSAGE],
			{ NOTIFY_INTEGRATION: "1" },
		);
		expect(fixtureOnly.code).toBe(2);
	});

	it("explains each refusal of resend_message", () => {
		expect(resendRefusal("22023", { kind: "test", status: "sent" })).toEqual({
			text: "resend: refused (22023): only an uncertain or failed digest or alert can be resent; this one is test, sent",
			exit: 2,
		});
		expect(
			resendRefusal("42501", { kind: "digest", status: "failed" }).exit,
		).toBe(1);
		expect(
			resendRefusal("42883", { kind: "digest", status: "failed" }).text,
		).toContain("apply the migrations");
		expect(resendRefusal(null, { kind: null, status: "sent" }).text).toContain(
			"nothing queued",
		);
	});

	it("lists resendable ids for local status output only", () => {
		expect(
			resendableLine(
				{
					id: MESSAGE,
					kind: "digest",
					status: "uncertain",
					businessDate: "2026-11-07",
					createdAt: AT,
				},
				"Asia/Ho_Chi_Minh",
			),
		).toBe(
			`  resendable: message ${MESSAGE} (digest, uncertain, 2026-11-07); fnb notify resend --message ${MESSAGE}`,
		);
	});
});

describe("status and doctor lines for notifications", () => {
	it("prints the fourteen-day counts and the last tick", () => {
		expect(
			notificationsLine(
				{
					available: true,
					sent: 12,
					held: 1,
					uncertain: 0,
					failed: 2,
					lastTickAt: minutesBefore(7),
				},
				AT,
			),
		).toBe(
			"notifications 14 d: sent 12, held 1, uncertain 0, failed 2; last notify tick 7 min ago",
		);
		expect(
			notificationsLine(
				{
					available: true,
					sent: 0,
					held: 0,
					uncertain: 0,
					failed: 0,
					lastTickAt: null,
				},
				AT,
			),
		).toContain("no notify tick yet");
		expect(
			notificationsLine(
				{
					available: false,
					sent: 0,
					held: 0,
					uncertain: 0,
					failed: 0,
					lastTickAt: null,
				},
				AT,
			),
		).toContain("apply the migrations");
	});

	it("grades the schedule and the last tick", () => {
		const [disabled, idleTick] = notifyScheduleChecks(
			{ enabled: false, lastTickAt: null },
			AT,
		);
		expect(disabled?.health).toBe("yellow");
		expect(idleTick?.health).toBe("green");
		const [enabled, lateTick] = notifyScheduleChecks(
			{ enabled: true, lastTickAt: minutesBefore(61) },
			AT,
		);
		expect(enabled?.health).toBe("green");
		expect(lateTick?.health).toBe("red");
		expect(
			notifyScheduleChecks(
				{ enabled: true, lastTickAt: minutesBefore(60) },
				AT,
			)[1]?.health,
		).toBe("green");
	});

	it("names secrets only, red after a no_dispatcher_secret cancellation", () => {
		const green = notifySecretsCheck({
			here: ["NOTIFY_ZALO_BOT_TOKEN"],
			dispatchers: [
				{
					runtime: "edge",
					names: ["NOTIFY_EMAIL_API_KEY", "NOTIFY_ZALO_BOT_TOKEN"],
					at: minutesBefore(5),
				},
			],
			destinationSecrets: ["NOTIFY_EMAIL_API_KEY", "NOTIFY_ZALO_BOT_TOKEN"],
			missing: [],
			now: AT,
		});
		expect(green.health).toBe("green");
		expect(green.detail).toBe(
			"here: NOTIFY_ZALO_BOT_TOKEN; last dispatchers: edge NOTIFY_EMAIL_API_KEY, NOTIFY_ZALO_BOT_TOKEN (5 min ago)",
		);
		const uncovered = notifySecretsCheck({
			here: [],
			dispatchers: [],
			destinationSecrets: ["NOTIFY_EMAIL_API_KEY"],
			missing: [],
			now: AT,
		});
		expect(uncovered.health).toBe("yellow");
		const red = notifySecretsCheck({
			here: [],
			dispatchers: [],
			destinationSecrets: [],
			missing: [{ key: "NOTIFY_EMAIL_API_KEY", count: 2 }],
			now: AT,
		});
		expect(red.health).toBe("red");
		expect(red.detail).toContain("no dispatcher holds NOTIFY_EMAIL_API_KEY");
	});

	it("is red for failing destinations and yellow from 80 % of the Zalo Bot quota", () => {
		expect(notifyDestinationsCheck(3, 1).health).toBe("red");
		expect(notifyDestinationsCheck(0, 0).health).toBe("yellow");
		expect(notifyDestinationsCheck(2, 0).health).toBe("green");
		expect(zaloBotQuotaCheck([]).health).toBe("green");
		expect(
			zaloBotQuotaCheck([{ key: "NOTIFY_ZALO_BOT_TOKEN", count: 2399 }]).health,
		).toBe("green");
		const yellow = zaloBotQuotaCheck([
			{ key: "NOTIFY_ZALO_BOT_TOKEN", count: 2400 },
		]);
		expect(yellow.health).toBe("yellow");
		expect(yellow.detail).toBe(
			"NOTIFY_ZALO_BOT_TOKEN 2400 of 3000 this month (yellow from 2400)",
		);
	});
});

describe("fnb digest --revise", () => {
	const candidate = {
		id: MESSAGE,
		tenantId: TENANT,
		businessDate: "2026-11-07",
		scopeKey: "k",
		storeIds: [],
		allStores: true,
		trigger: "settled" as const,
		builtAs: TENANT,
		model: {},
		fingerprint: "f",
		revision: 0,
		channelIds: [],
	};

	function outcome(overrides: Partial<RevisionOutcome>): RevisionOutcome {
		return {
			candidate,
			status: "unchanged",
			changed: false,
			delta: null,
			messages: 0,
			errorCode: null,
			...overrides,
		};
	}

	it("prints digests by number with counts only", () => {
		expect(revisionLine(outcome({}), 0)).toBe(
			"revise: digest 1 2026-11-07 unchanged",
		);
		expect(
			revisionLine(outcome({ status: "replaced", changed: true }), 1),
		).toBe("revise: digest 2 2026-11-07 replaced, no correction sent");
		expect(
			revisionLine(
				outcome({ status: "corrected", changed: true, messages: 2 }),
				0,
			),
		).toBe("revise: digest 1 2026-11-07 corrected, 2 message(s) queued");
		expect(
			revisionLine(outcome({ status: "failed", errorCode: "db_42883" }), 0),
		).toBe("revise: digest 1 2026-11-07 failed (db_42883)");
		expect(
			revisionLine(
				outcome({
					status: "dry_run",
					changed: true,
					delta: {
						net: { old: 1, new: 2 },
						invoices: null,
						stores: [],
						newFindings: [],
					},
				}),
				0,
			),
		).toBe(
			"revise: digest 1 2026-11-07 dry run, changed, 1 changed figure line(s), 0 new attention line(s)",
		);
	});

	it("runs with the due digests only", async () => {
		const withDate = await run([
			"digest",
			"--revise",
			"--tenant",
			"t",
			"--date",
			"2026-11-07",
		]);
		expect(withDate.code).toBe(2);
		expect(withDate.stderr).toContain("--revise runs with the due digests");
		const help = await run(["digest", "--help"]);
		expect(help.stdout).toContain("--revise");
		expect(help.stdout).toContain(":resend:<n>");
	});
});
