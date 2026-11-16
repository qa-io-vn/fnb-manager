import type { Notifier } from "@fnb/runner";
import { createRedactor } from "@fnb/sync";
import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import {
	type FallbackSource,
	fallbackEntry,
	notifyFallbackEntryCommand,
} from "../../src/commands/notify-fallback.js";
import {
	JOB_EXIT,
	notifyJobFailedCommand,
} from "../../src/commands/notify-job.js";
import type { CommandContext, OptionValues } from "../../src/context.js";
import { Output } from "../../src/output.js";
import type { Services } from "../../src/services.js";
import { capture } from "../support/capture.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CHAT = "synthetic-chat-1";
const OWNER = "owner@example.com";
const SENDER = "sender@example.com";

async function run(argv: string[], env: Record<string, string> = {}) {
	const io = capture();
	const code = await runCli(argv, env, {
		streams: io.streams,
		loadEnvFile: false,
	});
	return { code, stdout: io.stdout(), stderr: io.stderr() };
}

type Answer = (text: string) => Promise<unknown[]>;

function stubSql(answer: Answer): { sql: Sql; queries: string[] } {
	const queries: string[] = [];
	const sql = ((strings: TemplateStringsArray) => {
		const text = strings.join("$");
		queries.push(text);
		return answer(text);
	}) as unknown as Sql;
	return { sql, queries };
}

function stubContext(
	sql: Sql,
	env: Record<string, string> = {},
	ci = true,
): { context: CommandContext; stdout: () => string; stderr: () => string } {
	const io = capture();
	const redact = createRedactor([]);
	const output = new Output({ ci, streams: io.streams, redact });
	const notifier: Notifier = { notify: async () => undefined };
	const services = {
		db: () => ({ sql }),
		close: async () => undefined,
	} as unknown as Services;
	return {
		context: {
			env,
			rootDir: "",
			output,
			services,
			redact,
			notifier,
			now: () => new Date("2026-11-09T20:40:00Z"),
		},
		stdout: io.stdout,
		stderr: io.stderr,
	};
}

function sqlError(code: string): Error {
	return Object.assign(new Error("synthetic failure"), { code });
}

function source(overrides: Partial<FallbackSource>): FallbackSource {
	return {
		number: 1,
		kind: "zalo_bot",
		provider: "zalo_bot",
		status: "active",
		address: CHAT,
		config: {},
		memberEmail: OWNER,
		...overrides,
	};
}

describe("fnb notify fallback-entry", () => {
	it("is listed and documents the target format", async () => {
		const help = await run(["--help"]);
		expect(help.stdout).toContain("notify fallback-entry");
		const details = await run(["notify", "fallback-entry", "--help"]);
		expect(details.code).toBe(0);
		expect(details.stdout).toContain("NOTIFY_FALLBACK_TARGETS");
		expect(details.stdout).toContain("--destination <n>");
	});

	it("is refused in CI before touching the database", async () => {
		const refused = await run(
			["notify", "fallback-entry", "--tenant", "t", "--destination", "1"],
			{ CI: "1" },
		);
		expect(refused.code).toBe(2);
		expect(refused.stderr).toContain("refused in CI");
		const missing = await run(["notify", "fallback-entry", "--tenant", "t"]);
		expect(missing.code).toBe(2);
		expect(missing.stderr).toContain("--destination is required");
	});

	it("formats bot chats and e-mail destinations like notify link --print-fallback-entry", () => {
		expect(fallbackEntry(source({}), {})).toEqual({
			kind: "zalo_bot",
			chat_id: CHAT,
		});
		expect(
			fallbackEntry(source({ kind: "telegram", provider: "telegram" }), {}),
		).toEqual({ kind: "telegram", chat_id: CHAT });
		expect(
			fallbackEntry(
				source({ kind: "email", provider: "brevo", address: null }),
				{ NOTIFY_EMAIL_FROM: SENDER, NOTIFY_EMAIL_FROM_NAME: "FNB Manager" },
			),
		).toEqual({
			kind: "email",
			provider: "brevo",
			from: SENDER,
			from_name: "FNB Manager",
			to: OWNER,
		});
		expect(
			fallbackEntry(
				source({
					kind: "email",
					provider: "resend",
					address: null,
					config: { from_email: "alerts@example.com", from_name: "Alerts" },
				}),
				{ NOTIFY_EMAIL_FROM: SENDER },
			),
		).toEqual({
			kind: "email",
			provider: "resend",
			from: "alerts@example.com",
			from_name: "Alerts",
			to: OWNER,
		});
	});

	it("refuses a webhook, an unlinked chat and an e-mail without a sender", () => {
		expect(() =>
			fallbackEntry(
				source({ kind: "webhook", provider: "hmac_webhook", address: null }),
				{},
			),
		).toThrow("cannot be a fallback target");
		expect(() =>
			fallbackEntry(source({ status: "pending", address: null }), {}),
		).toThrow("no linked chat yet");
		expect(() =>
			fallbackEntry(
				source({ kind: "email", provider: "brevo", address: null }),
				{},
			),
		).toThrow("NOTIFY_EMAIL_FROM");
	});

	it("prints one JSON array entry for the numbered destination", async () => {
		const { sql, queries } = stubSql(async (text) => {
			if (text.includes("from public.tenants")) {
				return [
					{
						id: TENANT,
						slug: "t",
						name: "Synthetic",
						country_code: "VN",
						currency_code: "VND",
						timezone: "Asia/Ho_Chi_Minh",
						legal_form: "unknown",
					},
				];
			}
			return [
				{
					number: "2",
					kind: "email",
					provider: "brevo",
					status: "active",
					address: null,
					config: {},
					member_email: OWNER,
				},
			];
		});
		const { context, stdout, stderr } = stubContext(
			sql,
			{ NOTIFY_EMAIL_FROM: SENDER },
			false,
		);
		const code = await notifyFallbackEntryCommand.run(context, {
			tenant: "t",
			destination: "2",
		});
		expect(code).toBe(0);
		expect(queries).toHaveLength(2);
		expect(JSON.parse(stdout().trim())).toEqual([
			{
				kind: "email",
				provider: "brevo",
				from: SENDER,
				from_name: "",
				to: OWNER,
			},
		]);
		expect(stderr()).toContain("NOTIFY_FALLBACK_TARGETS");
	});
});

describe("fnb notify job-failed exit 4", () => {
	const values: OptionValues = { workflow: "Sync", conclusion: "failure" };

	it("exits 4 with one count-only line naming the SQLSTATE when the record fails", async () => {
		const { sql, queries } = stubSql(async (text) => {
			if (text.includes("select 1 as ready")) {
				return [{ ready: 1 }];
			}
			throw sqlError("42883");
		});
		const { context, stdout, stderr } = stubContext(sql);
		const code = await notifyJobFailedCommand.run(context, values);
		expect(code).toBe(JOB_EXIT.notRecorded);
		expect(
			queries.some((query) => query.includes("app.record_job_event")),
		).toBe(true);
		expect(stdout()).toBe("");
		const lines = stderr().trim().split("\n");
		expect(lines).toEqual([
			"job-failed: connected, but recording the event failed (42883); nothing recorded",
		]);
	});

	it("names no code that is not a SQLSTATE", async () => {
		const { sql } = stubSql(async (text) => {
			if (text.includes("select 1 as ready")) {
				return [{ ready: 1 }];
			}
			throw sqlError("connection reset by synthetic-host");
		});
		const { context, stderr } = stubContext(sql);
		expect(await notifyJobFailedCommand.run(context, values)).toBe(
			JOB_EXIT.notRecorded,
		);
		expect(stderr()).toContain("recording the event failed (error)");
		expect(stderr()).not.toContain("synthetic-host");
	});

	it("exits 4 for an unknown tenant without recording anything", async () => {
		const { sql, queries } = stubSql(async (text) => {
			if (text.includes("select 1 as ready")) {
				return [{ ready: 1 }];
			}
			if (text.includes("from public.tenants")) {
				return [];
			}
			throw new Error("no other statement is expected");
		});
		const { context, stderr } = stubContext(sql);
		const code = await notifyJobFailedCommand.run(context, {
			...values,
			tenant: "notify-it-missing",
		});
		expect(code).toBe(JOB_EXIT.notRecorded);
		expect(
			queries.some((query) => query.includes("app.record_job_event")),
		).toBe(false);
		expect(stderr()).toContain("the tenant does not exist; nothing recorded");
		expect(stderr()).not.toContain("notify-it-missing");
	});
});
