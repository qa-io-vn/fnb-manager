import { describe, expect, it } from "vitest";
import { messages } from "../../i18n";
import { SettingsWriteError } from "../source";
import { RATE_LIMITED } from "./source";
import {
	ageParts,
	canResend,
	capValid,
	decisionKey,
	disabledKey,
	isIanaZone,
	kindKey,
	paramValid,
	parseParamValue,
	RULE_LABEL_KEYS,
	reasonOf,
	testOutcomeOf,
	windowValid,
	writeErrorKey,
} from "./words";

const NOW = Date.parse("2026-11-20T10:00:00Z");

describe("notify words", () => {
	it("labels every catalogue rule in both languages", () => {
		for (const key of Object.values(RULE_LABEL_KEYS)) {
			expect(messages.vi[key]).toBeTruthy();
			expect(messages.en[key]).toBeTruthy();
		}
	});

	it("names the counter confirmation anomaly rule of the staff mode", () => {
		expect(RULE_LABEL_KEYS.loyalty_staff_anomaly).toBe(
			"settings.notify.rule.loyalty_staff_anomaly",
		);
		expect(messages.vi["settings.notify.rule.loyalty_staff_anomaly"]).toBe(
			"Bất thường xác nhận tại quầy",
		);
	});

	it("maps known and unknown codes to words without leaking raw keys", () => {
		expect(kindKey("zalo_bot")).toBe("settings.notify.kind.zalo_bot");
		expect(kindKey("sms")).toBe("settings.notify.kind.other");
		expect(disabledKey(null)).toBe("settings.notify.disabled.other");
		expect(disabledKey("consent_withdrawn")).toBe(
			"settings.notify.disabled.consent_withdrawn",
		);
		expect(reasonOf("token_invalid").key).toBe(
			"settings.notify.reason.token_invalid",
		);
		expect(reasonOf("weird_code")).toEqual({
			key: "settings.notify.reason.other",
			params: { code: "weird_code" },
		});
		expect(decisionKey("send")).toBeNull();
		expect(decisionKey(null)).toBeNull();
		expect(decisionKey("outside_window")).toBe(
			"settings.notify.decision.outside_window",
		);
		expect(decisionKey("something_new")).toBe("settings.notify.decision.other");
	});

	it("maps write errors: rate limit, forbidden, floor, invalid, network (decision table)", () => {
		expect(writeErrorKey("invalid", RATE_LIMITED)).toBe(
			"settings.notify.error.rateLimited",
		);
		expect(writeErrorKey("forbidden", null)).toBe(
			"settings.notify.error.forbidden",
		);
		expect(writeErrorKey("invalid", "channel_policies_advertising_floor")).toBe(
			"settings.notify.error.floor",
		);
		expect(writeErrorKey("invalid", null)).toBe(
			"settings.notify.error.invalid",
		);
		expect(writeErrorKey("network", null)).toBe(
			"settings.notify.error.network",
		);
		expect(writeErrorKey("duplicate", null)).toBe(
			"settings.notify.error.duplicate",
		);
		expect(new SettingsWriteError("invalid", RATE_LIMITED).constraint).toBe(
			RATE_LIMITED,
		);
	});

	it("turns a test message's state into an outcome over time (state transitions)", () => {
		const base = {
			id: "m",
			decision: null,
			holdReason: null,
			notBefore: null,
			sentAt: null,
			lastErrorCode: null,
		};
		expect(
			testOutcomeOf({ ...base, status: "queued" }, 6000, 60000, true),
		).toEqual({
			kind: "waiting",
		});
		expect(
			testOutcomeOf(
				{ ...base, status: "sent", sentAt: "2026-11-20T10:00:06Z" },
				6000,
				60000,
				true,
			),
		).toEqual({ kind: "sent", at: "2026-11-20T10:00:06Z" });
		expect(
			testOutcomeOf({ ...base, status: "queued" }, 60000, 60000, true),
		).toEqual({ kind: "stillQueued", scheduleOff: false });
		expect(
			testOutcomeOf({ ...base, status: "queued" }, 59999, 60000, true).kind,
		).toBe("waiting");
		expect(
			testOutcomeOf({ ...base, status: "queued" }, 2000, 60000, false),
		).toEqual({ kind: "stillQueued", scheduleOff: true });
		expect(
			testOutcomeOf(
				{ ...base, status: "failed", lastErrorCode: "token_invalid" },
				4000,
				60000,
				true,
			),
		).toEqual({ kind: "failed", code: "token_invalid" });
		expect(
			testOutcomeOf(
				{ ...base, status: "held", notBefore: "2026-11-20T23:00:00Z" },
				4000,
				60000,
				true,
			),
		).toEqual({ kind: "held", until: "2026-11-20T23:00:00Z" });
		expect(testOutcomeOf(null, 1000, 60000, true).kind).toBe("waiting");
	});

	it("offers resend only for uncertain or failed digests and alerts, to unlimited owners and managers", () => {
		expect(canResend({ kind: "alert", status: "uncertain" }, true)).toBe(true);
		expect(canResend({ kind: "digest", status: "failed" }, true)).toBe(true);
		expect(canResend({ kind: "alert", status: "uncertain" }, false)).toBe(
			false,
		);
		expect(canResend({ kind: "test", status: "failed" }, true)).toBe(false);
		expect(canResend({ kind: "alert", status: "sent" }, true)).toBe(false);
		expect(canResend({ kind: "alert", status: "queued" }, true)).toBe(false);
	});

	it("validates parameters by schema, with boundaries", () => {
		const ratio = { type: "number", min: 0.1, max: 0.99 };
		expect(paramValid(ratio, 0.1)).toBe(true);
		expect(paramValid(ratio, 0.99)).toBe(true);
		expect(paramValid(ratio, 0.09)).toBe(false);
		expect(paramValid(ratio, 1)).toBe(false);
		expect(paramValid(ratio, null)).toBe(false);
		const days = { type: "integer", min: 1, max: 8 };
		expect(paramValid(days, 8)).toBe(true);
		expect(paramValid(days, 8.5)).toBe(false);
		expect(paramValid({ type: "time" }, "06:30")).toBe(true);
		expect(paramValid({ type: "time" }, "24:00")).toBe(false);
		expect(paramValid({ type: "boolean" }, false)).toBe(true);
		expect(paramValid({ type: "enum", values: ["baseline"] }, "previous")).toBe(
			false,
		);
		expect(parseParamValue("number", "0,5")).toBe(0.5);
		expect(parseParamValue("integer", "")).toBeNull();
		expect(parseParamValue("number", "abc")).toBeNull();
		expect(parseParamValue("boolean", "true")).toBe(true);
	});

	it("checks the sending window, 24:00 and a window across midnight, and the daily cap", () => {
		expect(windowValid("", "")).toBe(true);
		expect(windowValid("07:00", "24:00")).toBe(true);
		expect(windowValid("22:00", "06:00")).toBe(true);
		expect(windowValid("24:00", "06:00")).toBe(false);
		expect(windowValid("07:00", "")).toBe(false);
		expect(windowValid("7h", "21:00")).toBe(false);
		expect(capValid("")).toBe(true);
		expect(capValid("1")).toBe(true);
		expect(capValid("1000")).toBe(true);
		expect(capValid("0")).toBe(false);
		expect(capValid("1001")).toBe(false);
		expect(capValid("2.5")).toBe(false);
	});

	it("accepts IANA zones only and rounds ages", () => {
		expect(isIanaZone("Asia/Ho_Chi_Minh")).toBe(true);
		expect(isIanaZone("Mars/Base")).toBe(false);
		expect(isIanaZone("<script>")).toBe(false);
		expect(ageParts(null, NOW)).toBeNull();
		expect(ageParts("2026-11-20T09:59:40Z", NOW)?.key).toBe(
			"settings.notify.age.now",
		);
		expect(ageParts("2026-11-20T09:01:00Z", NOW)).toEqual({
			key: "settings.notify.age.minutes",
			count: 59,
		});
		expect(ageParts("2026-11-18T11:00:00Z", NOW)).toEqual({
			key: "settings.notify.age.hours",
			count: 47,
		});
		expect(ageParts("2026-11-18T10:00:00Z", NOW)).toEqual({
			key: "settings.notify.age.days",
			count: 2,
		});
	});
});
