import { describe, expect, it } from "vitest";
import { catalogs } from "../i18n/catalog";
import {
	CHECKIN_REFUSALS,
	QUEUE_KINDS,
	QUEUE_OUTCOMES,
	REDEMPTION_REFUSALS,
	REQUEST_KINDS,
	REQUEST_STATES,
	VISIT_PATHS,
	VISIT_STATES,
} from "./contract";
import loyaltyEn from "./i18n/en.json";
import loyaltyVi from "./i18n/vi.json";

const sources = import.meta.glob(
	[
		"./*.{ts,tsx}",
		"../check-in/*.tsx",
		"../redemption/*.tsx",
		"../member-lookup/*.tsx",
		"../approvals/*.{ts,tsx}",
		"../app.tsx",
		"!./*.test.{ts,tsx}",
		"!../**/*.test.{ts,tsx}",
	],
	{ query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const LITERAL_KEY =
	/(?:\bt\(|(?:titleKey|refusedKey|unreadableKey|invalidKey)=)\s*"([a-z][\w.]*)"/g;

const LOYALTY_KEY =
	/"((?:loyalty|checkin|redeem|lookup|request|requests|queue)\.[\w.]+)"/g;

function literalKeys(): string[] {
	const keys = new Set<string>();
	for (const text of Object.values(sources))
		for (const pattern of [LITERAL_KEY, LOYALTY_KEY])
			for (const match of text.matchAll(pattern))
				if (match[1] !== undefined) keys.add(match[1]);
	return [...keys].sort();
}

function dynamicKeys(): string[] {
	return [
		...[...CHECKIN_REFUSALS, "other"].map((key) => `checkin.refusal.${key}`),
		...["matched", "queued"].map((key) => `checkin.result.${key}`),
		...[...REDEMPTION_REFUSALS, "other"].map((key) => `redeem.refusal.${key}`),
		...[...REDEMPTION_REFUSALS, "other"]
			.filter((key) => key !== "used")
			.map((key) => `redeem.refusal.${key}Body`),
		...["pos_discount", "voucher_code"].flatMap((key) => [
			`redeem.instruction.${key}`,
			`redeem.pendingBody.${key}`,
		]),
		...VISIT_STATES.map((key) => `loyalty.state.${key}`),
		...VISIT_PATHS.map((key) => `lookup.path.${key}`),
		...["suspended", "closed"].map((key) => `lookup.status.${key}`),
		...REQUEST_KINDS.map((key) => `request.title.${key}`),
		...["number", "zero", "large"].map((key) => `request.problem.${key}`),
		...REQUEST_STATES.map((key) => `requests.state.${key}`),
		...QUEUE_KINDS.map((key) => `queue.kind.${key}`),
		...QUEUE_OUTCOMES.map((key) => `queue.done.${key}`),
	];
}

describe("the loyalty texts", () => {
	it("cover every key the loyalty screens use, in both languages", () => {
		const used = literalKeys();
		expect(used.length).toBeGreaterThan(100);
		const wanted = [...used, ...dynamicKeys()];
		expect(wanted.filter((key) => catalogs.vi[key] === undefined)).toEqual([]);
		expect(wanted.filter((key) => catalogs.en[key] === undefined)).toEqual([]);
	});

	it("keep the loyalty catalogue to keys the screens use", () => {
		const wanted = new Set([...literalKeys(), ...dynamicKeys()]);
		expect(Object.keys(loyaltyVi).filter((key) => !wanted.has(key))).toEqual(
			[],
		);
		expect(Object.keys(loyaltyEn).sort()).toEqual(
			Object.keys(loyaltyVi).sort(),
		);
	});

	it("say a reused code is used, and never write a phone or a link", () => {
		expect(catalogs.vi["redeem.refusal.used"]).toBe("Mã đã được sử dụng");
		expect(catalogs.vi["loyalty.state.pending"]).toBe("Đang chờ xác nhận");
		for (const message of [
			...Object.values(loyaltyVi),
			...Object.values(loyaltyEn),
		]) {
			expect(message).not.toMatch(/\d{9,}|https?:|www\./);
		}
	});
});
