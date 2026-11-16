#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const USER_AGENT = "fnb-manager-notify/1";
export const REQUEST_TIMEOUT_MS = 10_000;
export const TIME_ZONE = "Asia/Ho_Chi_Minh";
export const EXIT = { reached: 0, unreached: 1, usage: 2 };

export const PROVIDERS = {
	zalo_bot: {
		host: "https://bot-api.zaloplatforms.com",
		override: "NOTIFY_ZALO_BOT_BASE_URL",
		token: "NOTIFY_ZALO_BOT_TOKEN",
	},
	telegram: {
		host: "https://api.telegram.org",
		override: "NOTIFY_TELEGRAM_BASE_URL",
		token: "NOTIFY_TELEGRAM_BOT_TOKEN",
	},
	brevo: {
		host: "https://api.brevo.com",
		override: "NOTIFY_BREVO_BASE_URL",
		token: "NOTIFY_EMAIL_API_KEY",
	},
	resend: {
		host: "https://api.resend.com",
		override: "NOTIFY_RESEND_BASE_URL",
		token: "NOTIFY_EMAIL_API_KEY",
	},
};

export const TOKEN_VARIABLES = [
	"NOTIFY_ZALO_BOT_TOKEN",
	"NOTIFY_TELEGRAM_BOT_TOKEN",
	"NOTIFY_EMAIL_API_KEY",
];

export const TARGETS_VARIABLE = "NOTIFY_FALLBACK_TARGETS";

const LOOPBACK_BASE_URL = /^http:\/\/(127\.0\.0\.1|localhost):[0-9]{2,5}$/;

export const WORKFLOW_KEYS_BY_NAME = {
	Sync: "sync",
	"Backup database": "backup",
	"Migrate database": "migrate",
	"Deploy web app": "deploy_web",
	"Deploy Edge Functions": "deploy_functions",
	Notify: "notify",
	"Scheduled workflows active": "workflows_active",
};

export const WORKFLOW_LABELS = {
	sync: "Đồng bộ đêm",
	backup: "Sao lưu cơ sở dữ liệu",
	migrate: "Cập nhật cơ sở dữ liệu",
	deploy_web: "Triển khai ứng dụng web",
	deploy_functions: "Triển khai Edge Function",
	notify: "Gửi bản tin",
	workflows_active: "Bật lại tác vụ theo lịch",
	other: "Tác vụ khác",
};

export const REASONS = {
	install:
		"Không cài được công cụ ghi nhận cảnh báo, nên cảnh báo được gửi trực tiếp.",
	unreachable:
		"Không kết nối được cơ sở dữ liệu (dự án Supabase có thể đang tạm dừng).",
	notRecorded: "Kết nối được cơ sở dữ liệu nhưng không ghi được cảnh báo.",
	toolError: "Công cụ ghi nhận cảnh báo báo lỗi.",
};

export const SUBJECT = "Cảnh báo: tác vụ tự động thất bại";
const SENDER_NAME = "FNB Manager";

export function workflowLabel(name) {
	const trimmed = String(name ?? "").trim();
	const key =
		WORKFLOW_KEYS_BY_NAME[trimmed] ??
		(Object.hasOwn(WORKFLOW_LABELS, trimmed) ? trimmed : "other");
	return WORKFLOW_LABELS[key];
}

export function reasonFor(install, databaseExit) {
	if (install !== "success") {
		return REASONS.install;
	}
	if (databaseExit === "3") {
		return REASONS.unreachable;
	}
	if (databaseExit === "4") {
		return REASONS.notRecorded;
	}
	return REASONS.toolError;
}

export function localTime(instant) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-GB", {
			timeZone: TIME_ZONE,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		})
			.formatToParts(instant)
			.map((part) => [part.type, part.value]),
	);
	return `${parts.hour}:${parts.minute} ngày ${parts.day}/${parts.month}/${parts.year}`;
}

export function fallbackText({
	workflow,
	conclusion,
	install,
	databaseExit,
	at,
}) {
	return `Cảnh báo: tác vụ tự động "${workflowLabel(workflow)}" thất bại lúc ${localTime(at)} (${conclusion}). ${reasonFor(install, databaseExit)} Mở tab Actions của kho mã để xem nhật ký.`.normalize(
		"NFC",
	);
}

export function escapeCommandData(value) {
	return value
		.replaceAll("%", "%25")
		.replaceAll("\r", "%0D")
		.replaceAll("\n", "%0A");
}

function parseTargets(raw) {
	if (raw === undefined || raw.trim() === "") {
		return { ok: true, entries: [] };
	}
	try {
		const parsed = JSON.parse(raw);
		const list = Array.isArray(parsed) ? parsed : [parsed];
		return {
			ok: true,
			entries: list.filter(
				(entry) =>
					entry !== null && typeof entry === "object" && !Array.isArray(entry),
			),
		};
	} catch {
		return { ok: false, entries: [] };
	}
}

export function maskValues(environment) {
	const values = [];
	for (const name of TOKEN_VARIABLES) {
		const value = environment[name];
		if (typeof value === "string" && value.trim() !== "") {
			values.push(value);
		}
	}
	const raw = environment[TARGETS_VARIABLE];
	const targets = parseTargets(raw);
	if (!targets.ok && raw !== undefined) {
		values.push(raw);
	}
	for (const entry of targets.entries) {
		for (const [key, value] of Object.entries(entry)) {
			if (
				key !== "kind" &&
				key !== "provider" &&
				typeof value === "string" &&
				value.trim() !== ""
			) {
				values.push(value);
			}
		}
	}
	return [...new Set(values)].flatMap((value) =>
		value
			.split(/\r?\n/)
			.filter((line) => line.trim() !== "")
			.map((line) => `::add-mask::${escapeCommandData(line)}`),
	);
}

export function baseUrl(provider, environment, warn) {
	const settings = PROVIDERS[provider];
	const override = environment[settings.override];
	if (override !== undefined && override !== "") {
		if (LOOPBACK_BASE_URL.test(override)) {
			return override;
		}
		warn(
			`${settings.override} ignored: only a loopback test server (http://127.0.0.1:<port>) may replace a provider host`,
		);
	}
	return settings.host;
}

function escapeHtml(text) {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function html(text) {
	return `<!doctype html><html lang="vi"><head><meta charset="utf-8"></head><body><p>${escapeHtml(text)}</p></body></html>`;
}

function text(value) {
	return typeof value === "string" ? value.trim() : "";
}

export function requestFor(entry, message, environment, warn) {
	const kind = text(entry.kind);
	const json = {
		"content-type": "application/json; charset=utf-8",
		accept: "application/json",
		"user-agent": USER_AGENT,
	};
	if (kind === "zalo_bot" || kind === "telegram") {
		const token = text(environment[PROVIDERS[kind].token]);
		const chatId = text(entry.chat_id);
		if (token === "" || chatId === "") {
			return null;
		}
		const body =
			kind === "telegram"
				? {
						chat_id: chatId,
						text: message,
						link_preview_options: { is_disabled: true },
					}
				: { chat_id: chatId, text: message };
		return {
			kind,
			url: `${baseUrl(kind, environment, warn)}/bot${token}/sendMessage`,
			init: { method: "POST", headers: json, body: JSON.stringify(body) },
			accepted: (status, payload) =>
				status >= 200 && status < 300 && payload?.ok === true,
		};
	}
	if (kind === "email") {
		const provider = text(entry.provider) || "brevo";
		const key = text(environment.NOTIFY_EMAIL_API_KEY);
		const from = text(entry.from);
		const to = text(entry.to);
		const fromName = text(entry.from_name) || SENDER_NAME;
		if (key === "" || from === "" || to === "" || !(provider in PROVIDERS)) {
			return null;
		}
		const accepted = (status) => status >= 200 && status < 300;
		if (provider === "brevo") {
			return {
				kind,
				url: `${baseUrl("brevo", environment, warn)}/v3/smtp/email`,
				init: {
					method: "POST",
					headers: { ...json, "api-key": key },
					body: JSON.stringify({
						sender: { email: from, name: fromName },
						to: [{ email: to }],
						subject: SUBJECT,
						textContent: message,
						htmlContent: html(message),
					}),
				},
				accepted,
			};
		}
		if (provider === "resend") {
			return {
				kind,
				url: `${baseUrl("resend", environment, warn)}/emails`,
				init: {
					method: "POST",
					headers: { ...json, authorization: `Bearer ${key}` },
					body: JSON.stringify({
						from: `${fromName} <${from}>`,
						to: [to],
						subject: SUBJECT,
						text: message,
						html: html(message),
					}),
				},
				accepted,
			};
		}
	}
	return null;
}

async function deliver(request, fetchLike) {
	try {
		const response = await fetchLike(request.url, {
			...request.init,
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		const body = await response.text();
		let payload = null;
		try {
			payload = JSON.parse(body);
		} catch {
			payload = null;
		}
		return request.accepted(response.status, payload);
	} catch {
		return false;
	}
}

export function orderTargets(entries) {
	const email = entries.filter((entry) => text(entry.kind) === "email");
	const others = entries.filter((entry) => text(entry.kind) !== "email");
	return [...email, ...others];
}

export async function sendFallback(options, environment, io) {
	const { install, databaseExit } = options;
	if (install === "success" && databaseExit === "0") {
		io.out(
			"fallback: the failure was recorded through the database; nothing sent",
		);
		return EXIT.reached;
	}
	const targets = parseTargets(environment[TARGETS_VARIABLE]);
	if (!targets.ok) {
		io.err(`fallback: ${TARGETS_VARIABLE} is not valid JSON`);
		io.out("fallback targets 0, reached 0");
		return EXIT.unreached;
	}
	const message = fallbackText({ ...options, at: io.now() });
	const warnings = new Set();
	const warn = (line) => warnings.add(line);
	let reached = 0;
	for (const entry of orderTargets(targets.entries)) {
		const request = requestFor(entry, message, environment, warn);
		if (request !== null && (await deliver(request, io.fetch))) {
			reached += 1;
		}
	}
	for (const line of warnings) {
		io.err(line);
	}
	const line = `fallback targets ${targets.entries.length}, reached ${reached}`;
	io.out(line);
	io.summary(`- ${line}`);
	return reached > 0 ? EXIT.reached : EXIT.unreached;
}

const USAGE =
	"usage: node scripts/notify-fallback.mjs mask | send --workflow <name> --conclusion <c> --install <outcome> --database-exit <code>";

export async function main(argv, environment, io) {
	const [command, ...rest] = argv;
	if (command === "mask") {
		if (rest.length > 0) {
			io.err(USAGE);
			return EXIT.usage;
		}
		for (const line of maskValues(environment)) {
			io.out(line);
		}
		return EXIT.reached;
	}
	if (command !== "send") {
		io.err(USAGE);
		return EXIT.usage;
	}
	let values;
	try {
		values = parseArgs({
			args: rest,
			options: {
				workflow: { type: "string" },
				conclusion: { type: "string" },
				install: { type: "string" },
				"database-exit": { type: "string" },
			},
			strict: true,
			allowPositionals: false,
		}).values;
	} catch {
		io.err(USAGE);
		return EXIT.usage;
	}
	const workflow = text(values.workflow);
	const conclusion = text(values.conclusion);
	if (workflow === "" || conclusion === "") {
		io.err(USAGE);
		return EXIT.usage;
	}
	return sendFallback(
		{
			workflow,
			conclusion,
			install: text(values.install),
			databaseExit: text(values["database-exit"]),
		},
		environment,
		io,
	);
}

function processIo(environment) {
	return {
		out: (line) => process.stdout.write(`${line}\n`),
		err: (line) => process.stderr.write(`${line}\n`),
		summary: (line) => {
			const file = environment.GITHUB_STEP_SUMMARY;
			if (file) {
				try {
					appendFileSync(file, `${line}\n`);
				} catch {
					process.stderr.write("fallback: the job summary is not writable\n");
				}
			}
		},
		now: () => new Date(),
		fetch: (url, init) => fetch(url, init),
	};
}

const invokedDirectly =
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
	const code = await main(
		process.argv.slice(2),
		process.env,
		processIo(process.env),
	);
	process.exitCode = code;
}
