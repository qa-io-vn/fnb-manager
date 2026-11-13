import { workflowKeyOf } from "@fnb/notify";
import { kickNotify } from "@fnb/notify/postgres";
import type { Sql } from "postgres";
import { findTenant } from "../admin/tenants.js";
import { ConfigError } from "../config/errors.js";
import {
	type CommandContext,
	type OptionValues,
	requiredString,
	stringOption,
	UsageError,
} from "../context.js";
import {
	instantOption,
	integerOption,
	requireFixtureTenantForTestSends,
	runCliCycle,
	scanNeedsTenant,
} from "./notify.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";

export const JOB_EXIT = {
	recorded: 0,
	usage: 2,
	unreachable: 3,
	notRecorded: 4,
} as const;

const CONNECT_TIMEOUT_MS = 10_000;
const INLINE_DISPATCH_SECONDS = 60;
export const FAILED_CONCLUSIONS = [
	"failure",
	"timed_out",
	"startup_failure",
] as const;
const RUN_ID_PATTERN = /^\d{1,20}$/;
const MAX_ATTEMPT = 100;

export interface JobEventInput {
	readonly workflowKey: string;
	readonly conclusion: string;
	readonly runId: string | null;
	readonly attempt: number;
	readonly startedAt: Date | null;
}

export interface JobEventRow {
	readonly tenantId: string | null;
	readonly outcome: string;
	readonly messages: number;
}

export function jobEventInput(values: OptionValues): JobEventInput {
	const workflow = requiredString(values, "workflow");
	const conclusion = requiredString(values, "conclusion").trim();
	if (!(FAILED_CONCLUSIONS as readonly string[]).includes(conclusion)) {
		throw new UsageError(
			`--conclusion must be one of ${FAILED_CONCLUSIONS.join(", ")}`,
		);
	}
	const runId = stringOption(values, "run-id")?.trim() ?? null;
	if (runId !== null && runId !== "" && !RUN_ID_PATTERN.test(runId)) {
		throw new UsageError("--run-id must be the numeric workflow run id");
	}
	return {
		workflowKey: workflowKeyOf(workflow),
		conclusion,
		runId: runId === "" ? null : runId,
		attempt: integerOption(values, "attempt", 1, 1, MAX_ATTEMPT),
		startedAt: instantOption(values, "started-at") ?? null,
	};
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		promise,
		new Promise<T>((_resolve, reject) => {
			timer = setTimeout(
				() => reject(new Error("connect timeout")),
				milliseconds,
			);
		}),
	]).finally(() => clearTimeout(timer));
}

export async function recordJobEvent(
	sql: Sql,
	input: JobEventInput,
	at: Date,
	tenantId: string | null,
): Promise<JobEventRow[]> {
	const rows = await sql<
		{ tenant_id: string | null; outcome: string; messages: number | null }[]
	>`
		select r.tenant_id::text as tenant_id, r.outcome, r.messages::integer as messages
		from app.record_job_event(
			${input.workflowKey}::text,
			${input.conclusion}::text,
			${input.runId}::bigint,
			${input.attempt}::integer,
			${input.startedAt}::timestamptz,
			${at}::timestamptz,
			${tenantId}::uuid
		) r
	`;
	return rows.map((row) => ({
		tenantId: row.tenant_id,
		outcome: row.outcome,
		messages: Number(row.messages ?? 0),
	}));
}

export function jobEventLine(
	input: JobEventInput,
	rows: readonly JobEventRow[],
): string {
	if (rows.length === 0) {
		return `job-failed: ${input.workflowKey} ${input.conclusion} recorded; no tenant receives job_failed alerts`;
	}
	const outcomes = new Map<string, number>();
	for (const row of rows) {
		outcomes.set(row.outcome, (outcomes.get(row.outcome) ?? 0) + 1);
	}
	const messages = rows.reduce((sum, row) => sum + row.messages, 0);
	const text = [...outcomes.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([outcome, count]) => `${outcome} ${count}`)
		.join(", ");
	return `job-failed: ${input.workflowKey} ${input.conclusion} recorded for ${rows.length} tenant(s): ${text}; ${messages} message(s) queued`;
}

async function jobFailed(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	let input: JobEventInput;
	let slug: string | undefined;
	try {
		input = jobEventInput(values);
		slug = stringOption(values, "tenant");
		if (slug === undefined && scanNeedsTenant(context, false)) {
			throw new UsageError(
				"--tenant is required with a provider base-URL override or NOTIFY_INTEGRATION=1",
			);
		}
		requireFixtureTenantForTestSends(context, slug, false);
	} catch (error) {
		if (error instanceof UsageError) {
			context.output.error(`job-failed: ${error.message}`);
			return JOB_EXIT.usage;
		}
		throw error;
	}
	let sql: Sql;
	try {
		sql = context.services.db().sql;
		await withTimeout(
			Promise.resolve(sql`select 1 as ready`),
			CONNECT_TIMEOUT_MS,
		);
	} catch (error) {
		context.output.error(
			`job-failed: could not connect to the database (${error instanceof ConfigError ? "not configured" : "unreachable"}); nothing recorded`,
		);
		return JOB_EXIT.unreachable;
	}
	const at = context.now();
	let rows: JobEventRow[];
	let tenantId: string | null = null;
	try {
		if (slug !== undefined) {
			const tenant = await findTenant(sql, slug);
			if (tenant === null) {
				context.output.error(
					"job-failed: the tenant does not exist; nothing recorded",
				);
				return JOB_EXIT.notRecorded;
			}
			tenantId = tenant.id;
		}
		rows = await recordJobEvent(sql, input, at, tenantId);
	} catch (error) {
		const code =
			typeof error === "object" && error !== null && "code" in error
				? String((error as { code: unknown }).code)
				: "error";
		context.output.error(
			`job-failed: connected, but recording the event failed (${/^[0-9A-Z]{5}$/.test(code) ? code : "error"}); nothing recorded`,
		);
		return JOB_EXIT.notRecorded;
	}
	const line = jobEventLine(input, rows);
	context.output.line(line);
	context.output.summary(`- ${line}`);
	if (rows.some((row) => row.messages > 0)) {
		try {
			await kickNotify(sql, "kick");
			const report = await runCliCycle(context, sql, {
				tenantId,
				at: undefined,
				runSqlTick: false,
				wallSeconds: INLINE_DISPATCH_SECONDS,
				linkPollSeconds: 0,
			});
			context.output.line(
				`job-failed: inline dispatch sent ${report.get("sent")}, failed ${report.get("failed")}, uncertain ${report.get("uncertain")}; the rest waits in the outbox`,
			);
		} catch (error) {
			context.output.error(
				`job-failed: the inline dispatch stopped (${error instanceof Error ? error.name : "error"}); the alert waits in the outbox`,
			);
		}
	}
	return JOB_EXIT.recorded;
}

export const notifyJobFailedCommand: CommandSpec = {
	path: ["notify", "job-failed"],
	summary:
		"Record a failed GitHub Actions run as a job_failed alert and send it",
	usage:
		"fnb notify job-failed --workflow <name> --conclusion <c> [--run-id <id>] [--attempt <n>] [--started-at <ISO instant>] [--tenant <slug>]",
	options: {
		...HELP_OPTION,
		workflow: { type: "string" },
		conclusion: { type: "string" },
		"run-id": { type: "string" },
		attempt: { type: "string" },
		"started-at": { type: "string" },
		tenant: { type: "string" },
	},
	details: [
		"Called by the workflow_run listener (notify-on-failure.yml) for a watched workflow that failed. app.record_job_event raises job_failed for every tenant with a destination that receives it, or only for --tenant.",
		"A Sync failure whose root cause is already open (an auth_failed episode, or a sync episode seen since the run started) is recorded as suppressed and sends nothing.",
		"After recording, it dispatches inline for up to 60 seconds with the secrets this job has; at night the message is held by the quiet hours and released by the next tick.",
		"Exit codes: 0 the event was recorded (sent, queued, held, suppressed, or no tenant receives job_failed); 2 usage error; 3 the database could not be reached within 10 seconds; 4 connected but the record failed. The listener's database-free fallback runs only on 2, 3 or 4.",
		"Output carries the workflow key, the conclusion and counts only.",
	],
	run: jobFailed,
};
