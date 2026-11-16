import {
	CHECK_TICK_MINUTES,
	type FailingDestination,
	type HealthProblem,
	healthProblems,
	messageOwner,
	type NotifyHealth,
	notifyHealth,
	resendMessageAs,
	unlimitedOwner,
} from "@fnb/notify/postgres";
import type { Sql } from "postgres";
import { requireTenant } from "../admin/tenants.js";
import {
	type CommandContext,
	type OptionValues,
	requiredString,
	stringOption,
	UsageError,
} from "../context.js";
import { ageText } from "./formatting.js";
import { requireFixtureTenantForTestSends, scanNeedsTenant } from "./notify.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

export interface CheckReport {
	readonly lines: readonly string[];
	readonly problems: readonly HealthProblem[];
	readonly code: number;
}

export function checkReport(
	health: NotifyHealth,
	destinationLabel?: (destination: FailingDestination) => string,
): CheckReport {
	const problems = healthProblems(health, destinationLabel);
	if (problems.length === 0) {
		const tick =
			health.lastTickAt === null
				? "no notify tick yet"
				: `last tick ${ageText(health.lastTickAt, health.at)} ago`;
		return {
			lines: [
				`check: green · schedule ${health.scheduleEnabled ? "enabled" : "disabled"} · ${tick} · nothing overdue, no failing destination`,
			],
			problems,
			code: 0,
		};
	}
	return {
		lines: [
			...problems.map(
				(problem) => `check: red · ${problem.condition}: ${problem.detail}`,
			),
			`check: red, ${problems.length} problem(s): ${[...new Set(problems.map((problem) => problem.condition))].join(", ")}`,
		],
		problems,
		code: 1,
	};
}

async function tenantLabels(
	sql: Sql,
	tenantIds: readonly string[],
	ci: boolean,
): Promise<Map<string, string>> {
	const ordered = [...new Set(tenantIds)].sort();
	if (ci) {
		return new Map(ordered.map((id, index) => [id, `tenant ${index + 1}`]));
	}
	const rows = await sql<{ id: string; slug: string }[]>`
		select id::text as id, slug
		from public.tenants
		where id in (select jsonb_array_elements_text(${JSON.stringify(ordered)}::text::jsonb)::uuid)
	`;
	const slugs = new Map(rows.map((row) => [row.id, row.slug]));
	return new Map(
		ordered.map((id, index) => [id, slugs.get(id) ?? `tenant ${index + 1}`]),
	);
}

async function check(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const slug = stringOption(values, "tenant");
	if (slug === undefined && scanNeedsTenant(context, false)) {
		throw new UsageError(
			"--tenant is required with a provider base-URL override or NOTIFY_INTEGRATION=1",
		);
	}
	const { sql } = context.services.db();
	const tenant =
		slug === undefined
			? null
			: await requireTenant(sql, slug, context.output.ci);
	const health = await notifyHealth(sql, context.now(), tenant?.id ?? null);
	const labels =
		tenant === null
			? await tenantLabels(
					sql,
					health.failingDestinations.map((destination) => destination.tenantId),
					context.output.ci,
				)
			: new Map<string, string>();
	const report = checkReport(health, (destination) => {
		const base = `destination ${destination.number} (${destination.kind})`;
		const owner = labels.get(destination.tenantId);
		return owner === undefined ? base : `${owner} ${base}`;
	});
	for (const line of report.lines) {
		if (report.code === 0) {
			context.output.line(line);
		} else {
			context.output.error(line);
		}
		context.output.summary(`- ${line}`);
	}
	return report.code;
}

export function appBaseUrlOption(value: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value.trim());
	} catch {
		throw new UsageError(
			"--app-url must be the web app's address, for example https://<owner>.github.io/<repository>/",
		);
	}
	if (
		parsed.username !== "" ||
		parsed.password !== "" ||
		parsed.search !== "" ||
		parsed.hash !== ""
	) {
		throw new UsageError(
			"--app-url may not carry user information, a query or a fragment",
		);
	}
	if (parsed.protocol === "https:") {
		const path = parsed.pathname.endsWith("/")
			? parsed.pathname
			: `${parsed.pathname}/`;
		return `https://${parsed.host}${path}`;
	}
	if (
		parsed.protocol === "http:" &&
		LOOPBACK_HOSTS.has(parsed.hostname) &&
		parsed.pathname === "/"
	) {
		return `http://${parsed.host}/`;
	}
	throw new UsageError(
		"--app-url must use https (http only for a loopback test server such as http://127.0.0.1:5173/)",
	);
}

async function setup(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const option = stringOption(values, "app-url");
	const url = option === undefined ? undefined : appBaseUrlOption(option);
	const { sql } = context.services.db();
	if (url === undefined) {
		const [row] = await sql<{ app_base_url: string | null }[]>`
			select app_base_url from app.notify_settings limit 1
		`;
		const stored = row?.app_base_url ?? null;
		context.output.line(
			stored === null
				? "setup: no app base URL stored; digests carry no link to Ngày (set it with --app-url)"
				: `setup: app base URL ${context.output.ci ? "stored" : stored}`,
		);
		return 0;
	}
	const updated = await sql<{ singleton: boolean }[]>`
		update app.notify_settings
		set app_base_url = ${url}, updated_at = now()
		where singleton
		returning singleton
	`;
	if (updated.length === 0) {
		context.output.error(
			"setup: app.notify_settings has no row; apply the migrations",
		);
		return 1;
	}
	context.output.line(
		context.output.ci
			? "setup: app base URL stored; digests link to Ngày from now on"
			: `setup: app base URL stored (${url}); digests link to Ngày from now on`,
	);
	return 0;
}

function sqlState(error: unknown): string | null {
	const code =
		typeof error === "object" && error !== null
			? (error as { readonly code?: unknown }).code
			: undefined;
	return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

export function resendRefusal(
	code: string | null,
	message: { kind: string | null; status: string },
): { text: string; exit: number } {
	switch (code) {
		case "22023":
			return {
				text: `resend: refused (22023): only an uncertain or failed digest or alert can be resent; this one is ${message.kind ?? "a log row"}, ${message.status}`,
				exit: 2,
			};
		case "42501":
			return {
				text: "resend: refused (42501): the tenant's owner may not resend this message",
				exit: 1,
			};
		case "42883":
			return {
				text: "resend: public.resend_message is missing; apply the migrations",
				exit: 1,
			};
		default:
			return {
				text: `resend: the database refused the resend (${code ?? "error"}); nothing queued`,
				exit: 1,
			};
	}
}

async function resend(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const slug = requiredString(values, "tenant");
	const messageId = requiredString(values, "message").trim();
	if (!UUID_PATTERN.test(messageId)) {
		throw new UsageError(
			"--message must be a message id as fnb notify status prints it locally",
		);
	}
	requireFixtureTenantForTestSends(context, slug, false);
	const { sql } = context.services.db();
	const tenant = await requireTenant(sql, slug, context.output.ci);
	const message = await messageOwner(sql, messageId);
	if (message === null || message.tenantId !== tenant.id) {
		throw new UsageError(
			"the tenant has no message with that id; fnb notify status lists the resendable ones (locally only)",
		);
	}
	const owner = await unlimitedOwner(sql, tenant.id);
	if (owner === null) {
		context.output.error(
			"resend: the tenant has no owner with every store to resend as",
		);
		return 1;
	}
	let created: string | null;
	try {
		created = await resendMessageAs(sql, owner.userId, messageId);
	} catch (error) {
		const refusal = resendRefusal(sqlState(error), message);
		context.output.error(refusal.text);
		return refusal.exit;
	}
	if (created === null) {
		context.output.error("resend: nothing was queued");
		return 1;
	}
	context.output.line(
		context.output.ci
			? "resend: 1 new message queued as a resend; fnb notify tick or the Supabase dispatcher sends it"
			: `resend: message ${created} queued as a resend of ${messageId}; fnb notify tick or the Supabase dispatcher sends it`,
	);
	return 0;
}

export const notifyCheckCommand: CommandSpec = {
	path: ["notify", "check"],
	summary:
		"Exit 1 when the notification pipeline has stalled: no tick, overdue work, a missing secret or a failing destination",
	usage: "fnb notify check [--tenant <slug>]",
	options: { ...HELP_OPTION, tenant: { type: "string" } },
	details: [
		`Red (exit 1) when any of these holds: the Supabase schedule is enabled and the last notify tick is older than ${CHECK_TICK_MINUTES} minutes; the schedule is enabled and a queued or held message has been due for more than 30 minutes, or a posted ticket expired unclaimed in the last 2 hours; a message was cancelled with no_dispatcher_secret in the last 7 days (the secret is named, never its value); a message is still sending 30 minutes after its lease ran out; a digest due for more than 2 hours is not built; a destination failed 3 or more times in a row.`,
		"Green (exit 0) prints one summary line. notify.yml runs it last, so a red check fails the Notify workflow and the failure listener reports it.",
		"--tenant narrows the message, digest and destination conditions to one tenant; it is required with a provider base-URL override or NOTIFY_INTEGRATION=1. The schedule and ticket conditions are project-wide.",
		"Output carries counts and destination numbers only; in CI tenants are 'tenant n'.",
	],
	run: check,
};

export const notifySetupCommand: CommandSpec = {
	path: ["notify", "setup"],
	summary: "Store the web app's address so digests link to Ngày",
	usage: "fnb notify setup [--app-url https://<owner>.github.io/<repository>/]",
	options: { ...HELP_OPTION, "app-url": { type: "string" } },
	details: [
		"--app-url writes app.notify_settings.app_base_url: an https address (a trailing / is added), or http://127.0.0.1:<port>/ or http://localhost:<port>/ for a local test server. User information, a query or a fragment is refused (exit 2).",
		"Without --app-url it shows whether an address is stored.",
	],
	run: setup,
};

export const notifyResendCommand: CommandSpec = {
	path: ["notify", "resend"],
	summary: "Queue a new copy of an uncertain or failed digest or alert",
	usage: "fnb notify resend --tenant <slug> --message <id>",
	options: {
		...HELP_OPTION,
		tenant: { type: "string" },
		message: { type: "string" },
	},
	details: [
		"Calls public.resend_message as the tenant's owner, the same path as the resend button in Settings: a new row with resend_of pointing at the original and the dedupe suffix :resend:<n>; the original stays as evidence. Nothing is ever resent automatically.",
		"Only an uncertain or failed digest or alert can be resent (exit 2 otherwise). fnb notify status lists their ids locally, never in CI.",
		"The new message is sent by the next fnb notify tick or by the Supabase dispatcher, which the resend kicks.",
	],
	run: resend,
};

export const notifyOpsCommands: readonly CommandSpec[] = [
	notifyCheckCommand,
	notifySetupCommand,
	notifyResendCommand,
];
