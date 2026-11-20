import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	WORKFLOW_KEYS,
	workflowKeyOf,
	workflowLabel,
} from "../../src/render/alert.js";
import {
	BREVO_FAULT_METHOD,
	type MockProviders,
	startMockProviders,
} from "../../src/testing/mock-providers.js";

const SCRIPT = fileURLToPath(
	new URL("../../../../scripts/notify-fallback.mjs", import.meta.url),
);
const TOKEN = "synthetic-bot-token";
const TELEGRAM_TOKEN = "synthetic-telegram-token";
const EMAIL_KEY = "synthetic-email-key";
const CHAT = "synthetic-chat-fallback";
const OWNER = "owner@example.com";
const SENDER = "sender@example.com";
const SENDER_NAME = "FNB Manager";
const WORKFLOW_NAMES = [
	"Sync",
	"Backup database",
	"Migrate database",
	"Deploy web app",
	"Deploy Edge Functions",
	"Notify",
	"Scheduled workflows active",
] as const;

const REASONS = {
	install:
		"Không cài được công cụ ghi nhận cảnh báo, nên cảnh báo được gửi trực tiếp.",
	unreachable:
		"Không kết nối được cơ sở dữ liệu (dự án Supabase có thể đang tạm dừng).",
	notRecorded: "Kết nối được cơ sở dữ liệu nhưng không ghi được cảnh báo.",
	toolError: "Công cụ ghi nhận cảnh báo báo lỗi.",
};

interface Spawned {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

function runScript(
	args: readonly string[],
	environment: Readonly<Record<string, string>>,
): Promise<Spawned> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [SCRIPT, ...args], {
			env: { ...environment },
			stdio: ["ignore", "pipe", "pipe"],
		});
		const out: Buffer[] = [];
		const err: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
		child.on("error", reject);
		child.on("close", (code) =>
			resolve({
				code,
				stdout: Buffer.concat(out).toString("utf8"),
				stderr: Buffer.concat(err).toString("utf8"),
			}),
		);
	});
}

function sendArgs(install: string, databaseExit: string): string[] {
	return [
		"send",
		"--workflow",
		"Sync",
		"--conclusion",
		"failure",
		"--install",
		install,
		"--database-exit",
		databaseExit,
	];
}

function expectNoCredentials(result: Spawned): void {
	for (const value of [TOKEN, EMAIL_KEY, CHAT, OWNER, SENDER, "127.0.0.1"]) {
		expect(result.stdout).not.toContain(value);
		expect(result.stderr).not.toContain(value);
	}
}

describe("scripts/notify-fallback.mjs", () => {
	let mock: MockProviders;

	const zaloTarget = { kind: "zalo_bot", chat_id: CHAT };
	const emailTarget = {
		kind: "email",
		provider: "brevo",
		from: SENDER,
		from_name: SENDER_NAME,
		to: OWNER,
	};

	function environment(
		targets: readonly object[],
		extra: Readonly<Record<string, string>> = {},
	): Record<string, string> {
		return {
			NOTIFY_ZALO_BOT_BASE_URL: mock.baseUrl,
			NOTIFY_BREVO_BASE_URL: mock.baseUrl,
			NOTIFY_ZALO_BOT_TOKEN: TOKEN,
			NOTIFY_EMAIL_API_KEY: EMAIL_KEY,
			NOTIFY_FALLBACK_TARGETS: JSON.stringify(targets),
			...extra,
		};
	}

	beforeAll(async () => {
		mock = await startMockProviders();
		mock.registerZaloBot(TOKEN);
		mock.registerEmailKey(EMAIL_KEY);
	});

	beforeEach(() => {
		mock.reset();
	});

	afterAll(async () => {
		await mock.close();
	});

	it("mask prints only ::add-mask:: lines, for every token and every string field but kind and provider", async () => {
		const result = await runScript(
			["mask"],
			environment([zaloTarget, emailTarget], {
				NOTIFY_TELEGRAM_BOT_TOKEN: TELEGRAM_TOKEN,
			}),
		);
		expect(result.code).toBe(0);
		expect(result.stderr).toBe("");
		const lines = result.stdout.trim().split("\n");
		expect(lines.every((line) => line.startsWith("::add-mask::"))).toBe(true);
		const masked = lines.map((line) => line.slice("::add-mask::".length));
		expect(masked).toEqual(
			expect.arrayContaining([
				TOKEN,
				EMAIL_KEY,
				TELEGRAM_TOKEN,
				CHAT,
				SENDER,
				SENDER_NAME,
				OWNER,
			]),
		);
		for (const word of ["zalo_bot", "email", "brevo"]) {
			expect(masked).not.toContain(word);
		}
		expect(mock.requestCount()).toBe(0);
	});

	it("mask masks the whole value when the targets are not valid JSON", async () => {
		const result = await runScript(["mask"], {
			NOTIFY_FALLBACK_TARGETS: "not-json-synthetic",
		});
		expect(result.code).toBe(0);
		expect(result.stdout.trim()).toBe("::add-mask::not-json-synthetic");
	});

	it("sends one fixed text per target, e-mail first, after an install failure", async () => {
		const result = await runScript(
			sendArgs("failure", ""),
			environment([zaloTarget, emailTarget]),
		);
		expect(result.code).toBe(0);
		expect(result.stdout.trim()).toBe("fallback targets 2, reached 2");
		expectNoCredentials(result);
		const [message] = mock.zaloMessages(TOKEN);
		const [email] = mock.emails(EMAIL_KEY);
		expect(mock.zaloMessages()).toHaveLength(1);
		expect(mock.emails()).toHaveLength(1);
		expect(message?.chatId).toBe(CHAT);
		expect(message?.text).toMatch(
			/^Cảnh báo: tác vụ tự động "Đồng bộ đêm" thất bại lúc \d{2}:\d{2} ngày \d{2}\/\d{2}\/\d{4} \(failure\)\. /,
		);
		expect(message?.text).toContain(REASONS.install);
		expect(
			message?.text.endsWith("Mở tab Actions của kho mã để xem nhật ký."),
		).toBe(true);
		expect(message?.text).not.toMatch(/₫/);
		expect(email?.to).toBe(OWNER);
		expect(email?.from).toBe(SENDER);
		expect(email?.text).toBe(message?.text);
		expect(email?.subject).not.toMatch(/\d/);
		expect(email?.html).toContain('lang="vi"');
		expect(
			(email?.at.getTime() ?? Number.POSITIVE_INFINITY) <=
				(message?.at.getTime() ?? 0),
		).toBe(true);
	});

	it.each([
		["success", "3", REASONS.unreachable],
		["success", "4", REASONS.notRecorded],
		["success", "2", REASONS.toolError],
		["success", "", REASONS.toolError],
		["skipped", "", REASONS.install],
	])(
		"names the cause for install %s and database exit '%s'",
		async (install, exit, reason) => {
			const result = await runScript(
				sendArgs(install, exit),
				environment([zaloTarget]),
			);
			expect(result.code).toBe(0);
			expect(result.stdout.trim()).toBe("fallback targets 1, reached 1");
			const texts = mock.zaloMessages(TOKEN).map((entry) => entry.text);
			expect(texts).toHaveLength(1);
			expect(texts[0]).toContain(reason);
			for (const other of Object.values(REASONS).filter(
				(text) => text !== reason,
			)) {
				expect(texts[0]).not.toContain(other);
			}
		},
	);

	it("reaches Telegram chats and Resend e-mail through the same fixed text", async () => {
		mock.registerTelegramBot(TELEGRAM_TOKEN);
		const result = await runScript(
			sendArgs("success", "4"),
			environment(
				[
					{ kind: "telegram", chat_id: CHAT },
					{ ...emailTarget, provider: "resend" },
				],
				{
					NOTIFY_TELEGRAM_BASE_URL: mock.baseUrl,
					NOTIFY_RESEND_BASE_URL: mock.baseUrl,
					NOTIFY_TELEGRAM_BOT_TOKEN: TELEGRAM_TOKEN,
				},
			),
		);
		expect(result.code).toBe(0);
		expect(result.stdout.trim()).toBe("fallback targets 2, reached 2");
		expectNoCredentials(result);
		const [chat] = mock.telegramMessages(TELEGRAM_TOKEN);
		const [email] = mock.emails(EMAIL_KEY);
		expect(chat?.chatId).toBe(CHAT);
		expect(chat?.previewsDisabled).toBe(true);
		expect(chat?.text).toContain(REASONS.notRecorded);
		expect(email?.provider).toBe("resend");
		expect(email?.from).toBe(SENDER);
		expect(email?.text).toBe(chat?.text);
		expect(mock.zaloMessages()).toHaveLength(0);
	});

	it("sends nothing when the database path recorded the failure", async () => {
		const result = await runScript(
			sendArgs("success", "0"),
			environment([zaloTarget]),
		);
		expect(result.code).toBe(0);
		expect(mock.requestCount()).toBe(0);
	});

	it("exits 1 when no target is reached, with counts only", async () => {
		mock.failNext(BREVO_FAULT_METHOD, { kind: "status", status: 500 });
		const result = await runScript(
			sendArgs("success", "3"),
			environment(
				[
					{ kind: "zalo_bot", chat_id: CHAT },
					emailTarget,
					{ kind: "webhook", url: "https://hooks.example.com/fnb/alerts" },
				],
				{ NOTIFY_ZALO_BOT_TOKEN: "synthetic-unknown-token" },
			),
		);
		expect(result.code).toBe(1);
		expect(result.stdout.trim()).toBe("fallback targets 3, reached 0");
		expectNoCredentials(result);
		expect(result.stdout).not.toContain("synthetic-unknown-token");
		expect(mock.zaloMessages()).toHaveLength(0);
	});

	it("exits 1 without targets and 2 on a usage error", async () => {
		const none = await runScript(sendArgs("success", "3"), {
			NOTIFY_ZALO_BOT_BASE_URL: mock.baseUrl,
		});
		expect(none.code).toBe(1);
		expect(none.stdout.trim()).toBe("fallback targets 0, reached 0");
		const broken = await runScript(sendArgs("success", "3"), {
			NOTIFY_FALLBACK_TARGETS: "{not json",
		});
		expect(broken.code).toBe(1);
		expect(broken.stderr).toContain("is not valid JSON");
		expect((await runScript([], {})).code).toBe(2);
		expect((await runScript(["send", "--workflow", "Sync"], {})).code).toBe(2);
		expect(
			(await runScript(["send", "--conclusion", "failure", "--nope"], {})).code,
		).toBe(2);
	});

	it("labels each watched workflow exactly as the alert templates do", async () => {
		const script = (await import(SCRIPT)) as {
			workflowLabel: (name: string) => string;
			WORKFLOW_LABELS: Readonly<Record<string, string>>;
		};
		for (const name of WORKFLOW_NAMES) {
			expect(script.workflowLabel(name)).toBe(
				workflowLabel(workflowKeyOf(name)),
			);
		}
		expect(Object.keys(script.WORKFLOW_LABELS).sort()).toEqual(
			[...WORKFLOW_KEYS].sort(),
		);
		for (const key of WORKFLOW_KEYS) {
			expect(script.WORKFLOW_LABELS[key]).toBe(workflowLabel(key));
		}
		expect(script.workflowLabel("Something new")).toBe(workflowLabel("other"));
	});
});
