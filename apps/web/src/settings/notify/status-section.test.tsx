// Test design (ISTQB, G-101, ADR-045): the owner's notice that no alert is being sent while no destination works.
// Decision table over the login (an owner who sees every destination, a store-limited owner, a manager) and the
// destinations (none, only disabled, only pending, an active one, a failing one, an active one switched off), boundary
// values at one working destination among many that do not work, equivalence over both languages, and a negative case
// for the other notes of the section (the notice never replaces the schedule or quota notes).
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n";
import type { Destination, DestinationStatus, NotifyOverview } from "./source";
import { noWorkingDestination, StatusSection } from "./status-section";

function destination(
	status: DestinationStatus,
	enabled = true,
	id = `d-${status}-${enabled}`,
): Destination {
	return {
		id,
		kind: "zalo_bot",
		provider: "zalo_bot",
		label: "Zalo Bot",
		status,
		enabled,
		disabledReason: null,
		addressHint: null,
		mine: true,
		hasMember: true,
		memberRole: "owner",
		memberEmail: null,
		storeIds: null,
		mutedRules: [],
		timezone: null,
		linkedAt: null,
		lastOkAt: null,
		lastErrorCode: null,
		lastErrorAt: null,
		consecutiveFailures: 0,
		secretReported: true,
	};
}

function overview(over: Partial<NotifyOverview> = {}): NotifyOverview {
	return {
		role: "owner",
		storeLimited: false,
		scheduleEnabled: true,
		lastTickAt: null,
		lastDispatchAt: null,
		dispatcherSecrets: [],
		destinations: [],
		held24h: 0,
		uncertain24h: 0,
		failed24h: 0,
		pendingLinks: 0,
		zaloBotMonth: 10,
		zaloBotQuota: 3000,
		...over,
	};
}

function show(data: NotifyOverview, language: "vi" | "en" = "vi") {
	return render(
		<I18nProvider language={language} onLanguageChange={() => undefined}>
			<StatusSection
				overview={data}
				failed={false}
				onRetry={() => undefined}
				now={Date.parse("2026-11-23T03:00:00Z")}
			/>
		</I18nProvider>,
	);
}

describe("noWorkingDestination", () => {
	it.each([
		{ label: "no destination at all", rows: [], expected: true },
		{
			label: "only a switched-off one",
			rows: [destination("disabled", false)],
			expected: true,
		},
		{
			label: "only one that waits for confirmation",
			rows: [destination("pending")],
			expected: true,
		},
		{
			label: "an active one that was switched off",
			rows: [destination("active", false)],
			expected: true,
		},
		{
			label: "an active one",
			rows: [destination("active")],
			expected: false,
		},
		{
			label: "a failing one: it is still tried",
			rows: [destination("failing")],
			expected: false,
		},
		{
			label: "one working among several that do not",
			rows: [
				destination("disabled", false, "a"),
				destination("pending", true, "b"),
				destination("active", true, "c"),
			],
			expected: false,
		},
	])("is $expected for $label", ({ rows, expected }) => {
		expect(noWorkingDestination(overview({ destinations: rows }))).toBe(
			expected,
		);
	});

	it("tells only an owner who sees every destination", () => {
		expect(noWorkingDestination(overview({ role: "manager" }))).toBe(false);
		expect(noWorkingDestination(overview({ storeLimited: true }))).toBe(false);
		expect(noWorkingDestination(overview({ role: "staff" }))).toBe(false);
	});
});

describe("the notice in the status section", () => {
	it("is shown to the owner with no working destination, in Vietnamese", () => {
		show(overview());
		const note = screen.getByTestId("notify-no-destination");
		expect(note).toHaveTextContent(
			"Chưa có nơi nhận tin nào đang hoạt động, nên cảnh báo, kể cả nhắc hạn trả lời yêu cầu về dữ liệu cá nhân, chưa được gửi đi.",
		);
	});

	it("is shown in English", () => {
		show(overview(), "en");
		expect(screen.getByTestId("notify-no-destination")).toHaveTextContent(
			"No destination is working, so alerts, including the reminders about deadlines for personal-data requests, are not being sent.",
		);
	});

	it("is not shown when a destination works", () => {
		show(overview({ destinations: [destination("active")] }));
		expect(screen.queryByTestId("notify-no-destination")).toBeNull();
	});

	it("is not shown to a manager or to a store-limited login", () => {
		show(overview({ role: "manager" }));
		expect(screen.queryByTestId("notify-no-destination")).toBeNull();
	});

	it("sits beside the other notes and replaces none of them", () => {
		show(
			overview({
				scheduleEnabled: false,
				zaloBotMonth: 2600,
				zaloBotQuota: 3000,
			}),
		);
		expect(screen.getByTestId("notify-no-destination")).toBeVisible();
		expect(screen.getByTestId("notify-schedule")).toHaveTextContent(
			"Lịch gửi tự động đang tắt",
		);
		expect(screen.getByTestId("notify-quota-high")).toBeVisible();
	});

	it("carries no personal data: the text is fixed and names no person or contact", () => {
		show(overview());
		expect(screen.getByTestId("notify-no-destination").textContent).not.toMatch(
			/@|\d{9,}/,
		);
	});
});
