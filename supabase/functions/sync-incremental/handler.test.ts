import { CompositeNotifier } from "@fnb/notify/outbox";
import type { Notification } from "@fnb/runner";
import {
	functionRedactor,
	handleRequest,
	notifySecretVariables,
	runNotifier,
	secretSources,
} from "./handler.ts";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

function assertEquals(actual: unknown, expected: unknown, label: string): void {
	const left = JSON.stringify(actual);
	const right = JSON.stringify(expected);
	assert(left === right, `${label}: expected ${right}, got ${left}`);
}

type FakeSql = ReturnType<Parameters<typeof runNotifier>[0]>;

const ENVIRONMENT = {
	SUPABASE_DB_URL:
		"postgresql://postgres.synthetic:synthetic-db-password@example.com:5432/postgres",
	IPOS_APP_KEY: "synthetic-app-key",
	NOTIFY_ZALO_BOT_TOKEN: "synthetic-bot-token",
	NOTIFY_EMAIL_API_KEY: "synthetic-email-key",
	NOTIFY_TELEGRAM_BOT_TOKEN_2: "synthetic-telegram-token",
	NOTIFY_WEBHOOK_SECRET: "synthetic-webhook-secret",
	NOTIFY_EMAIL_FROM_NAME: "FNB Manager",
	NOTIFY_ZALO_BOT_BASE_URL: "http://127.0.0.1:8787",
	NOTIFY_INTEGRATION: "1",
};

const NOTIFICATION: Notification = {
	kind: "auth_failed",
	severity: "critical",
	subject: {
		tenantId: "11111111-1111-4111-8111-111111111111",
		accountId: "22222222-2222-4222-8222-222222222222",
	},
	label: "account 1",
	message: "the POS refused the credentials",
	facts: { stores: 2 },
	occurredAt: "2026-11-09T00:00:00.000Z",
};

Deno.test("every NOTIFY_ credential present joins the secret sources", () => {
	assertEquals(
		notifySecretVariables(ENVIRONMENT),
		[
			"NOTIFY_EMAIL_API_KEY",
			"NOTIFY_TELEGRAM_BOT_TOKEN_2",
			"NOTIFY_WEBHOOK_SECRET",
			"NOTIFY_ZALO_BOT_TOKEN",
		],
		"notify variables",
	);
	const sources = secretSources(ENVIRONMENT);
	assert(sources.variables.includes("IPOS_APP_KEY"), "the POS key stays");
	assert(
		sources.variables.includes("NOTIFY_ZALO_BOT_TOKEN"),
		"the bot token joins",
	);
	assert(
		!sources.variables.includes("NOTIFY_ZALO_BOT_BASE_URL"),
		"base URLs are not secrets",
	);
	assertEquals(secretSources({}).variables.length, 3, "without notify secrets");
});

Deno.test("the redactor hides every NOTIFY_ value and the database password", () => {
	const redact = functionRedactor(ENVIRONMENT);
	const secrets = [
		"synthetic-bot-token",
		"synthetic-email-key",
		"synthetic-telegram-token",
		"synthetic-webhook-secret",
		"synthetic-db-password",
		"synthetic-app-key",
	];
	const line = redact(`run failed near ${secrets.join(" and ")}`);
	for (const secret of secrets) {
		assert(!line.includes(secret), `${secret} must be redacted`);
	}
});

Deno.test("the run's notifier writes the console line and the outbox", async () => {
	const lines: string[] = [];
	const statements: string[] = [];
	const sql = ((strings: TemplateStringsArray) => {
		statements.push(strings.join("?"));
		return Promise.resolve([
			{ event_id: null, outcome: "opened", messages: 1 },
		]);
	}) as unknown as FakeSql;
	const notifier = runNotifier(
		() => sql,
		functionRedactor(ENVIRONMENT),
		(line) => lines.push(line),
	);
	assert(notifier instanceof CompositeNotifier, "a composite notifier");
	await notifier.notify(NOTIFICATION);
	assertEquals(lines.length, 1, "console lines");
	assertEquals(statements.length, 1, "outbox statements");
	assert(
		statements[0]?.includes("app.record_runner_notification"),
		"the outbox records through app.record_runner_notification",
	);
});

Deno.test("a failing outbox write rejects the composite so notifySafely logs it", async () => {
	const lines: string[] = [];
	const sql = (() =>
		Promise.reject(new Error("connection refused"))) as unknown as FakeSql;
	const notifier = runNotifier(
		() => sql,
		functionRedactor(ENVIRONMENT),
		(line) => lines.push(line),
	);
	let rejected = false;
	try {
		await notifier.notify(NOTIFICATION);
	} catch {
		rejected = true;
	}
	assert(rejected, "the composite reports the failed member");
	assertEquals(lines.length, 1, "the console line is still written");
});

Deno.test("a request without a ticket is refused before any connection", async () => {
	const response = await handleRequest(
		new Request("http://127.0.0.1/functions/v1/sync-incremental", {
			method: "POST",
			body: JSON.stringify({}),
		}),
		ENVIRONMENT,
	);
	assertEquals(response.status, 400, "status");
});
