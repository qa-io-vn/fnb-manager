import { describe, expect, it } from "vitest";
import {
	baseUrlOverrideWarnings,
	claimableSecretNames,
	createAdapterRegistry,
	credentialKindOf,
	hasBaseUrlOverride,
	PROVIDER_BASE_URLS,
	presentSecretNames,
	providerBaseUrl,
	providersUseLoopback,
	resolveSecret,
} from "../../../src/index.js";

const ENVIRONMENT = {
	NOTIFY_ZALO_BOT_TOKEN: "synthetic-bot-token",
	NOTIFY_ZALO_BOT_TOKEN_2: "synthetic-bot-token-2",
	NOTIFY_TELEGRAM_BOT_TOKEN: "synthetic-telegram-token",
	NOTIFY_EMAIL_API_KEY: "synthetic-email-key",
	NOTIFY_WEBHOOK_SECRET: "synthetic-webhook-secret",
	NOTIFY_EMAIL_FROM: "sender@example.com",
	POS_ACCOUNTS_JSON: '[{"key":"synthetic"}]',
	SUPABASE_DB_URL: "postgresql://synthetic@127.0.0.1/postgres",
	NOTIFY_EMPTY: "",
};

describe("secrets by reference", () => {
	it("resolves a secret only under the kind's own prefix", () => {
		expect(
			resolveSecret("zalo_bot", "NOTIFY_ZALO_BOT_TOKEN", ENVIRONMENT),
		).toBe("synthetic-bot-token");
		expect(
			resolveSecret("zalo_bot", "NOTIFY_ZALO_BOT_TOKEN_2", ENVIRONMENT),
		).toBe("synthetic-bot-token-2");
		expect(
			resolveSecret("telegram", "NOTIFY_TELEGRAM_BOT_TOKEN", ENVIRONMENT),
		).toBe("synthetic-telegram-token");
		expect(resolveSecret("email", "NOTIFY_EMAIL_API_KEY", ENVIRONMENT)).toBe(
			"synthetic-email-key",
		);
		expect(resolveSecret("webhook", "NOTIFY_WEBHOOK_SECRET", ENVIRONMENT)).toBe(
			"synthetic-webhook-secret",
		);
	});

	it("refuses other variables, wrong prefixes, empty values and malformed names", () => {
		expect(
			resolveSecret("zalo_bot", "POS_ACCOUNTS_JSON", ENVIRONMENT),
		).toBeNull();
		expect(
			resolveSecret("zalo_bot", "SUPABASE_DB_URL", ENVIRONMENT),
		).toBeNull();
		expect(resolveSecret("email", "SUPABASE_DB_URL", ENVIRONMENT)).toBeNull();
		expect(
			resolveSecret("zalo_bot", "NOTIFY_EMAIL_API_KEY", ENVIRONMENT),
		).toBeNull();
		expect(
			resolveSecret("email", "NOTIFY_ZALO_BOT_TOKEN", ENVIRONMENT),
		).toBeNull();
		expect(
			resolveSecret("telegram", "NOTIFY_ZALO_BOT_TOKEN", ENVIRONMENT),
		).toBeNull();
		expect(
			resolveSecret("webhook", "NOTIFY_EMAIL_FROM", ENVIRONMENT),
		).toBeNull();
		expect(
			resolveSecret("zalo_bot", "NOTIFY_ZALO_BOT_TOKEN_MISSING", ENVIRONMENT),
		).toBeNull();
		expect(
			resolveSecret("zalo_bot", "notify_zalo_bot_token", ENVIRONMENT),
		).toBeNull();
		expect(resolveSecret("zalo_oa", "NOTIFY_EMPTY", ENVIRONMENT)).toBeNull();
	});

	it("lists only credential names, never values, and claims only kinds with a built adapter", () => {
		const names = presentSecretNames(ENVIRONMENT);
		expect(names).toEqual([
			"NOTIFY_EMAIL_API_KEY",
			"NOTIFY_TELEGRAM_BOT_TOKEN",
			"NOTIFY_WEBHOOK_SECRET",
			"NOTIFY_ZALO_BOT_TOKEN",
			"NOTIFY_ZALO_BOT_TOKEN_2",
		]);
		expect(JSON.stringify(names)).not.toContain("synthetic");
		expect(claimableSecretNames(names, createAdapterRegistry())).toEqual([
			"NOTIFY_EMAIL_API_KEY",
			"NOTIFY_ZALO_BOT_TOKEN",
			"NOTIFY_ZALO_BOT_TOKEN_2",
		]);
		expect(credentialKindOf("NOTIFY_ZALO_BOT_TOKEN_IT")).toBe("zalo_bot");
		expect(credentialKindOf("NOTIFY_EMAIL_FROM")).toBeNull();
	});

	it("keeps provider hosts constant and accepts an override only for a loopback test server", () => {
		expect(providerBaseUrl("zalo_bot", {})).toBe(
			"https://bot-api.zaloplatforms.com",
		);
		expect(PROVIDER_BASE_URLS.telegram).toBe("https://api.telegram.org");
		expect(PROVIDER_BASE_URLS.brevo).toBe("https://api.brevo.com");
		expect(PROVIDER_BASE_URLS.resend).toBe("https://api.resend.com");
		expect(
			providerBaseUrl("zalo_bot", {
				NOTIFY_ZALO_BOT_BASE_URL: "http://127.0.0.1:8787",
			}),
		).toBe("http://127.0.0.1:8787");
		expect(
			providerBaseUrl("zalo_bot", {
				NOTIFY_ZALO_BOT_BASE_URL: "http://localhost:54321",
			}),
		).toBe("http://localhost:54321");
		for (const value of [
			"https://attacker.example.com",
			"http://10.0.0.1:8787",
			"http://127.0.0.1",
			"http://127.0.0.1:8787/path",
			"http://127.0.0.1.example.com:8787",
		]) {
			expect(
				providerBaseUrl("zalo_bot", { NOTIFY_ZALO_BOT_BASE_URL: value }),
			).toBe("https://bot-api.zaloplatforms.com");
		}
		const warnings = baseUrlOverrideWarnings({
			NOTIFY_ZALO_BOT_BASE_URL: "https://attacker.example.com",
		});
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).not.toContain("attacker");
		expect(
			baseUrlOverrideWarnings({
				NOTIFY_ZALO_BOT_BASE_URL: "http://127.0.0.1:8787",
			}),
		).toEqual([]);
	});

	it("knows when an override is set and when every provider points at the loopback server", () => {
		expect(hasBaseUrlOverride({})).toBe(false);
		expect(
			hasBaseUrlOverride({
				NOTIFY_ZALO_BOT_BASE_URL: "https://attacker.example.com",
			}),
		).toBe(true);
		expect(
			hasBaseUrlOverride({ NOTIFY_WEBHOOK_BASE_URL: "http://127.0.0.1:1234" }),
		).toBe(true);
		expect(
			providersUseLoopback(["zalo_bot"], {
				NOTIFY_ZALO_BOT_BASE_URL: "http://127.0.0.1:8787",
			}),
		).toBe(true);
		expect(providersUseLoopback(["zalo_bot"], {})).toBe(false);
		expect(
			providersUseLoopback(["zalo_bot", "telegram"], {
				NOTIFY_ZALO_BOT_BASE_URL: "http://127.0.0.1:8787",
			}),
		).toBe(false);
	});
});
