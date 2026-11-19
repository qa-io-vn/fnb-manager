import { describe, expect, it } from "vitest";
import { catalogs } from "../i18n/catalog";
import {
	DESTINATION_STATES_SHOWN,
	DISABLED_REASONS,
} from "../notifications/contract";
import { REQUEST_DECISIONS, REQUEST_STATUSES } from "../requests/contract";
import teamEn from "./i18n/en.json";
import teamVi from "./i18n/vi.json";

const sources = import.meta.glob(
	[
		"./*.{ts,tsx}",
		"../announcements/*.{ts,tsx}",
		"../requests/*.{ts,tsx}",
		"../notifications/*.{ts,tsx}",
		"../profile/*.tsx",
		"!./*.test.{ts,tsx}",
		"!../**/*.test.{ts,tsx}",
	],
	{ query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const TEAM_KEY = /"((?:team|notices|ask|approvals|notify)\.[\w.]+[a-zA-Z])"/g;

function literalKeys(): string[] {
	const keys = new Set<string>();
	for (const text of Object.values(sources))
		for (const match of text.matchAll(TEAM_KEY))
			if (match[1] !== undefined) keys.add(match[1]);
	return [...keys].sort();
}

function dynamicKeys(): string[] {
	return [
		...["title", "body"].flatMap((field) =>
			["empty", "long"].map((problem) => `notices.problem.${field}.${problem}`),
		),
		"notices.problem.stores.empty",
		...["kind", "empty", "long"].map((problem) => `ask.problem.${problem}`),
		...REQUEST_STATUSES.map((status) => `ask.status.${status}`),
		...REQUEST_DECISIONS.map((status) => `ask.decidedAt.${status}`),
		...REQUEST_DECISIONS.map((status) => `approvals.done.${status}`),
		...["empty", "long"].map((problem) => `approvals.problem.${problem}`),
		...DESTINATION_STATES_SHOWN.map((state) => `notify.state.${state}`),
		...DISABLED_REASONS.map((reason) => `notify.reason.${reason}`),
	];
}

describe("the phase 15 texts", () => {
	it("cover every key the screens use, in both languages", () => {
		const wanted = [...literalKeys(), ...dynamicKeys()];
		expect(wanted.length).toBeGreaterThan(120);
		expect(wanted.filter((key) => catalogs.vi[key] === undefined)).toEqual([]);
		expect(wanted.filter((key) => catalogs.en[key] === undefined)).toEqual([]);
	});

	it("keep the catalogue to keys the screens use, with the same keys in English", () => {
		const wanted = new Set([...literalKeys(), ...dynamicKeys()]);
		expect(Object.keys(teamVi).filter((key) => !wanted.has(key))).toEqual([]);
		expect(Object.keys(teamEn).sort()).toEqual(Object.keys(teamVi).sort());
	});

	it("never write a link or a phone number", () => {
		for (const message of [...Object.values(teamVi), ...Object.values(teamEn)])
			expect(message).not.toMatch(/\d{9,}|https?:|www\./);
		expect(catalogs.vi["notices.read"]).toBe("Đã đọc");
		expect(catalogs.vi["notify.title"]).toBe("Nhận thông báo");
		expect(catalogs.vi["ask.title"]).toBe("Gửi yêu cầu");
		expect(catalogs.vi["ask.mine"]).toBe("Yêu cầu của tôi");
	});
});
